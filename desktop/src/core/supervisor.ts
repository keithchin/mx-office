// The office as the app's child: started with the system Node, watched, restarted, stopped. It is the
// launcher's loop (scripts/start-office.ps1) as a state machine: an exit with code 75 (🔁 Restart safely,
// or the app's "Restart now") starts it again; any other exit the app didn't ask for is a crash, with the
// last lines of its log. Stopping asks the office over its IPC channel (server/desktop/ipc.ts: what Ctrl+C
// does in a terminal) and only kills it, with everything it started, when it doesn't go in time. Pure of
// Electron and of real processes: the spawn, the health wait and the kill are handed in.

import { EventEmitter } from 'node:events';
import type { Health, WaitResult } from './health.js';

export const RESTART_EXIT_CODE = 75;

/** What the supervisor needs of a child process (node's ChildProcess has all of it). */
export interface ChildLike {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly connected?: boolean;
  send?(msg: unknown): boolean;
  on(ev: 'exit', fn: (code: number | null, signal: string | null) => void): unknown;
  on(ev: 'message', fn: (msg: unknown) => void): unknown;
  on(ev: 'error', fn: (err: Error) => void): unknown;
}

export interface SupervisorDeps {
  spawn(): ChildLike;
  /** Waits for the office this child is to answer (gone: the child exited first). */
  waitHealthy(child: ChildLike, accept?: (h: Health) => boolean): Promise<WaitResult>;
  /** Stops the child and everything it started, now. */
  killTree(child: ChildLike): void;
  /** The last lines of the office's log. */
  logTail(): string;
  /** How long a stop may take before the child is killed (default 20 s). */
  stopTimeoutMs?: number;
  /** At most this many restarts in RESTART_WINDOW_MS before it counts as a crash loop (default 5). */
  maxRestarts?: number;
  now?: () => number;
}

export type SupervisorState = 'idle' | 'starting' | 'running' | 'restarting' | 'stopping' | 'stopped' | 'crashed';

export interface CrashInfo {
  code: number | null;
  signal: string | null;
  /** Why, in a line: "exited with code 1", "didn't answer within 90 s", "restarted 6 times in 2 minutes". */
  why: string;
  tail: string;
}

export const RESTART_WINDOW_MS = 2 * 60_000;

/**
 * Events: 'state' (state), 'ready' (health, {restarted, signIn}), 'crashed' (CrashInfo), 'signin' (path).
 */
export class OfficeSupervisor extends EventEmitter {
  state: SupervisorState = 'idle';
  health?: Health;
  /** The sign-in link the office sent with its last 'ready' note. */
  signIn?: string;
  private child?: ChildLike;
  private stopWaiters: (() => void)[] = [];
  private restarts: number[] = [];
  private starting?: Promise<Health | undefined>;

  constructor(private readonly deps: SupervisorDeps) {
    super();
  }

