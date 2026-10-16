// The Budget tab's stage table: each stage's plan line against what was booked to it, and how many times
// over (×), with the overspend warnings (shared/budget/stage-warn.ts) beside their stage and the pace
// warning above. Estimates say they're estimates (the plan's numbers, the run-out date, history spread
// over the days) and missing data says it's missing (a stage with no plan line, spend booked to no stage,
// a project without the toolkit's pipeline). Admins raise the budget, review the plan or dismiss from here.

import type { BudgetView } from '../../../shared/budget/types';
import type { StagePlanRow, StageWarnView } from '../../../shared/budget/stage-warn';
import { dayWord, ratioWord } from '../../../shared/budget/stage-warn';
import { usdCents } from '../../../shared/budget/money';
import { h, toast } from '../dom';
import type { BudgetSection } from './tab';
import { post } from './feed';

/** POST /api/budget/action {floor, action: 'stage-dismiss', stage}; whether the office took it. */
export async function dismissStage(floor: string, stage: string): Promise<boolean> {
  const r = await post<{ ok: boolean }>('/api/budget/action', { floor, action: 'stage-dismiss', stage });
  if (r) toast(`Stage ${stage} warning dismissed until its next level`);
  return !!r;
}

/** POST /api/budget/action {floor, action: 'pace-dismiss'}. */
export async function dismissPace(floor: string): Promise<boolean> {
  const r = await post<{ ok: boolean }>('/api/budget/action', { floor, action: 'pace-dismiss' });
  if (r) toast('Pace warning dismissed for today');
  return !!r;
}

/** Scrolls the tab to a section once it's drawn: the stage table, or Settings opened with the total focused. */
export function goSection(section: 'settings' | 'stages' | 'plan') {
  const look = (tries: number) => {
    const el = document.querySelector<HTMLElement>(`#budget-view [data-sec="${section}"]`);
    if (!el) return void (tries > 0 && setTimeout(() => look(tries - 1), 100));
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (section === 'settings') document.querySelector<HTMLInputElement>('#bud-total')?.focus({ preventScroll: true });
  };
  requestAnimationFrame(() => look(15));
}

function row(r: StagePlanRow, w: StageWarnView | undefined): HTMLElement {
  const over = r.ratio !== null && r.ratio >= 1;
  return h(
    'tr',
    { ...(w && !w.dismissed ? { 'data-warn': 'true' } : {}) },
    h('th', { scope: 'row' }, r.label, r.current ? h('small.bud-hint', {}, 'now') : r.done ? h('small.bud-hint', {}, 'done') : null),
    h('td.bud-num', {}, r.planned === null ? h('span.bud-missing', { title: 'This stage has no line in the plan, so its spend can’t be compared' }, 'not in the plan') : usdCents(r.planned)),
    h('td.bud-num', {}, usdCents(r.spent)),
    h('td.bud-num', { class: over ? 'bud-over' : '' }, r.ratio === null ? '—' : ratioWord(r.ratio)),
    h('td.bud-st', {}, w ? (w.dismissed ? h('small.bud-hint', {}, `warned at ${w.multiple}×, dismissed until ${nextLevel(w.multiple)}`) : h('small.bud-hint.bud-warned', {}, `over plan: warned at ${w.multiple}×`)) : null),
  );
}

const nextLevel = (m: number) => (m >= 10 ? 'it changes' : `${m === 1 ? 2 : m === 2 ? 5 : 10}×`);

