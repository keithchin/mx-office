// "Show here" on the office's 🌐 Live app tab, in the desktop app: the project's running app top-level in
// a native view (Electron's WebContentsView) laid over the tab's viewer area, so window.top is the app
// itself and Mendix's pluggable widgets work (in the office's cross-origin frame they don't). The office
// page draws an empty placeholder and tells the app, over the preload's small bridge (desktop/src/preload.cts),
// where it is; this file says which messages count, where the view goes, and keeps one view per office
// window in step (EmbedController). No Electron here: desktop/src/embed.ts hands in the real views.
//
// Every message is checked: its shape, the project's name, and that the address is exactly that project's
// recording proxy (viewPort, asked of the office with the window's own sign-in), plain HTTP on this
// machine and never the office's port. The view has the Live app window's own session (no office cookies),
// is sandboxed without Node, stays on the proxy's origin (other links open in the default browser) and
// opens its developer tools only when asked.

/** The bridge's channels: requests from the office page, and the view's state back to it. */
export const EMBED_CHANNEL = 'mxoffice:embed';
export const EMBED_STATE = 'mxoffice:embed-state';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type EmbedMsg =
  | { op: 'show'; floor: string; url: string }
  /** Where the placeholder is (CSS px of the office page), the part of the page that shows (clip), and the app's own zoom (a device width fitted in). */
  | { op: 'bounds'; rect: Rect; clip: Rect; zoom: number }
  | { op: 'hide' }
  | { op: 'close' }
  | { op: 'navigate'; path: string }
  | { op: 'back' }
  | { op: 'forward' }
  | { op: 'reload'; hard: boolean }
  | { op: 'home' }
  | { op: 'devtools' };

/** What the office page is told after every navigation: the toolbar's address, Back and Forward. */
export interface EmbedState {
  floor: string;
  url: string;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
  title: string;
  visible: boolean;
}

export interface EmbedAnswer {
  ok: boolean;
  error?: string;
}

const FLOOR = /^[\w.-]{1,160}$/;
const LIMIT = 100_000;
const LOCAL = new Set(['localhost', '127.0.0.1']);
/** Below this (DIP, either way) the view is hidden rather than squeezed: the placeholder is scrolled almost out. */
export const MIN_VISIBLE = 40;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function rectOf(v: unknown): Rect | undefined {
  if (!isObj(v)) return undefined;
  const { x, y, width, height } = v;
  if (!num(x, -LIMIT, LIMIT) || !num(y, -LIMIT, LIMIT) || !num(width, 0, LIMIT) || !num(height, 0, LIMIT)) return undefined;
  return { x, y, width, height };
}

/** A message from the office page as it may be acted on, or undefined (anything else is dropped). */
export function parseEmbedMsg(raw: unknown): EmbedMsg | undefined {
  if (!isObj(raw) || typeof raw.op !== 'string') return undefined;
  switch (raw.op) {
    case 'show':
      return typeof raw.floor === 'string' && FLOOR.test(raw.floor) && typeof raw.url === 'string' && raw.url.length <= 2048 ? { op: 'show', floor: raw.floor, url: raw.url } : undefined;
    case 'bounds': {
      const rect = rectOf(raw.rect);
      const clip = rectOf(raw.clip);
      const zoom = raw.zoom === undefined ? 1 : raw.zoom;
      return rect && clip && num(zoom, 0.25, 5) ? { op: 'bounds', rect, clip, zoom } : undefined;
    }
    case 'navigate':
      return typeof raw.path === 'string' && raw.path.length <= 2048 ? { op: 'navigate', path: raw.path } : undefined;
    case 'reload':
      return { op: 'reload', hard: raw.hard === true };
    case 'hide':
    case 'close':
    case 'back':
    case 'forward':
    case 'home':
    case 'devtools':
      return { op: raw.op };
    default:
      return undefined;
  }
}

/**
 * The address the view may open for a project whose recording proxy listens on `viewPort`: plain HTTP on
 * this machine, exactly that port (never the office's); its origin locks the view. Undefined otherwise.
 */
