// The recording plan on the 🎬 Walkthroughs page (ui/walkthroughs/page.ts): which journeys play on which fresh
// database, in which order, which are played first only to set up another's start state (not filmed), and
// what isn't recorded and why (templates, an order that can't hold). Shown for the running batch (its group
// highlighted) and, folded, for what Re-record all would do at main's newest commit.

import type { PlanGroup, WalkPlan } from '../../../shared/walkthroughs/plan';
import { windowWords } from '../../../shared/walkthroughs/start-state';
import { h } from '../dom';

function group(g: PlanGroup, current: boolean): HTMLElement {
  return h(
    'li',
    { class: `wt-pgroup${current ? ' now' : ''}`, ...(current ? { 'aria-current': 'step' } : {}) },
    h('div.wt-phead', {}, h('strong', {}, `Group ${g.n}`), ' · fresh database', current ? h('span.pill.wt-pill.recording', {}, 'now') : null),
    h('p.wt-small', {}, g.why),
    h(
      'ol.wt-psteps',
      {},
      ...g.steps.map((s) =>
        h(
          'li',
          { class: s.setup ? 'setup' : '' },
          s.title,
          s.setup ? h('span.wt-ptag', { title: 'Played first, not filmed, so the journey after it starts on the data it needs' }, 'setup · not filmed') : null,
          s.windows?.length ? h('span.wt-ptag.win', { title: 'The journey says it must not run in this window: its group is moved to the end of the batch, or skipped with the reason' }, `not ${s.windows.map(windowWords).join(', ')}`) : null,
        ),
      ),
    ),
  );
}

/** The plan as a list of groups and skips; `now` is the group playing (1-based), if any. */
export function planView(p: WalkPlan, o: { now?: number; title: string; open: boolean }): HTMLElement {
  const setups = p.groups.reduce((n, g) => n + g.steps.filter((s) => s.setup).length, 0);
  const filmed = p.groups.reduce((n, g) => n + g.steps.filter((s) => !s.setup).length, 0);
  const summary = [`${p.groups.length} group${p.groups.length === 1 ? '' : 's'} (a fresh database each)`, `${filmed} filmed`, setups ? `${setups} played first to set up` : '', p.skipped.length ? `${p.skipped.length} not recorded` : ''].filter(Boolean).join(' · ');
  return h(
    'details.wt-plan',
    { open: o.open },
    h('summary', {}, h('strong', {}, o.title), ` · ${summary}`),
    h('ol.wt-pgroups', {}, ...p.groups.map((g) => group(g, g.n === o.now))),
    p.skipped.length
      ? h('div.wt-pskips', {}, h('p.wt-small', {}, h('strong', {}, 'Not recorded')), h('ul', {}, ...p.skipped.map((k) => h('li', {}, h('span', {}, k.title), h('span.wt-ptag', {}, k.kind === 'template' ? 'template — not recorded' : 'skipped'), h('span.wt-small', {}, ` ${k.why}`)))))
      : null,
  );
}
