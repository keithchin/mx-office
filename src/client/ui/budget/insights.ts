// The Budget tab's insights: what drives the spend, and suggestions that each take you to the action
// the office already has (the Org chart for a role's model, the team's settings for benching, Jeff and
// early drafts).

import type { Insight } from '../../../shared/budget/types';
import { h } from '../dom';
import type { BudgetSection } from './tab';

/** Where an insight's button goes; the 1D view sets it (the Org chart, Settings, …). */
let go: (to: NonNullable<Insight['action']>['to']) => void = () => {};
export const onInsightGo = (fn: typeof go) => (go = fn);

export const insightsSection: BudgetSection = (v) => {
  const list = v.insights ?? [];
  if (!list.length) return null;
  const item = (i: Insight) => h('li.bud-insight', { class: `bud-${i.kind}` }, h('span', {}, i.kind === 'driver' ? '📈 ' : '💡 ', i.text), i.action ? h('button.btn.small', { type: 'button', onclick: () => go(i.action!.to) }, i.action.label) : null);
  const drivers = list.filter((i) => i.kind === 'driver');
  const ideas = list.filter((i) => i.kind === 'suggestion');
  return h(
    'section.bud-card',
    {},
    h('h3.bud-h', {}, 'Insights', h('small.bud-hsub', {}, 'from the last 30 days')),
    drivers.length ? h('h4.bud-h4', {}, 'What drives the spend') : null,
    drivers.length ? h('ul.bud-insights', {}, ...drivers.map(item)) : null,
    ideas.length ? h('h4.bud-h4', {}, 'Ways to spend less') : null,
    ideas.length ? h('ul.bud-insights', {}, ...ideas.map(item)) : null,
  );
};
