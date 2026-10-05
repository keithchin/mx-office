// Jeff's priority: which escalation the Project Manager should resolve first. Jeff (server/roster/
// jeff-priority.ts) rates each open escalation once (again at most once an hour, or when its text
// changes): how soon on a scale, whether agents are stopped on it, whether delaying it risks something
// big. The office turns that into a score, and the open escalations of the floor are ranked by it.
// Advisory only: the lists show his order with a "#1 · resolve first" chip, and nothing else changes.
// Pure: the browser, the server and the tests import it.

import type { Escalation } from './escalation.js';

/** What Jeff said about one escalation, and where it stands among the floor's open ones. */
export interface JeffRank {
  /** The priority score (see priorityScore), with the escalation's age as of the last re-rank. */
  score: number;
  by: 'jev' | 'haiku';
  /** When Jeff was asked. */
  at: number;
  /** How true "agents are stopped until the Project Manager answers this" is, 0..1. */
  blocking: number;
  /** How true "delaying this risks security, data loss, budget overrun or a client milestone" is, 0..1. */
  risk: number;
  /** The level Jeff picked, in words. */
  level: string;
  /** The level as 0..1 (its index over the top index; Jev may answer between levels). */
  priority: number;
  /** 1 = resolve first; only on open, non-FYI escalations. */
  rank?: number;
  /** What the escalation said when he was asked: a change means asking again. */
  sig: string;
}

/** The levels Jeff picks from, least pressing first. */
export const PRIORITY_LEVELS = [
  'Can wait days: nothing depends on it yet',
  'Can wait a day or two: worth answering, but work goes on meanwhile',
  'Soon: work will slow down within hours without an answer',
  'Today: it holds up planned work or a decision others wait on',
  'Blocking work right now, or a critical risk',
];

const HOUR_MS = 3_600_000;
/** Age adds to a blocking escalation's score until it has been open this long. */
export const AGE_FULL_MS = 24 * HOUR_MS;

/**
 * The score, 0..120, higher = resolve sooner:
 *
 *   100 × (0.45 × level + 0.35 × blocking + 0.20 × risk)  +  20 × blocking × min(1, hours open / 24)
 *
 * `level` is Jeff's level as 0..1, `blocking` and `risk` his nouls. The age term only counts as far as
 * the escalation blocks someone, so an old blocker climbs past a fresh one of the same weight, while an
 * old nice-to-have doesn't climb at all; it is full after a day open.
 */
export function priorityScore(r: Pick<JeffRank, 'priority' | 'blocking' | 'risk'>, ageMs: number): number {
  const c = (n: number) => Math.max(0, Math.min(1, n));
  const base = 100 * (0.45 * c(r.priority) + 0.35 * c(r.blocking) + 0.2 * c(r.risk));
  const age = 20 * c(r.blocking) * c(Math.max(0, ageMs) / AGE_FULL_MS);
  return Math.round((base + age) * 10) / 10;
}

/** What Jeff's rating depends on: when any of it changes, he is asked again. */
export function rankSig(e: Pick<Escalation, 'title' | 'details' | 'options' | 'recommendation' | 'urgency' | 'trigger'>): string {
  const s = [e.urgency, e.trigger ?? '', e.title, e.details, e.options.join('|'), e.recommendation ?? ''].join('\u0001');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/** The ones Jeff ranks: open and not FYI. */
export const rankable = (e: Escalation) => e.status === 'open' && !e.fyi;

/**
 * Re-ranks the open, non-FYI escalations that have Jeff's rating: score again with their age at
 * `now`, highest first (the older first on a tie), numbered from 1. Anything else loses its rank.
 * Whether any rank or score changed.
 */
export function rerank(list: readonly Escalation[], now: number): boolean {
  let changed = false;
  const rated = list.filter((e) => rankable(e) && e.jeffRank);
  for (const e of rated) {
    const score = priorityScore(e.jeffRank!, now - e.at);
    if (score !== e.jeffRank!.score) ((e.jeffRank!.score = score), (changed = true));
  }
  rated.sort((a, b) => b.jeffRank!.score - a.jeffRank!.score || a.at - b.at);
  rated.forEach((e, i) => {
    if (e.jeffRank!.rank !== i + 1) ((e.jeffRank!.rank = i + 1), (changed = true));
  });
  for (const e of list) {
    if (e.jeffRank?.rank !== undefined && !(rankable(e) && rated.includes(e))) {
      delete e.jeffRank.rank;
      changed = true;
    }
  }
  return changed;
}

/** Jeff's rank of `e` when he has one and it counts (open, not FYI). */
export const rankOf = (e: Escalation): number | undefined => (rankable(e) ? e.jeffRank?.rank : undefined);

/**
 * `list` in Jeff's order when `on`: his ranked ones first, #1 on top; the rest after them in the
 * order `fallback` gives (each view keeps its own: urgency then age). Off, or nothing ranked: just
 * `fallback`'s order. Never changes `list`.
 */
export function jeffOrder<T extends Escalation>(list: readonly T[], on: boolean, fallback: (a: T, b: T) => number): T[] {
  const rest = [...list].sort(fallback);
  if (!on) return rest;
  const ranked = rest.filter((e) => rankOf(e) !== undefined).sort((a, b) => rankOf(a)! - rankOf(b)!);
  return ranked.length ? [...ranked, ...rest.filter((e) => rankOf(e) === undefined)] : rest;
}

/** Whether a floor's views sort by Jeff: his priority setting isn't off and he has ranked something open. */
export function sortedByJeff(list: readonly Escalation[], priority: 'off' | 'on' | undefined): boolean {
  return priority !== 'off' && list.some((e) => rankOf(e) !== undefined);
}

/** The chip's words: "🧑‍⚖️ #1 · resolve first", then "🧑‍⚖️ #2" and on. */
export const rankChip = (n: number) => `🧑‍⚖️ #${n}${n === 1 ? ' · resolve first' : ''}`;

/** The chip's tooltip: "Jeff (Jev) ranks this #1: blocking 92%, risk 40%". */
export function rankTip(r: JeffRank, n: number): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return `Jeff (${r.by === 'haiku' ? 'on Haiku' : 'Jev'}) ranks this #${n}: blocking ${pct(r.blocking)}, risk ${pct(r.risk)} · “${r.level.split(':')[0]}”`;
}

/** The note above a list sorted by Jeff. */
export const SORTED_NOTE = 'Sorted by Jeff · Router — resolve from the top.';
