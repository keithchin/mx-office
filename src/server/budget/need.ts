// What the server's Needs you (notify-teams/gather.ts, for the Teams cards and the Team phone) reads of a
// project's budget: the alerts standing and whether it's paused, and the models the price list had to guess for.

import type { BudgetNeed } from '../../shared/needsyou.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { budgetOf } from './index.js';
import { budgetPaused, pauseWhy } from './control.js';
import { totalOf } from './ledger.js';
import { priceListView } from '../prices.js';

export function budgetNeedOf(ctx: Ctx, floor: Floor): BudgetNeed | undefined {
  try {
    const f = budgetOf(ctx).file({ id: floor.id, name: floor.def.name, dir: floor.dir });
    const p = priceListView();
    const prices = p.unpriced.length ? { prices: p } : {};
    if (!f.settings.total) return p.unpriced.length ? { floor: floor.id, alerts: [], ...prices } : undefined;
    return { floor: floor.id, alerts: f.alerts.filter((a) => a.text), ...(budgetPaused(budgetOf(ctx), { id: floor.id, name: floor.def.name, dir: floor.dir }) ? { paused: pauseWhy(f.settings.total, totalOf(f.ledger)) } : {}), ...prices };
  } catch {
    return undefined;
  }
}
