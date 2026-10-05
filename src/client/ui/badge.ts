// The red count on a tab or a button (the pills on the 1D view's tab row, the ☰ menu's rows, the 2D
// view's buttons): one look for all of them, the Approvals tab's .ro-tab-n. A count, "!" when something
// broke, or a dot for something new. tabBadges() keeps a set of them current: a tab opts in with one
// line, badges.add(button, () => count).

import './badge.css';
import { h } from './dom';
import { badgeShown, badgeText, type BadgeValue } from './chrome-logic';

export type { BadgeValue } from './chrome-logic';

/** Puts `b` on `button` (its .ro-tab-n, made if it hasn't one), with `title` saying what it counts. */
export function tabBadge(button: HTMLElement, b: BadgeValue, title?: string): HTMLElement {
  let el = button.querySelector<HTMLElement>(':scope > .ro-tab-n');
  if (!el) {
    el = h('span.ro-tab-n');
    button.append(el);
  }
  const text = badgeText(b);
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle('dot', b === 'dot');
  el.classList.toggle('bang', b === '!');
  // Read out with the button's name: "Board, 3: cards that need a human".
  if (badgeShown(b) && title) el.setAttribute('aria-label', title);
  else el.removeAttribute('aria-label');
  el.title = badgeShown(b) ? (title ?? '') : '';
  return el;
}

export interface TabBadges {
  /** Keeps `button`'s badge at what `value` says, from now on; `title` says what it counts. */
  add(button: HTMLElement, value: () => BadgeValue, title?: string | (() => string)): void;
  /** Works every badge out again (something it counts changed). */
  refresh(): void;
}

/** A set of badges worked out together, a frame after whatever asked, however many asked. */
export function tabBadges(): TabBadges {
  const all: { button: HTMLElement; value: () => BadgeValue; title?: string | (() => string) }[] = [];
  let queued = false;
  const paint = () => {
    queued = false;
    for (const b of all) {
      let v: BadgeValue;
      try {
        v = b.value();
      } catch {
        // What it counts isn't there yet (a fetch still out): nothing for now.
        v = null;
      }
      tabBadge(b.button, v, typeof b.title === 'function' ? b.title() : b.title);
    }
  };
  return {
    add(button, value, title) {
      all.push({ button, value, title });
      this.refresh();
    },
    refresh() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(paint);
    },
  };
}
