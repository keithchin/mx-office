// A Lead's subagents as workers of their own, for the Workers tab's cards and the 2D view: each one's
// Lead (who hired it), whether it's at work now and on what, its last run, its record (runs, grade
// A–F, reviews) and where it stands (active, on warning, benched). Made from the floor's team as
// GET /api/roster has it (RosterView): its track record (`subagents`) and its live runs (`subagentRuns`).
// Pure: the browser imports it, and the tests.

import { ROLE_BY_ID, ROLES, type RoleId, type TeamId } from './roles.js';
import { helperTag, type LiveRunView, type LiveStatus } from './subagent-live.js';
import type { Grade, SubagentReviewBrief, SubagentState, SubagentView } from './subagents.js';
import type { MemberStatus, MemberView } from './types.js';

export type SubagentCardStatus = 'working' | 'idle' | 'benched';

export interface SubagentCard {
  /** `<lead role>/<name>`, as the roster keys it. */
  key: string;
  lead: RoleId;
  team: TeamId;
  name: string;
  leadName: string;
  leadTitle: string;
  leadIcon: string;
  /** The Lead's worker now, for its terminal and Chat view. */
  leadWorkerId?: string;
  leadStatus: MemberStatus;
  /** "Hedy (Lead Tester)". */
  hiredBy: string;
  /** "tester (Hedy's)", its name tag in the 2D view. */
  tag: string;
  model: string;
  status: SubagentCardStatus;
  /** Its runs going on now, oldest first (one subagent can be sent off more than once at a time). */
  working: LiveRunView[];
  /** What the oldest of those is on, and since when. */
  task?: string;
  since?: number;
  /** Its last run that's over: when it began, what it was on, how it ended. */
  lastRunAt?: number;
  lastTask?: string;
  lastStatus?: LiveStatus;
  runs: number;
  /** Runs over that its Lead hasn't reviewed yet (its grade counts only reviewed ones). */
  unreviewed: number;
  grade?: Grade;
  score?: number;
  underperforming: boolean;
  why?: string;
  state: SubagentState;
  benchedUntil?: number;
  benchReason?: string;
  warnings: number;
  lastWarning?: string;
  /** Defined by the office's team table (its Lead's Playbook writes it), not one the Lead made itself. */
  defined: boolean;
  /** Its runs the office saw (newest first) and its last reviewed runs with the Lead's verdicts. */
  recent: LiveRunView[];
  reviews: SubagentReviewBrief[];
}

/** Runs a card's detail lists. */
export const RECENT_SHOWN = 10;

type View = { members: readonly MemberView[]; subagents?: readonly SubagentView[]; subagentRuns?: readonly LiveRunView[] };

export interface CardOptions {
  /** Subagents that have never run (and aren't at work, benched or on warning) too: off unless asked for. */
  includeNeverRun?: boolean;
}

/**
 * Every Lead's subagents as cards, in the team's order (each Lead's together, the ones at work first).
 * Only those that have run, unless `includeNeverRun` (one at work for the first time has: its run is
 * going); a benched one or one on warning shows all the same. A Lead that isn't hired shows only
 * subagents that have run. One the office has only seen at work (a built-in like general-purpose,
 * before its first record) gets a card too.
 */
