// An Expert project's budget, set by the Expert wizard's setup: one total in USD, an alert at 80 % and the session
// paused at 100 % (budget/pause.ts pauses, never kills mid-write). No level: an Expert project has no team whose
// models a level would set. Recorded in the audit log like the Budget page's own change.

import type { Ctx } from '../office/context.js';
import { budgetOf, controlOf } from '../budget/index.js';

export const EXPERT_ALERT_PCT = 80;

/** Sets the floor's budget total with auto-pause on; why not, if it couldn't. */
export function setExpertBudget(ctx: Ctx, floorId: string, total: number, by: string): string | undefined {
  const b = budgetOf(ctx);
  const floor = b.floorRef(floorId);
  if (!floor) return 'the project is gone';
  const f = b.file(floor);
  const was = { ...f.settings };
  f.settings = { ...f.settings, total, threshold: EXPERT_ALERT_PCT, autoPause: true, updatedBy: by, updatedAt: Date.now() };
  if (total > (was.total ?? 0)) f.alerts = f.alerts.filter((a) => a.budget >= total);
  b.store.changed(floorId);
  controlOf(ctx).record(floorId, by, 'budget.settings', `Set ${floor.name}'s budget to $${total} in the Expert wizard (alert at ${EXPERT_ALERT_PCT} %, the session pauses at 100 %)`, { before: { total: was.total }, after: { total, threshold: EXPERT_ALERT_PCT, autoPause: true } });
  return undefined;
}
