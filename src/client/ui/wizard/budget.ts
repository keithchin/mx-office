// The new-project wizard's Budget page: three levels trading cost against speed (Lean, Balanced, Fast),
// each with its preset budget from the plan estimate for this project's tier and entry mode (GET
// /api/budget/estimate), plus Manual. Picking one fills the plan's budget and the settings the team
// step applies when it hires the team (and the Discovery model).

import { h } from '../dom';
import { fetchEstimate, levelPicker, type Estimate } from '../budget/levels-ui';
import type { PageCtx } from './forms';

const cache = new Map<string, Estimate>();

export function budgetPage(c: PageCtx): HTMLElement {
  const d = c.draft;
  const key = `tier=${d.tier}&entry=${d.entry}`;
  const box = h('div.wz-budget', {}, h('p.setting-note', {}, 'Working out the plan estimate…'));
  const show = (e: Estimate) => {
    box.replaceChildren(
      levelPicker(
        e,
        (choice) => {
          d.budget = choice;
          d.discovery.model = choice.settings.discoveryModel;
        },
        d.budget?.level ?? 'balanced',
        d.budget?.total,
      ),
    );
  };
  const hit = cache.get(key);
  if (hit) show(hit);
  else
    void fetchEstimate(key).then((e) => {
      if (!e) return box.replaceChildren(h('p.wz-note', {}, 'The office couldn’t work out an estimate: the project is made without a budget (set one later on its 💰 Budget tab).'));
      cache.set(key, e);
      show(e);
    });
  return h(
    'div.wz-page',
    {},
    h('p.setting-note', {}, 'How fast against how much. Each level sets the team’s models, early drafts, autonomy by stage and how many agents work at once, and a budget for the whole project. At 100 % the project pauses and tells you; the alert before that is at the threshold.'),
    box,
    c.editing ? h('p.wz-note', {}, 'For a project that’s already set up, change its level on its 💰 Budget tab: the setup only applies it once.') : null,
  );
}