  private set(s: SupervisorState) {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', s);
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** Whether the office is the app's own child and still there. */
  get owned(): boolean {
    return !!this.child && this.child.exitCode === null;
  }

  /** Starts the office (unless it's already starting or running); resolves with its health, or undefined if it crashed. */
  start(restarted = false): Promise<Health | undefined> {
    if (this.starting) return this.starting;
    if (this.owned && this.state === 'running') return Promise.resolve(this.health);
    this.starting = this.launch(restarted).finally(() => (this.starting = undefined));
    return this.starting;
  }

  private async launch(restarted: boolean): Promise<Health | undefined> {
    this.set(restarted ? 'restarting' : 'starting');
    this.signIn = undefined;
    const previous = this.health?.startedAt;
    let child: ChildLike;
    try {
      child = this.deps.spawn();
    } catch (err) {
      this.crash({ code: null, signal: null, why: `couldn't start: ${(err as Error).message}` });
      return undefined;
    }
    this.child = child;
    child.on('message', (m) => this.onMessage(child, m));
    child.on('error', () => undefined);
    child.on('exit', (code, signal) => this.onExit(child, code, signal));
    const r = await this.deps.waitHealthy(child, previous === undefined ? undefined : (h) => h.startedAt !== previous);
    if (this.child !== child) return undefined;
    if (!r.ok) {
      if (r.reason === 'timeout') {
        // Not this office's exit any more: the crash is the timeout.
        this.child = undefined;
        this.deps.killTree(child);
        this.crash({ code: null, signal: null, why: `didn't answer within ${Math.round(r.ms / 1000)} s` });
      }
      // An exit is reported by onExit.
      return undefined;
    }
    this.health = r.health;
    this.set('running');
    this.emit('ready', r.health, { restarted, signIn: this.signIn });
    return r.health;
  }

  private onMessage(child: ChildLike, m: unknown) {
    if (child !== this.child || !m || typeof m !== 'object') return;
    const note = m as { t?: unknown; signIn?: unknown };
    if (note.t === 'ready' && typeof note.signIn === 'string' && note.signIn.startsWith('/')) {
      this.signIn = note.signIn;
      this.emit('signin', note.signIn);
    }
  }

  private onExit(child: ChildLike, code: number | null, signal: string | null) {
    if (child !== this.child) return;
    if (this.state === 'stopping') {
      this.child = undefined;
      this.set('stopped');
      for (const w of this.stopWaiters.splice(0)) w();
      return;
    }
    if (code === RESTART_EXIT_CODE) {
      const now = this.now();
      this.restarts = [...this.restarts.filter((t) => now - t < RESTART_WINDOW_MS), now];
      if (this.restarts.length > (this.deps.maxRestarts ?? 5)) {
        this.crash({ code, signal, why: `restarted ${this.restarts.length} times in ${RESTART_WINDOW_MS / 60_000} minutes` });
        return;
      }
      this.child = undefined;
      this.starting = undefined;
      void this.start(true);
      return;
    }
    this.crash({ code, signal, why: code !== null ? `exited with code ${code}` : `was stopped (${signal ?? 'unknown signal'})` });
  }

  private crash(c: Omit<CrashInfo, 'tail'>) {
    this.child = undefined;
    this.set('crashed');
    this.emit('crashed', { ...c, tail: this.deps.logTail() } satisfies CrashInfo);
  }

  /** Asks the office to stop (agents stop with it); kills it if it hasn't gone in time. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.set('stopped');
      return;
    }
    this.set('stopping');
    const gone = new Promise<void>((r) => this.stopWaiters.push(r));
    let asked = false;
    try {
      asked = !!child.connected && !!child.send?.({ t: 'stop' });
    } catch {
      asked = false;
    }
    if (!asked) this.deps.killTree(child);
    const timeout = this.deps.stopTimeoutMs ?? 20_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((r) => (timer = setTimeout(() => r('late'), timeout)));
    const how = await Promise.race([gone.then(() => 'gone' as const), late]);
    clearTimeout(timer);
    if (how === 'late') {
      this.deps.killTree(child);
      await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))]);
      if (this.state === 'stopping') {
        this.child = undefined;
        this.set('stopped');
      }
    }
  }

  /**
   * Restarts the office right away (the restart exit: workers' terminals are kept, agents mid-turn are cut
   * off and resumed by the next office). Resolves with the new office's health.
   */
  async restartNow(): Promise<Health | undefined> {
    const child = this.child;
    if (!child || child.exitCode !== null) return this.start(this.state !== 'idle');
    const ready = new Promise<Health | undefined>((resolve) => {
      const done = (h?: Health) => {
        this.off('ready', onReady);
        this.off('crashed', onCrash);
        resolve(h);
      };
      const onReady = (h: Health) => done(h);
      const onCrash = () => done(undefined);
      this.on('ready', onReady);
      this.on('crashed', onCrash);
    });
    this.set('restarting');
    let asked = false;
    try {
      asked = !!child.connected && !!child.send?.({ t: 'restart-now' });
    } catch {
      asked = false;
    }
    if (!asked) {
      // No channel: stop it the hard way and start a new one.
      await this.stop();
      return this.start(true);
    }
    return ready;
  }
}
