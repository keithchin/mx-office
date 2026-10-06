// Which of the Team tab's and the Budget's actions count as risky through 📱 Phone access's tunnel
// (reauth.ts): those that let more money be spent. Lowering a cap or a budget never asks.

import { capAt, type AutonomyLevel } from '../../shared/roster/autonomy.js';
import type { RosterSettings } from '../../shared/roster/types.js';
import type { BudgetSettings } from '../../shared/budget/types.js';
import { cleanSettings } from '../roster/store.js';

const LEVELS: readonly AutonomyLevel[] = [1, 2, 3, 4];
/** A cap that was there, raised or taken off. */
const up = (was: number | undefined, now: number | undefined) => was !== undefined && (now === undefined || now > was);

/** Whether new team settings raise (or take off) a daily team cap, at any level or at the level it runs at. */
export function raisesTeamCap(before: RosterSettings, raw: unknown): boolean {
  const after = cleanSettings(raw, before);
  return LEVELS.some((l) => up(capAt(before.costCaps, l), capAt(after.costCaps, l))) || up(capAt(before.costCaps, before.autonomy), capAt(after.costCaps, after.autonomy));
}

/**
 * Whether a POST /api/budget/action raises the project's budget: a bigger total or none, auto-pause
 * switched off, the budget's pause taken off, a level or the Firm's re-forecast applied.
 */
export function raisesBudget(body: Record<string, unknown>, now: BudgetSettings): boolean {
  switch (body.action) {
    case 'resume':
    case 'level':
    case 'firm':
      return true;
    case 'settings': {
      if (body.autoPause === false && now.autoPause) return true;
      if (!('total' in body) || now.total === undefined) return false;
      const t = body.total;
      return t === null || t === '' || t === 0 || Number(t) > now.total;
    }
    default:
      return false;
  }
}
