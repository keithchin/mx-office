// What the pages say about the office's price list (server/prices.ts): when it was checked, and the
// models whose cost is a guess at Opus rates because they aren't on it. The Budget tab shows both; Needs
// you shows the guess as an info row (worth knowing, not waiting on you).

import type { BudgetAlert, BudgetView, PriceListView } from './types.js';
import type { BudgetNeed, NeedItem } from '../needsyou.js';
import { stageNeedOfView } from './stage-need.js';

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "Price list checked on 2026-10-16". */
export const priceCheckedLine = (p: PriceListView) => `Price list checked on ${p.checked}`;

/** The note for the models priced by the fallback, or undefined when there are none. */
export function unpricedNote(p: PriceListView | undefined): string | undefined {
  const ids = p?.unpriced.map((u) => u.model) ?? [];
  if (!ids.length) return undefined;
  const one = ids.length === 1;
  return `Priced at Opus rates: ${list(ids)} ${one ? "isn't" : "aren't"} on the office's price list (checked ${p!.checked}), so ${one ? 'its' : 'their'} cost is an estimate that may be high or low.`;
}

/** What Needs you reads of a project's budget view: its alerts and pause when it has a budget, and the price-list guess either way. */
export function budgetNeedOfView(v: BudgetView | undefined): BudgetNeed | undefined {
  if (!v) return undefined;
  const prices = v.prices?.unpriced.length ? v.prices : undefined;
  const stages = stageNeedOfView(v);
  if (!v.settings.total && !prices && !stages.stageWarnings) return undefined;
  const alerts: readonly BudgetAlert[] = v.settings.total ? (v.alerts ?? []) : [];
  return { floor: v.floor, alerts, ...(v.settings.total && v.paused ? { paused: v.paused } : {}), ...(prices ? { prices } : {}), ...stages };
}

/** Needs you's row for models priced by the fallback, when there are any. */
export function unpricedNeed(b: BudgetNeed | undefined): NeedItem | undefined {
  const text = unpricedNote(b?.prices);
  if (!b?.prices || !text) return undefined;
  return { key: 'budget-unpriced', kind: 'budget', icon: '🏷️', text, since: b.prices.unpriced[0]?.since, level: 'info', action: 'Budget', target: { to: 'budget' } };
}
