// The four detectors, as pure functions of what the office already has: the PR poll's list, the build
// plan, PROJECT.md and the test reports at main, Testing's records, and the activity the book tracks.
// No AI, no GitHub calls, no clock of their own (`now` comes in): the tests drive them with fixtures.
//
// 1. Stale PR: open, not a draft, no activity (GitHub's updatedAt: commits, comments, reviews) for prHours.
// 2. Decision waiting on the PM: a pending-decisions row of the build plan that blocks rows still open,
//    or a PROJECT.md open question that's the PM's or the client's, open for decisionHours.
// 3. Failing for days: a test or journey failing the same way for failingHours (Testing's records, or the
//    build plan's "J-08 fails on #51"); linked to the stale-PR item when that PR is the cause.
// 4. Going in circles: agents working, but no merged PR, stage change or build-plan row change for circlesHours.

import type { FailingFact, StuckDraft, StuckEvidence, StuckSettings } from '../../shared/stuck.js';
import { earliestDate, failingClaims, journeysOf, openQuestions, pendingDecisions, planRows, prRefs, projectFacts, rowOpen, rowsWords, shortQuestion } from './parse.js';
import { blockedRows } from './blocked-rows.js';

const H = 3_600_000;

/** At least this much agent time inside the window before "going in circles" says anything. */
export const MIN_ACTIVE_MS = 4 * H;

export interface PullFacts {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url?: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
}

export interface RepoText {
  file: string;
  text: string;
}

export interface RepoTexts {
  plan?: RepoText;
  project?: RepoText;
  reports: RepoText[];
}

export interface ActivityFacts {
  /** When progress was last made, and what it was ("PR #50 merged"). */
  lastProgressAt: number;
  lastProgress?: string;
  /** Agent time (at least one agent working) since lastProgressAt. */
  activeMs: number;
  spend?: number;
  currency?: string;
}

export interface DetectInput {
  now: number;
  settings: StuckSettings;
  pulls: readonly PullFacts[];
  files?: RepoTexts;
  /** Testing's records worked into streaks (failingStreaks). */
  failing?: readonly FailingFact[];
  activity?: ActivityFacts;
  /** When the office first saw an id (for a fact with no date of its own). */
  firstSeen(id: string): number;
}

const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);

/** file:line (a derived JSON file's lines mean nothing, so just the file). */
const place = (file: string, line: number, extra = ''): StuckEvidence => (file.endsWith('.json') ? { label: `${file}${extra}`, file } : { label: `${file}:${line}${extra}`, file, line });

function evidenceOf(lines: { file: string; line: number }[], max = 4): StuckEvidence[] {
  return lines.slice(0, max).map((l) => place(l.file, l.line));
}

