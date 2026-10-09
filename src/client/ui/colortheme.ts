// The flat views' color themes: Portal (Light) and Portal (Dark), the look of a low-code platform's web
// portal (a dark navy top bar, white pages, one blue, no emoji: the default since release 26); Clean (Light)
// and Clean (Dark), flat and quiet like a code editor's light and dark themes with no emoji; Fun, the office's original bright, chunky look
// (its id stays 'default' so earlier picks keep working); Fun (Dark); and Terminal (a green phosphor screen). The 🎨 in the 1D and 2D top bars opens a list of them, and this browser
// remembers the pick for both: a change in one tab reaches the other views open in other tabs too.
// A theme is <html data-theme="…">: the colors are tokens in styles/base.css, the other themes' values
// are in styles/themes.css, Terminal's shapes in styles/theme-terminal.css, and the Clean pair's in
// styles/theme-clean.css and theme-clean-parts.css (ui/clean/ hides their emoji). Portal is of the Clean family:
// it wears Clean's flat shapes and has no emoji either (every Clean rule is under
// html:is([data-theme^='clean'], [data-theme^='portal'])), with its own tokens and parts in
// styles/theme-portal.css and theme-portal-parts.css, its top bar in ui/portal/ and Home as its Projects page. lite.html, pixel.html
// and home.html set the attribute in a line of script before anything is drawn, so a dark page never
// flashes white first; this module keeps it, the 🎨 and the browser's bar color in step after that.

import '../styles/themes.css';
import '../styles/theme-terminal.css';
import '../styles/theme-clean.css';
import '../styles/theme-clean-parts.css';
import '../styles/theme-portal.css';
import '../styles/theme-portal-parts.css';
import './flatchrome.css';
import { h, toast } from './dom';
import { stepIndex } from './chrome-logic';
import { isCleanFamily, startClean } from './clean';
import { loadPortalFont } from './portal/font';

/** Every theme, in the 🎨 list's order. The pages' early scripts (lite.html, pixel.html, home.html) list the same names. */
export const COLOR_THEMES = ['portal-light', 'portal-dark', 'clean-light', 'clean-dark', 'default', 'dark', 'terminal'] as const;
export type ColorTheme = (typeof COLOR_THEMES)[number];

/** Where the pick is kept. The pages' early scripts read the same key. */
const KEY = 'agent-office.color-theme';
export const THEME_LABEL: Record<ColorTheme, string> = { 'portal-light': 'Portal (Light)', 'portal-dark': 'Portal (Dark)', 'clean-light': 'Clean (Light)', 'clean-dark': 'Clean (Dark)', default: 'Fun', dark: 'Fun (Dark)', terminal: 'Terminal' };
const WHAT: Record<ColorTheme, string> = {
  default: 'The office’s own bright, chunky look',
  dark: 'The same chunky look, at night',
  terminal: 'A green phosphor screen',
  'portal-light': 'Like a low-code platform’s web portal: navy bar, white pages',
  'portal-dark': 'The portal look in dark mode: navy and charcoal',
  'clean-light': 'Flat and quiet, like an editor’s light theme',
  'clean-dark': 'Flat and quiet, like an editor’s dark theme',
};
/** The browser's own bar (on a phone) in each theme's top-bar color. */
const BAR: Record<ColorTheme, string> = { default: '#fff1de', dark: '#222536', terminal: '#071009', 'clean-light': '#f3f3f3', 'clean-dark': '#181818', 'portal-light': '#0a1324', 'portal-dark': '#060b16' };

/** Each theme's light or dark twin, for the Portal top bar's dark-mode switch (Terminal has none). */
export const DARK_TWIN: Record<ColorTheme, ColorTheme> = { 'portal-light': 'portal-dark', 'portal-dark': 'portal-light', 'clean-light': 'clean-dark', 'clean-dark': 'clean-light', default: 'dark', dark: 'default', terminal: 'terminal' };
/** Whether a theme is a dark one (its twin is the light one). */
export const isDarkTheme = (t: ColorTheme) => t === 'dark' || t === 'terminal' || t.endsWith('-dark');

export const isTheme = (t: unknown): t is ColorTheme => COLOR_THEMES.includes(t as ColorTheme);

/** The theme to show: the one picked here before, else Portal (Light), or Portal (Dark) for someone whose system is dark. */
export function savedTheme(): ColorTheme {
  try {
    const t = localStorage.getItem(KEY);
    if (isTheme(t)) return t;
  } catch {
    // No storage (a private window, blocked site data): fall through to the system's preference.
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'portal-dark' : 'portal-light';
}

export function currentTheme(): ColorTheme {
  const t = document.documentElement.dataset.theme;
  return isTheme(t) ? t : 'portal-light';
}

export function applyTheme(t: ColorTheme, remember = false) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[t]);
  if (isCleanFamily(t)) startClean();
  if (t.startsWith('portal')) loadPortalFont();
  if (!remember) return;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Just for this visit, then.
  }
}

/**
 * Wires the 🎨 button to open the list of themes, and starts the Terminal theme's typing of the
 * project summary's story in `summary` (the element ui/summary.ts draws into), if the page has one.
 * `onChange` hears every change, picked here or in another tab (the 2D view repaints its office).
 */
