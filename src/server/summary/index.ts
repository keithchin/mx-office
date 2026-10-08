// A floor's project summary, for the panel above its board: what the project is for and where it
// stands (project.ts), how far along its issues, PRs and queue are, who's working on what, what just
// happened, what's in the way, and a few sentences saying it all in plain English (narrate.ts). Built
// from what the office already keeps (the floor's workers, queue and GitHub lists, the analyzer's run
// records): nothing here asks GitHub or runs a script on a request.

import type { WorkerInfo } from '../../shared/protocol.js';
import type { ActivityItem, ProjectSummary, Risk, SummaryAgent } from '../../shared/summary.js';
import { modelLabel, type RunRecord } from '../../shared/analysis.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { analysisOf } from '../analysis/index.js';
import { gh } from '../github.js';
import type { Haiku } from '../analysis/llm.js';
import { Narrator } from './narrate.js';
import { projectFacts } from './project.js';
import { waitsOnPerson } from '../../shared/progress.js';

/** Waiting on a person longer than this is a risk, not just a wait. */
export const WAIT_RISK_MS = 10 * 60_000;
/** Working with nothing changing (no tool call, no new spend) for longer than this looks stuck. */
export const STALL_RISK_MS = 15 * 60_000;
const ACTIVITY_SHOWN = 10;
const LOG_KEPT = 40;

interface Seen {
  sig: string;
  status: string;
  changedAt: number;
}

export class Summaries {
  /** What the office saw happen that nothing else keeps: agents stopping on a question. By floor, latest last. */
  private log = new Map<string, ActivityItem[]>();
  private seen = new Map<string, Seen>();
  private descriptions = new Map<string, string>();
  private narrator: Narrator;

  constructor(
    haiku: Haiku | null,
    private ledger: { overBudget: boolean },
    private runs: () => RunRecord[],
  ) {
    this.narrator = new Narrator(haiku);
  }

  /** Every worker update: notes when anything about it changed, and when it stops to wait on someone. */
  onWorker(floor: Floor, w: WorkerInfo) {
    const before = this.seen.get(w.id);
    this.observe(w);
    if (w.kind === 'agent' && w.status === 'needs_input' && before?.status !== 'needs_input') this.note(floor.id, { at: Date.now(), kind: 'needs', text: `${w.name} is waiting on a human${w.activity ? `: ${clip(w.activity, 80)}` : ''}` });
  }

  summary(floor: Floor): ProjectSummary {
    const s = this.facts(floor);
    return { ...s, ...this.narrator.narrative(floor.id, s) };
  }

