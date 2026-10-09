// Pieces of the 1D view that the Portal layout shows somewhere else: the floor picker in the left
// navigation's project card, the budget chip and run-state toggle and the Firm's banner in the page
// header. Each is the same element, moved (never copied, so whatever draws it keeps drawing it and its
// id still finds it): into its Portal slot while a Portal theme is on, back to exactly where it was the
// moment another theme is picked, so the other themes' pages stay as they were.

import { currentTheme, onThemeChange } from '../colortheme';

/** A Portal theme is on. */
export const portalOn = () => currentTheme().startsWith('portal');

/** Keeps `el` in `slot` while Portal is on and in its own place otherwise; `place` puts it into the slot (appended by default). */
export function portalSlot(el: Element | null, slot: Element, place: (el: Element) => void = (e) => slot.append(e)) {
  if (!el || !el.parentNode) return;
  const home = document.createComment('portal-slot');
  el.parentNode.insertBefore(home, el);
  const apply = () => {
    if (portalOn()) {
      if (!slot.contains(el)) place(el);
    } else if (home.nextSibling !== el) home.after(el);
  };
  onThemeChange(apply);
  apply();
}
