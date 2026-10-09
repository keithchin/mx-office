import { createHash, randomBytes } from 'node:crypto';
import { spawn as spawnProcess } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnOff, type OffChild } from './offloop/exec.js';
import type { IPty } from '@lydell/node-pty';
import { spawnLocal } from './ptylocal.js';

/**
 * Workers' terminals live in a small host process of their own (ptyhost.ts), not in the office.
 *
 * On Unix the host is detached and outlives the office: when the office restarts (a dev-server reload,
 * a self-upgrade), Claude keeps working in the host, and the new office picks every terminal back up
 * where it was.
 *
 * On Windows the host is tied to the office instead: it's there so that node-pty's native calls run
 * outside the office's event loop. Starting a terminal runs CreateProcess on the calling thread, and a
 * 256 MB claude.exe under the virus scanner holds it 0.65–2.6 s, every time a worker starts (the live
 * office stalled 2.6 s twice after a safe restart woke six agents, 2026-10-08). The host ends every
 * terminal and exits as soon as its office is gone (its pipe closes, or its process does), and its
 * terminals end with it if it dies itself (closing a pseudo console ends what runs in it), so nothing
 * outlives the office: a restart wakes its workers as before. If the host dies under a running office,
 * its workers resume in a fresh one (onClose, revive).
 *
 * Without a host (it couldn't be had, or AGENT_OFFICE_PTY_HOST=off), terminals run in-process as
 * before and die with the office.
 */

const WIN = process.platform === 'win32';
/** A Windows host that dies more often than this this soon (a crash loop) isn't started again: terminals run in-process from then on. */
const REVIVE_LIMIT = 3;
const REVIVE_WINDOW_MS = 10 * 60_000;

/** This office's Windows hosts (one per floor), for a terminal that isn't a worker's. */
const tiedHosts = new Set<PtyHost>();

/** A terminal that isn't a worker's (Claude Code's sign-in): in a host when there is one (Windows), else here. */
export function spawnTerminal(opts: SpawnOpts): Pty {
  for (const h of tiedHosts) if (h.hosted) return h.spawn(opts);
  return spawnLocal(opts);
}

/** Bump whenever the host's messages change: an office that finds an older host stops it and starts its own. */
export const PTY_PROTOCOL = 1;
export const SCROLLBACK = 3000;

export interface SpawnOpts {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  /** Output from before this process (a restored scrollback), for the host's copy of the screen. */
  prelude?: string;
}

export interface PtyExit {
  exitCode: number;
  /** It never started. */
  error?: string;
  /** The host went away under it; the process is gone. */
  lost?: boolean;
}

/** A worker's terminal process, wherever it runs. */
export interface Pty {
  /** Its session in the host, which outlives the office. None: it dies with the office. */
  readonly id?: string;
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: PtyExit) => void): void;
}

/** A terminal the host was still running when the office came back. */
export interface Adopted {
  pty: Pty;
  cols: number;
  rows: number;
  /** Claude's last OSC 9;4 progress report. */
  busy: boolean;
  title: string;
  /** Scrollback and screen, to replay into a fresh terminal. */
  snapshot: string;
}

export type ToHost =
  | { t: 'hello'; token: string }
  | { t: 'spawn'; id: string; opts: SpawnOpts }
  | { t: 'attach'; id: string }
  | { t: 'write'; id: string; data: string }
  | { t: 'resize'; id: string; cols: number; rows: number }
  | { t: 'kill'; id: string }
  | { t: 'stop' };

export type FromHost =
  | { t: 'ready'; version: number; sessions: string[] }
  /** Said again when the pid changes (on Windows it's only known once the process is up). */
  | { t: 'spawned'; id: string; pid: number }
  | ({ t: 'attached'; id: string; pid: number } & Omit<Adopted, 'pty'>)
  | { t: 'gone'; id: string }
  | { t: 'data'; id: string; data: string }
  | { t: 'exit'; id: string; exitCode: number; error?: string };

/** Calls `onMsg` with each newline-delimited JSON message on the socket. */
export function readMessages(sock: net.Socket, onMsg: (msg: any) => void) {
  sock.setEncoding('utf8');
  let buf = '';
  sock.on('data', (chunk: string) => {
    buf += chunk;
    let start = 0;
    let nl: number;
    while ((nl = buf.indexOf('\n', start)) >= 0) {
      const line = buf.slice(start, nl);
      start = nl + 1;
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      onMsg(msg);
    }
    buf = buf.slice(start);
  });
}

class RemotePty implements Pty {
  pid = 0;
  private dataCbs: ((data: string) => void)[] = [];
  private exitCbs: ((e: PtyExit) => void)[] = [];
  /** Output that came in before anyone listened (between an attach and the worker wiring up). */
  private held: string[] = [];
  private exited?: PtyExit;

