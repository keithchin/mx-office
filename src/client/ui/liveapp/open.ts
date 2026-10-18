// Open live app, on the 🌐 Live app tab: the running app in a window of its own, top-level, where every
// widget works. Inside the office's page the app is a frame on another origin (its own port), and
// Mendix's pluggable widgets (Data grid 2 and others) read the top window's globals, which a browser
// refuses across origins: those pages fail to load. So the tab no longer embeds it by default; the
// frame (ui/liveapp/viewer.ts) stays as an honest "preview", off unless asked for.
//
// The window opens through the office's recording proxy (server/liveapp/console/proxy.ts), so the
// Console's Network lists what it asks the runtime. It's one named window per project (opening again
// brings the same window to the address), without an opener (the app can't reach back into this page).
// The desktop app opens it as a separate window of its own with a small menu of its own (desktop/src/liveapp.ts).

import { h } from '../dom';
import type { LiveAppState } from '../../../shared/protocol';

export interface OpenPanel {
  readonly el: HTMLElement;
  /** The app runs at `url` (through the proxy when `recorded`). */
  show(url: string, floor: string, recorded: boolean): void;
  hide(): void;
  /** Whether the preview frame is asked for. */
  previewing(): boolean;
  onPreview?: (on: boolean) => void;
}

/**
 * The app's address as a browser on `host` reaches the office's machine, over plain HTTP (mxcli serves no
 * TLS): through the office's recording proxy when it's up (the Console's Network sees the requests),
 * else the runtime's own port.
 */
export const liveUrl = (s: Pick<LiveAppState, 'viewPort' | 'appPort'>, host: string) => (s.viewPort ? `http://${host}:${s.viewPort}/` : s.appPort ? `http://${host}:${s.appPort}/` : '');

/** The window's name: one per project, so Open again goes to the same window. */
export const liveWindowName = (floor: string) => `mxoffice-liveapp-${floor.replace(/[^\w-]/g, '_')}`;

export function openPanel(): OpenPanel {
  const link = h('a.btn.primary.la-go', { target: '_blank', rel: 'noopener', title: 'Open the app in a window of its own, where every widget works' }, '↗ Open live app') as HTMLAnchorElement;
  const copyBtn = h('button.btn', { type: 'button', title: 'Copy the address of the live app' }, 'Copy link') as HTMLButtonElement;
  const previewBtn = h('button.btn', { type: 'button', 'aria-pressed': 'false', title: 'Show the app in a frame here: a preview, where some widgets don’t work' }, 'Preview here') as HTMLButtonElement;
  const note = h('small.la-note', {});
  const said = h('span.la-note', { role: 'status', 'aria-live': 'polite' });
  const warn = h('p.la-note.la-preview-note', { hidden: true }, 'Preview: the app in a frame inside the office’s page. Some widgets don’t work here (Data grid 2 and others that read the top window are refused across origins, so their pages fail to load). Open live app shows it as it really is.');
  const el = h('div.la-openbox', { hidden: true }, h('div.la-openrow', {}, link, copyBtn, previewBtn, said), note, warn);
  let preview = false;
  let url = '';

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      said.textContent = 'Copied';
    } catch {
      said.textContent = url;
    }
    setTimeout(() => (said.textContent = ''), 2000);
  });
  previewBtn.addEventListener('click', () => {
    preview = !preview;
    paint();
    panel.onPreview?.(preview);
  });

  function paint() {
    previewBtn.setAttribute('aria-pressed', String(preview));
    previewBtn.textContent = preview ? 'Hide preview' : 'Preview here';
    warn.hidden = !preview;
  }

  const panel: OpenPanel = {
    el,
    show(u, floor, recorded) {
      url = u;
      el.hidden = false;
      link.href = u;
      link.target = liveWindowName(floor);
      note.textContent = recorded
        ? 'Opens in a window of its own (every widget works there). The Console below lists its requests and the runtime’s log.'
        : 'Opens in a window of its own (every widget works there). Its requests aren’t recorded: the office’s proxy for it isn’t up.';
      paint();
    },
    hide() {
      el.hidden = true;
      url = '';
    },
    previewing: () => preview,
  };
  return panel;
}