export function subagentCards(v: View, opts: CardOptions = {}): SubagentCard[] {
  const runs = v.subagentRuns ?? [];
  const views = [...(v.subagents ?? [])];
  for (const r of runs) {
    if (r.lead === 'pm' || views.some((s) => s.lead === r.lead && s.name === r.name)) continue;
    views.push({ lead: r.lead, name: r.name, defined: false, model: r.model ?? 'inherit', state: 'active', warnings: 0, score: { model: r.model ?? 'inherit', runs: 0, reviewed: 0, accepted: 0, reworks: 0, underperforming: false } });
  }
  const out: SubagentCard[] = [];
  for (const s of views) {
    const m = v.members.find((x) => x.role === s.lead);
    const role = ROLE_BY_ID.get(s.lead);
    if (!m || !role) continue;
    const mine = runs.filter((r) => r.lead === s.lead && r.name === s.name);
    const working = mine.filter((r) => r.status === 'working').sort((a, b) => a.startedAt - b.startedAt);
    const over = mine.filter((r) => r.status !== 'working').sort((a, b) => b.startedAt - a.startedAt)[0];
    const total = Math.max(s.totalRuns ?? s.score.runs, mine.length);
    if (!total && (m.status === 'not-hired' || (!opts.includeNeverRun && s.state === 'active'))) continue;
    const lastRunAt = Math.max(s.lastRunAt ?? 0, over?.startedAt ?? 0) || undefined;
    out.push({
      key: `${s.lead}/${s.name}`,
      lead: s.lead,
      team: role.team,
      name: s.name,
      leadName: m.name,
      leadTitle: m.title,
      leadIcon: m.icon,
      ...(m.workerId ? { leadWorkerId: m.workerId } : {}),
      leadStatus: m.status,
      hiredBy: `${m.name} (${m.title})`,
      tag: helperTag(s.name, m.name),
      model: s.model,
      status: working.length ? 'working' : s.state === 'benched' ? 'benched' : 'idle',
      working,
      ...(working[0]?.task ? { task: working[0].task } : {}),
      ...(working[0] ? { since: working[0].resumedAt ?? working[0].startedAt } : {}),
      ...(lastRunAt ? { lastRunAt } : {}),
      ...(over?.task ? { lastTask: over.task } : {}),
      ...(over ? { lastStatus: over.status } : {}),
      runs: total,
      unreviewed: s.unreviewed ?? 0,
      ...(s.score.grade ? { grade: s.score.grade, score: s.score.score } : {}),
      underperforming: s.score.underperforming,
      ...(s.score.why ? { why: s.score.why } : {}),
      state: s.state,
      ...(s.benchedUntil ? { benchedUntil: s.benchedUntil } : {}),
      ...(s.benchReason ? { benchReason: s.benchReason } : {}),
      warnings: s.warnings,
      ...(s.lastWarning ? { lastWarning: s.lastWarning } : {}),
      defined: s.defined,
      recent: [...mine].sort((a, b) => b.startedAt - a.startedAt).slice(0, RECENT_SHOWN),
      reviews: s.reviews ?? [],
    });
  }
  const order = new Map(ROLES.map((r, i) => [r.id, i]));
  const rank = (c: SubagentCard) => (c.status === 'working' ? 0 : c.status === 'idle' ? 1 : 2);
  return out.sort((a, b) => order.get(a.lead)! - order.get(b.lead)! || rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** How long, in a few words: "45s", "12m", "3h", "2d". */
export function shortSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

/** A card's line saying how it is now: at work on what and for how long, benched, or when it last ran. */
export function cardNow(c: SubagentCard, now: number): string {
  if (c.status === 'working') {
    const more = c.working.length > 1 ? ` (+${c.working.length - 1} more run${c.working.length > 2 ? 's' : ''})` : '';
    return `🔨 ${c.task ?? 'Working'} · ${shortSpan(now - (c.since ?? now))}${more}`;
  }
  if (c.status === 'benched') return `🪑 Benched${c.benchReason ? `: ${c.benchReason}` : ''}`;
  if (!c.lastRunAt) return '💤 Idle · no runs yet';
  const how = c.lastStatus === 'failed' ? ' (failed)' : c.lastStatus === 'lost' ? ' (lost track)' : '';
  return `💤 Idle · last run ${shortSpan(now - c.lastRunAt)} ago${c.lastTask ? `: ${c.lastTask}` : ''}${how}`;
}

/** A subagent as the 2D views draw it: each run at work on a stool behind its Lead, else one about the office. */
export interface FloorHelper {
  /** The run at work, for one at work. */
  runId?: string;
  key: string;
  /** Its Lead's worker: where its stool is. */
  leadWorkerId?: string;
  /** "tester (Hedy's)". */
  tag: string;
  task?: string;
  team: TeamId;
  /** At work on its stool, idle about the office, or benched (on a break, like a benched Lead). */
  state: 'working' | 'idle' | 'benched';
}

/**
 * The floor's subagents for the 2D views: only those that have run at least once (one at work for the
 * first time has). Each run at work of a Lead at a desk is one on a stool; every other is one character
 * about the office, idle or benched.
 */
export function floorHelpers(cards: readonly SubagentCard[]): FloorHelper[] {
  const out: FloorHelper[] = [];
  for (const c of cards) {
    if (!c.runs) continue;
    const base = { key: c.key, tag: c.tag, team: c.team, ...(c.leadWorkerId ? { leadWorkerId: c.leadWorkerId } : {}) };
    const working = c.leadWorkerId ? c.working : [];
    if (working.length) for (const r of working) out.push({ ...base, runId: r.id, ...(r.task ? { task: r.task } : {}), state: 'working' });
    else out.push({ ...base, state: c.state === 'benched' ? 'benched' : 'idle' });
  }
  return out;
}
