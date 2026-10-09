// The ☰ menu's rows and its dropdown, for the flat pages' top bars (shared/flatmenu.ts has the items).
import './menu.css';
import { h, openModal, type Modal } from './dom';

/** One thing the ☰ menu does. */
export interface HudAction {
  /** What it is, never changing. */
  id: string;
  icon: string | (() => string);
  label: string | (() => string);
  section: 'Open' | 'Together' | 'Office';
  /** Its keyboard shortcut, if it has one (now). */
  key?: string | (() => string | undefined);
  /** A number worth knowing before you open it: open issues, tasks waiting… */
  count?: () => number;
  /** Pressed, like a mode that's on. */
  on?: () => boolean;
  /** Stands out: an update to install, a sign-in that's needed. */
  tone?: () => 'primary' | 'danger' | undefined;
  /** Only offered some of the time (Invite, Accounts, Upgrade). */
  shown?: () => boolean;
  /** Worth calling out now (an update is out, agents wait on you). */
  status?: () => boolean;
  /** Its words while `status` is on. */
  chip?: () => string;
  /** Why it can't work here: it's greyed out and says so. */
  blocked?: () => string | undefined;
  title?: () => string;
  run: () => void;
}

export const labelOf = (a: HudAction) => (typeof a.label === 'string' ? a.label : a.label());
export const iconOf = (a: HudAction) => (typeof a.icon === 'string' ? a.icon : a.icon());
export const keyOf = (a: HudAction) => (typeof a.key === 'function' ? a.key() : a.key);
const classOf = (a: HudAction, blocked?: string) => [a.on?.() && 'on', a.tone?.(), blocked && 'dim'].filter(Boolean).join(' ');
const svcCount = (n: number | undefined) => (n ? h('span.svc-count', {}, String(n)) : null);

/**
 * An action's row in a ☰ menu: its icon, its words, its count (`badge` draws it, a
 * .svc-count unless told otherwise) and its key. Clicking it runs it after `close`.
 */
export function menuItem(a: HudAction, close: () => void, badge: (n: number | undefined) => Node | null = svcCount): HTMLButtonElement {
  const blocked = a.blocked?.();
  return h(
    'button.menu-item',
    {
      type: 'button',
      role: 'menuitem',
      class: classOf(a, blocked),
      title: blocked ?? a.title?.(),
      onclick: () => {
        close();
        a.run();
      },
    },
    h('span.mi-icon', {}, iconOf(a)),
    h('span.mi-label', {}, labelOf(a)),
    badge(a.count?.()),
    keyOf(a) ? h('kbd.mi-key', {}, keyOf(a)!) : null,
  );
}

/**
 * Opens `el` (a .hud-menu) as a dropdown hanging under `anchor`: arrows walk its rows, and Tab or a click anywhere else closes it like Esc. `onClose` hears it closing.
 */
export function openDropdown(anchor: HTMLElement, el: HTMLElement, onClose: () => void): Modal {
  // On the window, so the keys work wherever focus is while the menu is up.
  const onKey = (e: KeyboardEvent) => menuKey(el, e, () => modal.close());
  const modal = openModal(el, {
    // A dropdown under its button, which closes it again, like a click anywhere else.
    closeButton: false,
    onClose: () => {
      anchor.setAttribute('aria-expanded', 'false');
      window.removeEventListener('keydown', onKey, true);
      onClose();
    },
  });
  window.addEventListener('keydown', onKey, true);
  modal.backdrop.classList.add('menu-backdrop');
  anchor.setAttribute('aria-expanded', 'true');
  // Hangs under the button.
  const r = anchor.getBoundingClientRect();
  el.style.top = `${r.bottom + 8}px`;
  el.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  el.style.maxHeight = `${window.innerHeight - r.bottom - 20}px`;
  el.querySelector<HTMLElement>('.menu-item')?.focus();
  return modal;
}

/** Arrows walk the menu, and Tab closes it like Esc. */
function menuKey(el: HTMLElement, e: KeyboardEvent, close: () => void) {
  const items = [...el.querySelectorAll<HTMLElement>('.menu-item')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next: Element | null | undefined;
  switch (e.key) {
    case 'ArrowDown':
      next = items[(i + 1) % items.length];
      break;
    case 'ArrowUp':
      next = items[(i < 0 ? items.length : i) - 1] ?? items[items.length - 1];
      break;
    case 'Home':
      next = items[0];
      break;
    case 'End':
      next = items[items.length - 1];
      break;
    case 'Tab':
      // Not past the menu to what's behind it.
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (next instanceof HTMLElement) next.focus();
}
