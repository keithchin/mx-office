// The variance chart: expected cumulative spend (the plan) against actual cumulative spend, by day, on
// one dollar axis, with the budget as a reference line and the forecast at completion as an end point.
// Two series, so a legend and direct end labels; a crosshair that snaps to the nearest day with one
// tooltip listing every series; a table view with every value. Colours are the budget's series tokens
// (budget.css), text stays in the office's ink tokens.

import type { BudgetView, CurvePoint } from '../../../shared/budget/types';
import { both, usd, usdCents } from '../../../shared/budget/money';
import { h } from '../dom';
import { hideTip, showTip } from './tooltip';

const NS = 'http://www.w3.org/2000/svg';
const W = 720;
const H = 260;
const M = { top: 16, right: 120, bottom: 28, left: 52 };

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) el.append(c);
  return el;
}

/** Clean ticks: 0 and three or four round steps up to at least `max`. */
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

const short = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/** The chart for a project, or a note when there's nothing to draw. */
export function varianceChart(v: BudgetView): HTMLElement {
  const pts: CurvePoint[] = v.curve ?? [];
  if (pts.length < 2) return h('p.bud-empty', {}, 'The chart starts once there are two days of plan or spend.');
  const budget = v.settings.total;
  const fc = v.forecast?.atCompletion;
  const max = Math.max(...pts.map((p) => Math.max(p.expected ?? 0, p.actual ?? 0)), budget ?? 0, fc ?? 0);
  const ys = ticks(max);
  const top = ys[ys.length - 1];
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const x = (i: number) => M.left + (i / (pts.length - 1)) * iw;
  const y = (n: number) => M.top + ih - (n / top) * ih;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bud-chart', role: 'img', 'aria-label': `Expected against actual cumulative spend${budget ? `, budget ${usd(budget)}` : ''}${fc !== undefined ? `, forecast ${usd(fc)}` : ''}` });
  // Recessive grid and the dollar axis.
  for (const t of ys) {
    root.append(svg('line', { x1: M.left, x2: W - M.right, y1: y(t), y2: y(t), class: t === 0 ? 'bud-axis-line' : 'bud-grid' }));
    root.append(svg('text', { x: M.left - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'bud-tick' }, t === 0 ? '$0' : usd(t)));
  }
  const every = Math.max(1, Math.ceil(pts.length / 6));
  pts.forEach((p, i) => {
    if (i % every === 0 || i === pts.length - 1) root.append(svg('text', { x: x(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle', class: 'bud-tick' }, short(p.day)));
  });
  // The budget, as a reference line in ink (not a series).
  if (budget) {
    root.append(svg('line', { x1: M.left, x2: W - M.right, y1: y(budget), y2: y(budget), class: 'bud-ref' }));
    root.append(svg('text', { x: W - M.right + 6, y: y(budget) + 4, class: 'bud-ref-t' }, `Budget ${usd(budget)}`));
  }
  const path = (key: 'expected' | 'actual') => {
    let d = '';
    pts.forEach((p, i) => {
      const val = p[key];
      if (val === undefined) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`;
    });
    return d;
  };
  root.append(svg('path', { d: path('expected'), class: 'bud-line bud-line-exp' }));
  root.append(svg('path', { d: path('actual'), class: 'bud-line bud-line-act' }));
  // The forecast: from the last actual point to the plan's end, lighter, ending in a ringed dot.
  const lastA = pts.map((p, i) => [p.actual, i] as const).filter(([a]) => a !== undefined).pop();
  const labels: { y: number; text: string; cls: string }[] = [];
  const lastE = pts[pts.length - 1].expected;
  if (lastE !== undefined) labels.push({ y: y(lastE), text: `Plan ${usd(lastE)}`, cls: 'exp' });
  if (lastA) {
    const [a, i] = lastA;
    root.append(svg('circle', { cx: x(i), cy: y(a!), r: 4, class: 'bud-dot bud-dot-act' }));
    if (fc !== undefined && i < pts.length - 1) {
      root.append(svg('path', { d: `M${x(i)},${y(a!)}L${x(pts.length - 1)},${y(fc)}`, class: 'bud-line bud-line-fc' }));
      root.append(svg('circle', { cx: x(pts.length - 1), cy: y(fc), r: 4, class: 'bud-dot bud-dot-fc' }));
      labels.push({ y: y(fc), text: `Forecast ${usd(fc)}`, cls: 'act' });
    } else labels.push({ y: y(a!), text: `Actual ${usd(a!)}`, cls: 'act' });
  }
  // End labels, with leader lines when they'd collide (never nudged away silently).
  labels.sort((p, q) => p.y - q.y);
  for (let k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 14) labels[k].y = labels[k - 1].y + 14;
  for (const l of labels) root.append(svg('text', { x: W - M.right + 6, y: l.y + 4, class: `bud-end bud-end-${l.cls}` }, l.text));
  // The crosshair: snaps to the nearest day, one tooltip for every series.
  const cross = svg('line', { x1: 0, x2: 0, y1: M.top, y2: M.top + ih, class: 'bud-cross', visibility: 'hidden' });
  root.append(cross);
  const hit = svg('rect', { x: M.left, y: M.top, width: iw, height: ih, fill: 'transparent', tabindex: 0 });
  const at = (clientX: number) => {
    const r = root.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(pts.length - 1, Math.round(((sx - M.left) / iw) * (pts.length - 1))));
  };
  const show = (i: number, cx: number, cy: number) => {
    const p = pts[i];
    cross.setAttribute('x1', String(x(i)));
    cross.setAttribute('x2', String(x(i)));
    cross.setAttribute('visibility', 'visible');
    const lines = [short(p.day), p.expected !== undefined ? `Plan: ${both(p.expected, v.fx)}` : '', p.actual !== undefined ? `Actual: ${both(p.actual, v.fx)}` : '', p.actual !== undefined && p.expected !== undefined ? `Difference: ${p.actual - p.expected >= 0 ? '+' : ''}${usdCents(p.actual - p.expected)}` : ''];
    showTip(lines.filter(Boolean).join('\n'), cx, cy);
  };
  hit.addEventListener('pointermove', (e) => show(at(e.clientX), e.clientX, e.clientY));
  hit.addEventListener('pointerleave', () => (cross.setAttribute('visibility', 'hidden'), hideTip()));
  let focusI = pts.length - 1;
  hit.addEventListener('focus', () => {
    const r = root.getBoundingClientRect();
    show(focusI, r.left + (x(focusI) / W) * r.width, r.top);
  });
  hit.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    focusI = Math.max(0, Math.min(pts.length - 1, focusI + (e.key === 'ArrowRight' ? 1 : -1)));
    const r = root.getBoundingClientRect();
    show(focusI, r.left + (x(focusI) / W) * r.width, r.top);
    e.preventDefault();
  });
  hit.addEventListener('blur', () => (cross.setAttribute('visibility', 'hidden'), hideTip()));
  root.append(hit);
  const legend = h('p.bud-legend', {}, h('span.bud-key.bud-key-line.bud-key-exp'), 'Expected (the plan)', h('span.bud-key.bud-key-line.bud-key-act'), 'Actual', ...(fc !== undefined ? [h('span.bud-key.bud-key-line.bud-key-fc'), 'Forecast'] : []), ...(budget ? [h('span.bud-key.bud-key-line.bud-key-ref'), 'Budget'] : []));
  const table = h(
    'details.bud-table-view',
    {},
    h('summary', {}, 'Table view'),
    h('table.bud-table', {}, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Day'), h('th', { scope: 'col', class: 'bud-num' }, 'Plan'), h('th', { scope: 'col', class: 'bud-num' }, 'Actual'))), h('tbody', {}, ...pts.map((p) => h('tr', {}, h('th', { scope: 'row' }, p.day), h('td.bud-num', {}, p.expected !== undefined ? usdCents(p.expected) : '—'), h('td.bud-num', {}, p.actual !== undefined ? usdCents(p.actual) : '—'))))),
  );
  return h('div.bud-chart-box', {}, legend, root, table);
}
