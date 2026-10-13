// The Budget tab's alerts: every alert standing (100 %, the forecast over, the threshold), and Mark as
// seen on the forecast and threshold ones (admins). A seen one stays here, dimmed, with who saw it and
// when, and is out of Needs you; 100 % needs a budget decision, so it can't be marked. markAlertSeen is
// also what Needs you's Mark as seen button calls (ui/budget/index.ts).

import type { BudgetAlert } from '../../../shared/budget/types';
import { isSeeable } from '../../../shared/budget/alerts';
import { h, toast } from '../dom';
import type { BudgetSection } from './tab';
import { post } from './feed';

/** POST /api/budget/action {floor, action: 'seen', level}; whether the office took it. */
export async function markAlertSeen(floor: string, level: 'forecast' | 'threshold'): Promise<boolean> {
  const r = await post<{ ok: boolean }>('/api/budget/action', { floor, action: 'seen', level });
  if (r) toast(level === 'forecast' ? 'Forecast warning marked as seen' : 'Budget alert marked as seen');
  return !!r;
}

const LABEL: Record<BudgetAlert['level'], string> = { full: '100 %', forecast: 'Forecast', threshold: 'Threshold' };
const ORDER: BudgetAlert['level'][] = ['full', 'forecast', 'threshold'];

/** "Seen by Keith, 13 Oct". */
export const seenLine = (a: Pick<BudgetAlert, 'seenAt' | 'seenBy'>) => (a.seenAt ? `Seen by ${a.seenBy ?? 'someone'}, ${new Date(a.seenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : '');

export const alertsSection: BudgetSection = (v, _o, refresh) => {
  const list = (v.alerts ?? []).filter((a) => a.text).sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  if (!list.length) return null;
  const row = (a: BudgetAlert) =>
    h(
      'li.bud-alert',
      { 'data-level': a.level, ...(a.seenAt ? { 'data-seen': 'true' } : {}) },
      h('span.bud-alert-l', {}, LABEL[a.level]),
      h('span.bud-alert-t', {}, a.text),
      a.seenAt
        ? h('small.bud-hint', {}, seenLine(a))
        : isSeeable(a.level) && v.admin
          ? h('button.btn.small', { type: 'button', title: 'Out of Needs you; it stays here. A forecast warning comes back if the forecast grows by more than 10 %', onclick: async () => (await markAlertSeen(v.floor, a.level as 'forecast' | 'threshold')) && refresh() }, 'Mark as seen')
          : a.level === 'full'
            ? h('small.bud-hint', {}, 'Needs a budget decision: raise the budget or resume the project')
            : null,
    );
  return h('section.bud-card', { 'data-sec': 'alerts' }, h('h3.bud-h', {}, 'Alerts'), h('ul.bud-alerts', {}, ...list.map(row)));
};