  /** Its session in the host, by which the next office adopts it: only from a host that outlives the office. */
  readonly id?: string;

  constructor(
    readonly key: string,
    private send: (msg: ToHost) => void,
    durable: boolean,
  ) {
    if (durable) this.id = key;
  }

  write(data: string) {
    this.send({ t: 'write', id: this.key, data });
  }

  resize(cols: number, rows: number) {
    this.send({ t: 'resize', id: this.key, cols, rows });
  }

  kill() {
    this.send({ t: 'kill', id: this.key });
  }

  onData(cb: (data: string) => void) {
    this.dataCbs.push(cb);
    for (const d of this.held.splice(0)) cb(d);
  }

  onExit(cb: (e: PtyExit) => void) {
    this.exitCbs.push(cb);
    if (this.exited) cb(this.exited);
  }

  emitData(data: string) {
    if (!this.dataCbs.length) this.held.push(data);
    for (const cb of this.dataCbs) cb(data);
  }

  emitExit(e: PtyExit) {
    this.exited = e;
    for (const cb of this.exitCbs) cb(e);
  }
}

export class PtyHost {
  private sock: net.Socket | null = null;
  private ptys = new Map<string, RemotePty>();
  private attaching = new Map<string, (msg: FromHost | undefined) => void>();
  /** Sessions the host already had when the office connected, not yet claimed by a worker. */
  private unclaimed = new Set<string>();
  /** Leaving on purpose: the connection closing is not the host dying. */
  private leaving = false;
  private socketPath: string;
  private infoPath: string;
  /** A Windows host is being started (at first, or again): what's asked of it waits in `queue` (send). */
  private starting?: Promise<boolean>;
  private queue: ToHost[] = [];
  /** Terminals that waited for a host that never came, run here instead (fallBack). */
  private locals = new Map<string, IPty>();
  /** When the host died under this office (REVIVE_LIMIT). */
  private losses: number[] = [];

  constructor(
    private dataDir: string,
    private onLost: () => void,
  ) {
    this.infoPath = path.join(dataDir, 'pty-host.json');
    // Unix socket paths are capped at ~104 bytes; a deep project falls back to the temp dir.
    const inData = path.join(dataDir, 'pty.sock');
    const hash = createHash('sha256').update(dataDir).digest('hex').slice(0, 16);
    this.socketPath = Buffer.byteLength(inData) < 100 ? inData : path.join(os.tmpdir(), `agent-office-${hash}.sock`);
  }

  get hosted(): boolean {
    return this.sock !== null;
  }

