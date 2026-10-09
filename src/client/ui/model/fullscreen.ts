// The Model tab's full screen (ui/model/index.ts): the App Explorer, the diagram and the details fill the
// whole window. The browser's Fullscreen API on the tab's container where there is one; where there isn't
// (or the browser refuses, as an embedded frame may), a fallback class that lays the container over the
// whole viewport (.mxv.mx-full, model.css). The button or F (Shift+F too) with the focus in the tab goes in
// and out, Esc leaves; `changed` runs after each change once the new size has been laid out, so the
// drawing is fitted to it.

import { h } from '../dom';

export interface FullScreen {
  /** Whether the tab fills the window now. */
  readonly on: boolean;
  /** The bar's button. */
  readonly button: HTMLButtonElement;
  enter(): void;
  exit(): void;
  toggle(): void;
  /** Listens for F / Shift+F in the tab and for Esc (the browser also leaves its own full screen on Esc by itself). */
  keys(): void;
}

const editable = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function fullScreen(root: HTMLElement, changed: () => void): FullScreen {
  /** 'api': the browser's full screen; 'css': the fallback; null: in the page. */
  let mode: 'api' | 'css' | null = null;
  const button = h('button.btn.mx-full-btn', { type: 'button', title: 'Full screen (F)', 'aria-pressed': 'false' }, 'Full screen');

  // Twice: the first frame lays out the new size, the second fits the drawing to it.
  const after = () => requestAnimationFrame(() => requestAnimationFrame(changed));
  const paint = () => {
    const on = mode !== null;
    root.classList.toggle('mx-full', on);
    document.body.classList.toggle('mx-full-open', mode === 'css');
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? 'Exit full screen' : 'Full screen';
    button.title = on ? 'Exit full screen (Esc)' : 'Full screen (F)';
    after();
  };
  const fallback = () => {
    mode = 'css';
    paint();
  };

  const api = {
    get on() {
      return mode !== null;
    },
    button,
    enter() {
      if (mode) return;
      const can = typeof root.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
      if (!can) return fallback();
      mode = 'api';
      paint();
      root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
        // Refused (no user gesture, a frame without allowfullscreen): the fallback covers the window instead.
        if (mode === 'api') fallback();
      });
    },
    exit() {
      if (!mode) return;
      const was = mode;
      mode = null;
      paint();
      if (was === 'api' && document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
    },
    toggle() {
      if (mode) api.exit();
      else api.enter();
    },
    keys() {
      root.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || editable(e.target)) return;
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          api.toggle();
        }
      });
      document.addEventListener('keydown', (e) => {
        // The browser leaves its own full screen on Esc by itself; where it passes the key on, this leaves too.
        if (e.key !== 'Escape' || !mode || e.defaultPrevented) return;
        // A window opened over the tab closes first.
        if (document.querySelector('.backdrop')) return;
        e.preventDefault();
        api.exit();
      });
      // The browser's Esc (or F11, or another element taking the full screen) ends ours.
      document.addEventListener('fullscreenchange', () => {
        if (mode === 'api' && document.fullscreenElement !== root) api.exit();
        // In or out, the new size is laid out only now: fit to it (the page's height too, on the way out).
        after();
      });
    },
  };
  button.addEventListener('click', () => api.toggle());
  return api;
}
