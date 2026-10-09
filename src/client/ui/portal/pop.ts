// A small pop-up menu for the Portal pieces (the launcher, a project card's ⋯): it hangs under its
// button, drawn in the page's colours even in the navy bar (.pt-pagecolors), and closes on Esc, Tab, a
// click elsewhere or a pick, focus going back to the button. ↑ ↓ Home End walk its items. Not a window:
// nothing behind it is covered, so it has no ✕ (Esc closes it, as it does a dropdown).

import { h } from '../dom';
import './pop.css';

export interface PopItem {
  label: string;
  hint?: string;
  href?: string;
  /** A heading over the items after it, not something to pick. */
  heading?: boolean;
  disabled?: boolean;
  run?: () => void;
}

let current: { close(refocus?: boolean): void } | undefined;

/** Closes whichever pop-up is open. */
export const closePop = (refocus = false) => current?.close(refocus);

/** Opens `items` under `anchor` (closing it again if it's already open from there). */
export function openPop(anchor: HTMLElement, items: PopItem[], opts: { label: string; align?: 'left' | 'right'; cls?: string } = { label: 'Menu' }) {
  const wasMine = anchor.getAttribute('aria-expanded') === 'true';
  closePop();
  if (wasMine) return;
  const rows = items.map((it) => {
    if (it.heading) return h('li.pt-pop-h', { role: 'presentation' }, it.label);
    const body = [h('span.pt-pop-l', {}, it.label), it.hint ? h('small.pt-pop-hint', {}, it.hint) : null];
    const el = it.href
      ? h('a.pt-pop-item', { href: it.href, role: 'menuitem', tabindex: '-1' }, ...body)
      : h('button.pt-pop-item', { type: 'button', role: 'menuitem', tabindex: '-1', disabled: it.disabled ? '' : undefined }, ...body);
    el.addEventListener('click', (e) => {
      if (it.run) {
        e.preventDefault();
        close(false);
        it.run();
      } else close(false);
    });
    return h('li', { role: 'none' }, el);
  });
  const menu = h(`ul.pt-pop.pt-pagecolors${opts.cls ? `.${opts.cls}` : ''}`, { role: 'menu', 'aria-label': opts.label }, ...rows);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  if (opts.align === 'right') menu.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
  else menu.style.left = `${Math.max(8, Math.min(Math.round(r.left), innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.maxHeight = `${Math.max(160, innerHeight - r.bottom - 20)}px`;
  anchor.setAttribute('aria-expanded', 'true');
  const focusables = () => [...menu.querySelectorAll<HTMLElement>('.pt-pop-item:not(:disabled)')];
  focusables()[0]?.focus({ preventScroll: true });

  const outside = (e: Event) => {
    if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(false);
  };
  const onKey = (e: KeyboardEvent) => {
    const list = focusables();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const to = e.key === 'ArrowDown' ? (i + 1) % list.length : e.key === 'ArrowUp' ? (i - 1 + list.length) % list.length : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1;
    if (to >= 0) {
      e.preventDefault();
      list[to]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') close(false);
  };
  function close(refocus = false) {
    if (current !== handle) return;
    current = undefined;
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (refocus) anchor.focus({ preventScroll: true });
  }
  const handle = { close };
  current = handle;
  menu.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', outside, true);
}
