// What the Clean themes (Clean (Light) and Clean (Dark), ui/colortheme.ts) need beyond their sheets
// (styles/theme-clean.css, theme-clean-parts.css): no emoji anywhere, a line icon where an emoji was all
// a button had, and the clean font for what's drawn on a canvas.
//
// - The "AO Blank" font (ui/clean/emoji.ts) is first in the Clean font stacks, so every emoji in any
//   text draws as nothing.
// - An emoji that starts a word ("🎛️ Command Center", "I'm stuck 🤔 Which…") would still leave its
//   space behind: it goes in a <span class="ao-emo">, which Clean hides (and the other themes show as
//   before); one in the middle of a sentence shows its icon there instead, if Clean has one.
// - An element whose own words are just an emoji (🔔 🏠 🎨 ☰, a menu's icon) gets data-ao-icon with
//   the icon to draw in its place (ui/clean/icons.ts), or "none" for one there's no icon for (a button
//   gets a dot instead, so it's never empty).
// Both happen to whatever any page draws, now or later, while a Clean theme is on: a watcher on the
// page sees each new piece. Nothing is done until a Clean theme is first picked.

import { blankFont, leadingEmoji, onlyEmoji, stripEmoji, unicodeRange } from './emoji';
import { iconFor, iconSheet } from './icons';

export { stripEmoji } from './emoji';

/** Whether `theme` is of the Clean family: the Clean pair, or the Portal pair that wears Clean's shapes and has no emoji either. */
export const isCleanFamily = (theme: string | undefined) => !!theme && (theme.startsWith('clean') || theme.startsWith('portal'));

/** Whether a Portal theme is on (<html data-theme="portal-…">): its top bar (ui/portal/) and Home as its Projects page. */
export const isPortal = () => (document.documentElement.dataset.theme ?? '').startsWith('portal');

/** Whether a Clean-family theme is on (<html data-theme="clean-…"> or "portal-…"). */
export const isClean = () => isCleanFamily(document.documentElement.dataset.theme);

/** The Clean UI font for a canvas's `font`: the same stack as the pages' (styles/theme-clean.css). */
export const CLEAN_FONT = "'AO Blank', 'AO Clean', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

/** The font stack a canvas draws its words in: `normal` usually, the clean one in a Clean theme. */
export const uiFont = (normal: string) => (isClean() ? CLEAN_FONT : normal);

/** Words for a canvas: as they are usually, without their emoji in a Clean theme. */
export const canvasText = (s: string) => (isClean() ? stripEmoji(s) : s);

/** What counts as a button: one with only an emoji in it gets a dot when Clean has no icon for it. */
const BUTTONISH = 'button, a, [role=button], [role=tab], .btn';
/** Where the words are someone's own and stay as typed. */
const SKIP = 'textarea, input, select, pre, code, script, style, .xterm, [contenteditable]';

/** The words directly in `el`, not in its children. */
function ownText(el: Element): string {
  let s = '';
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) s += (n as Text).data;
  return s;
}

/** Marks `el` for its icon if its own words are just an emoji, and unmarks it if they've changed since. */
function markIcon(el: HTMLElement) {
  if (el.classList.contains('ao-emo')) return;
  const own = ownText(el);
  const icon = own.trim() ? iconFor(own) : undefined;
  const emojiOnly = icon !== undefined || onlyEmoji(own);
  // Its children's words (a count on a bell, say) may stay, but not a label: then the emoji just leads it.
  const rest = emojiOnly ? (el.textContent ?? '').replace(own, '') : '';
  if (emojiOnly && !/\p{L}/u.test(rest)) {
    const name = icon ?? (el.matches(BUTTONISH) ? 'dot' : 'none');
    if (el.dataset.aoIcon !== name) el.dataset.aoIcon = name;
  } else if (el.dataset.aoIcon !== undefined) delete el.dataset.aoIcon;
}

/**
 * Puts each emoji that starts a word in `t` (with the space after it) in a span Clean hides, so
 * "🎛️ Command Center" and "I'm stuck 🤔 Which…" read without a gap where the emoji was.
 */
function wrapEmoji(t: Text) {
  for (let i = 0; i < t.data.length; i++) {
    if (i > 0 && !/\s/.test(t.data[i - 1])) continue;
    const n = leadingEmoji(t.data.slice(i));
    if (!n) continue;
    const emoji = i ? t.splitText(i) : t;
    const rest = n < emoji.data.length ? emoji.splitText(n) : null;
    const span = document.createElement('span');
    span.className = 'ao-emo';
    // In the middle of a sentence ("the view is in the dropdown by the 🎨."), its icon, if Clean has one.
    const icon = i > 0 || t.previousSibling?.textContent?.trim() ? iconFor(emoji.data) : undefined;
    if (icon) span.dataset.aoIcon = icon;
    emoji.replaceWith(span);
    span.append(emoji);
    if (!rest) return;
    t = rest;
    i = -1;
  }
}

function textNode(t: Text) {
  const p = t.parentElement;
  if (!p || p.classList.contains('ao-emo') || p.closest(SKIP)) return;
  markIcon(p);
  if (p.dataset.aoIcon === undefined) wrapEmoji(t);
}

function scan(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return textNode(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if ((n as Text).data.trim()) found.push(n as Text);
  for (const t of found) textNode(t);
}

let installed = false;

/** Starts what Clean needs (the blank font, the icons, the watcher), once: ui/colortheme.ts calls it when a Clean theme comes on. */
export function startClean() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  try {
    const face = new FontFace('AO Blank', blankFont().buffer as ArrayBuffer, { unicodeRange: unicodeRange() });
    document.fonts.add(face);
    void face.load().catch(() => undefined);
  } catch {
    // An old browser without FontFace: the emoji show, nothing else is lost.
  }
  // The clean UI font for canvases too: they don't ask for it themselves.
  void document.fonts?.load(`13px ${CLEAN_FONT}`).catch(() => undefined);
  void document.fonts?.load(`900 13px ${CLEAN_FONT}`).catch(() => undefined);
  const style = document.createElement('style');
  style.id = 'ao-clean-icons';
  style.textContent = iconSheet();
  document.head.append(style);
  const go = () => {
    scan(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.target instanceof HTMLElement && m.target.isConnected && !m.target.closest(SKIP)) markIcon(m.target);
        m.addedNodes.forEach((n) => n.isConnected && scan(n));
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) go();
  else addEventListener('DOMContentLoaded', go, { once: true });
}
