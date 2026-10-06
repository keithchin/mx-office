// The 💰 Budget tab on the 1D view: the project's headline numbers (spent, budget, remaining, forecast,
// days active), then where the money went: by stage, role, agent (subagents nested under the Lead that
// hired them), model and day, and the issues and pull requests that cost the most. Estimated history
// shows as the lighter part of each bar. Its numbers come from GET /api/budget (feed.ts); the plan,
// variance, settings and insights sections plug in through `sections`.

import type { BreakdownRow, BudgetView, OfficeBudgetView } from '../../../shared/budget/types';
import { both, local, pctOf, rateLine, TONE_WORD, usd, usdCents } from '../../../shared/budget/money';
import { h } from '../dom';
import type { BudgetFeed } from './feed';
import { tooltip } from './tooltip';
import './budget.css';

/** A section the tab shows after the headline (the plan, the variance chart, settings, insights): null to skip. */
export type BudgetSection = (v: BudgetView, o: OfficeBudgetView | undefined, refresh: () => void) => HTMLElement | null;

/** A stat tile: label, value, the local currency under it. */
function tile(label: string, value: string, sub?: string, tone?: string): HTMLElement {
  return h('div.bud-tile', tone ? { 'data-tone': tone } : {}, h('span.bud-tile-l', {}, label), h('strong.bud-tile-v', {}, value), sub ? h('span.bud-tile-s', {}, sub) : null);
}

/** One breakdown table row's bar: the booked part, then the estimated part, scaled to the largest row. */
function bar(r: BreakdownRow, max: number): HTMLElement {
  const est = r.est ?? 0;
  const exact = Math.max(0, r.cost - est);
  const w = (x: number) => `${max > 0 ? Math.max(0, (x / max) * 100) : 0}%`;
  return h('span.bud-bar', { 'aria-hidden': 'true' }, exact > 0 ? h('span.bud-bar-x', { style: `width:${w(exact)}` }) : null, est > 0 ? h('span.bud-bar-e', { style: `width:${w(est)}` }) : null);
}

function rowsOf(list: BreakdownRow[], max: number, fx: BudgetView['fx'], depth = 0): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const r of list) {
    const tip = [`${r.label}: ${both(r.cost, fx)} (${Math.round(r.share * 100)} %)`, r.est ? `${usdCents(r.est)} of it estimated from history` : '', r.hint ?? ''].filter(Boolean).join('\n');
    const tr = h(
      'tr',
      { class: depth ? 'bud-sub' : '' },
      h('th', { scope: 'row' }, h('span.bud-name', {}, r.label), r.hint ? h('small.bud-hint', {}, r.hint) : null),
      h('td.bud-barcell', {}, bar(r, max)),
      h('td.bud-num', {}, usdCents(r.cost)),
      h('td.bud-num.bud-pct', {}, `${Math.round(r.share * 100)} %`),
    );
    tooltip(tr, () => tip);
    out.push(tr);
    if (r.sub) out.push(...rowsOf(r.sub, max, fx, depth + 1));
  }
  return out;
}

/** A breakdown as a table with a bar per row; the values are always in text, so no colour carries meaning alone. */
function table(title: string, list: BreakdownRow[], fx: BudgetView['fx'], empty = 'Nothing spent yet.'): HTMLElement {
  const max = Math.max(0, ...list.map((r) => r.cost), ...list.flatMap((r) => r.sub?.map((s) => s.cost) ?? []));
  return h(
    'section.bud-card',
    {},
    h('h3.bud-h', {}, title),
    list.length
      ? h('table.bud-table', {}, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, ''), h('th', { scope: 'col', class: 'bud-barcell' }, h('span.vh', {}, 'Share')), h('th', { scope: 'col', class: 'bud-num' }, 'Cost'), h('th', { scope: 'col', class: 'bud-num bud-pct' }, '%'))), h('tbody', {}, ...rowsOf(list, max, fx)))
      : h('p.bud-empty', {}, empty),
  );
}