  /** The summary's facts without its narrative, so a page that only counts (the home page's statistics) never asks the small model. */
  facts(floor: Floor): Omit<ProjectSummary, 'narrative' | 'narrativeBy'> {
    const now = Date.now();
    const workers = floor.workers.list().filter((w) => w.kind === 'agent');
    for (const w of workers) if (!this.seen.has(w.id)) this.observe(w);
    const tasks = floor.queue.state().tasks;
    const issues = floor.github.issues.items;
    const pulls = floor.github.pulls.items;
    const runs = this.runs().filter((r) => r.floor === floor.id);

    const agents: SummaryAgent[] = workers.map((w) => {
      const seen = this.seen.get(w.id);
      const waiting = w.status === 'needs_input' ? now - (w.waitingSince ?? seen?.changedAt ?? now) : undefined;
      const quiet = w.status === 'working' ? now - Math.max(seen?.changedAt ?? 0, w.workingSince ?? 0) : undefined;
      const on = w.task?.name ?? w.title ?? clip(w.prompt ?? 'No task yet', 60);
      const doing = w.status === 'working' ? (w.task?.summary ?? w.activity ?? 'working') : w.status === 'needs_input' ? `waiting on a human${w.activity ? `: ${clip(w.activity, 80)}` : ''}` : w.pr ? `done, PR #${w.pr.number}` : w.status;
      return { id: w.id, name: w.name, color: w.color, model: w.usage?.model ? modelLabel(w.usage.model) : w.model, status: w.status, doing: `${on} — ${doing}`, waitingMs: waiting, quietMs: quiet };
    });
    const waiting = agents.filter((a) => a.waitingMs !== undefined);
    const needsHuman = { count: waiting.length, longestMs: Math.max(0, ...waiting.map((a) => a.waitingMs!)) };

    const openPrs = pulls.filter((p) => p.state === 'OPEN');
    const merged = pulls.filter((p) => p.state === 'MERGED');
    const closedIssues = issues.filter((i) => i.state !== 'OPEN');
    const progress = {
      issuesOpen: issues.filter((i) => i.state === 'OPEN').length,
      issuesClosed: closedIssues.length,
      issuesClosedCapped: closedIssues.length >= 40,
      prsOpen: openPrs.length,
      prsMerged: merged.length,
      prsMergedCapped: merged.length >= 30,
      queued: tasks.filter((t) => t.status === 'queued').length,
      running: tasks.filter((t) => t.status === 'running').length,
      done: tasks.filter((t) => t.status === 'done').length,
    };

    // Spend: the workers here now, plus the recorded runs of the ones that have gone home.
    const here = new Set(workers.map((w) => w.id));
    const today = new Date().toDateString();
    const isToday = (t: number | undefined) => !!t && new Date(t).toDateString() === today;
    const runOf = new Map(runs.map((r) => [r.workerId, r]));
    let total = 0;
    let spentToday = 0;
    for (const w of workers) {
      const cost = w.usage?.cost ?? 0;
      total += cost;
      if (isToday(runOf.get(w.id)?.endedAt ?? w.workingSince ?? w.createdAt) || w.status === 'working') spentToday += cost;
    }
    for (const r of runs) {
      if (here.has(r.workerId)) continue;
      total += r.cost;
      if (isToday(r.endedAt)) spentToday += r.cost;
    }

    const risks: Risk[] = [];
    for (const a of waiting) if (a.waitingMs! > WAIT_RISK_MS) risks.push({ level: 'bad', text: `${a.name} has waited on a human for ${mins(a.waitingMs!)}` });
    for (const p of openPrs) if (p.checks === 'fail') risks.push({ level: 'bad', text: `PR #${p.number} has failing checks: ${clip(p.title, 70)}` });
    for (const a of agents) if (a.quietMs !== undefined && a.quietMs > STALL_RISK_MS) risks.push({ level: 'warn', text: `${a.name} has shown no progress for ${mins(a.quietMs)}` });
    if (this.ledger.overBudget) risks.push({ level: 'bad', text: "Today's budget is spent" });
    const facts = { ...projectFacts(floor.dir) };
    // No README or intake to say what it's for: the GitHub repository's own description, once gh has said it.
    if (!facts.goal) {
      const about = this.about(floor.dir);
      if (about) Object.assign(facts, { goal: about, goalFrom: 'the GitHub repository description' });
    }
    // A gate failing only for a missing sign-off is waiting on a person, not broken (waitsOnPerson): not a risk.
    const failing = facts.phase?.stages.filter((s) => s.status === 'FAIL' && !waitsOnPerson(s.detail)) ?? [];
    if (failing.length) risks.push({ level: 'warn', text: `${failing.length} toolkit gate${failing.length === 1 ? '' : 's'} failing: ${failing.slice(0, 3).map((s) => s.title).join(', ')}` });

    const activity = this.activity(floor, workers, runs).slice(0, ACTIVITY_SHOWN);
    return {
      floor: floor.id,
      name: floor.def.name,
      repo: floor.def.repo,
      ...facts,
      progress,
      agents,
      needsHuman,
      spend: { today: round(spentToday), total: round(total) },
      activity,
      risks,
      generatedAt: now,
    };
  }

