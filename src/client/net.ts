import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { lastFloor, store, type Profile } from './state';
import { isReturnPage } from '../shared/home';
import { OFFICE_CLOSE } from '../shared/office-down';

type Handler = (msg: ServerMsg) => void;

/** The sign-in page, coming back to the home page, the 1D or 2D view afterwards if that's where you are (see login.ts). */
export function loginUrl(): string {
  return isReturnPage(location.pathname) ? `/login?next=${location.pathname}` : '/login';
}

export class Net {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private statusHandlers: ((up: boolean) => void)[] = [];
  private sendHandlers: ((msg: ClientMsg) => void)[] = [];
  private retry = 0;
  private closedByUs = false;
  /** The server is restarting on purpose: retry every second instead of backing off. */
  private restartExpected = false;
  up = false;
  /** The close code of the connection that last went, and the reconnects that failed since (ui/loading/office-down.ts reads them). */
  closeCode: number | undefined;
  failures = 0;

  constructor(private profile: () => Profile) {}

  onMessage(h: Handler) {
    this.handlers.push(h);
  }

  onStatus(h: (up: boolean) => void) {
    this.statusHandlers.push(h);
  }

  /** Hears every message this page sends (the floor's loading overlay sees a floor.go start, ui/loading/). */
  onSend(h: (msg: ClientMsg) => void) {
    this.sendHandlers.push(h);
  }

  connect() {
    const { name, color, look } = this.profile();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({ name, color, skin: String(look.skin), hair: String(look.hair), style: String(look.style) });
    // Back to the floor you were on (after a reload or a restart). Every page is in the office without
    // standing anywhere in it (see PeerInfo.lite).
    const floor = store.floor ?? lastFloor();
    if (floor) q.set('floor', floor);
    q.set('lite', '1');
    const ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.failures = 0;
      this.closeCode = undefined;
      this.up = true;
      this.statusHandlers.forEach((h) => h(true));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = async (ev) => {
      if (this.ws !== ws) return;
      // The first close says why (the office's own code as it shuts down); a failed reconnect after it only counts.
      if (this.up) this.closeCode = ev.code;
      else this.failures++;
      // The office said it's restarting: try every second, as for an upgrade.
      if (ev.code === OFFICE_CLOSE.restarting) this.restartExpected = true;
      this.up = false;
      this.statusHandlers.forEach((h) => h(false));
      if (this.closedByUs) return;
      // Session expired? Go back to the door.
      try {
        const res = await fetch('/api/whoami', { cache: 'no-store' });
        if (res.status === 401) {
          location.href = loginUrl();
          return;
        }
      } catch {
        // offline; keep retrying
      }
      const delay = this.restartExpected ? 1000 : Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  expectRestart() {
    this.restartExpected = true;
  }

  /** The office said it was restarting (an upgrade, or the close code a restart sends). */
  get restarting(): boolean {
    return this.restartExpected;
  }

  send(msg: ClientMsg) {
    for (const h of this.sendHandlers) h(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
