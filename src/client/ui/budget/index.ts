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
import { dismissPace, dismissStage, goSection, stagesSection } from './stages';
import { pausedSection, settingsSection } from './settings';
import { insightsSection, onInsightGo } from './insights';
import { alertsSection, markAlertSeen } from './alerts';
import type { Insight } from '../../../shared/budget/types';
import { budgetNeedOfView } from '../../../shared/budget/prices';

/** The sections between the headline and the breakdowns, in order (the plan, variance, settings, insights plug in here). */
export const SECTIONS: BudgetSection[] = [pausedSection, alertsSection, stagesSection, insightsSection, varianceSection, settingsSection, planSection];

export interface BudgetUi {
  feed: BudgetFeed;
  /** Draws the tab (when it's showing). */
  show(): void;
  /** What Needs you reads of the budget. */
  need(): BudgetNeed | undefined;
  /** A Needs-you button: the tab (at a section), Resume, Mark as seen, or Dismiss a stage or pace warning. */
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
    need: () => budgetNeedOfView(feed.floor()),
    go: (t) => {
      // Mark as seen stays where you are: the item leaves Needs you once the budget is fetched again.
      if (t.seen) {
        const floor = feed.floor()?.floor ?? store.floor;
        if (floor) void markAlertSeen(floor, t.seen).then((ok) => ok && feed.refresh());
        return;
      }
      // Dismiss a stage's overspend warning (until its next level) or today's pace warning: stays where you are too.
      if (t.dismissStage || t.dismissPace) {
        const floor = feed.floor()?.floor ?? store.floor;
        if (floor) void (t.dismissStage ? dismissStage(floor, t.dismissStage) : dismissPace(floor)).then((ok) => ok && feed.refresh());
        return;
      }
      opts.open();
      if (t.section) goSection(t.section);
      // Resume is the office's ▶ Resume project: its preview, who has work waiting and what's safe.
      if (t.resume && store.floor) void openResume(store.floor, () => feed.refresh());
    },
  };
}
