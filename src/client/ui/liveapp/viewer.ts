// The live app viewer on the 🌐 Live app tab: the running app in a frame, with a small browser's toolbar
// over it. It's only the tab's "Preview here" now (ui/liveapp/open.ts): in a frame on another origin some
// Mendix widgets fail (they read the top window), so Open live app shows the app top-level instead. Back, Forward, Reload (Shift: hard reload), Home, the address within the app (Enter goes there,
// on the app's own origin only), the device width (Desktop / Tablet / Phone) and zoom (fit / 100%), Copy
// link, Open in a new tab, and Full screen (the browser's Fullscreen API on the viewer, or the viewer laid
// over the window when that's refused; Esc or the button leaves).
//
// The app is on another origin (its own port), so where the frame is now can't be read and its history
// can't be driven: Back and Forward step through the addresses the viewer sent it to (viewer-logic.ts),
// and a click inside the app that moved it is shown as "moved inside the app" when the frame says it
// loaded, or not at all for the app's own client-side navigation. The frame itself keeps exactly the
// attributes it had (nothing loosened); it's never taken out of the page, which would reload it.
//
// Keys, with the focus on the viewer's toolbar: Alt+← / Alt+→, F5 or Ctrl+R (Shift: hard), F11.

import { h } from '../dom';
import { back, bust, canBack, canForward, current, DEVICE_LABEL, DEVICE_WIDTH, forward, freshHistory, go, inApp, scaleFor, urlOf, type Device, type ViewerHistory, type Zoom } from './viewer-logic';
import './viewer.css';

export interface LiveViewer {
  /** The toolbar and the frame. */
  readonly el: HTMLElement;
  /** Shows the app at `base` (its root address); a new `key` (another start or commit) goes Home again. */
  show(base: string, key: string): void;
  /** Nothing to show: the frame is emptied, the toolbar hidden. */
  hide(): void;
}

const ADDRESS = 'A page of the app, as a path (/p/check-sheets): Enter goes there. Only the app’s own address is allowed.';
const WANDERED = 'The app moved to another page after a click inside it; the office can’t read which (the app is on another origin). This is the last address opened here.';
const editable = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