export function showTarget(url: string, viewPort: number | undefined, officePort: number): { url: string; origin: string; home: string } | undefined {
  if (!viewPort || viewPort === officePort) return undefined;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' || !LOCAL.has(u.hostname) || u.port !== String(viewPort) || u.username || u.password) return undefined;
  return { url: u.toString(), origin: u.origin, home: `${u.origin}/` };
}

/** Where the address field's text goes on the app's `origin` (a path, or a full address on it); undefined for anywhere else. */
export function navTarget(input: string, origin: string): string | undefined {
  const text = input.trim() || '/';
  let u: URL;
  try {
    u = /^[a-z][a-z0-9+.-]*:/i.test(text) ? new URL(text) : new URL(text.startsWith('/') || text.startsWith('?') || text.startsWith('#') ? text : `/${text}`, `${origin}/`);
  } catch {
    return undefined;
  }
  return u.origin === origin && u.protocol === 'http:' ? u.toString() : undefined;
}

/** The overlap of two rectangles (empty: zero size). */
export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const btm = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, r - x), height: Math.max(0, btm - y) };
}

/**
 * The view's bounds in the window (DIP) for a placeholder at `rect` of which `clip` shows, on a page
 * zoomed by `zoom` (the office window's zoom factor: CSS px × zoom = DIP). Native views sit above the
 * page, so the view covers only the part that shows; undefined when too little does (then it's hidden).
 */
export function placement(rect: Rect, clip: Rect, zoom: number): Rect | undefined {
  const v = intersect(rect, clip);
  const x = Math.round(v.x * zoom);
  const y = Math.round(v.y * zoom);
  const width = Math.round((v.x + v.width) * zoom) - x;
  const height = Math.round((v.y + v.height) * zoom) - y;
  if (width < MIN_VISIBLE || height < MIN_VISIBLE) return undefined;
  return { x, y, width, height };
}

// ---- the view, kept in step

/** The bits of Electron's WebContents the controller uses (a fake in the tests). */
export interface WebContentsLike {
  loadURL(url: string): Promise<unknown>;
  getURL(): string;
  getTitle(): string;
  isLoading(): boolean;
  reload(): void;
  reloadIgnoringCache(): void;
  setZoomFactor(f: number): void;
  navigationHistory: { canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void };
  openDevTools(o?: { mode: 'detach' | 'right' | 'bottom' | 'undocked' }): void;
  close(): void;
  isDestroyed(): boolean;
  on(event: string, fn: (...a: unknown[]) => void): unknown;
}

/** A WebContentsView's bits. */
export interface ViewLike {
  readonly webContents: WebContentsLike;
  setBounds(r: Rect): void;
  setVisible(on: boolean): void;
}

/** The office window, as the view's host. */
export interface HostLike {
  add(v: ViewLike): void;
  remove(v: ViewLike): void;
  /** The office page's zoom factor. */
  zoom(): number;
  /** Tells the office page how the view is (null: it's gone). */
  send(state: EmbedState | null): void;
}

export interface EmbedDeps {
  host: HostLike;
  /** A new view on the live session, its navigation kept to `origin()` (desktop/src/embed.ts). */
  create(o: { origin: () => string }): ViewLike;
  /** The project's recording proxy port, as the office says (undefined: not running, no proxy, or no such project). */
  viewPortOf(floor: string): Promise<number | undefined>;
  officePort: number;
}

interface Current {
  floor: string;
  origin: string;
  home: string;
  view: ViewLike;
  visible: boolean;
  bounds?: Rect;
  zoom: number;
}

const NAV_EVENTS = ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'page-title-updated'];

export class EmbedController {
  private cur: Current | undefined;
  /** Bumped by every show and close: a show still asking the office when another came is dropped. */
  private gen = 0;

  constructor(private d: EmbedDeps) {}

