// The top of the Workers tab: the podium (the top three as chunky pixel robots on their steps), the
// full ranking as a table, and a card per model or role with its average grade and how the grades spread.

import { GRADES } from '../../../shared/ranking/model';
import type { GroupStats, RankedWorker, RankingReport } from '../../../shared/ranking/report';
import { h } from '../dom';
import { colorOf, gradeBadge, robot } from './view';

export function podium(r: RankingReport, pick: (key: string) => void): HTMLElement | null {
  const top = r.workers.filter((w) => w.score !== undefined).slice(0, 3);
  if (!top.length) return null;
  // Second, first, third, as podiums stand.
  const order = [top[1], top[0], top[2]];
  const step = (w: RankedWorker | undefined, place: number) =>
    w
      ? h(
          `button.rk-step.p${place}`,
          { type: 'button', onclick: () => pick(w.key), title: `${w.name}: ${w.score!.toFixed(0)} of 100, show its card` },
          h('span.rk-podium-bot', {}, robot(colorOf(w), place === 1 ? 56 : 44)),
          h('span.rk-podium-name', {}, w.name),
          h('span.rk-podium-sub', {}, `${w.roleLabel} · ${w.modelLabel}`),
          gradeBadge(w.grade, w.score),
          h('span.rk-block', {}, place === 1 ? '🥇 1' : place === 2 ? '🥈 2' : '🥉 3'),
        )
      : h('span.rk-step.empty', { 'aria-hidden': 'true' });
  return h('div.rk-podium', { role: 'group', 'aria-label': 'Top three' }, step(order[0], 2), step(order[1], 1), step(order[2], 3));
}

export function table(r: RankingReport, pick: (key: string) => void): HTMLElement {
  const graded = r.workers.filter((w) => w.score !== undefined);
  const head = ['#', 'Grade', 'Worker', 'Role', 'Model', ...(r.scope === 'all' ? ['Floor'] : []), 'Score', 'Trend', 'Tasks'];
  const row = (w: RankedWorker) =>
    h(
      `tr${w.gone ? '.gone' : ''}`,
      { tabindex: '0', onclick: () => pick(w.key), onkeydown: (e: Event) => { const k = (e as KeyboardEvent).key; if (k === 'Enter' || k === ' ') { e.preventDefault(); pick(w.key); } } },
      h('td.num', {}, String((r.scope === 'all' ? w.rank.global : w.rank.floor) ?? '')),
      h('td', {}, gradeBadge(w.grade, w.score, false)),
      h('th', { scope: 'row' }, h('span.rk-who', {}, robot(colorOf(w), 18), w.name, w.gone ? h('small', {}, ' · gone home') : null)),
      h('td.rk-c-role', {}, w.roleLabel),
      h('td.rk-c-model', {}, w.modelLabel),
      r.scope === 'all' ? h('td.rk-c-floor', {}, w.floorName) : null,
      h('td.num', {}, w.score!.toFixed(0)),
      h('td.num.rk-c-trend', {}, w.trend ? `${w.trend > 0 ? '▲' : '▼'} ${Math.abs(w.trend).toFixed(0)}` : '–'),
      h('td.num.rk-c-tasks', {}, String(w.tasks)),
    );
  const ungraded = r.workers.length - graded.length;
  return h(
    'details.rk-table-wrap',
    { open: graded.length <= 12 },
    h('summary', {}, `Full ranking · ${graded.length} graded${ungraded ? `, ${ungraded} not yet` : ''}`),
    graded.length
      ? h('div.rk-scroll', {}, h('table.rk-table', {}, h('thead', {}, h('tr', {}, ...head.map((t) => h('th', { scope: 'col', class: `rk-h-${t.toLowerCase()}` }, t)))), h('tbody', {}, ...graded.map(row))))
      : h('p.rk-empty', {}, 'Nobody has finished a task to grade yet.'),
  );
}

/** How a group's grades spread, as a bar of A to F. */
function spread(g: GroupStats): HTMLElement {
  return h(
    'span.rk-spread',
    { role: 'img', 'aria-label': GRADES.map((x) => `${g.grades[x]} ${x}`).join(', ') },
    ...GRADES.filter((x) => g.grades[x]).map((x) => h(`span.g-${x}`, { style: `flex:${g.grades[x]}`, title: `${g.grades[x]} × ${x}` }, String(g.grades[x]))),
  );
}

export function groupCards(groups: GroupStats[], names: Map<string, string>, what: string): HTMLElement {
  return h(
    'div.rk-groups',
    { role: 'list', 'aria-label': `By ${what}` },
    ...groups.map((g) =>
      h(
        'div.rk-group',
        { role: 'listitem' },
        gradeBadge(g.avgGrade, g.avgScore),
        h(
          'span.rk-group-info',
          {},
          h('b', {}, g.label),
          h('small', {}, `${g.count} worker${g.count === 1 ? '' : 's'}${g.graded < g.count ? `, ${g.graded} graded` : ''}${g.top ? ` · best: ${names.get(g.top) ?? ''}` : ''}`),
          g.graded ? spread(g) : h('small', {}, 'No grades yet'),
        ),
      ),
    ),
  );
}

export function howGraded(r: RankingReport): HTMLElement {
  const p = (n: number) => `${Math.round(n * 100)}%`;
  const w = r.weights;
  return h(
    'details.rk-how',
    {},
    h('summary', {}, 'ℹ️ How workers are graded'),
    h(
      'ul',
      {},
      h('li', {}, h('b', {}, `${r.labels.benchmark} ${p(w.benchmark)}`), ' — its tasks’ score (the 📊 Analysis tab’s run score) against other workers on the same model and against every model, and its cost and working time against its model’s average. On par is 75.'),
      h('li', {}, h('b', {}, `${r.labels.delivery} ${p(w.delivery)}`), ' — its pull requests: merged, open, closed unmerged (rework); CI green; the quality scorecard. Leads who deliver through their team aren’t marked down for tasks without a PR.'),
      h('li', {}, h('b', {}, `${r.labels.autonomy} ${p(w.autonomy)}`), ' — people typing into it and stops on questions per task, escalations the Project Manager didn’t dismiss, standup proposals approved.'),
      h('li', {}, h('b', {}, `${r.labels.efficiency} ${p(w.efficiency)}`), ' — value delivered (merged 1, open 0.7, closed 0.2) per dollar and per million tokens against the building’s median, and its cache hits. Spending with nothing delivered scores 0.'),
      h('li', {}, `Team roles also get a specialist ranking from their role’s own criteria; it counts ${p(r.specialistShare)} of their overall score.`),
      h('li', {}, `Grades: ${r.gradeFloors.map(([g, min]) => `${g} ≥ ${min}`).join(', ')}, F below. A criterion without data is left out and the rest scaled up; nothing is guessed.`),
    ),
  );
}
