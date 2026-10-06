// The Budget tab's settings (admins): the project's total, alert threshold and auto-pause, Resume when the
// budget paused it, Change level (the wizard's cards again, applied from the team's next hire or Playbook
// rewrite), and the office's own: the default alert threshold and the local currency.

import type { BudgetView, OfficeBudgetView } from '../../../shared/budget/types';
import type { BudgetChoice } from '../../../shared/budget/levels';
import { rateLine } from '../../../shared/budget/money';
import { h, toast } from '../dom';
import type { BudgetSection } from './tab';
import { act } from './plan';
import { post } from './feed';
import { fetchEstimate, levelPicker } from './levels-ui';
import { openResume } from '../project-run/modal';

/** Paused by the budget: Raise budget and Resume, right under the headline. */
export const pausedSection: BudgetSection = (v, _o, refresh) => {
  if (!v.paused) return null;
  return h(
    'div.bud-paused',
    { role: 'alert' },
    h('strong', {}, '⏸️ Budget reached: project paused'),
    h('span', {}, 'The project is paused (⏸ Pause project): agents finish their turn, hand off and sleep; no new hires and no office prompts, and people’s messages still go through.'),
    v.admin
      ? h('span.bud-actions', {}, h('button.btn.small.primary', { type: 'button', onclick: () => document.querySelector<HTMLInputElement>('#bud-total')?.focus() }, 'Raise budget'), h('button.btn.small', { type: 'button', title: '▶ Resume project: see who has work waiting first', onclick: () => void openResume(v.floor, refresh) }, 'Resume'))
      : h('span.bud-note', {}, 'An admin can raise the budget or resume it.'),
  );
};

function projectForm(v: BudgetView, refresh: () => void): HTMLElement {
  const total = h('input.bud-in', { id: 'bud-total', type: 'number', min: '0', step: '10', value: v.settings.total ? String(v.settings.total) : '', placeholder: 'No budget', 'aria-label': 'Total budget, USD' });
  const th = h('input.bud-in.bud-in-days', { type: 'number', min: '1', max: '99', value: v.settings.threshold ? String(v.settings.threshold) : '', placeholder: String(v.officeThreshold), 'aria-label': 'Alert threshold, percent' });
  const ap = h('input', { type: 'checkbox', checked: v.settings.autoPause });
  const save = () => void act(v, { action: 'settings', total: total.value === '' ? null : Number(total.value), threshold: th.value === '' ? null : Number(th.value), autoPause: ap.checked }, refresh, 'Budget saved');
  return h(
    'div.bud-fields',
    {},
    h('label.bud-field', {}, h('span', {}, 'Total budget (USD)'), h('span.bud-row', {}, '$', total)),
    h('label.bud-field', {}, h('span', {}, `Alert at (office default ${v.officeThreshold} %)`), h('span.bud-row', {}, th, '%')),
    h('label.bud-check', {}, ap, ' Pause the project at 100 %'),
    h('button.btn.small.primary', { type: 'button', onclick: save }, 'Save'),
    v.settings.updatedBy ? h('small.bud-hint', {}, `Last changed by ${v.settings.updatedBy}${v.settings.updatedAt ? ` on ${new Date(v.settings.updatedAt).toLocaleDateString()}` : ''}`) : null,
  );
}

function levelBox(v: BudgetView, refresh: () => void): HTMLElement {
  const box = h('div.bud-level-box', {}, h('button.btn.small', { type: 'button' }, `Change level${v.settings.level ? ` (now ${v.settings.level})` : ''}`));
  box.firstElementChild!.addEventListener('click', async () => {
    const e = await fetchEstimate(`floor=${encodeURIComponent(v.floor)}`);
    if (!e) return toast("Couldn't load the levels", 'warn');
    let choice: BudgetChoice | undefined;
    const apply = h('button.btn.small.primary', { type: 'button' }, 'Apply level');
    apply.addEventListener('click', () => choice && void act(v, { action: 'level', choice }, refresh));
    box.replaceChildren(levelPicker(e, (c) => (choice = c), v.settings.level ?? 'balanced', v.settings.total), h('p.bud-note', {}, 'Models and settings apply from each Lead’s next hire or Playbook rewrite; a session that’s running keeps its model, and nobody is interrupted mid-turn.'), h('div.bud-actions', {}, apply, h('button.btn.small', { type: 'button', onclick: refresh }, 'Cancel')));
  });
  return box;
}

function officeForm(o: OfficeBudgetView, refresh: () => void): HTMLElement {
  const th = h('input.bud-in.bud-in-days', { type: 'number', min: '1', max: '99', value: String(o.officeThreshold), 'aria-label': 'Office default alert threshold, percent' });
  const cur = h('input.bud-in.bud-in-days', { type: 'text', maxlength: '3', value: o.fxSettings.currency, 'aria-label': 'Local currency, three letters' });
  const mode = h('select', { 'aria-label': 'Where the rate comes from' }, h('option', { value: 'daily', selected: o.fxSettings.mode === 'daily' }, 'ECB rate, fetched daily'), h('option', { value: 'manual', selected: o.fxSettings.mode === 'manual' }, 'Set by hand'));
  const rate = h('input.bud-in', { type: 'number', min: '0', step: '0.0001', value: o.fxSettings.manualRate ? String(o.fxSettings.manualRate) : '', placeholder: 'per US dollar', 'aria-label': 'Rate set by hand: units per US dollar' });
  const saveFx = async (refreshRate = false) => {
    const r = await post('/api/budget/fx', { currency: cur.value, mode: mode.value, ...(rate.value ? { manualRate: Number(rate.value) } : {}), refresh: refreshRate });
    if (r) toast('Currency saved');
    refresh();
  };
  return h(
    'div.bud-fields',
    {},
    h('label.bud-field', {}, h('span', {}, 'Office default alert'), h('span.bud-row', {}, th, '%', h('button.btn.small', { type: 'button', onclick: async () => ((await post('/api/budget/action', { action: 'officeThreshold', threshold: Number(th.value) })) && toast('Saved'), refresh()) }, 'Save'))),
    h('label.bud-field', {}, h('span', {}, 'Local currency'), h('span.bud-row', {}, cur, mode, rate)),
    h('span.bud-actions', {}, h('button.btn.small', { type: 'button', onclick: () => void saveFx() }, 'Save currency'), h('button.btn.small', { type: 'button', onclick: () => void saveFx(true) }, 'Fetch the rate now')),
    rateLine(o.fx) ? h('small.bud-hint', {}, rateLine(o.fx)!) : null,
  );
}

export const settingsSection: BudgetSection = (v, o, refresh) => {
  if (!v.admin) return h('details.bud-card.bud-keep', { 'data-sec': 'settings' }, h('summary.bud-h', {}, 'Settings'), h('p.bud-note', {}, `Budget ${v.settings.total ? `$${v.settings.total}` : 'not set'}, alert at ${v.settings.threshold ?? v.officeThreshold} %, auto-pause ${v.settings.autoPause ? 'on' : 'off'}${v.settings.level ? `, level ${v.settings.level}` : ''}. Only admins change them.`));
  return h('details.bud-card.bud-keep', { 'data-sec': 'settings', ...(v.paused || !v.settings.total ? { open: true } : {}) }, h('summary.bud-h', {}, 'Settings'), h('h4.bud-h4', {}, 'This project'), projectForm(v, refresh), h('h4.bud-h4', {}, 'Budget level'), levelBox(v, refresh), o ? h('h4.bud-h4', {}, 'The office') : null, o ? officeForm(o, refresh) : null);
};