  /** One message from the office page (already known to come from the office window's own page). */
  async handle(raw: unknown): Promise<EmbedAnswer> {
    const m = parseEmbedMsg(raw);
    if (!m) return { ok: false, error: 'Not a message the desktop app takes.' };
    if (m.op === 'show') return this.show(m.floor, m.url);
    if (m.op === 'close') {
      this.close();
      return { ok: true };
    }
    const c = this.cur;
    if (!c || c.view.webContents.isDestroyed()) return { ok: false, error: 'Nothing is shown.' };
    const wc = c.view.webContents;
    switch (m.op) {
      case 'bounds': {
        const officeZoom = this.d.host.zoom();
        const at = placement(m.rect, m.clip, officeZoom);
        // The app follows the office's zoom, times its own for a device width fitted in.
        const zoom = Math.round(m.zoom * officeZoom * 1000) / 1000;
        if (zoom !== c.zoom) {
          c.zoom = zoom;
          wc.setZoomFactor(zoom);
        }
        if (at) {
          c.bounds = at;
          c.view.setBounds(at);
        }
        this.setVisible(c, !!at);
        break;
      }
      case 'hide':
        this.setVisible(c, false);
        break;
      case 'navigate': {
        const to = navTarget(m.path, c.origin);
        if (!to) return { ok: false, error: 'Only pages of this app open here.' };
        void wc.loadURL(to).catch(() => undefined);
        break;
      }
      case 'home':
        void wc.loadURL(c.home).catch(() => undefined);
        break;
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        break;
      case 'forward':
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
        break;
      case 'reload':
        if (m.hard) wc.reloadIgnoringCache();
        else wc.reload();
        break;
      case 'devtools':
        wc.openDevTools({ mode: 'detach' });
        break;
    }
    return { ok: true };
  }

  private async show(floor: string, url: string): Promise<EmbedAnswer> {
    const gen = ++this.gen;
    const port = await this.d.viewPortOf(floor).catch(() => undefined);
    if (gen !== this.gen) return { ok: false, error: 'Superseded.' };
    const t = showTarget(url, port, this.d.officePort);
    if (!t) return { ok: false, error: port ? "That isn't this project's live app address." : "The project's live app isn't running through the office's proxy." };
    const c = this.cur;
    if (c && c.floor === floor && c.origin === t.origin && !c.view.webContents.isDestroyed()) {
      // Shown again (another draw, the tab back): it stays where it is; a new home is only remembered.
      c.home = t.home;
      if (!c.view.webContents.getURL()) void c.view.webContents.loadURL(t.url).catch(() => undefined);
      this.emit();
      return { ok: true };
    }
    this.close(false);
    const entry: Current = { floor, origin: t.origin, home: t.home, view: undefined as unknown as ViewLike, visible: false, zoom: 1 };
    const view = this.d.create({ origin: () => entry.origin });
    entry.view = view;
    view.setVisible(false);
    this.d.host.add(view);
    this.cur = entry;
    for (const ev of NAV_EVENTS) view.webContents.on(ev, () => this.cur === entry && this.emit());
    void view.webContents.loadURL(t.url).catch(() => undefined);
    this.emit();
    return { ok: true };
  }

  private setVisible(c: Current, on: boolean) {
    if (c.visible === on) return;
    c.visible = on;
    c.view.setVisible(on);
    this.emit();
  }

  private emit() {
    const c = this.cur;
    if (!c || c.view.webContents.isDestroyed()) return;
    const wc = c.view.webContents;
    this.d.host.send({ floor: c.floor, url: wc.getURL(), canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward(), loading: wc.isLoading(), title: wc.getTitle(), visible: c.visible });
  }

  /** The view goes: another project, the office page left or reloaded, the window gone. */
  close(tell = true) {
    this.gen++;
    const c = this.cur;
    if (!c) return;
    this.cur = undefined;
    try {
      c.view.setVisible(false);
      this.d.host.remove(c.view);
    } catch {
      // the window went first
    }
    if (!c.view.webContents.isDestroyed()) c.view.webContents.close();
    if (tell) this.d.host.send(null);
  }

  /** How it is now (test mode's checks). */
  info(): { floor: string; origin: string; url: string; visible: boolean; bounds?: Rect; zoom: number } | undefined {
    const c = this.cur;
    return c && { floor: c.floor, origin: c.origin, url: c.view.webContents.isDestroyed() ? '' : c.view.webContents.getURL(), visible: c.visible, bounds: c.bounds, zoom: c.zoom };
  }

  /** The view itself (test mode's checks). */
  view(): ViewLike | undefined {
    return this.cur?.view;
  }
}