  /** The latest things that happened on the floor, latest first, from everything the office keeps. */
  private activity(floor: Floor, workers: WorkerInfo[], runs: RunRecord[]): ActivityItem[] {
    const out: ActivityItem[] = [...(this.log.get(floor.id) ?? [])];
    const ts = (iso: string) => Date.parse(iso) || 0;
    for (const w of workers) out.push({ at: w.createdAt, kind: 'started', text: `${w.name} started: ${clip(w.task?.name ?? w.title ?? w.prompt ?? 'a task', 70)}` });
    const finished = new Set<string>();
    for (const r of runs) {
      if (r.outcome === 'running' || r.excluded) continue;
      finished.add(r.workerId);
      out.push({ at: r.endedAt, kind: 'finished', text: `${r.worker} (${r.modelLabel}) finished ${clip(r.title, 60)}${r.pr ? ` → PR #${r.pr.number}` : ' (no PR)'}` });
    }
    for (const t of floor.queue.state().tasks) {
      if (t.finishedAt && t.workerId && !finished.has(t.workerId)) out.push({ at: t.finishedAt, kind: 'finished', text: `${t.workerName ?? 'An agent'} finished ${clip(t.title, 60)}` });
    }
    for (const p of floor.github.pulls.items) {
      out.push({ at: ts(p.createdAt), kind: 'pr-opened', text: `PR #${p.number} opened: ${clip(p.title, 70)}` });
      if (p.state === 'MERGED') out.push({ at: ts(p.updatedAt), kind: 'pr-merged', text: `PR #${p.number} merged` });
      else if (p.state === 'CLOSED') out.push({ at: ts(p.updatedAt), kind: 'pr-closed', text: `PR #${p.number} closed without merging` });
      else if (p.reviewDecision === 'APPROVED') out.push({ at: ts(p.updatedAt), kind: 'approved', text: `PR #${p.number} approved` });
    }
    for (const i of floor.github.issues.items) {
      out.push({ at: ts(i.createdAt), kind: 'issue-opened', text: `Issue #${i.number} opened: ${clip(i.title, 70)}` });
      if (i.state !== 'OPEN') out.push({ at: ts(i.updatedAt), kind: 'issue-closed', text: `Issue #${i.number} closed` });
    }
    return out.filter((a) => a.at > 0).sort((a, b) => b.at - a.at);
  }

  /** The repository's description: asked of gh once per floor, in the background, and '' until it answers. */
  private about(dir: string): string {
    if (!this.descriptions.has(dir)) {
      this.descriptions.set(dir, '');
      void gh(['repo', 'view', '--json', 'description', '--jq', '.description'], dir, 20_000)
        .then((out) => this.descriptions.set(dir, out.trim().slice(0, 400)))
        .catch(() => {});
    }
    return this.descriptions.get(dir)!;
  }

  private observe(w: WorkerInfo) {
    const sig = `${w.status}|${w.activity ?? ''}|${w.usage?.calls ?? 0}`;
    const before = this.seen.get(w.id);
    if (before?.sig === sig) return;
    this.seen.set(w.id, { sig, status: w.status, changedAt: Date.now() });
  }

  /** Something the project team did that nothing else keeps (a review nudge, an escalation, a PR labelled). */
  noteTeam(floor: string, text: string) {
    this.note(floor, { at: Date.now(), kind: 'team', text });
  }

  private note(floor: string, item: ActivityItem) {
    const list = this.log.get(floor) ?? [];
    list.push(item);
    this.log.set(floor, list.slice(-LOG_KEPT));
  }
}

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};
export const mins = (ms: number) => (ms < 90 * 60_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : `${(ms / 3_600_000).toFixed(1)} h`);
const round = (n: number) => Math.round(n * 100) / 100;

const offices = new WeakMap<object, Summaries>();

/** The office's summaries: made on first use, sharing the analyzer's small-model budget and its run records. */
export function summaryOf(ctx: Pick<Ctx, 'cfg' | 'ledger'>): Summaries {
  let s = offices.get(ctx.cfg);
  if (!s) {
    const analysis = analysisOf(ctx);
    s = new Summaries(analysis.haiku, ctx.ledger, () => analysis.store.all());
    offices.set(ctx.cfg, s);
  }
  return s;
}