export function colorThemes(button: HTMLElement, summary?: HTMLElement, onChange?: (t: ColorTheme) => void) {
  applyTheme(savedTheme());
  const choose = (t: ColorTheme) => {
    if (t === currentTheme()) return;
    applyTheme(t, true);
    label();
    onChange?.(t);
    themeListeners.forEach((fn) => fn(t));
    toast(`🎨 ${THEME_LABEL[t]} theme`);
  };
  picker = choose;
  const list = themeList(button, choose);
  const label = () => {
    const t = currentTheme();
    button.title = `Theme: ${THEME_LABEL[t]}. Click to pick another`;
    button.setAttribute('aria-label', `Color theme: ${THEME_LABEL[t]}`);
    list.refresh();
  };
  label();
  // Picked in another tab (the other flat view, say): this one follows.
  addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    const t = savedTheme();
    if (t === currentTheme()) return;
    applyTheme(t);
    label();
    onChange?.(t);
    themeListeners.forEach((fn) => fn(t));
  });
  if (summary) typeStories(summary);
}

/** The page's pick (colorThemes's), once it's wired: the Portal top bar's dark-mode switch goes through it. */
let picker: ((t: ColorTheme) => void) | undefined;
const themeListeners = new Set<(t: ColorTheme) => void>();

/** Picks `t` as the 🎨 list would: remembered, the 🎨 relabelled, the page told. */
export function pickTheme(t: ColorTheme) {
  if (picker) picker(t);
  else applyTheme(t, true);
}

/** Hears every change of theme on this page, picked here or in another tab. Returns how to stop. */
export function onThemeChange(fn: (t: ColorTheme) => void): () => void {
  themeListeners.add(fn);
  return () => themeListeners.delete(fn);
}

/**
 * The 🎨's list, a listbox under it in the view dropdown's look (ui/flatchrome.css): ↑ ↓ Home End move,
 * Enter or Space picks, Esc or Tab or a click elsewhere closes it. It hangs in the button's bar, lined
 * up with the button's right edge, so the bar's layout stays as it was.
 */
function themeList(button: HTMLElement, pick: (t: ColorTheme) => void) {
  const id = 'theme-list';
  const options = COLOR_THEMES.map((t, i) =>
    h(
      'li.vp-opt',
      { id: `${id}-${t}`, role: 'option', 'aria-selected': 'false', 'data-i': i, title: WHAT[t] },
      h('span.vp-text', {}, h('b', {}, THEME_LABEL[t]), h('small', {}, WHAT[t])),
      h('span.vp-tick', { 'aria-hidden': 'true' }, '✓'),
    ),
  );
  const list = h('ul.vp-list.theme-list', { id, role: 'listbox', tabindex: '-1', 'aria-label': 'Color theme', hidden: true }, ...options);
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);
  (button.parentElement ?? document.body).append(list);
  let at = 0;

  const mark = (i: number) => {
    at = i;
    options.forEach((o, j) => o.classList.toggle('active', j === i));
    list.setAttribute('aria-activedescendant', options[i].id);
  };
  const isOpen = () => !list.hidden;
  function open() {
    if (isOpen()) return;
    // Under the button, its right edge on the button's, in whatever the bar is positioned by.
    const host = (list.offsetParent ?? list.parentElement ?? document.body) as HTMLElement;
    list.hidden = false;
    const hb = (list.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? host.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    list.style.top = `${Math.round(b.bottom - hb.top + 8)}px`;
    list.style.right = `${Math.max(8, Math.round(hb.right - b.right))}px`;
    button.setAttribute('aria-expanded', 'true');
    mark(Math.max(0, COLOR_THEMES.indexOf(currentTheme())));
    list.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside, true);
  }
  function close(refocus = true) {
    if (!isOpen()) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (refocus) button.focus({ preventScroll: true });
  }
  const choose = (i: number) => {
    close();
    pick(COLOR_THEMES[i]);
  };
  const outside = (e: Event) => {
    if (!list.contains(e.target as Node) && !button.contains(e.target as Node)) close(false);
  };
  button.addEventListener('click', () => (isOpen() ? close() : open()));
  button.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    open();
  });
  list.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const next = stepIndex(at, e.key, COLOR_THEMES.length);
    if (next !== undefined) {
      e.preventDefault();
      return mark(next);
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      return choose(at);
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
    if (o) choose(Number(o.dataset.i));
  });
  return {
    /** The ✓ and aria-selected on the theme that's on now. */
    refresh() {
      const now = currentTheme();
      COLOR_THEMES.forEach((t, i) => options[i].setAttribute('aria-selected', String(t === now)));
    },
  };
}

/**
 * In the Terminal theme, the summary's story comes out a few letters at a time, like a command's
 * output, each time it says something new. The whole text stays in the page from the start (what
 * isn't typed yet is only see-through), so the card doesn't jump and a screen reader reads it all.
 * Nobody who asked for less motion sees it typed.
 */
function typeStories(summary: HTMLElement) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let typed = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  new MutationObserver(() => {
    const p = summary.querySelector<HTMLElement>('.sm-story p');
    if (!p || p.dataset.typing) return;
    const text = p.textContent ?? '';
    if (text === typed) return;
    typed = text;
    if (currentTheme() !== 'terminal' || reduce.matches) return;
    clearInterval(timer);
    const shown = document.createElement('span');
    const rest = document.createElement('span');
    rest.style.color = 'transparent';
    rest.style.textShadow = 'none';
    p.dataset.typing = '1';
    p.classList.add('typing');
    p.replaceChildren(shown, rest);
    let n = 0;
    const step = Math.max(2, Math.ceil(text.length / 90));
    timer = setInterval(() => {
      n = Math.min(text.length, n + step);
      shown.textContent = text.slice(0, n);
      rest.textContent = text.slice(n);
      if (n < text.length) return;
      clearInterval(timer);
      p.classList.remove('typing');
    }, 18);
  }).observe(summary, { childList: true, subtree: true });
}
