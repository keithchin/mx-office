// Turns one worker into a run record: its transcript (transcript.ts) for time, calls and cost, its
// queue task for the issue it came from, GitHub for its pull request's fate and scorecard
// (scorecard.ts), and the analyzer agent for what kind of task it was (classify.ts). The office
// (live.ts) and the backfill from disk (disk.ts) both describe their workers the same way to it.

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { QueueTask, Usage } from '../../shared/protocol.js';
import { modelLabel, type RunOutcome, type RunRecord } from '../../shared/analysis.js';
import { gh } from '../github.js';
import { findTranscript, readSession, type SessionStats } from './transcript.js';
import { scorecardOf } from './scorecard.js';
import type { Classifier } from './classify.js';

/** A floor as the analyzer needs it, live or read from disk. */
export interface FloorRef {
  id: string;
  name: string;
  repo?: string;
  dir: string;
}

/** A worker as the analyzer needs it, live or read from disk. */
export interface WorkerSnapshot {
  id: string;
  name: string;
  provider?: string;
  model?: string;
  effort?: string;
  prompt?: string;
  title?: string;
  sessionId?: string;
  createdAt: number;
  pr?: { number: number };
  worktreePath?: string;
  /** Known exactly when read from disk (the tracker saved it); else found by session id. */
  transcript?: string;
  /** What the office tallied for it, for when its transcript is gone. */
  usage?: Usage;
  workedMs?: number;
  /** Still at it (working, or stopped mid-turn on a question). */
  running: boolean;
  needsInput?: number;
  needsInputMs?: number;
}

/** Under this many API calls with no pull request, a run is a false start (a duplicate hire, a quick question), not a result. */
export const TRIVIAL_CALLS = 10;

export const TRIVIAL_REASON = `no pull request and under ${TRIVIAL_CALLS} API calls (stopped early, a duplicate, or a quick question)`;

interface PrFacts {
  number: number;
  url: string;
  title: string;
  state: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: string;
  body: string;
  comments: string[];
  files: string[];
}

/** GitHub's answers, kept a while: an open PR is asked about again after a few minutes, a finished one never. */
export class GhCache {
  private prs = new Map<string, { at: number; facts: Promise<PrFacts | undefined> }>();
  private issues = new Map<string, Promise<{ title: string; body: string } | undefined>>();

  pr(dir: string, n: number, fresh = false): Promise<PrFacts | undefined> {
    const key = `${dir}#${n}`;
    const hit = this.prs.get(key);
    if (hit && !fresh && Date.now() - hit.at < 10 * 60_000) return hit.facts;
    const facts = gh(['pr', 'view', String(n), '--json', 'number,url,title,state,additions,deletions,changedFiles,body,comments,files,statusCheckRollup'], dir, 30_000)
      .then((out) => {
        const p = JSON.parse(out);
        return {
          number: Number(p.number),
          url: String(p.url ?? ''),
          title: String(p.title ?? ''),
          state: String(p.state ?? ''),
          additions: Number(p.additions) || 0,
          deletions: Number(p.deletions) || 0,
          changedFiles: Number(p.changedFiles) || 0,
          checks: checksOf(p.statusCheckRollup),
          body: String(p.body ?? ''),
          comments: (p.comments ?? []).map((c: any) => String(c?.body ?? '')),
          files: (p.files ?? []).map((f: any) => String(f?.path ?? '')).filter(Boolean),
        };
      })
      .catch(() => undefined);
    this.prs.set(key, { at: Date.now(), facts });
    return facts;
  }

  issue(dir: string, n: number): Promise<{ title: string; body: string } | undefined> {
    const key = `${dir}#${n}`;
    let hit = this.issues.get(key);
    if (!hit) {
      hit = gh(['issue', 'view', String(n), '--json', 'title,body'], dir, 30_000)
        .then((out) => {
          const v = JSON.parse(out);
          return { title: String(v.title ?? ''), body: String(v.body ?? '') };
        })
        .catch(() => undefined);
      this.issues.set(key, hit);
    }
    return hit;
  }
}

function checksOf(rollup: any[]): string {
  if (!Array.isArray(rollup) || !rollup.length) return 'none';
  const states = rollup.map((c) => String(c?.conclusion || c?.state || c?.status || '').toUpperCase());
  if (states.some((s) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(s))) return 'fail';
  if (states.some((s) => ['PENDING', 'EXPECTED', 'IN_PROGRESS', 'QUEUED', ''].includes(s))) return 'pending';
  return 'pass';
}

/** The issue a task came from: its queue task says, or its prompt ("Work on GitHub issue #3"). */
export function issueOf(w: Pick<WorkerSnapshot, 'prompt' | 'title'>, task?: QueueTask): number | undefined {
  if (task?.issue) return task.issue;
  const m = /\bissue\s*#(\d+)/i.exec(`${w.title ?? ''}\n${w.prompt ?? ''}`);
  return m ? Number(m[1]) : undefined;
}

