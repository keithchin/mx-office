// The Portal Projects page's filter and sort (home/portal.ts draws it), without the page: which cards
// show for the search, the status picked and the sort, in what order. Pure, so
// tests/portal-theme.test.ts runs it.

import type { FloorInfo } from '../../shared/protocol';

/** A card's status, for the status select and its chip. */
export type ProjectStatus = 'needs-you' | 'running' | 'paused' | 'adding';
export type StatusFilter = 'all' | ProjectStatus;
export type SortKey = 'pinned' | 'recent' | 'name';

export const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All statuses' },
  { id: 'needs-you', label: 'Needs you' },
  { id: 'running', label: 'Running' },
  { id: 'paused', label: 'Paused' },
  { id: 'adding', label: 'Being added' },
];

export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'pinned', label: 'Pinned' },
  { id: 'recent', label: 'Recent activity' },
  { id: 'name', label: 'Name' },
];

export type ProjectFloor = Pick<FloorInfo, 'id' | 'name' | 'repo' | 'waiting' | 'busy' | 'cloning' | 'addedAt'>;

export interface ProjectFacts {
  /** Paused (from the run state, home/run-state.ts), or pausing. */
  paused: (id: string) => boolean;
  pinned: (id: string) => boolean;
  /** How recent its last activity is: bigger is more recent (its spend's last active day, then what's busy now). */
  activity: (id: string) => number;
}

/** A project's status: being added, needs you (someone's waiting), paused, or running. */
export function statusOf(f: ProjectFloor, facts: Pick<ProjectFacts, 'paused'>): ProjectStatus {
  if (f.cloning) return 'adding';
  if (f.waiting > 0) return 'needs-you';
  if (facts.paused(f.id)) return 'paused';
  return 'running';
}

/** The cards to show, in order. `desc` turns the sort round (Name Z–A, the least recent first, pinned last). */
export function visibleProjects<F extends ProjectFloor>(floors: readonly F[], q: { text: string; status: StatusFilter; sort: SortKey; desc?: boolean }, facts: ProjectFacts): F[] {
  const text = q.text.trim().toLowerCase();
  const shown = floors
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !text || f.name.toLowerCase().includes(text) || (f.repo ?? '').toLowerCase().includes(text))
    .filter(({ f }) => q.status === 'all' || statusOf(f, facts) === q.status);
  const byName = (a: F, b: F) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const cmp = (a: { f: F; i: number }, b: { f: F; i: number }) => {
    if (q.sort === 'name') return byName(a.f, b.f) || a.i - b.i;
    if (q.sort === 'recent') return facts.activity(b.f.id) - facts.activity(a.f.id) || b.f.addedAt - a.f.addedAt || a.i - b.i;
    // Pinned: the pinned ones first, then the building's order.
    return Number(facts.pinned(b.f.id)) - Number(facts.pinned(a.f.id)) || a.i - b.i;
  };
  shown.sort((a, b) => (q.desc ? -cmp(a, b) : cmp(a, b)));
  return shown.map((r) => r.f);
}

/** How recent a project's activity is, from its last 14 days' spend (oldest first) and what's busy now. */
export function activityScore(spark: readonly number[] | undefined, busy: number, waiting: number): number {
  const s = spark ?? [];
  let last = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] > 0) {
      last = i;
      break;
    }
  }
  // The day matters most, then how much is going on now.
  return (last + 1) * 1000 + Math.min(999, (busy + waiting) * 10 + (s[s.length - 1] ?? 0));
}

/** The letters on a project's tile: "Travel Approval" → "TA", "big-spike" → "BS", "mx" → "MX". */
export function tileLetters(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase();
  return ([...words[0]][0] + [...words[1]][0]).toUpperCase();
}
