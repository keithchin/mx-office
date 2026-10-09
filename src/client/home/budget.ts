// The home page's 💰 Budget tab: every project's spend against its budget, its forecast, a status chip and
// a 14-day sparkline, then the office's own background calls and the Firm's audits. From GET
// /api/budget/office.

import type { OfficeBudgetView, OfficeFloorBudget } from '../../shared/budget/types';
import { local, pctOf, rateLine, TONE_WORD, usd, usdCents } from '../../shared/budget/money';
import { h } from '../ui/dom';
import { tooltip } from '../ui/budget/tooltip';
import '../ui/budget/budget.css';

const NS = 'http://www.w3.org/2000/svg';

/** A 14-day sparkline: one 2px line, the last day as a ringed dot; hover for the numbers. */
function spark(values: number[], name: string): SVGSVGElement {
  const W = 120;
  const H = 28;
  const max = Math.max(...values, 0.01);
  const x = (i: number) => 2 + (i / Math.max(1, values.length - 1)) * (W - 6);
  const y = (v: number) => H - 3 - (v / max) * (H - 7);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'bud-spark');
  svg.setAttribute('role', 'img');
  const total = values.reduce((n, v) => n + v, 0);
  svg.setAttribute('aria-label', `${name}: ${usd(total)} over the last ${values.length} days`);
  const line = document.createElementNS(NS, 'path');
  line.setAttribute('d', values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''));
  line.setAttribute('class', 'bud-line bud-line-act');
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', String(x(values.length - 1)));
  dot.setAttribute('cy', String(y(values[values.length - 1] ?? 0)));
  dot.setAttribute('r', '3.5');
  dot.setAttribute('class', 'bud-dot bud-dot-act');
  svg.append(line, dot);
  const peak = values.indexOf(Math.max(...values));
  tooltip(svg, () => `${name}, last ${values.length} days: ${usd(total)}\ntoday ${usdCents(values[values.length - 1] ?? 0)} · peak ${usdCents(values[peak] ?? 0)} ${peak === values.length - 1 ? 'today' : `${values.length - 1 - peak} days ago`}`);
  return svg;
}

/** Spent against budget as a meter: the fill carries the status, the label says it in words too. */
function meter(f: OfficeFloorBudget): HTMLElement {
  if (!f.budget) return h('span.bud-hint', {}, 'no budget');
  const p = Math.min(100, (f.spent / f.budget) * 100);
  return h('span.bud-meter', { 'data-tone': f.tone, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(f.budget), 'aria-valuenow': String(f.spent), 'aria-label': `${usd(f.spent)} of ${usd(f.budget)}` }, h('span.bud-meter-fill', { style: `width:${p}%` }));
}

function chip(f: OfficeFloorBudget): HTMLElement {
  const word = f.paused ? 'Paused' : TONE_WORD[f.tone];
  return h('span.bud-status', { 'data-tone': f.paused ? 'bad' : f.tone }, f.paused ? '⏸️ ' : '', word);
}

