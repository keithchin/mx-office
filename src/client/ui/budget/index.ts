// The budget on a flat view: the top bar's chips everywhere, and on the 1D view the 💰 Budget tab with
// its sections. The 2D view's chips open the 1D view's tab.

import type { Net } from '../../net';
import { budgetChips } from './chips';
import { budgetFeed, type BudgetFeed } from './feed';
import { budgetTab, type BudgetSection } from './tab';

/** The sections between the headline and the breakdowns, in order (the plan, variance, settings, insights plug in here). */
export const SECTIONS: BudgetSection[] = [];

export interface BudgetUi {
  feed: BudgetFeed;
  /** Draws the tab (when it's showing). */
  show(): void;
}

/** `root` is the tab's element on the 1D view (none on the 2D view); `open` shows the tab. */
export function budgetUi(net: Net, opts: { root?: HTMLElement; visible?: () => boolean; open: () => void }): BudgetUi {
  const feed = budgetFeed(net);
  budgetChips(feed, opts.open);
  const tab = opts.root ? budgetTab(opts.root, feed, opts.visible ?? (() => true), SECTIONS) : undefined;
  return { feed, show: () => tab?.render() };
}
