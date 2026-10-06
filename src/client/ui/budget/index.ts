// The budget on a flat view: the top bar's chips everywhere, and on the 1D view the 💰 Budget tab with
// its sections. The 2D view's chips open the 1D view's tab.

import type { Net } from '../../net';
import { store } from '../../state';
import type { BudgetNeed, NeedTarget } from '../../../shared/needsyou';
import { openResume } from '../project-run/modal';
import { budgetChips } from './chips';
import { budgetFeed, type BudgetFeed } from './feed';
import { budgetTab, type BudgetSection } from './tab';
import { planSection, varianceSection } from './plan';
import { pausedSection, settingsSection } from './settings';
import { insightsSection, onInsightGo } from './insights';
import type { Insight } from '../../../shared/budget/types';

/** The sections between the headline and the breakdowns, in order (the plan, variance, settings, insights plug in here). */
export const SECTIONS: BudgetSection[] = [pausedSection, insightsSection, varianceSection, settingsSection, planSection];

export interface BudgetUi {
  feed: BudgetFeed;
  /** Draws the tab (when it's showing). */
  show(): void;
  /** What Needs you reads of the budget. */
  need(): BudgetNeed | undefined;
  /** A Needs-you button: the tab, or Resume. */
  go(t: Extract<NeedTarget, { to: 'budget' }>): void;
}

/** `root` is the tab's element on the 1D view (none on the 2D view); `open` shows the tab. */
export function budgetUi(net: Net, opts: { root?: HTMLElement; visible?: () => boolean; open: () => void; go?: (to: NonNullable<Insight['action']>['to']) => void }): BudgetUi {
  const feed = budgetFeed(net);
  if (opts.go) onInsightGo(opts.go);
  budgetChips(feed, opts.open);
  const tab = opts.root ? budgetTab(opts.root, feed, opts.visible ?? (() => true), SECTIONS) : undefined;
  return {
    feed,
    show: () => tab?.render(),
    need: () => {
      const v = feed.floor();
      return v && v.settings.total ? { floor: v.floor, alerts: v.alerts ?? [], ...(v.paused ? { paused: v.paused } : {}) } : undefined;
    },
    go: (t) => {
      opts.open();
      // Resume is the office's ▶ Resume project: its preview, who has work waiting and what's safe.
      if (t.resume && store.floor) void openResume(store.floor, () => feed.refresh());
    },
  };
}
