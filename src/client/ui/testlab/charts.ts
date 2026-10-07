// The Test Mode page's two small charts for a pages run: one horizontal bar per view (its longest task,
// or its time to usable) against the budget, drawn as a reference line. One series, so no legend: the
// title says what's plotted. A bar over budget wears the bad status color and says "over" in words, so
// it never rests on color alone. Thin bars with a rounded data end, a hairline grid, labels in the ink
// tokens, a tooltip on every row (hover and focus), and the per-view table beside it is the table view.
// Inline SVG, colors from the theme's tokens (ui.css), so every theme reads it.

import { h } from '../dom';
import { ms, ticksFor, type Bar } from './logic';

const NS = 'http://www.w3.org/2000/svg';
const W = 560;
const ROW = 22;
const BAR = 12;
const M = { top: 22, right: 64, bottom: 22, left: 150 };

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) el.append(c);
  return el;
}

let tip: HTMLElement | undefined;
function showTip(text: string, x: number, y: number) {
  if (!tip) {
    tip = h('div.tl-tip', { role: 'tooltip' });
    document.body.append(tip);
  }
  tip.textContent = text;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14))}px`;
  tip.style.top = `${Math.max(8, y + 16 + r.height > window.innerHeight ? y - r.height - 10 : y + 16)}px`;
}
export const hideTip = () => tip && (tip.hidden = true);

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A bar per view against `budget`; `onPick` opens a view's details. */
export function barChart(title: string, bars: Bar[], budget: number, onPick?: (id: string) => void): HTMLElement {
  if (!bars.length) return h('p.tl-empty', {}, 'Nothing measured in this run.');
  const ys = ticksFor(Math.max(budget * 1.15, ...bars.map((b) => b.value)));
  const top = ys[ys.length - 1];
  const iw = W - M.left - M.right;
  const H = M.top + bars.length * ROW + M.bottom;
  const x = (v: number) => M.left + (Math.min(v, top) / top) * iw;
  const g = svg('g', {});
  // Hairline grid and its labels along the bottom.
  for (const t of ys) {
    g.append(svg('line', { class: 'tl-grid', x1: x(t), x2: x(t), y1: M.top - 4, y2: H - M.bottom }));
    g.append(svg('text', { class: 'tl-tick', x: x(t), y: H - 6, 'text-anchor': 'middle' }, ms(t)));
  }
  bars.forEach((b, i) => {
    const y = M.top + i * ROW;
    const row = svg('g', { class: `tl-row${b.over ? ' over' : ''}`, tabindex: 0, role: 'img', 'aria-label': b.tip });
    // The whole row is the hit target, wider than the bar.
    row.append(svg('rect', { class: 'tl-hit', x: 0, y, width: W, height: ROW }));
    row.append(svg('text', { class: 'tl-label', x: M.left - 8, y: y + ROW / 2 + 4, 'text-anchor': 'end' }, cut(b.label, 22)));
    const w = Math.max(2, x(b.value) - M.left);
    const r = Math.min(4, w / 2);
    const by = y + (ROW - BAR) / 2;
    // Square at the baseline, rounded at the data end.
    row.append(svg('path', { class: 'tl-bar', d: `M${M.left},${by} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${BAR - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - r} z` }));
    // Only the bars over budget, and the worst, carry their number.
    const worst = b.value === Math.max(...bars.map((z) => z.value));
    if (b.over || worst) row.append(svg('text', { class: 'tl-val', x: Math.min(x(b.value), M.left + iw) + 6, y: y + ROW / 2 + 4 }, `${ms(b.value)}${b.over ? ' over' : ''}`));
    row.addEventListener('pointermove', (e) => showTip(b.tip, e.clientX, e.clientY));
    row.addEventListener('pointerleave', hideTip);
    row.addEventListener('focus', () => {
      const rr = row.getBoundingClientRect();
      showTip(b.tip, rr.left + M.left, rr.bottom);
    });
    row.addEventListener('blur', hideTip);
    if (onPick) {
      row.addEventListener('click', () => onPick(b.id));
      row.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick(b.id)));
    }
    g.append(row);
  });
  // The budget: a reference line, labelled at its top.
  g.append(svg('line', { class: 'tl-ref', x1: x(budget), x2: x(budget), y1: M.top - 6, y2: H - M.bottom }));
  g.append(svg('text', { class: 'tl-ref-t', x: x(budget), y: M.top - 9, 'text-anchor': 'middle' }, `budget ${ms(budget)}`));
  const chart = svg('svg', { class: 'tl-chart', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': title }, g);
  return h('figure.tl-fig', {}, h('figcaption', {}, title), chart as unknown as HTMLElement);
}