  /**
   * Finds the host this office left running, or starts one. Resolves to false when there is no
   * host to be had: terminals then run in-process.
   */
  async connect(): Promise<boolean> {
    if (process.env.AGENT_OFFICE_PTY_HOST === 'off') return false;
    if (WIN) return this.startTied();
    try {
      let found = await this.hello();
      if (found && found.version !== PTY_PROTOCOL) {
        // A host from an older build: its terminals go (workers resume their conversations).
        await new Promise<void>((resolve) => {
          found!.sock.once('close', () => resolve());
          found!.sock.end(frame({ t: 'stop' }));
          setTimeout(resolve, 5000);
        });
        found = undefined;
      }
      if (!found) {
        this.startHost();
        const deadline = Date.now() + 10_000;
        while (!found && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
          found = await this.hello();
        }
      }
      if (!found) return false;
      this.take(found);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Windows: starts a host and, until it answers, keeps what's asked of it (a worker hired or woken
   * meanwhile) for it. If it never answers, those terminals run here after all (fallBack).
   */
  private startTied(): Promise<boolean> {
    const starting = this.connectTied().catch(() => false);
    this.starting = starting;
    void starting.then((ok) => {
      if (this.starting === starting) this.starting = undefined;
      if (!ok) this.fallBack();
    });
    return starting;
  }

  /** No host came: what waited for one runs here, in order. */
  private fallBack() {
    for (const m of this.queue.splice(0)) {
      if (m.t === 'spawn') {
        const p = this.ptys.get(m.id);
        if (!p) continue;
        this.ptys.delete(m.id);
        try {
          const local = spawnLocal(m.opts);
          this.locals.set(m.id, local);
          local.onData((d) => p.emitData(d));
          local.onExit(({ exitCode }) => {
            this.locals.delete(m.id);
            p.pid = local.pid;
            p.emitExit({ exitCode });
          });
          p.pid = local.pid;
        } catch (err) {
          p.emitExit({ exitCode: -1, error: (err as Error).message });
        }
      } else if (m.t === 'write' || m.t === 'resize' || m.t === 'kill') this.toLocal(m);
    }
  }

  private toLocal(m: Extract<ToHost, { t: 'write' | 'resize' | 'kill' }>) {
    const local = this.locals.get(m.id);
    try {
      if (m.t === 'write') local?.write(m.data);
      else if (m.t === 'resize') local?.resize(m.cols, m.rows);
      else local?.kill();
    } catch {
      // it has exited
    }
  }

  /**
   * Windows: starts this office's own host on a pipe nobody else knows, and connects to it. It never
   * outlives this process, so there's no earlier one to find.
   */
  private async connectTied(): Promise<boolean> {
    const hash = createHash('sha256').update(this.dataDir).digest('hex').slice(0, 12);
    this.socketPath = `\\\\.\\pipe\\agent-office-ptys-${hash}-${process.pid}-${randomBytes(4).toString('hex')}`;
    let exited = false;
    const child = this.startHost(true);
    child?.on('close', () => (exited = true));
    child?.on('error', () => (exited = true));
    let found: Awaited<ReturnType<PtyHost['hello']>>;
    const deadline = Date.now() + 15_000;
    while (!found && !exited && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      found = await this.hello();
    }
    if (!found) {
      child?.kill();
      return false;
    }
    this.take(found);
    return true;
  }

  private take({ sock, sessions }: { sock: net.Socket; sessions: string[] }) {
    // The office stopped while this host was starting (again): it has nothing to do.
    if (this.leaving) {
      sock.end(frame({ t: 'stop' }));
      return;
    }
    this.sock = sock;
    this.unclaimed = new Set(sessions);
    if (WIN) tiedHosts.add(this);
    readMessages(sock, (msg) => this.onMessage(msg as FromHost));
    sock.on('close', () => this.onClose(sock));
    // What was asked of it while it was being started again, in order.
    for (const m of this.queue.splice(0)) this.send(m);
  }

  /** A new terminal: in the host when there is one, else in-process. Throws if it can't start. */
  spawn(opts: SpawnOpts): Pty {
    if (!this.sock && !this.starting) return spawnLocal(opts);
    const id = randomBytes(8).toString('hex');
    // A Windows host's terminals end with the office: nothing for the next one to adopt.
    const p = new RemotePty(id, (m) => this.send(m), !WIN);
    this.ptys.set(id, p);
    this.send({ t: 'spawn', id, opts });
    return p;
  }

  /** Picks up a terminal from before the restart. Undefined if the host no longer has it running. */
  async attach(id: string): Promise<Adopted | undefined> {
    if (!this.sock || !this.unclaimed.delete(id)) return undefined;
    const p = new RemotePty(id, (m) => this.send(m), true);
    this.ptys.set(id, p);
    const msg = await new Promise<FromHost | undefined>((resolve) => {
      // The office waits on this before it opens its doors: never for long.
      const timer = setTimeout(() => {
        this.attaching.delete(id);
        resolve(undefined);
      }, 5000);
      this.attaching.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      this.send({ t: 'attach', id });
    });
    if (msg?.t !== 'attached') {
      this.ptys.delete(id);
      // Its worker resumes the conversation afresh; the old process mustn't carry on beside it.
      this.send({ t: 'kill', id });
      return undefined;
    }
    p.pid = msg.pid;
    return { pty: p, cols: msg.cols, rows: msg.rows, busy: msg.busy, title: msg.title, snapshot: msg.snapshot };
  }

  /** Ends the host's terminals that no worker claimed (their worker was sent home meanwhile). */
  killUnclaimed() {
    for (const id of this.unclaimed) this.send({ t: 'kill', id });
    this.unclaimed.clear();
  }

  /** The office is restarting: leave every terminal running in the host for the next one (a Windows host, tied to this office, stops). */
  detach() {
    if (WIN) return this.stop();
    this.leaving = true;
    this.sock?.end();
  }

  /** The office is closing for good: the host ends every terminal and exits. */
  stop() {
    this.leaving = true;
    this.queue = [];
    tiedHosts.delete(this);
    this.sock?.end(frame({ t: 'stop' }));
  }

  private send(msg: ToHost) {
    if ((msg.t === 'write' || msg.t === 'resize' || msg.t === 'kill') && this.locals.has(msg.id)) this.toLocal(msg);
    else if (this.sock && !this.sock.destroyed) this.sock.write(frame(msg));
    else if (this.starting && !this.leaving) this.queue.push(msg);
  }

  private onMessage(msg: FromHost) {
    switch (msg.t) {
      case 'spawned': {
        const p = this.ptys.get(msg.id);
        if (p) p.pid = msg.pid ?? 0;
        break;
      }
      case 'attached':
      case 'gone':
        this.attaching.get(msg.id)?.(msg);
        this.attaching.delete(msg.id);
        break;
      case 'data':
        this.ptys.get(msg.id)?.emitData(msg.data);
        break;
      case 'exit': {
        const p = this.ptys.get(msg.id);
        this.ptys.delete(msg.id);
        p?.emitExit({ exitCode: msg.exitCode, error: msg.error });
        break;
      }
    }
  }

  private onClose(sock: net.Socket) {
    if (this.sock !== sock) return;
    this.sock = null;
    for (const resolve of this.attaching.values()) resolve(undefined);
    this.attaching.clear();
    if (this.leaving) return;
    // The host died (killed, crashed), and its terminals with it. On Unix terminals run in-process from
    // here on; on Windows a fresh host is started for them (the workers resume there), unless it keeps dying.
    const lost = [...this.ptys.values()];
    this.ptys.clear();
    if (WIN) this.revive();
    this.onLost();
    for (const p of lost) p.emitExit({ exitCode: -1, lost: true });
  }

  /** Starts a fresh Windows host after the last one died; what's asked of it meanwhile waits (send). */
  private revive() {
    const now = Date.now();
    this.losses = [...this.losses.filter((t) => now - t < REVIVE_WINDOW_MS), now];
    if (this.losses.length > REVIVE_LIMIT) {
      console.warn(`agent-office: the workers' terminal host died ${this.losses.length} times in ${REVIVE_WINDOW_MS / 60_000} minutes; terminals run in the office from now on`);
      return;
    }
    void this.startTied();
  }

  /** Connects and says hello with the saved token. Undefined if no host answers. */
  private hello(): Promise<{ sock: net.Socket; version: number; sessions: string[] } | undefined> {
    let token: string;
    try {
      token = JSON.parse(readFileSync(this.infoPath, 'utf8')).token;
    } catch {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      const sock = net.createConnection(this.socketPath);
      let settled = false;
      const done = (v?: { sock: net.Socket; version: number; sessions: string[] }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.removeAllListeners('data');
        if (!v) sock.destroy();
        resolve(v);
      };
      const timer = setTimeout(() => done(), 3000);
      sock.on('error', () => done());
      sock.on('close', () => done());
      sock.on('connect', () => sock.write(frame({ t: 'hello', token })));
      readMessages(sock, (msg: FromHost) => {
        if (msg.t === 'ready') done({ sock, version: msg.version, sessions: Array.isArray(msg.sessions) ? msg.sessions : [] });
      });
    });
  }


