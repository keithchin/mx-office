// One floor's live app: its checkout of main, the mxcli process running it, and what everyone on the
// floor is told about it. Actions queue up one behind another, so a start, a stop and an update
// never step on each other; what's allowed when is machine.ts's table.

import type { ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { LiveAppState, LiveAppStatus } from '../../shared/protocol.js';
import { cleanBuild, defaultBranch, ensureCheckout, findMpr, pullBranch, remoteHead } from './checkout.js';
import { databaseName, type LiveAppConfig } from './config.js';
import { isUp, nextStatus, type LiveAppEvent } from './machine.js';
import { pickPorts } from './ports.js';
import { pgBinDir, startTree, stopTree } from './process.js';
import { floorToolkitEnv } from '../toolkit-env.js';

/** Lines of the log kept for the page. */
const TAIL = 30;
/** The log file starts over past this size. */
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const READY_POLL_MS = 2_000;

export interface LiveAppDeps {
  cfg: LiveAppConfig;
  /** The resolved mxcli, or null when there's none on this machine. */
  mxcli: string | null;
  floorId: string;
  /** The floor's own checkout, cloned from the first time. */
  floorDir: string;
  /** The floor's GitHub remote, which the live checkout follows. */
  remote?: string;
  /** Where the checkout and the log go: <dir>/<floor> and <dir>/<floor>.log. */
  liveDir: string;
  /** Ports other floors' apps hold. */
  taken(): Set<number>;
  changed(state: LiveAppState): void;
}

export class LiveApp {
  private s: LiveAppState;
  private child: ChildProcess | null = null;
  ports: number[] = [];
  /** Bumped on every start and stop: callbacks from an older process see it moved, and keep quiet. */
  private gen = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly checkout: string;
  private readonly logFile: string;
  /** Whether this start already cleaned the build and tried again once. */
  private retried = false;
  private soon: NodeJS.Timeout | undefined;

  constructor(private d: LiveAppDeps) {
    this.checkout = path.join(d.liveDir, d.floorId);
    this.logFile = path.join(d.liveDir, `${d.floorId}.log`);
    this.s = { floor: d.floorId, status: 'stopped', log: [], available: !!d.mxcli };
  }

  get state(): LiveAppState {
    return { ...this.s, log: [...this.s.log] };
  }

  get status(): LiveAppStatus {
    return this.s.status;
  }

  /** ▶: build main and run it. */
  start(by: string) {
    return this.act('start', by, () => this.launch(false));
  }

  /** ⟳: stop, then start on the newest main. */
  restart(by: string) {
    return this.act('restart', by, () => this.launch(false));
  }

  /** ■: stop it. Takes effect at once, even in the middle of a start. */
  stop(by: string): Promise<void> {
    const to = nextStatus(this.s.status, 'stop');
    if (!to) return this.queue;
    this.gen++;
    this.set({ status: to, by, message: to === 'stopping' ? 'Stopping…' : undefined });
    return this.enqueue(async () => {
      await this.kill();
      if (this.s.status === 'stopping') this.set({ status: 'stopped', message: undefined, appPort: undefined });
    });
  }

  /** Auto-refresh: whether main moved past what runs, and if so, restart on it. */
  async poll(): Promise<void> {
    if (this.s.status !== 'running' || !this.s.branch || !this.s.sha) return;
    let head: string | undefined;
    try {
      head = await remoteHead(this.checkout, this.s.branch);
    } catch (err) {
      return this.note(`auto-refresh: couldn't ask the remote about ${this.s.branch}: ${(err as Error).message}`);
    }
    if (!head || head === this.s.sha || this.s.status !== 'running') return;
    await this.act('update', 'auto-refresh', () => this.launch(true), `Updating to ${head.slice(0, 7)}…`);
  }

  /** The office is closing: end the process, no waiting on anything else queued. */
  async shutdown() {
    this.gen++;
    await this.kill();
  }

  /** The process, for ending it synchronously as the office's own process exits. */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  // ---- Inside ------------------------------------------------------------------------------------

  private act(event: LiveAppEvent, by: string, run: () => Promise<void>, message?: string): Promise<void> {
    const to = nextStatus(this.s.status, event);
    if (!to) return this.queue;
    if (!this.d.mxcli) {
      this.set({ status: 'failed', by, message: `mxcli isn't installed on the office's machine (looked for "${this.d.cfg.mxcli}"; set AGENT_OFFICE_LIVE_MXCLI)` });
      return this.queue;
    }
    const gen = ++this.gen;
    this.retried = false;
    this.set({ status: to, by, message: message ?? (event === 'restart' ? 'Restarting…' : 'Getting main…'), since: Date.now(), log: [] });
    return this.enqueue(async () => {
      await this.kill();
      if (gen !== this.gen) return;
      try {
        await run();
      } catch (err) {
        if (gen === this.gen) this.fail((err as Error).message);
      }
    });
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(fn, fn);
    return this.queue;
  }

  /** Gets main, picks ports and starts mxcli; resolves once it's started, not once it's up. */
  private async launch(update: boolean) {
    const gen = this.gen;
    mkdirSync(this.d.liveDir, { recursive: true });
    this.rotateLog();
    await ensureCheckout(this.checkout, this.d.floorDir, this.d.remote);
    const branch = this.s.branch ?? (await defaultBranch(this.checkout));
    const co = await pullBranch(this.checkout, branch);
    if (gen !== this.gen) return;
    const mpr = findMpr(this.checkout);
    if (!mpr) throw new Error(`No Mendix project (.mpr) in ${branch} at ${co.sha.slice(0, 7)}`);
    // A newer main over an older build trips mxbuild up (see BUILD_LEFTOVERS).
    if (co.moved && cleanBuild(path.dirname(mpr))) this.note('main moved: cleared the last build');
    this.set({ branch, sha: co.sha, subject: co.subject, message: update ? `Updating to ${co.sha.slice(0, 7)}: building…` : `Building ${co.sha.slice(0, 7)}… (a cold start takes a minute or two)` });
    await this.spawnApp(mpr, gen);
  }

  private async spawnApp(mpr: string, gen: number) {
    const { cfg } = this.d;
    const ports = await pickPorts(3, cfg.ports, this.d.taken());
    if (!ports) throw new Error(`No three free ports left in ${cfg.ports.from}-${cfg.ports.to} (AGENT_OFFICE_LIVE_PORTS)`);
    if (gen !== this.gen) return;
    this.ports = ports;
    const [app, admin, serve] = ports;
    const args = ['run', '--local', '-p', path.basename(mpr), '--app-port', String(app), '--admin-port', String(admin), '--serve-port', String(serve)];
    args.push('--db-host', `${cfg.db.host.includes(':') ? `[${cfg.db.host}]` : cfg.db.host}:${cfg.db.port}`, '--db-user', cfg.db.user, '--db-password', cfg.db.password, '--db-name', databaseName(this.d.floorId), '--ensure-db');
    this.note(`$ mxcli ${args.map((a, i) => (args[i - 1] === '--db-password' ? '***' : a)).join(' ')}`);
    // The floor's toolkit.env (its MXBUILD_PATH) over the office's own, as for its workers.
    const child = startTree(this.d.mxcli!, args, path.dirname(mpr), { ...floorToolkitEnv(this.d.floorDir), PGPASSWORD: cfg.db.password }, pgBinDir());
    this.child = child;
    this.set({ appPort: app });
    let partial = '';
    const onData = (buf: Buffer) => {
      const lines = (partial + buf.toString('utf8')).split(/\r?\n/);
      partial = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) this.note(l, gen);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', (err) => gen === this.gen && this.fail(`mxcli didn't start: ${err.message}`));
    child.once('exit', (code) => {
      if (this.child === child) this.child = null;
      if (gen !== this.gen || !isUp(this.s.status)) return;
      // A first build that fails is often the last build's leftovers: clean and try once more.
      if (this.s.status !== 'running' && !this.retried) {
        this.retried = true;
        this.note('mxcli stopped before the app came up: clearing the build and trying once more');
        cleanBuild(path.dirname(mpr));
        void this.enqueue(() =>
          this.spawnApp(mpr, gen).catch((err) => {
            if (gen === this.gen) this.fail((err as Error).message);
          }),
        );
        return;
      }
      this.fail(`mxcli exited (code ${code ?? '?'})`);
    });
    void this.waitReady(app, gen);
  }

  /** Asks the app's port until it answers; past the timeout, gives up and stops it. */
  private async waitReady(port: number, gen: number) {
    const deadline = Date.now() + this.d.cfg.readyTimeoutMs;
    while (gen === this.gen && isUp(this.s.status) && this.s.status !== 'running') {
      if (await answers(port)) {
        if (gen !== this.gen || !isUp(this.s.status)) return;
        this.set({ status: nextStatus(this.s.status, 'ready') ?? 'running', message: undefined, since: Date.now() });
        return;
      }
      if (Date.now() > deadline) {
        this.fail(`The app didn't answer on port ${port} within ${Math.round(this.d.cfg.readyTimeoutMs / 60_000)} min`);
        void this.enqueue(() => this.kill());
        return;
      }
      await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
  }

  private async kill() {
    const child = this.child;
    this.child = null;
    if (child) await stopTree(child);
    this.ports = [];
  }

  private fail(why: string) {
    const to = nextStatus(this.s.status, 'crash');
    if (!to) return;
    this.note(`✖ ${why}`);
    this.set({ status: to, message: to === 'failed' ? why : undefined, appPort: to === 'failed' ? undefined : this.s.appPort });
  }

  /** A line in the log file, and in the page's tail while it's starting or has failed. */
  private note(line: string, gen = this.gen) {
    try {
      appendFileSync(this.logFile, `${line}\n`);
    } catch {
      // The log is a convenience.
    }
    if (gen !== this.gen) return;
    this.s.log.push(line.length > 400 ? `${line.slice(0, 400)}…` : line);
    if (this.s.log.length > TAIL) this.s.log.splice(0, this.s.log.length - TAIL);
    // A build prints hundreds of lines: the page hears about them a couple of times a second at most.
    if ((this.s.status === 'starting' || this.s.status === 'updating') && !this.soon) this.soon = setTimeout(() => this.flush(), 500);
  }

  private flush() {
    clearTimeout(this.soon);
    this.soon = undefined;
    this.d.changed(this.state);
  }

  private rotateLog() {
    try {
      if (statSync(this.logFile).size > LOG_MAX_BYTES) truncateSync(this.logFile, 0);
    } catch {
      // No log yet.
    }
    try {
      appendFileSync(this.logFile, `\n=== ${new Date().toISOString()} ${this.s.status} (${this.s.by ?? '?'})\n`);
    } catch {
      // As above.
    }
  }

  private set(patch: Partial<LiveAppState>) {
    Object.assign(this.s, patch);
    this.flush();
  }
}

/** Whether something answers HTTP on the port yet (any status but a gateway error counts). */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 5_000 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.once('timeout', () => req.destroy());
    req.once('error', () => resolve(false));
  });
}