export function liveViewer(): LiveViewer {
  const frame = h('iframe.la-frame', { title: 'The live app', referrerpolicy: 'no-referrer' }) as HTMLIFrameElement;
  const btn = (label: string, title: string, text: string, onclick: (e: MouseEvent) => void) => {
    const b = h('button.btn.lv-btn', { type: 'button', 'aria-label': label, title }, text) as HTMLButtonElement;
    b.addEventListener('click', onclick);
    return b;
  };
  const backBtn = btn('Back', 'Back (Alt+←): the address you opened before this one', '←', () => step(-1));
  const fwdBtn = btn('Forward', 'Forward (Alt+→)', '→', () => step(1));
  const reloadBtn = btn('Reload', 'Reload (F5); Shift+click or Shift+F5: hard reload, past the browser cache', '⟳', (e) => reload(e.shiftKey));
  const homeBtn = btn('Home', "The app's home page", '⌂', () => nav('/'));
  const address = h('input.lv-address', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Address within the app', title: ADDRESS }) as HTMLInputElement;
  const deviceBtns = (Object.keys(DEVICE_LABEL) as Device[]).map((d) => {
    const b = h('button.btn.lv-seg', { type: 'button', 'aria-pressed': 'false', title: DEVICE_WIDTH[d] ? `${DEVICE_LABEL[d]}: ${DEVICE_WIDTH[d]} px wide` : 'Desktop: the full width', onclick: () => setDevice(d) }, DEVICE_LABEL[d]) as HTMLButtonElement;
    b.dataset.device = d;
    return b;
  });
  const zoomBtn = btn('Zoom', 'Fit the device width into the viewer, or show it at 100%', 'Fit', () => setZoom(zoom === 'fit' ? '100' : 'fit'));
  const copyBtn = btn('Copy link', 'Copy the address of this page of the app', 'Copy link', () => void copy());
  const open = h('a.btn.lv-btn.la-open', { target: '_blank', rel: 'noopener noreferrer', title: 'Open this page of the app in a new browser tab' }, 'Open ↗') as HTMLAnchorElement;
  const fullBtn = btn('Full screen', 'Full screen (F11)', '⛶ Full screen', () => toggleFull());
  fullBtn.setAttribute('aria-pressed', 'false');
  const status = h('span.lv-status', { role: 'status', 'aria-live': 'polite' });
  const bar = h('div.lv-bar', { role: 'toolbar', 'aria-label': 'Live app viewer' }, backBtn, fwdBtn, reloadBtn, homeBtn, address, h('span.lv-group', { role: 'group', 'aria-label': 'Device width' }, ...deviceBtns), zoomBtn, copyBtn, open, fullBtn);
  const stage = h('div.lv-stage', {}, frame);
  const el = h('div.la-framebox.lv', { hidden: true }, bar, h('div.lv-sub', {}, status), stage);

  let base = '';
  let key = '';
  let hist: ViewerHistory = freshHistory();
  /** The frame was sent somewhere and hasn't said it loaded yet. */
  let loading = false;
  /** The frame loaded something the viewer didn't send it to (a click inside the app). */
  let wandered = false;
  let device: Device = 'desktop';
  let zoom: Zoom = 'fit';
  let full: 'api' | 'css' | null = null;

  function load(path: string) {
    loading = true;
    wandered = false;
    frame.src = urlOf(base, path);
    paint();
  }
  function nav(path: string) {
    hist = go(hist, path);
    load(current(hist));
  }
  function step(dir: -1 | 1) {
    // Moved inside the app: Back first returns to the page the viewer last opened.
    if (dir === -1 && wandered) return load(current(hist));
    const next = dir === -1 ? back(hist) : forward(hist);
    if (next === hist) return;
    hist = next;
    load(current(hist));
  }
  function reload(hard: boolean) {
    if (!base) return;
    loading = true;
    wandered = false;
    // The frame's own location isn't ours to reload (another origin): it's pointed at the address again.
    frame.src = urlOf(base, hard ? bust(current(hist), Date.now()) : current(hist));
    paint();
  }
  async function copy() {
    const url = urlOf(base, current(hist));
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = `Copied ${url}`;
    } catch {
      status.textContent = `Couldn't copy (the browser refused): ${url}`;
    }
  }
  function setDevice(d: Device) {
    device = d;
    paint();
  }
  function setZoom(z: Zoom) {
    zoom = z;
    paint();
  }
  function fit() {
    const w = DEVICE_WIDTH[device];
    const s = scaleFor(device, zoom, stage.clientWidth - 8);
    frame.style.width = w ? `${w}px` : '';
    frame.style.transform = s < 1 ? `scale(${s})` : '';
    frame.style.transformOrigin = 'top center';
    // A shrunk frame shows less height: it's made taller by as much, so it still fills the stage.
    frame.style.height = s < 1 ? `${Math.floor(stage.clientHeight / s)}px` : '';
    stage.classList.toggle('lv-scroll', zoom === '100' && !!w && w > stage.clientWidth);
  }
  function paint() {
    backBtn.disabled = !canBack(hist) && !wandered;
    fwdBtn.disabled = !canForward(hist);
    if (document.activeElement !== address) address.value = current(hist);
    address.title = wandered ? WANDERED : ADDRESS;
    el.classList.toggle('lv-wandered', wandered);
    open.href = base ? urlOf(base, current(hist)) : '';
    for (const b of deviceBtns) b.setAttribute('aria-pressed', String(b.dataset.device === device));
    zoomBtn.textContent = zoom === 'fit' ? 'Fit' : '100%';
    zoomBtn.disabled = device === 'desktop';
    zoomBtn.setAttribute('aria-pressed', String(zoom === '100'));
    stage.dataset.device = device;
    el.classList.toggle('lv-loading', loading);
    status.textContent = loading ? `Loading ${current(hist)}…` : wandered ? 'Moved inside the app (the office can’t read where: the app is on another origin)' : '';
    fullBtn.textContent = full ? '✕ Exit full screen' : '⛶ Full screen';
    fullBtn.title = full ? 'Exit full screen (Esc)' : 'Full screen (F11)';
    fullBtn.setAttribute('aria-pressed', String(!!full));
    el.classList.toggle('lv-full', full === 'css');
    document.body.classList.toggle('lv-full-open', full === 'css');
    requestAnimationFrame(fit);
  }

  function enterFull() {
    if (full) return;
    const can = typeof el.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
    full = can ? 'api' : 'css';
    paint();
    if (can)
      el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
        // Refused (an embedding frame without allowfullscreen, no user gesture): the viewer covers the window instead.
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

  frame.addEventListener('load', () => {
    if (!frame.getAttribute('src')) return;
    if (loading) loading = false;
    // A load nobody here asked for: the app navigated itself (a full page load after a click).
    else wandered = true;
    paint();
  });
  address.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      address.value = current(hist);
      address.blur();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const path = inApp(address.value, base);
    if (path === null) {
      status.textContent = 'Only pages of this app can be opened here (its own address); open other sites in a browser tab.';
      address.setAttribute('aria-invalid', 'true');
      return;
    }
    address.removeAttribute('aria-invalid');
    nav(path);
    address.blur();
  });
  el.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !editable(e.target)) {
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
      e.preventDefault();
      reload(e.shiftKey);
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
    else requestAnimationFrame(fit);
  });
  window.addEventListener('resize', () => !el.hidden && device !== 'desktop' && requestAnimationFrame(fit));

  return {
    el,
    show(b, k) {
      el.hidden = false;
      if (b === base && k === key) return;
      const same = b === base;
      base = b;
      key = k;
      // Another build: Home again, the address history kept only while it's the same app address.
      if (!same) hist = freshHistory();
      load(same ? current(hist) : '/');
    },
    hide() {
      el.hidden = true;
      exitFull();
      if (base) {
        base = '';
        key = '';
        loading = false;
        wandered = false;
        frame.removeAttribute('src');
      }
    },
  };
}
