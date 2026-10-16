// A team member's own subagents as the 1D views list them under it (the Overview's Team card, the Team
// tab's org chart) and as the office's fact block names them: each run at work now, with its name, type,
// task and how long it's been at it; each just finished for a minute ("done · 4 min"); then folded into
// "2 subagent runs today". And whether the member is at work through them: a Lead whose turn is over while
// the subagent it sent off is still going is working, not idle (the Overview said "nobody's working"
// while one ran). From the floor's live runs (shared/roster/subagent-live.ts) that GET /api/roster
// already carries: nothing new is fetched. Pure: the browser imports it, the server and the tests too.

import type { LiveRun } from './subagent-live.js';
import { firstNameIn, roleLower, roleWord } from './subagent-names.js';

/** How long a finished run stays on its member's row before it folds into the day's count. */
export const DONE_SHOWN_MS = 60_000;

type RunLike = Pick<LiveRun, 'id' | 'lead' | 'workerId' | 'name' | 'task' | 'status' | 'startedAt' | 'resumedAt' | 'endedAt' | 'durationMs'>;
type Names = Readonly<Record<string, string>> | undefined;

export interface SubRow {
  id: string;
  /** `<lead role>/<type>`, as the roster keys its record (its detail in the Workers tab). */
  key: string;
  /** "Elsa", and its type as a role: "Business Analyst". */
  first: string;
  role: string;
  type: string;
  task?: string;
  state: 'working' | 'done' | 'failed';
  /** Since when it's at it (working), or how long it took (finished). */
  since: number;
  tookMs?: number;
}

export interface MemberSubs {
  rows: SubRow[];
  /** Runs over today that aren't on the row any more. */
  today: number;
  /** When the next finished run folds (to draw the row again then); none when nothing's due. */
  foldAt?: number;
}

/** Midnight before `now`, in the viewer's (or the server's) time zone. */
export function dayStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "45 s", "4 min", "1.5 h". */
export function spanWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

/** Each member role's runs at work now, oldest first. */
export function workingByLead<R extends RunLike>(runs: readonly R[] | undefined): Map<string, R[]> {
  const out = new Map<string, R[]>();
  for (const r of runs ?? []) {
    if (r.status !== 'working') continue;
    const list = out.get(r.lead) ?? [];
    list.push(r);
    out.set(r.lead, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.startedAt - b.startedAt);
  return out;
}

/** The workers whose subagents are at work now (the floor's "working" count counts them). */
export function busyWorkers(runs: readonly RunLike[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const r of runs ?? []) if (r.status === 'working') out.add(r.workerId);
  return out;
}

/** Member `lead`'s subagents: at work, just finished, and how many more ran today. */
export function memberSubagents(runs: readonly RunLike[] | undefined, names: Names, lead: string, now: number): MemberSubs {
  const start = dayStart(now);
  const rows: SubRow[] = [];
  let today = 0;
  let foldAt: number | undefined;
  for (const r of runs ?? []) {
    if (r.lead !== lead) continue;
    const key = `${r.lead}/${r.name}`;
    const base = { id: r.id, key, first: firstNameIn(names, key), role: roleWord(r.name), type: r.name, ...(r.task ? { task: r.task } : {}) };
    if (r.status === 'working') {
      rows.push({ ...base, state: 'working', since: r.resumedAt ?? r.startedAt });
      continue;
    }
    const ended = r.endedAt ?? r.startedAt;
    if ((r.status === 'done' || r.status === 'failed') && now - ended < DONE_SHOWN_MS && ended <= now) {
      rows.push({ ...base, state: r.status, since: ended, tookMs: r.durationMs ?? ended - (r.resumedAt ?? r.startedAt) });
      foldAt = Math.min(foldAt ?? Infinity, ended + DONE_SHOWN_MS);
      continue;
    }
    if (ended >= start) today++;
  }
  // At work first (oldest first), then the ones just finished (newest first).
  rows.sort((a, b) => Number(a.state !== 'working') - Number(b.state !== 'working') || (a.state === 'working' ? a.since - b.since : b.since - a.since));
  return { rows, today, ...(foldAt !== undefined ? { foldAt } : {}) };
}

/** How long a run at work has been at it, to the minute (so a list is drawn again at most once a minute): "just started", "3 min". */
export const subElapsed = (r: SubRow, now: number) => (now - r.since < 60_000 ? 'just started' : spanWords(now - r.since));

/** A row's line: "Draft the BRD · 3 min", "done · 4 min", "failed · 40 s". */
export function subRowLine(r: SubRow, now: number): string {
  if (r.state === 'working') return `${r.task ?? 'Working'} · ${subElapsed(r, now)}`;
  return `${r.state === 'failed' ? 'failed' : 'done'} · ${spanWords(r.tookMs ?? 0)}`;
}

/** "2 subagent runs today", or "+2 earlier today" under rows. */
export function todayWords(subs: MemberSubs): string {
  if (!subs.today) return '';
  if (subs.rows.length) return `+${subs.today} earlier run${subs.today === 1 ? '' : 's'} today`;
  return `${subs.today} subagent run${subs.today === 1 ? '' : 's'} today`;
}

/** What a member's status says while it's idle but its subagents are at work. */
export const VIA_SUBAGENT = 'Working (via subagent)';

/**
 * For the office's fact block: "1 subagent working: Elsa (business analyst)", or undefined when none is.
 * Joined with "+" so the list of agents it sits in (comma-separated) still reads.
 */
export function factsSubagents(runs: readonly RunLike[] | undefined, names: Names, workerId: string): string | undefined {
  const mine = (runs ?? []).filter((r) => r.workerId === workerId && r.status === 'working').sort((a, b) => a.startedAt - b.startedAt);
  if (!mine.length) return undefined;
  const who = mine.map((r) => `${firstNameIn(names, `${r.lead}/${r.name}`)} (${roleLower(r.name)})`);
  return `${mine.length} subagent${mine.length === 1 ? '' : 's'} working: ${who.join(' + ')}`;
}
