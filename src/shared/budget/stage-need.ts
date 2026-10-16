// Needs you's rows for the stage overspend and pace warnings (shared/budget/stage-warn.ts): one per stage
// past its plan line and not dismissed, with Raise the budget… and Dismiss for this stage; and the pace
// warning, with Review the plan and Dismiss for today, unless a stage row already says when the budget
// runs out (no saying it twice) or the budget paused the project (its own row asks for the decision).
// Pure: the page, the server's Teams cards and the tests read it.

import type { BudgetNeed, NeedItem } from '../needsyou.js';
import type { BudgetView } from './types.js';

export function stageNeeds(b: BudgetNeed | undefined): NeedItem[] {
  if (!b || b.paused) return [];
  const out: NeedItem[] = [];
  for (const w of b.stageWarnings ?? []) {
    if (w.dismissed) continue;
    out.push({ key: `budget-stage-${w.stage}`, kind: 'budget', icon: '📈', text: w.text, since: w.at, level: 'warn', action: 'Raise the budget…', target: { to: 'budget', section: 'settings' }, alt: { action: 'Dismiss for this stage', target: { to: 'budget', dismissStage: w.stage } } });
  }
  const p = b.pace;
  if (p && !p.dismissed && !out.length) out.push({ key: 'budget-pace', kind: 'budget', icon: '⏳', text: p.text, since: p.at, level: 'warn', action: 'Review the plan', target: { to: 'budget', section: 'stages' }, alt: { action: 'Dismiss for today', target: { to: 'budget', dismissPace: true } } });
  return out;
}

/** The stage warnings and pace of a Budget view, for what Needs you reads on the page. */
export function stageNeedOfView(v: BudgetView | undefined): Pick<BudgetNeed, 'stageWarnings' | 'pace'> {
  const s = v?.stagePlan;
  if (!s) return {};
  const warnings = s.warnings.filter((w) => !w.dismissed);
  return { ...(warnings.length ? { stageWarnings: warnings } : {}), ...(s.pace && !s.pace.dismissed ? { pace: s.pace } : {}) };
}