export const stagesSection: BudgetSection = (v: BudgetView, _o, refresh) => {
  const s = v.stagePlan;
  if (!s) return null;
  const warns = new Map(s.warnings.map((w) => [w.stage, w]));
  const live = s.warnings.filter((w) => !w.dismissed);
  const raise = () => goSection('settings');
  const review = () => goSection('plan');
  const actions = (extra?: HTMLElement | null) => (v.admin ? h('span.bud-actions', {}, h('button.btn.small.primary', { type: 'button', onclick: raise }, 'Raise the budget…'), h('button.btn.small', { type: 'button', onclick: review }, 'Review the plan'), extra ?? null) : h('small.bud-hint', {}, 'An admin can raise the budget, change the plan or dismiss a warning.'));
  const warnList = live.map((w) => h('li.bud-alert', { 'data-level': 'stage' }, h('span.bud-alert-l', {}, `Stage ${w.stage}`), h('span.bud-alert-t', {}, w.text), actions(v.admin ? h('button.btn.small', { type: 'button', title: 'Out of Needs you until this stage reaches its next level', onclick: async () => (await dismissStage(v.floor, w.stage)) && refresh() }, 'Dismiss for this stage') : null)));
  const pace = s.pace && !s.pace.dismissed && !live.length ? h('li.bud-alert', { 'data-level': 'pace' }, h('span.bud-alert-l', {}, 'Pace'), h('span.bud-alert-t', {}, s.pace.text), actions(v.admin ? h('button.btn.small', { type: 'button', onclick: async () => (await dismissPace(v.floor)) && refresh() }, 'Dismiss for today') : null)) : null;
  const sumP = s.rows.reduce((n, r) => n + (r.planned ?? 0), 0);
  const sumA = s.rows.reduce((n, r) => n + r.spent, 0);
  const notes = [
    s.noPipeline ? 'Missing: this project has no toolkit pipeline, so its spend can’t be told apart by stage and no stage is warned about.' : '',
    s.unattributed > 0.005 ? `Missing: ${usdCents(s.unattributed)} was booked to no stage (before the stage was known, or outside the pipeline), so it’s in no row.` : '',
    'Spend is booked to the stage the project was in at the time (read from its gate files); work done before a gate was recorded counts towards the earlier stage.',
    s.planEstimated ? 'Plan lines marked by the office are estimates (its default rates or this office’s history), not quotes.' : '',
    s.estimated > 0.005 ? `${usdCents(s.estimated)} of the spend is estimated from history (before the ledger started), not split exactly by stage.` : '',
    s.runOut ? `Run-out estimate: around ${dayWord(s.runOut.date)} at ${usdCents(s.runOut.perDay)} a day (the last ${s.runOut.days} day${s.runOut.days === 1 ? '' : 's'}’ average); the ${s.endIs === 'milestone' ? 'milestone' : 'plan’s end'} is ${dayWord(s.end)}.` : v.settings.total ? 'Run-out: no recent spend to estimate it from.' : 'Run-out: no project budget set.',
  ].filter(Boolean);
  return h(
    'section.bud-card',
    { 'data-sec': 'stages' },
    h('h3.bud-h', {}, 'Stages against plan', h('small.bud-hsub', {}, 'warned at 1×, 2×, 5× and 10× a stage’s plan line')),
    warnList.length || pace ? h('ul.bud-alerts', {}, ...warnList, pace) : null,
    s.rows.length
      ? h(
          'table.bud-table.bud-var.bud-stages',
          {},
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Stage'), h('th', { scope: 'col', class: 'bud-num' }, 'Plan (estimate)'), h('th', { scope: 'col', class: 'bud-num' }, 'Spent'), h('th', { scope: 'col', class: 'bud-num', title: 'Spent ÷ plan' }, '×'), h('th', { scope: 'col' }, h('span.vh', {}, 'Warning')))),
          h('tbody', {}, ...s.rows.map((r) => row(r, warns.get(r.stage)))),
          h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, 'In these stages'), h('td.bud-num', {}, usdCents(sumP)), h('td.bud-num', {}, usdCents(sumA)), h('td.bud-num', {}, sumP > 0 ? ratioWord(sumA / sumP) : '—'), h('td'))),
        )
      : h('p.bud-empty', {}, 'No plan lines and no stage spend yet.'),
    h('div.bud-notes', {}, ...notes.map((t) => h('p.bud-note', {}, t))),
  );
};