export function outcomeOf(running: boolean, prState: string | undefined, hasPr: boolean): RunOutcome {
  if (running) return 'running';
  if (!hasPr) return 'no-pr';
  const s = (prState ?? '').toUpperCase();
  return s === 'MERGED' ? 'merged' : s === 'CLOSED' ? 'closed' : 'open';
}

export function exclusionOf(outcome: RunOutcome, hasPr: boolean, apiCalls: number): string | undefined {
  if (outcome === 'running') return 'still working';
  if (!hasPr && apiCalls < TRIVIAL_CALLS) return TRIVIAL_REASON;
  return undefined;
}

const emptyStats = (): SessionStats => ({ activeMs: 0, apiCalls: 0, toolCalls: 0, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, cost: 0, humanPromptsAt: [] });

export interface CollectDeps {
  gh: GhCache;
  classifier: Classifier;
  /** Whether the analyzer may ask the small model (it never does for a run still going). */
  useModel: boolean;
  /** What was recorded before, so counts seen live (waits on a human) aren't lost on a rebuild. */
  previous?: RunRecord;
  /** Ask GitHub again even if it answered recently. */
  freshPr?: boolean;
}

export async function collectRun(floor: FloorRef, w: WorkerSnapshot, task: QueueTask | undefined, deps: CollectDeps): Promise<RunRecord> {
  const cwd = w.worktreePath ? path.resolve(floor.dir, w.worktreePath) : floor.dir;
  const transcript = w.transcript && existsSync(w.transcript) ? w.transcript : findTranscript(w.sessionId, cwd);
  const stats = transcript ? readSession(transcript) : emptyStats();
  // No transcript left to read (cleared, or another provider): the office's own tally.
  if (!stats.apiCalls && w.usage) {
    stats.apiCalls = w.usage.calls;
    stats.cost = w.usage.cost;
    stats.tokens = { input: w.usage.input, output: w.usage.output, cacheWrite: w.usage.cacheWrite, cacheRead: w.usage.cacheRead };
    stats.model ??= w.usage.model;
  }
  const model = stats.model ?? w.model ?? 'unknown';
  const startedAt = stats.startedAt ?? task?.startedAt ?? w.createdAt;
  const endedAt = stats.endedAt ?? task?.finishedAt ?? startedAt;
  const prNumber = w.pr?.number ?? stats.prLinked;
  const pr = prNumber ? await deps.gh.pr(floor.dir, prNumber, deps.freshPr) : undefined;
  const issueNo = issueOf(w, task);
  const issue = issueNo ? await deps.gh.issue(floor.dir, issueNo) : undefined;
  const prev = deps.previous;
  const needsInput = Math.max(w.needsInput ?? 0, prev?.needsInput ?? 0);
  const outcome = outcomeOf(w.running, pr?.state, !!prNumber);
  const record: RunRecord = {
    id: `${floor.id}:${w.id}`,
    floor: floor.id,
    repo: floor.repo,
    worker: w.name,
    workerId: w.id,
    provider: w.provider ?? 'claude',
    model,
    modelLabel: modelLabel(model),
    effort: w.effort,
    title: (issue?.title || task?.title || w.title || w.prompt || 'Untitled task').replace(/\s+/g, ' ').trim().slice(0, 160),
    issue: issueNo,
    prompt: (w.prompt ?? '').slice(0, 2000),
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    activeMs: stats.activeMs || w.workedMs || 0,
    apiCalls: stats.apiCalls,
    toolCalls: stats.toolCalls,
    tokens: stats.tokens,
    cost: Math.round(stats.cost * 1e4) / 1e4,
    // Questions asked after the PR was opened are review, not rescue.
    humanPrompts: stats.humanPromptsAt.filter((t) => stats.prLinkedAt === undefined || t < stats.prLinkedAt).length,
    needsInput,
    needsInputMs: Math.max(w.needsInputMs ?? 0, prev?.needsInputMs ?? 0),
    outcome,
    pr: prNumber
      ? pr
        ? { number: pr.number, url: pr.url, title: pr.title, state: pr.state, additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles, checks: pr.checks }
        : (prev?.pr ?? { number: prNumber, url: '', title: '', state: 'OPEN', additions: 0, deletions: 0 })
      : undefined,
    scorecard: pr ? scorecardOf(pr.body, pr.comments) : prev?.scorecard,
    types: [],
    typesBy: 'keywords',
    excluded: exclusionOf(outcome, !!prNumber, stats.apiCalls),
    updatedAt: Date.now(),
  };
  const taskText = [issue ? `Issue #${issueNo}: ${issue.title}\n${issue.body}` : '', task?.title ?? '', w.title ?? '', w.prompt ?? '', pr ? `PR: ${pr.title}` : ''].filter(Boolean).join('\n\n');
  Object.assign(record, await deps.classifier.classify(record, { task: taskText, report: pr?.body || stats.lastText || '', files: pr?.files ?? [] }, deps.useModel && outcome !== 'running'));
  return record;
}
