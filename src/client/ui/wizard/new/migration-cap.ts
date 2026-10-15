// A migration's budget cap on the Team & budget card: the planner's estimate with a warning that migrations
// have run over it, and a cap field filled in with the level's budget. The cap is the plan's budget total
// (shared/budget/levels.ts BudgetChoice), so the level and its settings stay, and auto-pause at 100% is on.
import type { ProjectPlan } from '../../../../shared/wizard';
import { usd } from '../../../../shared/budget/money';
import { h } from '../../dom';
import './migration-cap.css';

/** A cap typed by hand, kept when the card is drawn again (a new level's preset doesn't undo it). */
const capped = new WeakMap<ProjectPlan, number>();

export const MIGRATION_CAP_NOTE = 'Migrations have run over this estimate; set a cap';

export function migrationCap(plan: ProjectPlan, estimate: number | undefined, redraw: () => void): HTMLElement | null {
  const b = plan.budget;
  if (plan.entry !== 'migration' || !b) return null;
  b.autoPause = true;
  const mine = capped.get(plan);
  if (mine) b.total = mine;
  const input = h('input', { type: 'number', id: 'nw-cap', min: '1', step: '50', value: String(Math.round(b.total)), inputmode: 'decimal' }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const v = Math.round(Number(input.value));
    if (!Number.isFinite(v) || v < 1) return void (input.value = String(Math.round(b.total)));
    b.total = v;
    capped.set(plan, v);
    redraw();
  });
  return h(
    'div.nw-warn.nw-cap',
    { role: 'note' },
    h('p', {}, h('strong', {}, `Planner’s estimate: ${estimate ? usd(estimate) : 'not known'}. `), `${MIGRATION_CAP_NOTE}.`),
    h('div.nw-field', {}, h('label', { for: 'nw-cap' }, 'Budget cap (USD)'), input, h('span.nw-hint', {}, 'The project pauses at 100% of the cap and tells you; raise it later on the Budget page.')),
  );
}