export function detectStuck(i: DetectInput): StuckDraft[] {
  if (!i.settings.on) return [];
  const out: StuckDraft[] = [];
  const plan = i.files?.plan;
  const rows = plan ? planRows(plan.text) : new Map();
  const sources = [plan, i.files?.project, ...(i.files?.reports ?? [])].filter((x): x is RepoText => !!x);
  const open = new Map(i.pulls.filter((p) => p.state === 'OPEN').map((p) => [p.number, p]));

  // 1. Stale pull requests.
  const stale = new Map<number, StuckDraft>();
  for (const p of open.values()) {
    const at = ms(p.updatedAt);
    if (p.isDraft || !Number.isFinite(at) || i.now - at < i.settings.prHours * H) continue;
    const refs = prRefs(p.number, sources, rows);
    const d: StuckDraft = {
      id: `pr-${p.number}`,
      kind: 'stale-pr',
      since: at,
      blocks: refs.blocks,
      evidence: [...(p.url ? [{ label: `PR #${p.number} on GitHub`, url: p.url }] : []), ...evidenceOf(refs.lines)],
      pr: { number: p.number, title: p.title, ...(p.url ? { url: p.url } : {}) },
    };
    stale.set(p.number, d);
    out.push(d);
  }

  // 3. Failing for days: Testing's streaks, and the build plan's "J-08 fails on #51" while that PR is open.
  const failing = new Map<string, { f: FailingFact; pr?: number; ev: StuckEvidence[] }>();
  for (const f of i.failing ?? []) failing.set(f.name, { f, ev: [{ label: `Testing: ${f.name}${f.detail ? `: ${f.detail}` : ''}` }] });
  for (const c of plan ? failingClaims(plan.text) : []) {
    const pr = open.get(c.pr);
    if (!pr) continue;
    const had = failing.get(c.name);
    const ev = place(plan!.file, c.line);
    if (had) {
      had.pr ??= c.pr;
      had.ev.push(ev);
    } else failing.set(c.name, { f: { name: c.name, since: Number.isFinite(ms(pr.createdAt)) ? ms(pr.createdAt) : i.firstSeen(`failing-${c.name}`) }, pr: c.pr, ev: [ev] });
  }
  for (const [name, x] of failing) {
    if (i.now - x.f.since < i.settings.failingHours * H) continue;
    const cause = x.pr !== undefined ? stale.get(x.pr) : undefined;
    if (cause) {
      // The same cause: one card, the PR's, saying what it keeps red.
      (cause.failing ??= []).push(x.f);
      if (!cause.blocks.includes(name)) cause.blocks.unshift(name);
      continue;
    }
    out.push({ id: `failing-${name}`, kind: 'failing', since: x.f.since, blocks: [], evidence: x.ev.slice(0, 4), failing: [x.f], ...(x.pr !== undefined ? { waitsOn: x.pr } : {}) });
  }

  // 2. Decisions waiting on the Project Manager.
  const project = i.files?.project;
  const seen = new Set<string>();
  for (const p of plan ? pendingDecisions(plan.text) : []) {
    const waiting = p.rows.filter((n) => rowOpen(rows.get(n)));
    if (!p.rows.length || !waiting.length) continue;
    const facts = project ? projectFacts(project.text, p.id, p.raised) : {};
    seen.add(p.id);
    const ref = /PROJECT\.md\s+([A-Z]{1,4}-\d+)/.exec(p.raised)?.[1];
    if (ref) seen.add(ref);
    // Answered in the register (CONFIRMED), or accepted for now (a CONFIRMED row that defers it): not waiting
    // on you. OW-1 was re-raised from its own "accepted for now" evidence (slice 0 baseline, 13 Oct).
    if (facts.confirmed || facts.accepted) continue;
    const id = `decision-${p.id}`;
    const since = earliestDate(p.raised) ?? facts.since ?? i.firstSeen(id);
    if (i.now - since < i.settings.decisionHours * H) continue;
    const journeys = journeysOf(rows, p.rows);
    const words = rowsWords(p.rows);
    out.push({
      id,
      kind: 'decision',
      since,
      blocks: [words, ...journeys],
      evidence: [
        place(plan!.file, p.line),
        ...waiting.slice(0, 2).flatMap((n) => (rows.get(n) ? [place(plan!.file, rows.get(n)!.line, ` (row ${n})`)] : [])),
      ],
      decision: { id: p.id, question: shortQuestion(p.question), rows: words, journeys, ...(p.workaround ? { workaround: p.workaround } : {}) },
    });
  }
  for (const q of project ? openQuestions(project.text) : []) {
    if (!q.id || seen.has(q.id)) continue;
    // The same id CONFIRMED or accepted for now in the Decisions register: answered, not waiting on you.
    const settled = projectFacts(project!.text, q.id);
    if (settled.confirmed || settled.accepted) continue;
    const id = `decision-${q.id}`;
    const since = q.since ?? i.firstSeen(id);
    if (i.now - since < i.settings.decisionHours * H) continue;
    out.push({ id, kind: 'decision', since, blocks: [], evidence: [{ label: `${project!.file}:${q.line}`, file: project!.file, line: q.line }], decision: { id: q.id, question: shortQuestion(q.question), rows: '', journeys: [] } });
  }

  // 2b. Build-plan rows blocked on something no pending decision names, or on one that's resolved (blocked-rows.ts).
  if (plan) out.push(...blockedRows({ now: i.now, decisionHours: i.settings.decisionHours, plan, ...(project ? { project } : {}), openPrs: new Set(open.keys()), firstSeen: i.firstSeen }));

  // 4. Going in circles.
  const a = i.activity;
  if (a && i.now - a.lastProgressAt >= i.settings.circlesHours * H && a.activeMs >= MIN_ACTIVE_MS) {
    out.push({
      id: 'circles',
      kind: 'circles',
      since: a.lastProgressAt,
      blocks: [],
      evidence: [{ label: `Last progress: ${a.lastProgress ?? 'none seen'} (${new Date(a.lastProgressAt).toISOString().slice(0, 16).replace('T', ' ')} UTC)` }, ...(a.spend !== undefined ? [{ label: `Spent since then: ${a.currency ?? 'USD'} ${a.spend.toFixed(2)} (budget ledger)` }] : [])],
      circles: { activeMs: a.activeMs, ...(a.spend !== undefined ? { spend: a.spend } : {}), ...(a.currency ? { currency: a.currency } : {}), ...(a.lastProgress ? { lastProgress: a.lastProgress } : {}), lastProgressAt: a.lastProgressAt },
    });
  }
  return out;
}

// ---- Testing's records as streaks -------------------------------------------------------------------

export interface RunLike {
  suite: string;
  pr?: number;
  finishedAt?: string;
  startedAt?: string;
  results: { name: string; status: string; detail?: string; links?: { target: string }[] }[];
}

const norm = (s: string | undefined) => (s ?? '').replace(/\d+(\.\d+)?\s*(ms|s)\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Every test whose newest runs on main failed the same way, with when that streak began (PR runs are the PR's own business). */
export function failingStreaks(runs: readonly RunLike[]): FailingFact[] {
  const by = new Map<string, { at: number; status: string; detail: string; name: string }[]>();
  for (const r of runs) {
    if (r.pr !== undefined) continue;
    const at = ms(r.finishedAt ?? r.startedAt);
    if (!Number.isFinite(at)) continue;
    for (const t of r.results) {
      const journey = /\bJ-\d+(?:\.\d+)?[a-z]?\b/.exec(t.name)?.[0] ?? t.links?.find((l) => /^J-\d/.test(l.target))?.target;
      const name = journey ?? `${r.suite}: ${t.name}`;
      const list = by.get(name) ?? [];
      list.push({ at, status: t.status, detail: norm(t.detail), name });
      by.set(name, list);
    }
  }
  const out: FailingFact[] = [];
  for (const [name, list] of by) {
    list.sort((a, b) => a.at - b.at);
    const last = list.at(-1)!;
    if (last.status !== 'failed') continue;
    let since = last.at;
    for (let k = list.length - 2; k >= 0 && list[k].status === 'failed' && list[k].detail === last.detail; k--) since = list[k].at;
    out.push({ name, since, ...(last.detail ? { detail: last.detail } : {}) });
  }
  return out;
}