/** Spend per day, last 30 days, as columns: hover a column for its day and amount; the table below has every value. */
function dayChart(v: BudgetView): HTMLElement {
  const days = v.byDay;
  const max = Math.max(0, ...days.map((d) => d.cost));
  const cols = days.map((d) => {
    const exact = Math.max(0, d.cost - d.est);
    const hp = (x: number) => `${max > 0 ? (x / max) * 100 : 0}%`;
    const col = h('span.bud-col', { tabindex: '0', role: 'img', 'aria-label': `${d.day}: ${usdCents(d.cost)}` }, h('span.bud-col-in', {}, d.est > 0 ? h('span.bud-col-e', { style: `height:${hp(d.est)}` }) : null, exact > 0 ? h('span.bud-col-x', { style: `height:${hp(exact)}` }) : null));
    tooltip(col, () => `${d.day}: ${both(d.cost, v.fx)}${d.est ? `\n${usdCents(d.est)} estimated from history` : ''}`);
    return col;
  });
  const peak = days.reduce((a, d) => (d.cost > a.cost ? d : a), days[0]);
  return h(
    'section.bud-card',
    {},
    h('h3.bud-h', {}, 'By day', h('small.bud-hsub', {}, 'last 30 days')),
    max > 0
      ? h('div.bud-days', {}, h('span.bud-axis', {}, h('span', {}, usd(max)), h('span', {}, '$0')), h('div.bud-cols', {}, ...cols), h('div.bud-days-x', {}, h('span', {}, days[0].day.slice(5)), h('span', {}, `peak ${usd(peak.cost)} on ${peak.day.slice(5)}`), h('span', {}, 'today')))
      : h('p.bud-empty', {}, 'Nothing spent in the last 30 days.'),
    max > 0
      ? h('details.bud-table-view', {}, h('summary', {}, 'Table view'), h('table.bud-table', {}, h('tbody', {}, ...days.filter((d) => d.cost > 0).reverse().map((d) => h('tr', {}, h('th', { scope: 'row' }, d.day), h('td.bud-num', {}, usdCents(d.cost)), h('td.bud-num', {}, d.est ? `${usdCents(d.est)} est.` : ''))))))
      : null,
  );
}

function legend(v: BudgetView): HTMLElement | null {
  if (!v.estimated) return null;
  return h('p.bud-legend', {}, h('span.bud-key.bud-key-x'), 'Booked as it happened', h('span.bud-key.bud-key-e'), `Estimated from history (${usdCents(v.estimated)}: what was spent before the ledger started, spread over the days each worker was around)`);
}

/** The headline: spent, budget, remaining, forecast, days active. */
function headline(v: BudgetView): HTMLElement {
  const budget = v.settings.total;
  const l = (n: number) => local(n, v.fx);
  const tiles = [
    tile('Spent', usd(v.spent), [l(v.spent), budget ? `${pctOf(v.spent, budget)} % of the budget` : undefined].filter(Boolean).join(' · ') || undefined),
    tile('Budget', budget ? usd(budget) : 'None set', budget ? l(budget) : 'Set one in Settings below'),
    ...(budget ? [tile('Remaining', usd(budget - v.spent), l(budget - v.spent), budget - v.spent < 0 ? 'bad' : undefined)] : []),
    ...(v.forecast ? [tile('Forecast at completion', usd(v.forecast.atCompletion), [l(v.forecast.atCompletion), budget ? TONE_WORD[v.tone] : undefined].filter(Boolean).join(' · '), v.tone)] : []),
    tile('Today', usd(v.today), l(v.today)),
    tile('Days active', String(v.daysActive), v.firstDay ? `since ${v.firstDay}` : undefined),
  ];
  return h('div.bud-tiles', {}, ...tiles);
}

function notes(v: BudgetView): HTMLElement | null {
  const items = [
    v.paused ? h('p.bud-note.bad', {}, `⏸️ ${v.paused}`) : null,
    v.unmetered.calls ? h('p.bud-note', {}, `${v.unmetered.calls} call${v.unmetered.calls === 1 ? '' : 's'} not metered (${v.unmetered.agents.join(', ')}): providers the office can't price, counted but not costed.`) : null,
    rateLine(v.fx) ? h('p.bud-note.bud-fx', {}, rateLine(v.fx)!) : null,
  ].filter(Boolean) as HTMLElement[];
  return items.length ? h('div.bud-notes', {}, ...items) : null;
}

/** The tab: mounts into `root`, redraws when the feed has new numbers and the tab is showing. */
export function budgetTab(root: HTMLElement, feed: BudgetFeed, visible: () => boolean, sections: BudgetSection[] = []) {
  const render = () => {
    if (!visible()) return;
    const v = feed.floor();
    if (!v) {
      root.replaceChildren(h('p.bud-empty', {}, 'Loading the budget…'));
      return;
    }
    const keep = root.querySelector('.bud-keep-open')?.getAttribute('data-open');
    root.replaceChildren(
      h('div.bud', {}, h('h2.lite-h', {}, `💰 Budget · ${v.name}`, h('small.bud-hsub', {}, v.stage !== '—' ? `now at Stage ${v.stage}` : '')), headline(v), notes(v), legend(v), ...sections.map((s) => s(v, feed.office(), feed.refresh)), table('By stage', v.byStage, v.fx, 'No spend yet.'), table('By role', v.byRole, v.fx), table('By agent', v.byAgent, v.fx), table('By model', v.byModel, v.fx), dayChart(v), table('Top issues and pull requests', v.topWork, v.fx, 'No spend tied to an issue or a pull request yet.')),
    );
    if (keep) root.querySelector(`[data-sec="${keep}"]`)?.setAttribute('open', '');
  };
  feed.on(render);
  return { render };
}
