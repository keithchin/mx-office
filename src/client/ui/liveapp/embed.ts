// Show here, in the desktop app: the live app top-level inside the office window, where every widget
// works. The desktop app lays a native view of its own (its own session, sandboxed, kept on the app's
// address) over this placeholder, so the app's window.top is the app itself, not the office's page as in
// the browser's frame (ui/liveapp/viewer.ts), where Data grid 2 and others fail. The page only says
// where the placeholder is, over the preload's bridge (desktop/src/preload.cts), and drives the toolbar:
// Back and Forward are the app's real history now, the address is where it really is.
//
// A native view sits above the whole page, so it's kept to the part of the placeholder that shows (the
// window and the boxes that scroll it), checked every frame while shown; and it's hidden whenever
// anything of the office is over it (a dialog, a menu, a toast) or the tab isn't showing, and closed when
// the project changes or the app stops.

import { h } from '../dom';
import { DEVICE_LABEL, DEVICE_WIDTH, type Device, type Zoom } from './viewer-logic';
import { clipOf, deviceBox, overlap, placeKey, probePoints, shownPath, type Box } from './embed-logic';
import type { LiveViewer } from './viewer';
import './viewer.css';
import './embed.css';

interface EmbedState {
  floor: string;
  url: string;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
  title: string;
  visible: boolean;
}

/** The preload's bridge (desktop/src/preload.cts), when the page runs in the desktop app. */
export interface DesktopEmbed {
  version: number;
  show(floor: string, url: string): Promise<{ ok: boolean; error?: string }>;
  setBounds(rect: Box, clip: Box, zoom: number): void;
  hide(): void;
  close(): void;
  navigate(path: string): void;
  back(): void;
  forward(): void;
  reload(hard: boolean): void;
  home(): void;
  devtools(): void;
  onState(cb: (s: EmbedState | null) => void): () => void;
}

/** The desktop app's Show here bridge, or null in a browser. */
export function desktopEmbed(): DesktopEmbed | null {
  const e = (window as unknown as { mxOfficeDesktop?: { embed?: DesktopEmbed } }).mxOfficeDesktop?.embed;
  return e && e.version === 1 && typeof e.show === 'function' ? e : null;
}

const editable = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

/** Boxes around `el` that clip what's inside them (their inner part). */
function clippersOf(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.position === 'fixed') break;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') out.push(p);
  }
  return out;
}
const innerBox = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.x + el.clientLeft, y: r.y + el.clientTop, width: el.clientWidth, height: el.clientHeight };
};

