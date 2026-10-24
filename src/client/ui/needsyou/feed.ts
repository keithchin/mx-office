// What the Needs-you strip (./index.ts) works out, for whatever else on the page shows it: the Portal
// Overview's Needs you card (ui/portal/needs-card.ts, the escalations as full cards) and the team-lead
// panel's "N waiting on you" (ui/lead-panel/). The strip publishes each time what it shows changes; they
// listen. No fetch or timer of its own: it's the strip's work, shared.

import type { RosterView } from '../../../shared/roster/types';
import type { DecisionCard } from '../../../shared/decisions/types';
import { type NeedItem, type NeedTarget } from './logic';
import { needsCount, type NeedsCount } from '../../../shared/needs-count';

export interface NeedsSnapshot {
  floor?: string;
  /** Everything that needs you, most urgent first (collectNeeds): each the compact row of a card. */
  items: readonly NeedItem[];
  /** The same as decision cards (shared/decisions/), in the same order: `cards[i].need === items[i]`. */
  cards?: readonly DecisionCard[];
  /** The floor's team the items were worked out from (its escalations in full), once fetched. */
  roster?: RosterView;
  /** Takes you to an item's fix, as the strip's own buttons do. */
  go(target: NeedTarget): void;
  /** The one count (shared/needs-count.ts) the strip worked out with these items: every surface shows this, never its own. */
  count?: NeedsCount;
}

const listeners = new Set<(s: NeedsSnapshot) => void>();
let last: NeedsSnapshot | undefined;

/** The strip's newest snapshot. */
export const currentNeeds = (): NeedsSnapshot | undefined => last;

/** Hears every new snapshot, and the newest one now if there is one. */
export function onNeeds(fn: (s: NeedsSnapshot) => void): () => void {
  listeners.add(fn);
  if (last) fn(last);
  return () => listeners.delete(fn);
}

/** The strip's: a new snapshot for everyone listening. */
export function publishNeeds(s: NeedsSnapshot): void {
  last = s;
  for (const fn of listeners) fn(s);
}

/**
 * The one count for a snapshot (shared/needs-count.ts): the strip's own when it handed one, else worked out
 * from its items the same way (a test's snapshot), so the panel, the Overview and the navigation never disagree.
 */
export const countOf = (s: Pick<NeedsSnapshot, 'items' | 'count' | 'floor'>, admin = true): NeedsCount => s.count ?? needsCount(s.items, { admin, floor: s.floor });

/** How many wait on you on this floor: the one count's `forYou`. */
export const waitingCount = (items: readonly NeedItem[], admin = true): number => needsCount(items, { admin }).forYou;
