// Whether the live app is ready, milestone by milestone, from evidence only. A milestone is a phase of the
// build plan (./plan.ts) with the BUILD rows it needs, and the whole plan is the last one (its goal: "the
// PackTrack Line 7 demo"). For the commit the live app runs, each milestone is:
//   ready        every BUILD row has evidence in that commit (./rows.ts, commits that are its ancestors)
//                and every journey tied to it passed against that very build (a test-run record whose
//                tested revision is the live commit);
//   unverified   built into the running app, but a journey tied to it hasn't passed against this build
//                ("built, not yet verified"), never "ready" from code alone;
//   refresh      every row is merged to main, some aren't in the running build yet (restart picks them up);
//   branch       some rows are only on unmerged branches ("in PR #6, open, not merged");
//   partial / not-built otherwise.
// Nothing is ready while the app isn't running. Pure.

import { buildRowsOf, type JourneyDef, type ParsedPlan } from './plan.js';
import { rowsWord } from './rows.js';

export type MilestoneState = 'ready' | 'unverified' | 'refresh' | 'branch' | 'partial' | 'not-built';

export interface MilestoneJourney {
  id: string;
  /** passed / failed against the live commit, or not run against it. */
  result: 'passed' | 'failed' | 'not-run';
}

export interface MilestoneWhere {
  branch: string;
  pr?: number;
  draft?: boolean;
  rows: number[];
}

export interface MilestoneView {
  /** "phase-3", or "all" for the whole plan. */
  id: string;
  title: string;
  /** The BUILD rows it needs. */
  rows: number[];
  /** Of those: in the running build, merged to main but not in it, only on branches, nowhere yet. */
  inLive: number[];
  onMain: number[];
  onBranch: MilestoneWhere[];
  missing: number[];
  journeys: MilestoneJourney[];
  state: MilestoneState;
  /** One line for people. */
  line: string;
}

/** A milestone that became ready (or stopped being ready) in the running app, for Needs you and the notifications. */
export interface ReadinessNews {
  key: string;
  kind: 'ready' | 'unready';
  milestone: string;
  title: string;
  at: number;
  sha: string;
}

export interface LiveReadiness {
  /** The commit judged: the running build's (undefined while nothing runs). */
  sha?: string;
  /** Main's commit, read at the same time. */
  main?: string;
  plan?: string;
  goal: string;
  milestones: MilestoneView[];
  /** Ready for the goal: the whole plan is in the running build and verified. */
  ready: boolean;
  headline: string;
  /** Why the office can't say (no build plan yet, the commit isn't readable here). */
  note?: string;
  at: number;
  news?: ReadinessNews[];
}

export interface ReadinessInput {
  plan: ParsedPlan;
  planFile?: string;
  running: boolean;
  /** The running build's commit and the rows with evidence in it. */
  live?: { sha: string; rows: ReadonlySet<number> };
  main: { sha: string; branch: string; rows: ReadonlySet<number> };
  /** Unmerged branches, each with the rows that have evidence on it and not on main. */
  branches: readonly { branch: string; rows: ReadonlySet<number>; pr?: { number: number; draft?: boolean } }[];
  journeys: readonly JourneyDef[];
  /** Journey results whose tested revision is the live commit, newest first. */
  results: readonly { journey: string; status: 'passed' | 'failed' }[];
  now: number;
}

const where = (w: MilestoneWhere) => (w.pr ? `PR #${w.pr}${w.draft ? ', draft' : ', open'}, not merged` : `branch ${w.branch}, no PR yet`);

function judge(id: string, title: string, rows: number[], journeys: readonly JourneyDef[], i: ReadinessInput): MilestoneView {
  const inLive = i.running && i.live ? rows.filter((r) => i.live!.rows.has(r)) : [];
  const onMain = rows.filter((r) => !inLive.includes(r) && i.main.rows.has(r));
  const taken = new Set([...inLive, ...onMain]);
  const onBranch: MilestoneWhere[] = [];
  for (const b of i.branches) {
    const got = rows.filter((r) => !taken.has(r) && b.rows.has(r));
    if (!got.length) continue;
    for (const r of got) taken.add(r);
    onBranch.push({ branch: b.branch, ...(b.pr ? { pr: b.pr.number, ...(b.pr.draft ? { draft: true } : {}) } : {}), rows: got });
  }
  const missing = rows.filter((r) => !taken.has(r));
  const js: MilestoneJourney[] = journeys.map((j) => {
    const r = i.results.find((x) => x.journey === j.id);
    return { id: j.id, result: r ? r.status : 'not-run' };
  });
  const allLive = rows.length > 0 && inLive.length === rows.length;
  let state: MilestoneState;
  if (allLive) state = js.every((j) => j.result === 'passed') ? 'ready' : 'unverified';
  else if (!missing.length && !onBranch.length && rows.length) state = 'refresh';
  else if (onBranch.length) state = 'branch';
  else if (inLive.length || onMain.length) state = 'partial';
  else state = 'not-built';
  const line = lineOf(title, state, { rows, inLive, onMain, onBranch, missing, journeys: js }, i.running);
  return { id, title, rows, inLive, onMain, onBranch, missing, journeys: js, state, line };
}

