// New things first in Needs you (shared/needsyou.ts collectDecisions): the rebuild run's Marketplace card, new and
// waiting on the PM, sat under "Show 38 more", behind 37 approve-merge asks from a run a day before. The list keeps
// its order of urgency within each group, but the groups go:
//   1. what waits on you and is recent (or has no age), 2. what waits on you but is old (`OLD_MS`) or whose source
//   is gone (an AWAITING-PM line removed, an asked merge already on main: the card's "Resolved / Still needed"),
//   3. what is shown but doesn't wait on you (info).
// Group 2 is marked `older`, so the Overview card folds it behind "Show N older" while there's anything new.
// Pure.

import type { DecisionCard } from './decisions/types.js';
import type { NeedItem } from './needsyou.js';

/** Older than this, an item waits behind new ones (a day). */
export const OLD_MS = 24 * 3_600_000;

/** 0 new and waiting, 1 old or its source gone, 2 info. */
export function freshness(n: NeedItem, now: number, gone = false): 0 | 1 | 2 {
  if (n.level === 'info') return 2;
  // Other projects where someone waits stay after this project's items, old or new (never folded as older).
  if (n.kind === 'floor') return 1;
  if (gone) return 1;
  // Something stopped right now (an agent asking, a sev1, the spend cap) is never "old": its age is how long it has waited.
  if (n.kind === 'asking' || n.kind === 'incident' || n.kind === 'paused' || n.kind === 'claude') return 0;
  // A time before 2001 isn't a real one (a record without it): its age is unknown, so it isn't old.
  return n.since !== undefined && n.since > 1e12 && now - n.since > OLD_MS ? 1 : 0;
}

/** The needs and their cards, new ones first (stable within a group); old ones marked `older`. */
export function freshFirst(d: { cards: DecisionCard[]; needs: NeedItem[] }, now: number): { cards: DecisionCard[]; needs: NeedItem[] } {
  // Every need is a card's compact row (decisions/group.ts): the cards are what is ordered.
  const ranked = d.cards.map((c, i) => ({ c, i, g: freshness(c.need, now, !!c.gone) }));
  ranked.sort((a, b) => a.g - b.g || a.i - b.i);
  const cards = ranked.map(({ c, g }) => (g === 1 && c.need.kind !== 'floor' ? { ...c, need: { ...c.need, older: true as const } } : c));
  return { cards, needs: cards.map((c) => c.need) };
}

/**
 * Where a list folds: after the new items when old ones follow (they wait behind "Show N older"), else after `max`
 * (all of them when only one more would be hidden). `label` is the fold button's words while folded.
 */
export function foldAt(items: readonly Pick<NeedItem, 'older'>[], max: number): { show: number; label: string } {
  const firstOld = items.findIndex((n) => n.older);
  if (firstOld > 0 && firstOld <= max) return { show: firstOld, label: `Show ${items.length - firstOld} older ▾` };
  const show = items.length <= max + 1 ? items.length : max;
  return { show, label: `Show ${items.length - show} more ▾` };
}
