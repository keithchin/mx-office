// Show here (core/embed.ts says what and why): the project's live app as a native view inside the office
// window, laid over the Live app tab's placeholder. This is the Electron glue: the bridge's two channels,
// accepted only from the office window's own top frame on the office's address, and the view itself, a
// WebContentsView on the Live app window's session (liveapp.ts: no office cookies, sandboxed, no Node),
// kept on the app's origin. The view goes when the office page navigates, reloads or crashes.

import { ipcMain, WebContentsView, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { EMBED_CHANNEL, EMBED_STATE, EmbedController, type ViewLike } from './core/embed.js';
import { LIVE_PREFS, keepOnOrigin } from './liveapp.js';

export interface EmbedOptions {
  win: BrowserWindow;
  officePort: number;
  /** Whether `url` is the office's own address (main.ts sameOffice). */
  isOffice(url: string): boolean;
  /** The project's recording proxy port, asked of the office with the window's sign-in. */
  viewPortOf(floor: string): Promise<number | undefined>;
}

export function attachEmbed(o: EmbedOptions): EmbedController {
  const { win } = o;
  const wc = win.webContents;
  const ctl = new EmbedController({
    officePort: o.officePort,
    viewPortOf: o.viewPortOf,
    host: {
      add: (v) => win.contentView.addChildView(v as unknown as WebContentsView),
      remove: (v) => win.contentView.removeChildView(v as unknown as WebContentsView),
      zoom: () => wc.getZoomFactor(),
      send: (s) => !wc.isDestroyed() && wc.send(EMBED_STATE, s),
    },
    create({ origin }) {
      const view = new WebContentsView({ webPreferences: { ...LIVE_PREFS } });
      view.setBackgroundColor('#ffffff');
      keepOnOrigin(view.webContents, origin);
      return view as unknown as ViewLike;
    },
  });
  /** Only the office window's own page, on the office's address, drives the view (not its pop-ups, frames or error pages). */
  const fromOffice = (e: IpcMainEvent | IpcMainInvokeEvent) => !win.isDestroyed() && e.sender === wc && !!e.senderFrame && e.senderFrame === wc.mainFrame && o.isOffice(e.senderFrame.url);
  ipcMain.handle(EMBED_CHANNEL, (e, raw: unknown) => (fromOffice(e) ? ctl.handle(raw) : { ok: false, error: 'Refused.' }));
  ipcMain.on(EMBED_CHANNEL, (e, raw: unknown) => {
    if (fromOffice(e)) void ctl.handle(raw);
  });
  // The office page went (another page, a reload, a sign-in) or crashed: the view goes with it.
  wc.on('did-navigate', () => ctl.close(false));
  wc.on('render-process-gone', () => ctl.close(false));
  win.on('closed', () => ctl.close(false));
  return ctl;
}
