// The loading overlay over a flat view's page (not its top bar, so 🏠 and the floor picker still work):
// the page dimmed a little and still visible underneath, a card with a spinner, "Loading project
// mx-spike… 42 %", the step it waits on and a bar. A ✕ (or Esc) hides it; the load carries on. It's a
// status, not a window: role=status with a polite live region that speaks at the start and the end,
// and the bar is a progressbar. Spinner and fades stop for prefers-reduced-motion (loading.css).

import { h } from '../dom';
import './loading.css';

export interface OverlayState {
  title: string;
  step: string;
  pct: number;
  slow?: boolean;
}

let root: HTMLElement | undefined;
let parts: { title: HTMLElement; step: HTMLElement; bar: HTMLElement; fill: HTMLElement; slow: HTMLElement; say: HTMLElement } | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let onHide: (() => void) | undefined;

function build() {
  const title = h('b.ld-title');
  const step = h('span.ld-step');
  const fill = h('i.ld-fill');
  const bar = h('div.ld-bar', { role: 'progressbar', 'aria-label': 'Loading', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  const slow = h('p.ld-slow', { hidden: true }, 'Still loading… the office is slow to answer. The page works meanwhile; this goes away by itself.');
  const say = h('span.ld-say', { 'aria-live': 'polite' });
  const x = h('button.ld-x', { type: 'button', title: 'Hide (Esc): the project keeps loading', 'aria-label': 'Hide the loading overlay' }, '✕');
  x.addEventListener('click', () => (hideOverlay(), onHide?.()));
  const el = h('div.ld-overlay', { role: 'status', hidden: true }, h('div.ld-card', {}, h('span.ld-spin', { 'aria-hidden': 'true' }), h('div.ld-text', {}, title, step), x, bar, slow), say);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root && !root.hidden && !document.querySelector('#modal-root > *')) (hideOverlay(), onHide?.());
  });
  document.body.append(el);
  // Under the top bar (at the top: sticky on the 1D view, first on the 2D), so the bar stays usable. A
  // ResizeObserver hears its height after layout, so showing the overlay never forces a layout.
  const topBar = document.querySelector('.lite-bar');
  if (topBar) new ResizeObserver(([e]) => el.style.setProperty('--ld-top', `${Math.round(e.borderBoxSize?.[0]?.blockSize ?? 0)}px`)).observe(topBar);
  root = el;
  parts = { title, step, bar, fill, slow, say };
}

/** Shows (or updates) the overlay. `hidden` is called when someone hides it with ✕ or Esc. */
export function showOverlay(s: OverlayState, hidden?: () => void) {
  if (!root) build();
  const p = parts!;
  onHide = hidden;
  clearTimeout(hideTimer);
  if (root!.hidden || root!.classList.contains('out')) {
    root!.hidden = false;
    root!.classList.remove('out');
    p.say.textContent = s.title.replace(/… \d+ ?%$/, '…');
  }
  p.title.textContent = s.title;
  p.step.textContent = s.step;
  p.fill.style.width = `${s.pct}%`;
  p.bar.setAttribute('aria-valuenow', String(s.pct));
  p.slow.hidden = !s.slow;
  root!.setAttribute('aria-busy', 'true');
}

/** Fades the overlay out; `said` is spoken to a screen reader (the project loaded). */
export function hideOverlay(said = '') {
  if (!root || root.hidden) return;
  root.classList.add('out');
  root.removeAttribute('aria-busy');
  if (said) parts!.say.textContent = said;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => root && (root.hidden = true), 200);
}

export const overlayShowing = () => !!root && !root.hidden && !root.classList.contains('out');
