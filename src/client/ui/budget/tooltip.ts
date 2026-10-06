// One floating tooltip for the budget's marks (a table row's bar, a day's column, a chart's crosshair):
// shown on pointer move and on focus, words set as text (names come from the office's data), kept on screen.

import { h } from '../dom';

let tip: HTMLElement | undefined;

function el(): HTMLElement {
  if (!tip) {
    tip = h('div.bud-tip', { role: 'tooltip' });
    tip.hidden = true;
    document.body.append(tip);
  }
  return tip;
}

/** Places the tooltip near (x, y) with `text`, flipped to stay inside the window. */
export function showTip(text: string, x: number, y: number) {
  const t = el();
  t.textContent = text;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
  const top = y + 16 + r.height > window.innerHeight ? y - r.height - 10 : y + 16;
  t.style.left = `${left}px`;
  t.style.top = `${Math.max(8, top)}px`;
}

export function hideTip() {
  if (tip) tip.hidden = true;
}

/** Gives `target` the tooltip: on hover where the pointer is, on focus under it. */
export function tooltip(target: HTMLElement | SVGElement, text: () => string) {
  target.addEventListener('pointermove', (e) => showTip(text(), (e as PointerEvent).clientX, (e as PointerEvent).clientY));
  target.addEventListener('pointerleave', hideTip);
  target.addEventListener('focus', () => {
    const r = target.getBoundingClientRect();
    showTip(text(), r.left, r.bottom);
  });
  target.addEventListener('blur', hideTip);
}
