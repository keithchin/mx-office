// What the server's Needs you (notify-teams/gather.ts, for the Teams cards and the Team phone) reads of a
// project's budget: the alerts standing and whether it's paused, and the models the price list had to guess for.

import type { BudgetNeed } from '../../shared/needsyou.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { budgetOf } from './index.js';
import { budgetPaused, pauseWhy } from './control.js';
import { totalOf } from './ledger.js';
import { priceListView } from '../prices.js';
import type { BudgetView } from '../../shared/budget/types.js';
import { stageNeedOfView } from '../../shared/budget/stage-need.js';
import { stagePlanOf } from './stage-warn.js';

export function budgetNeedOf(ctx: Ctx, floor: Floor): BudgetNeed | undefined {
  try {
    const ref = { id: floor.id, name: floor.def.name, dir: floor.dir };
    const f = budgetOf(ctx).file(ref);
    const p = priceListView();
    const prices = p.unpriced.length ? { prices: p } : {};
    // Stages past their plan line and the pace (stage-warn.ts), only once one was raised: no plan read otherwise.
    const stages = f.stageWarns?.length || f.pace ? stageNeedOfView({ stagePlan: stagePlanOf(budgetOf(ctx), ref) } as BudgetView) : {};
    if (!f.settings.total) return p.unpriced.length || stages.stageWarnings ? { floor: floor.id, alerts: [], ...prices, ...stages } : undefined;
    return { floor: floor.id, alerts: f.alerts.filter((a) => a.text), ...(budgetPaused(budgetOf(ctx), ref) ? { paused: pauseWhy(f.settings.total, totalOf(f.ledger)) } : {}), ...prices, ...stages };
  } catch {
    return undefined;
  }
}