export function liveEmbed(bridge: DesktopEmbed, floor: () => string): LiveViewer {
  const btn = (label: string, title: string, text: string, onclick: (e: MouseEvent) => void) => {
    const b = h('button.btn.lv-btn', { type: 'button', 'aria-label': label, title }, text) as HTMLButtonElement;
    b.addEventListener('click', onclick);
    return b;
  };
  const backBtn = btn('Back', 'Back (Alt+←)', '←', () => bridge.back());
  const fwdBtn = btn('Forward', 'Forward (Alt+→)', '→', () => bridge.forward());
  const reloadBtn = btn('Reload', 'Reload (F5); Shift+click or Shift+F5: hard reload, past the cache', '⟳', (e) => bridge.reload(e.shiftKey));
  const homeBtn = btn('Home', "The app's home page", '⌂', () => bridge.home());
  const address = h('input.lv-address', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Address within the app', title: 'Where the app is: a path within it (/p/orders). Enter goes there; only the app’s own address.' }) as HTMLInputElement;
  const deviceBtns = (Object.keys(DEVICE_LABEL) as Device[]).map((d) => {
    const b = h('button.btn.lv-seg', { type: 'button', 'aria-pressed': 'false', title: DEVICE_WIDTH[d] ? `${DEVICE_LABEL[d]}: ${DEVICE_WIDTH[d]} px wide` : 'Desktop: the full width', onclick: () => ((device = d), paint()) }, DEVICE_LABEL[d]) as HTMLButtonElement;
    b.dataset.device = d;
    return b;
  });
  const zoomBtn = btn('Zoom', 'Fit the device width into the viewer, or show it at 100%', 'Fit', () => ((zoom = zoom === 'fit' ? '100' : 'fit'), paint()));
  const copyBtn = btn('Copy link', 'Copy the address of this page of the app', 'Copy link', () => void copy());
  const open = h('a.btn.lv-btn.la-open', { target: '_blank', rel: 'noopener noreferrer', title: 'Open this page of the app in your browser' }, 'Open ↗') as HTMLAnchorElement;
  const toolsBtn = btn('Developer tools', "The app's developer tools, in a window of their own", '🛠 Tools', () => bridge.devtools());
  const fullBtn = btn('Full screen', 'Full screen (F11)', '⛶ Full screen', () => toggleFull());
  fullBtn.setAttribute('aria-pressed', 'false');
  const status = h('span.lv-status', { role: 'status', 'aria-live': 'polite' });
  const bar = h('div.lv-bar', { role: 'toolbar', 'aria-label': 'Live app viewer' }, backBtn, fwdBtn, reloadBtn, homeBtn, address, h('span.lv-group', { role: 'group', 'aria-label': 'Device width' }, ...deviceBtns), zoomBtn, copyBtn, open, toolsBtn, fullBtn);
  const placeNote = h('p.lv-place-note', {}, '');
  const place = h('div.lv-place', { 'aria-label': 'The live app, shown by the desktop app' }, placeNote);
  const stage = h('div.lv-stage', {}, place);
  const el = h('div.la-framebox.lv.lv-native', { hidden: true }, bar, h('div.lv-sub', {}, status), stage);

  let base = '';
  let key = '';
  let at = '';
  /** Shown by the desktop app (its answer said yes). */
  let live = false;
  let state: EmbedState | null = null;
  let device: Device = 'desktop';
  let zoom: Zoom = 'fit';
  let full: 'api' | 'css' | null = null;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sent = '';
  let clippers: HTMLElement[] = [];
  let frames = 0;
  let asking = 0;

  bridge.onState((s) => {
    state = s && s.floor === at ? s : null;
    if (!s && live) {
      // The desktop app closed it (the office page went elsewhere): shown again on the next draw.
      live = false;
      key = '';
      stop();
    }
    paint();
  });

  function send(rect: Box | null, clip?: Box, z = 1) {
    if (!rect || !clip) {
      if (sent !== 'hidden') bridge.hide();
      sent = 'hidden';
      return;
    }
    const k = placeKey(rect, clip, z, devicePixelRatio);
    if (k === sent) return;
    sent = k;
    bridge.setBounds(rect, clip, z);
  }

  /** Where the view goes now, or null when it mustn't show (tab hidden, scrolled away, something over it). */
  function measure(): { rect: Box; clip: Box; zoom: number } | null {
    if (document.hidden || !place.getClientRects().length) return null;
    if (frames++ % 60 === 0) clippers = clippersOf(place);
    const r = place.getBoundingClientRect();
    const fit = deviceBox({ x: r.x, y: r.y, width: r.width, height: r.height }, device, zoom);
    const clip = clipOf({ x: 0, y: 0, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }, clippers.map(innerBox));
    const shows = overlap(fit.rect, clip);
    if (shows.width < 40 || shows.height < 40) return null;
    // Anything of the office's over it (a dialog, a menu): the native view would cover it, so it steps aside.
    for (const p of probePoints(shows)) {
      const hit = document.elementFromPoint(p.x, p.y);
      if (hit !== place && !(hit && place.contains(hit))) return null;
    }
    return { rect: fit.rect, clip, zoom: fit.zoom };
  }

  function tick() {
    frame = 0;
    timer = undefined;
    if (!live) return;
    if (!place.isConnected || floor() !== at) {
      // The tab's gone from the page, or another project is open (maybe while another tab showed): the view goes too, and comes back with the next show.
      live = false;
      key = '';
      bridge.close();
      return;
    }
    const m = measure();
    send(m && m.rect, m?.clip, m?.zoom);
    const covered = !m && place.getClientRects().length > 0 && !document.hidden;
    if (covered !== el.classList.contains('lv-covered')) {
      el.classList.toggle('lv-covered', covered);
      placeNote.textContent = covered ? 'The app steps aside while something of the office is over it, or it’s scrolled out of view.' : '';
    }
    // Every frame while it can show; slower while the tab is hidden.
    if (place.getClientRects().length && !document.hidden) frame = requestAnimationFrame(tick);
    else timer = setTimeout(tick, 300);
  }
  function start() {
    if (!frame && !timer) tick();
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    if (timer) clearTimeout(timer);
    frame = 0;
    timer = undefined;
    sent = '';
  }

  async function ask(home = false) {
    const n = ++asking;
    live = false;
    stop();
    placeNote.textContent = 'Opening the app here…';
    el.classList.remove('lv-failed');
    const r = await bridge.show(at, base).catch((e: Error) => ({ ok: false, error: e.message }));
    if (n !== asking || !base) return;
    if (!r.ok) {
      el.classList.add('lv-failed');
      placeNote.textContent = `The desktop app can’t show it here: ${r.error ?? 'it said no'} ↗ Open live app shows it in a window of its own.`;
      return;
    }
    placeNote.textContent = '';
    // Another start or commit of the same app: Home again, as the browser's viewer does.
    if (home) bridge.home();
    live = true;
    frames = 0;
    start();
  }

  async function copy() {
    const url = state?.url || base;
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = `Copied ${url}`;
    } catch {
      status.textContent = `Couldn't copy (refused): ${url}`;
    }
  }

  function paint() {
    backBtn.disabled = !state?.canBack;
    fwdBtn.disabled = !state?.canForward;
    const url = state?.url || base;
    if (document.activeElement !== address) address.value = url ? shownPath(url, base) : '';
    open.href = url;
    for (const b of deviceBtns) b.setAttribute('aria-pressed', String(b.dataset.device === device));
    zoomBtn.textContent = zoom === 'fit' ? 'Fit' : '100%';
    zoomBtn.disabled = device === 'desktop';
    zoomBtn.setAttribute('aria-pressed', String(zoom === '100'));
    stage.dataset.device = device;
    el.classList.toggle('lv-loading', !!state?.loading);
    status.textContent = state?.loading ? `Loading ${shownPath(url, base)}…` : state?.title ? `${state.title} · shown by the desktop app: every widget works here` : '';
    fullBtn.textContent = full ? '✕ Exit full screen' : '⛶ Full screen';
    fullBtn.title = full ? 'Exit full screen (Esc)' : 'Full screen (F11)';
    fullBtn.setAttribute('aria-pressed', String(!!full));
    el.classList.toggle('lv-full', full === 'css');
    document.body.classList.toggle('lv-full-open', full === 'css');
  }

  function enterFull() {
    if (full) return;
    const can = typeof el.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
    full = can ? 'api' : 'css';
    paint();
    if (can)
      el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
        if (full === 'api') {
          full = 'css';
          paint();
        }
      });
  }
  function exitFull() {
    if (!full) return;
    const was = full;
    full = null;
    paint();
    if (was === 'api' && document.fullscreenElement === el) void document.exitFullscreen().catch(() => undefined);
  }
  const toggleFull = () => (full ? exitFull() : enterFull());

  address.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      address.value = state?.url ? shownPath(state.url, base) : '';
      address.blur();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    bridge.navigate(address.value);
    address.blur();
  });
  el.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !editable(e.target)) {
      e.preventDefault();
      if (e.key === 'ArrowLeft') bridge.back();
      else bridge.forward();
    } else if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
      e.preventDefault();
      bridge.reload(e.shiftKey);
    } else if (e.key === 'F11') {
      e.preventDefault();
      toggleFull();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || full !== 'css' || e.defaultPrevented || document.querySelector('.backdrop')) return;
    e.preventDefault();
    exitFull();
  });
  document.addEventListener('fullscreenchange', () => {
    if (full === 'api' && document.fullscreenElement !== el) exitFull();
  });

  return {
    el,
    show(b, k) {
      el.hidden = false;
      const f = floor();
      if (b === base && k === key && f === at && (live || el.classList.contains('lv-failed'))) return start();
      const fresh = !base;
      const again = b === base && f === at && k !== key;
      base = b;
      key = k;
      at = f;
      state = null;
      paint();
      void ask(again);
      if (fresh) requestAnimationFrame(() => stage.scrollIntoView({ block: 'nearest' }));
    },
    hide() {
      el.hidden = true;
      exitFull();
      if (!base) return;
      asking++;
      base = '';
      key = '';
      state = null;
      live = false;
      stop();
      bridge.close();
      el.classList.remove('lv-covered', 'lv-failed');
    },
  };
}
