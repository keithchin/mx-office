// The order ▶ Resume project wakes agents in, and how it paces them. Pure, so a test can walk both
// with a fake clock: the Coordinator first (it routes everyone else's news), then the Leads that block
// the most, then everyone else; at most `concurrent` booting at once, `gap` apart, and a wake only
// counts as started once its session is up (SessionStart: it leaves 'starting').

import type { RoleId } from '../../shared/roster/roles.js';

export interface OrderFacts {
  key: string;
  name: string;
  role?: RoleId;
  /** Escalation answers from the Project Manager it hasn't been told. */
  owed: number;
  /** Its open pull requests: others wait on them for review, merge or rebase. */
  openPrs: number;
  /** Jeff's priority of its open escalations (the highest score, 0 without one). */
  jeff: number;
}

/** Group first (Coordinator 0, Leads 1, the rest 2), then the most blocking first, then by name. */
export function wakeOrder<T extends OrderFacts>(agents: readonly T[]): T[] {
  const group = (a: OrderFacts) => (a.role === 'pm' ? 0 : a.role ? 1 : 2);
  return [...agents].sort((a, b) => group(a) - group(b) || b.owed - a.owed || b.openPrs - a.openPrs || b.jeff - a.jeff || a.name.localeCompare(b.name));
}

export interface Pace {
  concurrent: number;
  gapMs: number;
  /** How long a wake may take to reach a live session before it's counted failed and its slot freed. */
  bootMs: number;
}

export interface Starting {
  key: string;
  at: number;
}

/**
 * How long to wait before the next wake may go: 0 to go now. `starting` are the wakes not yet live
 * (the caller drops those that are, or that took longer than `bootMs`); `lastAt` the last wake's time.
 */
export function waitBeforeNext(now: number, starting: readonly Starting[], lastAt: number | undefined, p: Pace): number {
  const booting = starting.filter((s) => now - s.at < p.bootMs);
  const gap = lastAt === undefined ? 0 : Math.max(0, lastAt + p.gapMs - now);
  if (booting.length < p.concurrent) return gap;
  // Full: the earliest of them to time out frees a slot (a live one frees it sooner; the caller looks again).
  const free = Math.min(...booting.map((s) => s.at + p.bootMs)) - now;
  return Math.max(gap, Math.min(free, 1_000));
}