function render(root: HTMLElement, v: OfficeBudgetView, leave: () => void) {
  const rows = v.floors.map((f) =>
    h(
      'tr',
      {},
      h('th', { scope: 'row' }, h('a', { href: `/lite?tab=budget&floor=${encodeURIComponent(f.id)}`, onclick: leave }, f.name)),
      h('td', {}, chip(f)),
      h('td.bud-num', {}, usd(f.spent), f.budget ? h('small.bud-hint', {}, `of ${usd(f.budget)} · ${pctOf(f.spent, f.budget)} %`) : null),
      h('td.bud-meter-cell', {}, meter(f)),
      h('td.bud-num', {}, f.forecast !== undefined ? usd(f.forecast) : '—', f.forecast !== undefined && local(f.forecast, v.fx) ? h('small.bud-hint', {}, local(f.forecast, v.fx)!) : null),
      h('td.bud-num', {}, usd(f.today)),
      h('td', {}, spark(f.spark, f.name)),
    ),
  );
  const bgRows = v.background.bySource.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.label), h('td.bud-num', {}, usdCents(r.cost)), h('td.bud-num.bud-pct', {}, `${Math.round(r.share * 100)} %`)));
  const firm = v.firm.list ?? [];
  root.replaceChildren(
    h(
      'div.bud.bud-home',
      {},
      h('div.bud-tiles', {}, h('div.bud-tile', {}, h('span.bud-tile-l', {}, 'Today, the whole office'), h('strong.bud-tile-v', {}, usd(v.today)), h('span.bud-tile-s', {}, [local(v.today, v.fx), v.dailyBudget ? `of a ${usd(v.dailyBudget)} daily budget` : undefined].filter(Boolean).join(' · ') || ' ')), h('div.bud-tile', {}, h('span.bud-tile-l', {}, 'All time'), h('strong.bud-tile-v', {}, usd(v.total)), h('span.bud-tile-s', {}, local(v.total, v.fx) ?? ' ')), h('div.bud-tile', {}, h('span.bud-tile-l', {}, 'Background calls'), h('strong.bud-tile-v', {}, usd(v.background.total)), h('span.bud-tile-s', {}, `${usd(v.background.today)} today · ${v.total > 0 ? Math.round((v.background.total / v.total) * 100) : 0} % of all spend`)), h('div.bud-tile', {}, h('span.bud-tile-l', {}, 'Firm audits'), h('strong.bud-tile-v', {}, usd(v.firm.total)), h('span.bud-tile-s', {}, `${v.firm.audits} audit${v.firm.audits === 1 ? '' : 's'}`))),
      h(
        'section.bud-card',
        {},
        h('h3.bud-h', {}, 'Every project'),
        v.floors.length
          ? h('div.bud-scroll', {}, h('table.bud-table.bud-projects', {}, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Project'), h('th', { scope: 'col' }, 'Status'), h('th', { scope: 'col', class: 'bud-num' }, 'Spent'), h('th', { scope: 'col' }, h('span.vh', {}, 'Against budget')), h('th', { scope: 'col', class: 'bud-num' }, 'Forecast'), h('th', { scope: 'col', class: 'bud-num' }, 'Today'), h('th', { scope: 'col' }, 'Last 14 days'))), h('tbody', {}, ...rows)))
          : h('p.bud-empty', {}, 'No projects yet.'),
      ),
      h('section.bud-card', {}, h('h3.bud-h', {}, 'The office’s own calls', h('small.bud-hsub', {}, 'Jeff, the analyzer, task naming, the summary, the Firm')), bgRows.length ? h('table.bud-table', {}, h('tbody', {}, ...bgRows)) : h('p.bud-empty', {}, 'None metered yet.')),
      h(
        'section.bud-card',
        {},
        h('h3.bud-h', {}, 'Firm audits'),
        firm.length
          ? h('table.bud-table', {}, h('tbody', {}, ...firm.map((e) => h('tr', {}, h('th', { scope: 'row' }, e.floorName, h('small.bud-hint', {}, new Date(e.at).toLocaleDateString())), h('td', {}, e.phase), h('td.bud-num', {}, `${usdCents(e.spent)} of ${usd(e.budget)}`)))))
          : h('p.bud-empty', {}, v.firm.audits ? '' : 'No audits run by this office yet.'),
      ),
      rateLine(v.fx) ? h('p.bud-note', {}, `Local amounts: ${rateLine(v.fx)}. Hover a sparkline for its days.`) : null,
    ),
  );
}

export function homeBudget(root: HTMLElement, leave: () => void) {
  let on = false;
  const load = async () => {
    if (!on) return;
    try {
      const res = await fetch('/api/budget/office', { credentials: 'same-origin' });
      if (res.ok && on) render(root, (await res.json()) as OfficeBudgetView, leave);
    } catch {
      // the office is unreachable: the last view stays
    }
  };
  setInterval(() => !document.hidden && void load(), 30_000);
  return {
    show: () => {
      on = true;
      if (!root.firstChild) root.replaceChildren(h('p.bud-empty', {}, 'Loading the budget…'));
      void load();
    },
    hide: () => {
      on = false;
    },
  };
}
