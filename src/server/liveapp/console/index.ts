// Every floor's live app Console (the 🌐 Live app tab's): the runtime log's tail (./tail.ts) and the
// requests through the app's recording proxy (./proxy.ts), told to the people who have it showing.
//
// The proxy runs while the app is up (starting, running, updating) and keeps the last NET_KEEP requests
// in memory, nothing on disk; the log is read only while someone has the Console showing. News goes out
// at most every FLUSH_MS, in one message per person, and only to those watching.

import type { LiveAppState, ServerMsg } from '../../../shared/protocol.js';
import { NET_KEEP, type LiveLogEntry, type LiveNetEntry } from '../../../shared/liveapp/console.js';
import { isUp } from '../machine.js';
import { pickPorts } from '../ports.js';
import { RecordingProxy } from './proxy.js';
import { LogTail } from './tail.js';

const FLUSH_MS = 200;

type Send = (msg: Extract<ServerMsg, { t: 'liveapp.console' }>) => void;

export interface ConsoleDeps {
  /** Where the proxy listens (the office's own bind address). */
  host: string;
  ports: { from: number; to: number };
  /** Ports the live apps hold. */
  taken(): Set<number>;
  /** The floor's runtime log, where its app's checkout is now. */
  logFile(floorId: string): string;
  /** The floor's proxy came or went: the page's state says where it is (viewPort). */
  portChanged(floorId: string): void;
  isFree?: (port: number) => Promise<boolean>;
  statMs?: number;
}

interface FloorConsole {
  subs: Map<object, Send>;
  tail?: LogTail;
  proxy?: RecordingProxy;
  /** A proxy on its way up. */
  opening?: Promise<void>;
  upstream?: number;
  net: LiveNetEntry[];
  out: { log: Map<number, LiveLogEntry>; net: Map<number, LiveNetEntry>; reset?: boolean; missing?: boolean };
  timer?: NodeJS.Timeout;
}

export class LiveConsoles {
  private floors = new Map<string, FloorConsole>();

  constructor(private d: ConsoleDeps) {}

  private of(floorId: string): FloorConsole {
    let f = this.floors.get(floorId);
    if (!f) {
      f = { subs: new Map(), net: [], out: { log: new Map(), net: new Map() } };
      this.floors.set(floorId, f);
    }
    return f;
  }

  /** Ports the proxies hold (no app may take them). */
  ports(): number[] {
    return [...this.floors.values()].flatMap((f) => (f.proxy ? [f.proxy.port] : []));
  }

  /** Where the floor's proxy answers, once it does. */
  portOf(floorId: string): number | undefined {
    return this.floors.get(floorId)?.proxy?.port;
  }

  /** The requests it has, oldest first. */
  requests(floorId: string): LiveNetEntry[] {
    return [...(this.floors.get(floorId)?.net ?? [])];
  }

  /** `key` (a person's connection) has the Console showing, or no longer. */
  watch(floorId: string, key: object, send: Send, on: boolean) {
    if (!on) return this.unwatch(key, floorId);
    for (const [id, f] of this.floors) if (id !== floorId && f.subs.has(key)) this.unwatch(key, id);
    const f = this.of(floorId);
    const first = !f.subs.has(key);
    f.subs.set(key, send);
    const file = this.d.logFile(floorId);
    if (f.tail && f.tail.file !== file) {
      f.tail.stop();
      f.tail = undefined;
    }
    f.tail ??= new LogTail(file, { entries: (list, reset) => this.logNews(floorId, list, reset), missing: (yes) => this.queue(floorId, (o) => (o.missing = yes)) }, { statMs: this.d.statMs });
    if (first) send({ t: 'liveapp.console', floor: floorId, reset: true, log: f.tail.snapshot(), net: [...f.net], logMissing: f.tail.missing });
    f.tail.start();
  }

  /** `key` stopped watching (`floorId`, or everywhere). */
  unwatch(key: object, floorId?: string) {
    for (const [id, f] of this.floors) {
      if (floorId && id !== floorId) continue;
      if (!f.subs.delete(key) || f.subs.size) continue;
      f.tail?.stop();
      clearTimeout(f.timer);
      f.timer = undefined;
      f.out = { log: new Map(), net: new Map() };
    }
  }

