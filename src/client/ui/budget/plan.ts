// The Budget tab's plan sections: the variance chart and the per-stage table (planned, actual,
// difference), then the expected plan line by line, which admins edit in place (each edit records who),
// make again from the project, or re-forecast from a Firm audit with one click.

import type { BudgetView, PlanLine } from '../../../shared/budget/types';
import { both, usd, usdCents } from '../../../shared/budget/money';
import { h, toast } from '../dom';
import type { BudgetSection } from './tab';
import { varianceChart } from './chart';
import { post } from './feed';

const BASIS: Record<PlanLine['basis'], string> = { default: 'default rate', history: 'this office’s history', firm: 'Firm audit', edited: 'edited' };

/** Sends a budget action for the floor and redraws. */
export async function act(v: BudgetView, body: Record<string, unknown>, refresh: () => void, done?: string): Promise<boolean> {
  const r = await post<{ note?: string }>('/api/budget/action', { floor: v.floor, ...body });
  if (r) toast(r.note ?? done ?? 'Saved');
  refresh();
  return !!r;
}

/** Planned against actual: the chart and the per-stage table. */
export const varianceSection: BudgetSection = (v) => {
  if (!v.plan || !v.variance) return null;
  const f = v.forecast;
  const rows = v.variance.map((s) =>
    h(
      'tr',
      {},
      h('th', { scope: 'row' }, s.label, s.done ? h('small.bud-hint', {}, 'done') : null),
      h('td.bud-num', {}, usdCents(s.planned)),
      h('td.bud-num', {}, usdCents(s.actual)),
      h('td.bud-num', { class: s.diff > 0.005 ? 'bud-over' : s.diff < -0.005 ? 'bud-under' : '' }, `${s.diff > 0 ? '+' : ''}${usdCents(s.diff)}`),
    ),
  );
  const sumP = v.variance.reduce((n, s) => n + s.planned, 0);
  const sumA = v.variance.reduce((n, s) => n + s.actual, 0);
  return h(
    'section.bud-card',
    {},
    h('h3.bud-h', {}, 'Plan against actual', h('small.bud-hsub', {}, `expected end ${v.plan.end}`)),
    varianceChart(v),
    f ? h('p.bud-note', {}, `Forecast at completion ${both(f.atCompletion, v.fx)} = spent ${usd(v.spent)} + ${usd(f.remainingPlan)} of plan left × ${f.factor.toFixed(2)} (how the finished stages went against their plan, kept between 0.5 and 2).${f.over ? ` That's ${usd(f.over)} over the budget.` : ''}`) : null,
    h('table.bud-table.bud-var', {}, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Stage'), h('th', { scope: 'col', class: 'bud-num' }, 'Planned'), h('th', { scope: 'col', class: 'bud-num' }, 'Actual'), h('th', { scope: 'col', class: 'bud-num' }, 'Difference'))), h('tbody', {}, ...rows), h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, 'In the plan’s stages'), h('td.bud-num', {}, usdCents(sumP)), h('td.bud-num', {}, usdCents(sumA)), h('td.bud-num', {}, `${sumA - sumP > 0 ? '+' : ''}${usdCents(sumA - sumP)}`)))),
  );
};

/** The expected plan, editable by admins. */
export const planSection: BudgetSection = (v, _o, refresh) => {
  const p = v.plan;
  if (!p) return null;
  const inputs = new Map<string, { usd: HTMLInputElement; days: HTMLInputElement }>();
  const rows = p.lines.map((l) => {
    const u = h('input.bud-in', { type: 'number', min: '0', step: '1', value: String(l.usd), 'aria-label': `${l.label}: expected cost in USD`, disabled: !v.admin });
    const d = h('input.bud-in.bud-in-days', { type: 'number', min: '0', step: '1', value: String(l.days), 'aria-label': `${l.label}: working days`, disabled: !v.admin });
    inputs.set(l.id, { usd: u, days: d });
    return h('tr', {}, h('th', { scope: 'row' }, l.label, h('small.bud-hint', {}, l.basis === 'edited' || l.basis === 'firm' ? `${BASIS[l.basis]} by ${l.editedBy ?? 'someone'}` : BASIS[l.basis])), h('td.bud-num', {}, h('span.bud-dollar', {}, '$'), u), h('td.bud-num', {}, d, ' d'));
  });
  const total = p.lines.reduce((n, l) => n + l.usd, 0);
  const save = async () => {
    const lines = p.lines.filter((l) => Number(inputs.get(l.id)!.usd.value) !== l.usd || Number(inputs.get(l.id)!.days.value) !== l.days).map((l) => ({ id: l.id, usd: Number(inputs.get(l.id)!.usd.value), days: Number(inputs.get(l.id)!.days.value) }));
    if (!lines.length) return toast('Nothing changed');
    await act(v, { action: 'plan', lines }, refresh, `Plan saved: ${lines.length} line${lines.length === 1 ? '' : 's'} edited`);
  };
  const firm = v.firm;
  return h(
    'details.bud-card.bud-keep',
    { 'data-sec': 'plan' },
    h('summary.bud-h', {}, 'Expected plan', h('small.bud-hsub', {}, `${usd(total)} · ${p.start} to ${p.end}${p.edited ? ' · edited' : ''}`)),
    h('p.bud-note', {}, `Made from: ${p.basis}. Each stage's cost is spread over its working days to make the expected curve.`),
    h('table.bud-table.bud-plan', {}, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Line'), h('th', { scope: 'col', class: 'bud-num' }, 'Expected'), h('th', { scope: 'col', class: 'bud-num' }, 'Days'))), h('tbody', {}, ...rows)),
    v.admin
      ? h(
          'div.bud-actions',
          {},
          h('button.btn.small.primary', { type: 'button', onclick: () => void save() }, 'Save plan'),
          h('button.btn.small', { type: 'button', title: 'Make the plan again from the project: its tier, entry mode, build modules and this office’s history (edited lines too)', onclick: () => confirm('Make the plan again from the project? Edited lines are replaced.') && void act(v, { action: 'regenerate' }, refresh, 'Plan made again from the project') }, 'Make again'),
          firm ? h('button.btn.small', { type: 'button', title: `The Firm's audit ${firm.report}`, onclick: () => void act(v, { action: 'firm' }, refresh, 'Applied the Firm’s re-forecast') }, `Apply the Firm's re-forecast${firm.usd !== undefined ? ` (${usd(firm.usd)}` : ' ('}${firm.end ? `${firm.usd !== undefined ? ', ' : ''}ends ${firm.end}` : ''})`) : null,
        )
      : h('p.bud-note', {}, 'Only admins edit the plan.'),
  );
};
