// What the Needs-you strip (./index.ts) works out, for whatever else on the page shows it: the Portal
// Overview's Needs you card (ui/portal/needs-card.ts, the escalations as full cards) and the team-lead
// panel's "N waiting on you" (ui/lead-panel/). The strip publishes each time what it shows changes; they
// listen. No fetch or timer of its own: it's the strip's work, shared.

import type { RosterView } from '../../../shared/roster/types';
import type { DecisionCard } from '../../../shared/decisions/types';
import { hereCount, type NeedItem, type NeedTarget } from './logic';

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
 * How many things wait on you on this floor: every actionable item (escalations and decisions, a merged
 * PR not verified, a ✋ sign-off, agents asking, approvals…), not just the escalations. The same number as
 * the Overview's tab count (hereCount), so the panel's strip and the navigation never disagree.
 */
export const waitingCount = (items: readonly NeedItem[]): number => hereCount(items);