  /** The app changed: its proxy comes up with it and goes when it stops; it follows the app's port. */
  sync(s: LiveAppState) {
    const up = isUp(s.status);
    const f = up ? this.of(s.floor) : this.floors.get(s.floor);
    if (!f) return;
    if (s.appPort) f.upstream = s.appPort;
    if (up && !f.proxy && !f.opening) {
      f.opening = this.open(s.floor, f).finally(() => (f.opening = undefined));
    } else if (!up && (f.proxy || f.opening)) {
      f.upstream = undefined;
      void this.close(s.floor, f);
    }
  }

  private async open(floorId: string, f: FloorConsole) {
    const taken = new Set([...this.d.taken(), ...this.ports()]);
    const [port] = (await pickPorts(1, this.d.ports, taken, this.d.isFree)) ?? [];
    if (!port || this.floors.get(floorId) !== f || f.proxy) return;
    const proxy = new RecordingProxy({ host: this.d.host, port, upstream: () => f.upstream, record: (e) => this.record(floorId, f, e) });
    try {
      await proxy.start();
    } catch (err) {
      console.error('agent-office: live app proxy did not start', err);
      return;
    }
    if (this.floors.get(floorId) !== f || f.upstream === undefined) return void proxy.stop();
    f.proxy = proxy;
    this.d.portChanged(floorId);
  }

  private async close(floorId: string, f: FloorConsole) {
    await f.opening;
    const p = f.proxy;
    f.proxy = undefined;
    if (!p) return;
    await p.stop();
    this.d.portChanged(floorId);
  }

  private record(floorId: string, f: FloorConsole, e: LiveNetEntry) {
    let i = -1;
    for (let j = f.net.length - 1; j >= 0 && j >= f.net.length - 200; j--) if (f.net[j].id === e.id) i = j;
    if (i >= 0) f.net[i] = e;
    else f.net.push(e);
    if (f.net.length > NET_KEEP) f.net.splice(0, f.net.length - NET_KEEP);
    if (f.subs.size) this.queue(floorId, (o) => o.net.set(e.id, e));
  }

  private logNews(floorId: string, list: LiveLogEntry[], reset: boolean) {
    this.queue(floorId, (o) => {
      if (reset) {
        o.log.clear();
        o.reset = true;
      }
      for (const e of list) o.log.set(e.id, e);
    });
  }

  private queue(floorId: string, fn: (o: FloorConsole['out']) => void) {
    const f = this.floors.get(floorId);
    if (!f?.subs.size) return;
    fn(f.out);
    if (f.timer) return;
    f.timer = setTimeout(() => this.flush(floorId), FLUSH_MS);
    f.timer.unref?.();
  }

  private flush(floorId: string) {
    const f = this.floors.get(floorId);
    if (!f) return;
    f.timer = undefined;
    const o = f.out;
    f.out = { log: new Map(), net: new Map() };
    // A reset sends what the tail has now, so it carries everything since.
    const log = o.reset ? (f.tail?.snapshot() ?? []) : [...o.log.values()];
    const net = o.reset ? [...f.net] : [...o.net.values()];
    const msg = { t: 'liveapp.console' as const, floor: floorId, ...(o.reset ? { reset: true } : {}), ...(log.length || o.reset ? { log } : {}), ...(net.length || o.reset ? { net } : {}), ...(o.missing !== undefined ? { logMissing: o.missing } : {}) };
    if (!msg.log && !msg.net && msg.logMissing === undefined) return;
    for (const send of f.subs.values()) send(msg);
  }

  /** A deleted project's floor. */
  async forget(floorId: string) {
    const f = this.floors.get(floorId);
    if (!f) return;
    this.floors.delete(floorId);
    f.tail?.stop();
    clearTimeout(f.timer);
    await f.opening;
    await f.proxy?.stop();
  }

  async shutdown() {
    await Promise.all([...this.floors.keys()].map((id) => this.forget(id)));
  }
}