  /**
   * Starts a host, detached so that it never sees this process's Ctrl+C. On Unix it outlives this
   * process. `tied` (Windows), it's told this process's pid and ends with it, and it's started from a
   * worker thread (offloop/exec.ts), so the office's event loop isn't held while Windows starts it.
   */
  private startHost(tied = false): OffChild | undefined {
    writeFileSync(this.infoPath, JSON.stringify({ token: randomBytes(24).toString('hex') }), { mode: 0o600 });
    const here = fileURLToPath(import.meta.url);
    // Under tsx this is ptyhost.ts, run with the same loader flags; built, it's ptyhost.js.
    const script = path.join(path.dirname(here), `ptyhost${path.extname(here)}`);
    // A relative path in them (`--import ./x.ts`) is from where the office started, not the host's cwd.
    const flags = process.execArgv.filter((a) => !/^--(inspect|debug)/.test(a)).map((a) => a.replace(/^(--[\w-]+=)?(\.\.?\/.*)$/, (_, flag = '', p) => `${flag}${path.resolve(p)}`));
    const logPath = path.join(this.dataDir, 'pty-host.log');
    // Where the office's own code is, so a loader flag (`--import tsx`) resolves from its
    // node_modules and not from whichever project this floor is.
    const cwd = path.dirname(here);
    // It writes its own log: the pipes spawnOff gives it go unread. Detached it has no console, so nothing it starts
    // may want one (windowsHide here, and hidewindows.ts in the host for what node-pty starts).
    if (tied) return spawnOff(process.execPath, [...flags, script, this.socketPath, this.infoPath, String(process.pid), logPath], { detached: true, cwd, windowsHide: true });
    const log = openSync(logPath, 'w', 0o600);
    try {
      const child = spawnProcess(process.execPath, [...flags, script, this.socketPath, this.infoPath], {
        detached: true,
        stdio: ['ignore', 'ignore', log],
        cwd,
      });
      child.unref();
    } finally {
      closeSync(log);
    }
    return undefined;
  }
}

function frame(msg: ToHost): string {
  return `${JSON.stringify(msg)}\n`;
}
