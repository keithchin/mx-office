// The flat views' color themes: Default (the office's own light look), Dark, and Terminal (a green
// phosphor screen). The 🎨 in the 1D and 2D top bars steps through them, and this browser remembers
// the pick for both: a change in one tab reaches the other views open in other tabs too.
// A theme is <html data-theme="…">: the colors are tokens in styles/base.css, the other themes' values
// are in styles/themes.css, and Terminal's shapes in styles/theme-terminal.css. lite.html and pixel.html set
// the attribute in a line of script before anything is drawn, so a dark page never flashes white first;
// this module keeps it, the 🎨 and the browser's bar color in step after that.

import '../styles/themes.css';
import '../styles/theme-terminal.css';
import { toast } from './dom';

export const COLOR_THEMES = ['default', 'dark', 'terminal'] as const;
export type ColorTheme = (typeof COLOR_THEMES)[number];

/** Where the pick is kept. lite.html's and pixel.html's early scripts read the same key. */
const KEY = 'agent-office.color-theme';
const LABEL: Record<ColorTheme, string> = { default: 'Default', dark: 'Dark', terminal: 'Terminal' };
/** The browser's own bar (on a phone) in each theme's top-bar color. */
const BAR: Record<ColorTheme, string> = { default: '#fff1de', dark: '#222536', terminal: '#071009' };

const isTheme = (t: unknown): t is ColorTheme => COLOR_THEMES.includes(t as ColorTheme);

/** The theme to show: the one picked here before, or Dark for someone whose system is dark and hasn't picked. */
export function savedTheme(): ColorTheme {
  try {
    const t = localStorage.getItem(KEY);
    if (isTheme(t)) return t;
  } catch {
    // No storage (a private window, blocked site data): fall through to the system's preference.
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

export function currentTheme(): ColorTheme {
  const t = document.documentElement.dataset.theme;
  return isTheme(t) ? t : 'default';
}

export function applyTheme(t: ColorTheme, remember = false) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[t]);
  if (!remember) return;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Just for this visit, then.
  }
}

/**
 * Wires the 🎨 button to step through the themes, and starts the Terminal theme's typing of the
 * project summary's story in `summary` (the element ui/summary.ts draws into), if the page has one.
 * `onChange` hears every change, picked here or in another tab (the 2D view repaints its office).
 */
export function colorThemes(button: HTMLElement, summary?: HTMLElement, onChange?: (t: ColorTheme) => void) {
  applyTheme(savedTheme());
  const label = () => {
    const t = currentTheme();
    const next = COLOR_THEMES[(COLOR_THEMES.indexOf(t) + 1) % COLOR_THEMES.length];
    button.title = `Theme: ${LABEL[t]}. Click for ${LABEL[next]}`;
    button.setAttribute('aria-label', `Color theme: ${LABEL[t]}`);
  };
  label();
  button.addEventListener('click', () => {
    const t = COLOR_THEMES[(COLOR_THEMES.indexOf(currentTheme()) + 1) % COLOR_THEMES.length];
    applyTheme(t, true);
    label();
    onChange?.(t);
    toast(`🎨 ${LABEL[t]} theme`);
  });
  // Picked in another tab (the other flat view, say): this one follows.
  addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    const t = savedTheme();
    if (t === currentTheme()) return;
    applyTheme(t);
    label();
    onChange?.(t);
  });
  if (summary) typeStories(summary);
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
