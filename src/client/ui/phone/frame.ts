// The team phone's shell: the floating launcher at the bottom right, above the page's bottom bar (the
// 1D view's Issues / PRs / Queue / New task, the 2D view's footer), with its badge; and the window it
// opens, anchored to it. In the Default theme both are a pixel-art iPhone (a chunky frame, the notch,
// a status bar with the time and battery, the home bar: CSS and crisp inline SVG, iphone.css); in the
// other themes a round messages button and a plain window in the theme's colors (phone.css). The
// window has a ✕ and closes on Esc, can be widened, and this browser remembers it open or closed.

import type { Badge } from '../../../shared/phone';
import { h } from '../dom';

const OPEN_KEY = 'agent-office.phone.open';
const WIDE_KEY = 'agent-office.phone.wide';

const remembered = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const remember = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Only for this visit.
  }
};

const SVG = 'http://www.w3.org/2000/svg';
function svg(viewBox: string, cls: string, body: string): SVGSVGElement {
  const el = document.createElementNS(SVG, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('class', cls);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.innerHTML = body;
  return el;
}

/** Pixels as rects: each string a row, '.' empty, other letters a palette color. */
function pixels(rows: string[], palette: Record<string, string>): string {
  let out = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = palette[row[x]];
      if (c) out += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`;
    }
  });
  return out;
}

/** The launcher's pixel iPhone: a dark frame, a lit screen with two chat bubbles, the notch and home bar. */
const PIXEL_PHONE = pixels(
  [
    '..kkkkkkkk..',
    '.kffffffffk.',
    'kffffkkffffk',
    'kfssssssssfk',
    'kfsbbbbsssfk',
    'kfsbbbbbssfk',
    'kfssssssssfk',
    'kfssssgggsfk',
    'kfsssggggsfk',
    'kfssssssssfk',
    'kfsbbbssssfk',
    'kfssssssssfk',
    'kfssssssssfk',
    'kffffffffffk',
    'kffffhhffffk',
    'kffffffffffk',
    '.kffffffffk.',
    '..kkkkkkkk..',
  ],
  { k: '#1b1c2b', f: '#3d4160', s: '#9be7ff', b: '#ffffff', g: '#06d6a0', h: '#c9cde8' },
);

/** A speech-bubbles line icon, for the other themes. */
const LINE_ICON = '<path d="M3 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 15 14.5H9l-4 3.5v-3.5H3A1.5 1.5 0 0 1 1.5 13V6A1.5 1.5 0 0 1 3 4.5z"/><path d="M5.5 8.5h7M5.5 11h4.5"/><path d="M8 1.5h11A1.5 1.5 0 0 1 20.5 3v7"/>';

/** The status bar's battery, in pixels. */
const BATTERY = pixels(['kkkkkkkkkk.', 'kggggggg.kk', 'kggggggg.kk', 'kkkkkkkkkk.'], { k: 'currentColor', g: '#06d6a0' });

export interface Frame {
  launcher: HTMLButtonElement;
  win: HTMLElement;
  title: HTMLElement;
  sub: HTMLElement;
  back: HTMLButtonElement;
  gear: HTMLButtonElement;
  body: HTMLElement;
  isOpen(): boolean;
  setOpen(open: boolean): void;
  setBadge(b: Badge, label: string): void;
}

export function phoneFrame(onOpenChange: (open: boolean) => void): Frame {
  const badge = h('span.tp-badge', { 'aria-hidden': 'true' });
  const launcher = h(
    'button.tp-launch',
    { type: 'button', title: 'Team phone: team chatter and what needs you', 'aria-label': 'Team phone', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
    h('span.tp-ico-pixel', {}, svg('0 0 12 18', 'tp-px-phone', PIXEL_PHONE)),
    h('span.tp-ico-line', {}, svg('0 0 22 20', 'tp-line-icon', LINE_ICON)),
    badge,
  ) as HTMLButtonElement;

  const clock = h('span.tp-clock');
  const tick = () => (clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  tick();
  setInterval(tick, 20_000);

  const back = h('button.tp-hbtn.tp-back', { type: 'button', 'aria-label': 'Back to the channels', title: 'Back (Alt+←)' }, '‹') as HTMLButtonElement;
  const title = h('h2.tp-title');
  const sub = h('small.tp-sub');
  const wide = h('button.tp-hbtn.tp-wide', { type: 'button', 'aria-label': 'Wider', title: 'Wider: the channels beside the chat', 'aria-pressed': 'false' }, '⤢');
  const gear = h('button.tp-hbtn.tp-gear', { type: 'button', 'aria-label': 'Phone settings', title: 'Do not disturb, digest, sound' }, svg('0 0 16 16', 'tp-gear-icon', '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>')) as HTMLButtonElement;
  const close = h('button.tp-hbtn.close', { type: 'button', 'aria-label': 'Close the team phone', title: 'Close (Esc)' }, '✕');
  const body = h('div.tp-body');
  const win = h(
    'section.tp-win',
    { role: 'dialog', 'aria-label': 'Team phone', hidden: true },
    h('span.tp-side.tp-side-a', { 'aria-hidden': 'true' }),
    h('span.tp-side.tp-side-b', { 'aria-hidden': 'true' }),
    h('span.tp-side.tp-side-c', { 'aria-hidden': 'true' }),
    h(
      'div.tp-frame',
      {},
      h(
        'div.tp-screen',
        {},
        h('div.tp-status', { 'aria-hidden': 'true' }, clock, h('span.tp-notch'), h('span.tp-bars', {}, svg('0 0 11 4', 'tp-battery', BATTERY))),
        h('header.tp-head', {}, back, h('div.tp-titles', {}, title, sub), wide, gear, close),
        body,
        h('div.tp-homebar', { 'aria-hidden': 'true' }),
      ),
    ),
  );

  const setWide = (on: boolean) => {
    win.classList.toggle('tp-is-wide', on);
    wide.setAttribute('aria-pressed', String(on));
    wide.textContent = on ? '⤡' : '⤢';
  };
  setWide(remembered(WIDE_KEY));
  wide.addEventListener('click', () => {
    const on = !win.classList.contains('tp-is-wide');
    setWide(on);
    remember(WIDE_KEY, on);
  });

  let open = false;
  function setOpen(next: boolean) {
    if (next === open) return;
    open = next;
    win.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.classList.toggle('tp-on', open);
    remember(OPEN_KEY, open);
    onOpenChange(open);
  }
  launcher.addEventListener('click', () => {
    setOpen(!open);
    if (open) setTimeout(() => body.querySelector<HTMLElement>('textarea, [data-focus], button')?.focus(), 30);
  });
  close.addEventListener('click', () => {
    setOpen(false);
    launcher.focus();
  });

  // Above the page's bottom bar, whatever its height (it wraps on a narrow phone).
  const place = () => {
    const bar = document.querySelector<HTMLElement>('#lite-nav, #px-foot');
    const above = bar && getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().height : bar ? Math.max(0, window.innerHeight - bar.getBoundingClientRect().top) : 0;
    document.documentElement.style.setProperty('--tp-above', `${Math.round(above)}px`);
  };
  window.addEventListener('resize', place);
  const bar = document.querySelector<HTMLElement>('#lite-nav, #px-foot');
  if (bar) new ResizeObserver(place).observe(bar);
  // On the next frame, not while the page is still being built: reading the bar's size here forced a layout of the whole page.
  requestAnimationFrame(place);

  return {
    launcher,
    win,
    title,
    sub,
    back,
    gear,
    body,
    isOpen: () => open,
    setOpen,
    setBadge(b, label) {
      // Written only when it changes: it's worked out on every worker update, and each write restyles the page.
      const cls = `tp-badge tp-badge-${b.kind}`;
      const text = b.kind === 'count' ? (b.n > 99 ? '99+' : String(b.n)) : '';
      const aria = `Team phone${label ? `: ${label}` : ''}`;
      if (badge.className !== cls) badge.className = cls;
      if (badge.textContent !== text) badge.textContent = text;
      if (launcher.getAttribute('aria-label') !== aria) launcher.setAttribute('aria-label', aria);
    },
  };
}

/** Whether this browser had the phone open last time. */
export const wasOpen = () => remembered(OPEN_KEY);
