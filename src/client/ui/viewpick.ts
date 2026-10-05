// The view dropdown on every top bar (1D, 2D, 3D): the view you're in with its icon, and the others
// a click or a key away. A button that opens a listbox: ↑ ↓ Home End move, Enter or Space picks, Esc
// or Tab or a click elsewhere closes it. Picking another view goes there (graphics.ts switchView).
// No three.js here: the flat views load it too.

import './flatchrome.css';
import { h } from './dom';
import { switchView, type View } from '../graphics';
import { stepIndex } from './chrome-logic';

const VIEWS: { view: View; icon: string; label: string; what: string }[] = [
  { view: '1d', icon: '🗂️', label: '1D', what: "The floor's board and its workers" },
  { view: '2d', icon: '🗺️', label: '2D', what: 'The floor from above in pixel art' },
  { view: '3d', icon: '🏢', label: '3D', what: 'The 3D office, where you walk around' },
  { view: 'retro', icon: '👾', label: 'Retro', what: 'The office in chunky 16-bit pixels' },
];

let made = 0;

/** The dropdown, showing `current`; `cls` is its trigger's extra classes (the 3D bar's dock-btn). */
export function viewPicker(current: View, cls = ''): HTMLElement {
  const id = `vp${++made}`;
  const now = VIEWS.find((v) => v.view === current)!;
  const button = h(
    'button.btn.vp-btn',
    { type: 'button', class: cls, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': `${id}-list`, 'aria-label': `View: ${now.label}. Change view`, title: `View: ${now.label} · ${now.what}` },
    h('span.vp-ico', { 'aria-hidden': 'true' }, now.icon),
    h('span.vp-label', {}, now.label),
    h('span.vp-caret', { 'aria-hidden': 'true' }),
  );
  const options = VIEWS.map((v, i) =>
    h(
      'li.vp-opt',
      { id: `${id}-${v.view}`, role: 'option', 'aria-selected': String(v.view === current), 'data-i': i, title: v.what },
      h('span.vp-ico', { 'aria-hidden': 'true' }, v.icon),
      h('span.vp-text', {}, h('b', {}, v.label), h('small', {}, v.what)),
      v.view === current ? h('span.vp-tick', { 'aria-hidden': 'true' }, '✓') : null,
    ),
  );
  const list = h('ul.vp-list', { id: `${id}-list`, role: 'listbox', tabindex: '-1', 'aria-label': 'View', hidden: true }, ...options);
  const root = h('div.vp', {}, button, list);
  let at = VIEWS.indexOf(now);

  const mark = (i: number) => {
    at = i;
    options.forEach((o, j) => o.classList.toggle('active', j === i));
    list.setAttribute('aria-activedescendant', options[i].id);
    options[i].scrollIntoView?.({ block: 'nearest' });
  };
  const isOpen = () => !list.hidden;
  function open() {
    if (isOpen()) return;
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    root.classList.add('open');
    mark(VIEWS.indexOf(now));
    list.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside, true);
  }
  function close(refocus = true) {
    if (!isOpen()) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    root.classList.remove('open');
    document.removeEventListener('pointerdown', outside, true);
    if (refocus) button.focus({ preventScroll: true });
  }
  function pick(i: number) {
    const v = VIEWS[i];
    close();
    if (v.view !== current) switchView(v.view);
  }
  const outside = (e: Event) => {
    if (!root.contains(e.target as Node)) close(false);
  };

  button.addEventListener('click', () => (isOpen() ? close() : open()));
  button.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    open();
  });
  list.addEventListener('keydown', (e) => {
    // Kept here: the 3D office's own keys (walking, Tab for the menu) don't hear them.
    e.stopPropagation();
    const next = stepIndex(at, e.key, VIEWS.length);
    if (next !== undefined) {
      e.preventDefault();
      return mark(next);
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      return pick(at);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      return close();
    }
    if (e.key === 'Tab') close(false);
  });
  list.addEventListener('pointermove', (e) => {
    const o = (e.target as HTMLElement).closest<HTMLElement>('.vp-opt');
    if (o) mark(Number(o.dataset.i));
  });
  list.addEventListener('click', (e) => {
    const o = (e.target as HTMLElement).closest<HTMLElement>('.vp-opt');
    if (o) pick(Number(o.dataset.i));
  });
  return root;
}
