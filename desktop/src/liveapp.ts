// The Live app window: the project's running Mendix app top-level in a window of its own (not a frame
// in the office's page, where Mendix's pluggable widgets can't reach the top window), opened from the
// office's Open live app link (core/liveapp.ts says which links). One window per project; opening again
// brings it to the address.
//
// Its menu is its toolbar: Back, Forward, Reload, Hard reload, Home, Copy address, Open in browser and
// the developer tools. It has a session of its own (partition), so the office's cookies are never in it,
// it's sandboxed without Node, and it stays on the app's origin: other addresses open in the default browser.

import { BrowserWindow, Menu, clipboard, shell, type NativeImage } from 'electron';
import { onOrigin, type LiveWindowRequest } from './core/liveapp.js';

/** The Live app windows' own session: none of the office's cookies or storage. */
export const LIVE_PARTITION = 'persist:mxoffice-liveapp';

const windows = new Map<string, { win: BrowserWindow; home: string; origin: string }>();

/** The open Live app windows (test mode's checks). */
export function liveWindows(): { key: string; url: string; partition: string; win: BrowserWindow }[] {
  return [...windows].map(([key, w]) => ({ key, url: w.win.webContents.getURL(), partition: LIVE_PARTITION, win: w.win }));
}

const PREFS = { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: LIVE_PARTITION } as const;

export function openLiveWindow(req: LiveWindowRequest, o: { icon: NativeImage; test: boolean }): BrowserWindow {
  const had = windows.get(req.key);
  if (had && !had.win.isDestroyed()) {
    had.home = req.url;
    had.origin = req.origin;
    void had.win.loadURL(req.url);
    if (!o.test) {
      if (had.win.isMinimized()) had.win.restore();
      had.win.show();
      had.win.focus();
    }
    return had.win;
  }
  const win = new BrowserWindow({
    ...(o.test ? { x: -5000, y: 0 } : {}),
    width: 1280,
    height: 860,
    show: false,
    title: 'Live app',
    icon: o.icon,
    autoHideMenuBar: false,
    backgroundColor: '#ffffff',
    webPreferences: { ...PREFS },
  });
  const entry = { win, home: req.url, origin: req.origin };
  windows.set(req.key, entry);
  const wc = win.webContents;
  const go = (dir: -1 | 1) => {
    const nav = wc.navigationHistory;
    if (dir < 0 && nav.canGoBack()) nav.goBack();
    if (dir > 0 && nav.canGoForward()) nav.goForward();
  };
  win.setMenu(
    Menu.buildFromTemplate([
      {
        label: 'Navigate',
        submenu: [
          { label: 'Back', accelerator: 'Alt+Left', click: () => go(-1) },
          { label: 'Forward', accelerator: 'Alt+Right', click: () => go(1) },
          { label: 'Reload', accelerator: 'F5', click: () => wc.reload() },
          { label: 'Hard reload', accelerator: 'Shift+F5', click: () => wc.reloadIgnoringCache() },
          { label: 'Home', accelerator: 'Alt+Home', click: () => void wc.loadURL(entry.home) },
          { type: 'separator' },
          { label: 'Copy address', click: () => clipboard.writeText(wc.getURL()) },
          { label: 'Open in browser', click: () => void shell.openExternal(wc.getURL()) },
          { type: 'separator' },
          { label: 'Close', accelerator: 'CmdOrCtrl+W', click: () => win.close() },
        ],
      },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { label: 'Developer tools', accelerator: 'F12', click: () => wc.toggleDevTools() }] },
    ]),
  );
  wc.setWindowOpenHandler(({ url }) => {
    // The app's own pop-ups (a file download, a report) stay with it; anything else is the browser's.
    if (onOrigin(url, entry.origin)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { ...PREFS } } };
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (onOrigin(url, entry.origin)) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
  });
  win.on('page-title-updated', (e, title) => {
    e.preventDefault();
    win.setTitle(title ? `${title} · Live app` : 'Live app');
  });
  win.once('ready-to-show', () => (o.test ? win.showInactive() : win.show()));
  win.on('closed', () => {
    if (windows.get(req.key)?.win === win) windows.delete(req.key);
  });
  void win.loadURL(req.url);
  return win;
}