function lineOf(title: string, state: MilestoneState, m: Pick<MilestoneView, 'rows' | 'inLive' | 'onMain' | 'onBranch' | 'missing' | 'journeys'>, running: boolean): string {
  const bits: string[] = [];
  if (m.onMain.length) bits.push(`${rowsWord(m.onMain)} merged to main${running ? ', not in the live app yet' : ''}`);
  for (const w of m.onBranch) bits.push(`${rowsWord(w.rows)} in ${where(w)}`);
  if (m.missing.length) bits.push(`${rowsWord(m.missing)} not built`);
  switch (state) {
    case 'ready':
      return `Ready: ${title}${m.journeys.length ? ` (${m.journeys.map((j) => j.id).join(', ')} passed against this build)` : ''}`;
    case 'unverified': {
      const failed = m.journeys.filter((j) => j.result === 'failed').map((j) => j.id);
      const notRun = m.journeys.filter((j) => j.result === 'not-run').map((j) => j.id);
      const why = [failed.length ? `${failed.join(', ')} failed against this build` : '', notRun.length ? `${notRun.join(', ')} not run against this build` : ''].filter(Boolean).join('; ');
      return `${title}: built, not yet verified (${why})`;
    }
    case 'refresh':
      return `${title}: ${bits.join('; ')}${running ? ' (Restart picks it up)' : ''}`;
    default:
      return `${title}: ${m.inLive.length ? `has ${rowsWord(m.inLive)}; ` : ''}${bits.join('; ') || 'not built'}`;
  }
}

/** The short form of a milestone that isn't in the running app, for the headline's "Missing:". */
function missingWords(m: MilestoneView): string {
  const parts: string[] = [];
  for (const w of m.onBranch) parts.push(where(w));
  if (m.onMain.length) parts.push('merged, not in the live app yet');
  if (m.missing.length) parts.push(`${rowsWord(m.missing)} not built`);
  return `${m.title} (${parts.join('; ')})`;
}

/** The live app's readiness by milestone, and the headline the card leads with. */
export function computeReadiness(i: ReadinessInput): LiveReadiness {
  const goal = i.plan.goal ?? 'the whole build plan';
  const base = { ...(i.live && i.running ? { sha: i.live.sha } : {}), main: i.main.sha, ...(i.planFile ? { plan: i.planFile } : {}), goal, at: i.now };
  const phases = i.plan.phases.map((p) => ({ p, rows: buildRowsOf(p) })).filter((x) => x.rows.length);
  if (!phases.length) return { ...base, milestones: [], ready: false, headline: `Live app: can't say what's ready, the project has no build plan with numbered BUILD rows on ${i.main.branch} yet`, note: 'no build plan' };
  const rowPhase = new Map<number, string>();
  for (const { p } of phases) for (const r of p.rows) rowPhase.set(r.n, p.id);
  const tied = new Set<string>();
  const milestones = phases.map(({ p, rows }) => {
    const js = i.journeys.filter((j) => j.rows.some((r) => rowPhase.get(r) === p.id));
    for (const j of js) tied.add(j.id);
    return judge(p.id, p.title, rows, js, i);
  });
  const all = judge('all', goal, [...new Set(phases.flatMap((x) => x.rows))].sort((a, b) => a - b), i.journeys, i);
  milestones.push(all);
  const ready = i.running && all.state === 'ready';
  return { ...base, milestones, ready, headline: headlineOf(goal, milestones, all, i.running) };
}

function headlineOf(goal: string, ms: readonly MilestoneView[], all: MilestoneView, running: boolean): string {
  const phases = ms.filter((m) => m.id !== 'all');
  if (!running) {
    const merged = phases.filter((m) => !m.missing.length && !m.onBranch.length);
    return `Live app: not ready for ${goal}, it isn't running.${merged.length ? ` Main has: ${merged.map((m) => m.title).join(', ')}.` : ''}`;
  }
  if (all.state === 'ready') return `Live app: ready for ${goal}. Every milestone is in the running build${all.journeys.length ? ' and its journeys passed against it' : ''}.`;
  if (all.state === 'unverified') return `Live app: ${goal} is built into the running app, not yet verified (${all.journeys.filter((j) => j.result !== 'passed').length} of ${all.journeys.length} journeys haven't passed against this build).`;
  const has = phases.filter((m) => m.state === 'ready' || m.state === 'unverified');
  const some = phases.filter((m) => m.state !== 'ready' && m.state !== 'unverified' && m.inLive.length);
  const inLive = phases.flatMap((m) => m.inLive);
  const hasWords = [...has.map((m) => (m.state === 'unverified' ? `${m.title} (not yet verified)` : m.title)), ...some.map((m) => `part of ${m.title}`)];
  const missing = phases.filter((m) => m.state !== 'ready' && m.state !== 'unverified');
  return `Live app: not ready for ${goal}. Has: ${hasWords.length ? `${hasWords.join(', ')} (${rowsWord(inLive)})` : 'none of the plan’s build rows'}. Missing: ${missing.map(missingWords).join('; ')}.`;
}

/**
 * What changed between two readings of the running app, as news: a milestone that is ready now and wasn't
 * (`notified` holds the ones already told), and one told ready before that isn't any more (rolled back).
 */
export function readinessNews(now: LiveReadiness, notified: Readonly<Record<string, { at: number; sha: string }>>, at: number): { news: ReadinessNews[]; notified: Record<string, { at: number; sha: string }> } {
  const next: Record<string, { at: number; sha: string }> = { ...notified };
  const news: ReadinessNews[] = [];
  if (!now.sha) return { news, notified: next };
  for (const m of now.milestones) {
    const was = next[m.id];
    if (m.state === 'ready' && !was) {
      next[m.id] = { at, sha: now.sha };
      news.push({ key: `live-ready:${m.id}@${at}`, kind: 'ready', milestone: m.id, title: m.title, at, sha: now.sha });
    } else if (m.state !== 'ready' && m.state !== 'unverified' && was) {
      delete next[m.id];
      news.push({ key: `live-unready:${m.id}@${at}`, kind: 'unready', milestone: m.id, title: m.title, at, sha: now.sha });
    }
  }
  return { news, notified: next };
}
