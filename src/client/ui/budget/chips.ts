// The budget in the flat views' top bar: the project's chip beside the floor's branch ("$42 today · $252 /
// $600 · 42 %", coloured by the forecast) and the office's at the far right ("Office $110 today"). Hover
// gives the local currency; a click opens the Budget tab. In the Clean themes the emoji gives way to a
// line icon (styles: budget.css).

import { projectChip, officeChip } from '../../../shared/budget/money';
import { h } from '../dom';
import type { BudgetFeed } from './feed';
import './budget.css';

const SVG = 'http://www.w3.org/2000/svg';

/** A small line icon: a coin stack (the project) or a building (the office). */
function lineIcon(kind: 'coins' | 'office'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'bud-icon');
  svg.setAttribute('aria-hidden', 'true');
  const d = kind === 'coins' ? 'M3 5.5c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2zM3 5.5v5c0 1.1 2.2 2 5 2s5-.9 5-2v-5M3 8c0 1.1 2.2 2 5 2s5-.9 5-2' : 'M3 14V3h7v11M10 6h3v8M5 5.5h3M5 8h3M5 10.5h3M2 14h12';
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}

function chipButton(id: string, kind: 'coins' | 'office', emoji: string, open: () => void): HTMLButtonElement {
  return h('button.bud-chip', { id, type: 'button', onclick: open }, h('span.ao-emo.bud-emo', { 'aria-hidden': 'true' }, emoji), lineIcon(kind), h('span.bud-chip-t', {}));
}

/**
 * Puts the two chips on the page's top bar: the project's right after #floor-meta (the floor's branch),
 * the office's as the bar's last item. `open` shows the Budget tab.
 */
export function budgetChips(feed: BudgetFeed, open: () => void) {
  const meta = document.getElementById('floor-meta');
  const bar = document.querySelector('.lite-bar');
  if (!meta || !bar) return;
  const project = chipButton('budget-chip', 'coins', '💰', open);
  const office = chipButton('budget-office', 'office', '🏢', open);
  office.classList.add('bud-office');
  // Beside the branch: the floor's line becomes a row with the chip at its end.
  const row = h('div.bud-meta-row', {});
  meta.replaceWith(row);
  row.append(meta, project);
  bar.append(office);
  const render = () => {
    const v = feed.floor();
    project.hidden = !v;
    if (v) {
      const c = projectChip({ today: v.today, spent: v.spent, budget: v.settings.total, forecast: v.forecast?.atCompletion, fx: v.fx });
      project.querySelector('.bud-chip-t')!.textContent = c.text;
      project.title = c.title;
      project.setAttribute('aria-label', `Budget: ${c.text}. Open the Budget tab`);
      project.dataset.tone = c.tone;
    }
    const o = feed.office();
    office.hidden = !o;
    if (o) {
      const c = officeChip(o.today, o.dailyBudget, o.fx);
      office.querySelector('.bud-chip-t')!.textContent = c.text;
      office.title = c.title;
      office.setAttribute('aria-label', `${c.text}. Open the Budget tab`);
      office.dataset.tone = c.tone;
    }
  };
  feed.on(render);
}
