// One floor's live app: its checkout of main, the mxcli process running it, and what everyone on the
// floor is told about it. Actions queue up one behind another, so a start, a stop and an update
// never step on each other; what's allowed when is machine.ts's table.
//
// Two revisions, never one: `served` is the commit actually running and answering (set only once a build
// answered on its port, gone the moment that runtime stops), `target` the commit it's getting, building or
// starting. An update or restart fetches the new commit first, with the old runtime still serving, and stops
// that runtime only once the fetch worked and the build has to start: a fetch that fails leaves it serving,
// said as "update failed, still running …". The build itself still needs the old runtime gone (it builds in
// the same folder, against the same database), so from then until the new build answers nothing serves, and
// the state says so. What served last is kept on disk for after an office restart (./served.ts).
//
// Not every update needs that restart (shared/liveapp/speed.ts): before it touches the runtime, an update over
// a build that serves classifies what changed (./classify.ts). No app files changed: the serving build is
// that commit's app, so it serves on, `built` naming the commit it was built from. Only pages, logic or the
// theme, and hot reload on (./prefs.ts; mxcli runs with --watch): the checkout moves under the running app and
// mxcli's watch applies it in place (./hot.ts); `served` moves only once mxcli said it applied it and the app
// answers, and anything else drops what served and restarts. Merges that land meanwhile wait, and the next
// update takes the newest of them at once, saying which commits it brought in. Each phase is timed.

import type { ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs';
import path from 'node:path';
import type { LiveAppFailure, LiveAppPrefs, LiveAppState, LiveAppStatus, LiveServed } from '../../shared/protocol.js';
import { updateLine as updateWord, type ChangeClass } from '../../shared/liveapp/speed.js';
import { checkoutFetched, cleanBuild, defaultBranch, ensureCheckout, fetchBranch, findMpr, lookAtFloor, type Fetched, type FloorLook } from './checkout.js';
import { classifyUpdate, commitsIn } from './classify.js';
import { answers, answersWithin, HOT_TIMES, UpdateClock, watchFor, watchLine, type HotOutcome, type HotTimes, type WatchSaid } from './hot.js';
import { databaseName, type LiveAppConfig } from './config.js';
import { isUp, nextStatus, type LiveAppEvent } from './machine.js';
import { pickPorts } from './ports.js';
import { pgBinDir, startTree, stopTree } from './process.js';
import { floorToolkitEnv } from '../toolkit-env.js';
import { linuxMxbuildIn, linuxMxbuildMessage, pickMxbuild, supportsMxbuildPath, supportsWatch, type MxbuildPick } from './mxbuild.js';
import { readLastServed, writeServed } from './served.js';

/** Lines of the log kept for the page. */
const TAIL = 30;
/** Lines of the log kept with a failure (what it said as it stopped). */
const FAIL_LINES = 8;
/** The log file starts over past this size. */
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const READY_POLL_MS = 2_000;
/** mxcli says the build is done and the Mendix runtime is starting (as far as its log says: else it stays "building" until it answers). */
const RUNTIME_STARTING = /\b(?:starting|started|start)\b[^\n]*\bruntime\b|\bruntime\b[^\n]*\b(?:starting|started)\b/i;
const short = (sha?: string) => sha?.slice(0, 7) ?? '';
const MXBUILD_FROM: Record<NonNullable<MxbuildPick['source']>, string> = {
  'toolkit.env': "MXBUILD_PATH in the project's .claude/toolkit.env",
  office: "the office's MXBUILD_PATH",
  'studio-pro': 'the installed Studio Pro of the project’s version',
};

export interface LiveAppDeps {
  cfg: LiveAppConfig;
  /** The resolved mxcli, or null when there's none on this machine. */
  mxcli: string | null;
  floorId: string;
  /** The floor's own checkout: the live checkout is cloned from it and fetches from it. */
  floorDir: string;
  /** Where the checkout and the log go: <dir>/<floor> and <dir>/<floor>.log. */
  liveDir: string;
  /** Ports other floors' apps hold. */
  taken(): Set<number>;
  changed(state: LiveAppState): void;
  /** Which mxbuild to build with, and whether this mxcli takes --mxbuild-path (mxbuild.ts; tests stand in for them). */
  mxbuild?: {
    pick(mpr: string, floorEnv: Record<string, string>): MxbuildPick;
    supportsFlag(mxcli: string): Promise<boolean>;
  };
  /** The project's live app settings as they are now (./prefs.ts); none: hot reload off. */
  prefs?(): LiveAppPrefs;
  /** What an update would change (./classify.ts with the office's model reader; tests stand in for it). */
  classify?(dir: string, from: string, to: string, mprPath: string): Promise<ChangeClass>;
  /** Whether this mxcli takes --watch (mxbuild.ts supportsWatch). */
  supportsWatch?(mxcli: string): Promise<boolean>;
  /** How long a hot apply may take (./hot.ts HOT_TIMES). */
  hotTimes?: HotTimes;
}

export class LiveApp {
  private s: LiveAppState;
  private child: ChildProcess | null = null;
  /** The process whose build is `served` (the one that answered), until it stops. */
  private serving: ChildProcess | null = null;
  ports: number[] = [];
  /** Bumped on every start and stop: callbacks from an older process see it moved, and keep quiet. */
  private gen = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly checkout: string;
  private readonly logFile: string;
  /** Whether this start already cleaned the build and tried again once. */
  private retried = false;
  private soon: NodeJS.Timeout | undefined;
  /** The mxbuild the last start picked, and whether mxcli could be told it. */
  private mxbuild?: { pick: MxbuildPick; flag?: boolean };
  /** The folder of the .mpr the last start ran (mxcli's working folder: its .mxcli/runtime.log is there). */
  projectDir: string | undefined;
  /** The .mpr the running mxcli runs, from the checkout's top. */
  private mprRel: string | undefined;
  /** Whether the running mxcli was started with --watch (so a page or logic change can go in hot). */
  private watching = false;
  /** Times the start or update under way. */
  private clock: UpdateClock | undefined;
  /** Main moved again while an update was under way: the next update goes to the newest. */
  private pendingHead: string | undefined;
  /** A hot apply waiting on what mxcli's watch says. */
  private hotWait: ((said: WatchSaid) => void) | undefined;
  /** A failed hot apply leaves the build half written: the restart after it starts clean. */
  private cleanNext = false;
  /** Hot applies in a row that mxcli's watch never picked up (its words changed?): two, and this run stops trying. */
  private hotMisses = 0;

  constructor(private d: LiveAppDeps) {
    this.checkout = path.join(d.liveDir, d.floorId);
    this.logFile = path.join(d.liveDir, `${d.floorId}.log`);
    // After an office restart nothing runs until someone starts it: what served before is only `lastServed`.
    const last = readLastServed(d.liveDir, d.floorId);
    const prefs = d.prefs?.();
    this.s = { floor: d.floorId, status: 'stopped', phase: 'stopped', log: [], available: !!d.mxcli, ...(last ? { lastServed: last } : {}), ...(prefs ? { prefs } : {}) };
  }

  /** The project's settings changed: said to the page (hot reload takes effect at the next start or restart). */
  prefsChanged() {
    const prefs = this.d.prefs?.();
    if (prefs) this.set({ prefs });
  }

  /** A word for the page while it's stopped (keep warm didn't start it, and why). */
  say(message: string) {
    if (this.s.status === 'stopped' || this.s.status === 'failed') this.set({ message });
  }

  /** The live checkout (<live dir>/<floor>). */
  get checkoutDir(): string {
    return this.checkout;
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
    this.pendingHead = undefined;
    this.clock = undefined;
    this.set({ status: to, phase: to === 'stopping' ? 'stopping' : 'stopped', by, message: to === 'stopping' ? 'Stopping…' : undefined, target: undefined });
    return this.enqueue(async () => {
      await this.kill();
      if (this.s.status === 'stopping') this.set({ status: 'stopped', phase: 'stopped', message: undefined, appPort: undefined });
    });
  }

  /**
   * Auto-refresh (every pollMs while it runs): has the floor's folder fetch main from GitHub (the office's own fetch and credentials),
   * says how that went (a failure is on the page and in Needs you, never only in the log), and restarts
   * on a newer main.
   */
  async poll(): Promise<void> {
    const branch = this.s.branch;
    if (this.s.status !== 'running' || !branch || !this.s.served) return;
    const look: FloorLook = await lookAtFloor(this.d.floorDir, branch, 0).catch((err) => ({ ok: false, at: Date.now(), error: (err as Error).message }));
    this.noteRefresh(branch, look);
    await this.follow(look.head);
  }

  /**
   * Main is at `head` in the floor's folder (a fetch just landed): update to it when it moved past what
   * serves. An update to `head` that already failed with the old build still serving isn't tried again
   * every minute: ⟳ Restart does that.
   */
  async follow(head: string | undefined): Promise<void> {
    if (!head || head === this.s.served?.sha) return;
    // An update or start under way: this one waits, and the next update goes to the newest main once (not one per merge).
    if ((this.s.status === 'updating' || this.s.status === 'starting') && head !== this.s.target?.sha) {
      if (this.pendingHead !== head) this.note(`main moved to ${short(head)} meanwhile: the next update takes the newest`);
      this.pendingHead = head;
      return;
    }
    if (this.s.status !== 'running') return;
    if (this.s.failure?.kind === 'update' && this.s.failure.sha === head) return;
    await this.act('update', 'auto-refresh', () => this.launch(true), `Updating to ${short(head)}…`, head);
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

  /** `run` stops what serves itself, once it got that far (launch); `head` is the commit it's for, when known already. */
  private act(event: LiveAppEvent, by: string, run: () => Promise<void>, message?: string, head?: string): Promise<void> {
    const to = nextStatus(this.s.status, event);
    if (!to) return this.queue;
    if (!this.d.mxcli) {
      this.set({ status: 'failed', phase: 'failed', by, message: `mxcli isn't installed on the office's machine (looked for "${this.d.cfg.mxcli}"; set AGENT_OFFICE_LIVE_MXCLI)` });
      return this.queue;
    }
    const gen = ++this.gen;
    this.retried = false;
    if (event !== 'update') [this.pendingHead, this.hotMisses] = [undefined, 0];
    this.clock = new UpdateClock(event === 'start' || !this.s.served ? 'cold' : 'restart', event === 'restart' ? 'restart asked for' : event === 'start' ? 'cold start' : 'main moved');
    const from = this.s.served?.sha;
    this.set({ status: to, phase: 'building', by, message: message ?? (event === 'restart' ? 'Restarting…' : 'Getting main…'), since: Date.now(), log: [], started: true, failure: undefined, target: head ? { sha: head, ...(from ? { from } : {}) } : undefined });
    return this.enqueue(async () => {
      if (gen !== this.gen) return;
      try {
        await run();
      } catch (err) {
        if (gen !== this.gen) return;
        // It failed before the running build was stopped: that one still serves.
        if (this.child && this.child === this.serving && this.s.served) this.failUpdate((err as Error).message);
        else this.fail((err as Error).message);
      }
    });
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(fn, fn);
    return this.queue;
  }

  /**
   * Fetches main (what serves keeps serving meanwhile), stops what serves, puts the checkout on it, picks
   * ports and starts mxcli; resolves once it's started, not once it's up.
   */
  private async launch(update: boolean) {
    const gen = this.gen;
    mkdirSync(this.d.liveDir, { recursive: true });
    this.rotateLog();
    await ensureCheckout(this.checkout, this.d.floorDir);
    const branch = this.s.branch ?? (await defaultBranch(this.d.floorDir));
    const next = await fetchBranch(this.checkout, this.d.floorDir, branch);
    if (gen !== this.gen) return;
    const clock = this.clock;
    clock?.lap('fetch');
    const from = this.s.served?.sha;
    this.set({ branch, target: { sha: next.sha, subject: next.subject, ...(next.at ? { commitAt: next.at } : {}), ...(from ? { from } : {}) } });
    if (clock && from) [clock.from, clock.to] = [from, next.sha];
    // An update over a build that serves: what changed decides whether it restarts at all (shared/liveapp/speed.ts).
    if (update && clock && from && from !== next.sha && this.child && this.child === this.serving && this.mprRel) {
      const done = await this.quick(next, branch, from, clock, gen);
      if (done || gen !== this.gen) return;
    }
    // The build runs in the same folder against the same database, so what serves stops here (blue/green on a second checkout is a follow-up).
    if (this.child) {
      this.note(`stopping ${from ? short(from) : 'the app'} to build ${short(next.sha)}`);
      await this.kill();
      if (gen !== this.gen) return;
      clock?.lap('stop');
      this.flush();
    }
    const co = await checkoutFetched(this.checkout, branch);
    if (gen !== this.gen) return;
    const mpr = findMpr(this.checkout);
    if (!mpr) throw new Error(`No Mendix project (.mpr) in ${branch} at ${short(co.sha)}`);
    this.projectDir = path.dirname(mpr);
    this.mprRel = path.relative(this.checkout, mpr).replaceAll('\\', '/');
    // A newer main over an older build trips mxbuild up (see BUILD_LEFTOVERS); so does what a failed hot reload left.
    if ((co.moved || this.cleanNext) && cleanBuild(path.dirname(mpr))) this.note(this.cleanNext ? 'cleared what the failed hot reload left' : 'main moved: cleared the last build');
    this.cleanNext = false;
    this.set({ target: { sha: co.sha, subject: co.subject, ...(co.at ? { commitAt: co.at } : {}), ...(from ? { from } : {}) }, message: update ? `Updating to ${short(co.sha)}: building…` : `Building ${short(co.sha)}… (a cold start takes a minute or two)` });
    await this.spawnApp(mpr, gen);
  }

  /**
   * The quick ways, with the old build still serving: classifies the change (the commits it brings in are
   * counted meanwhile), then takes the target over without a restart when no app files changed, or hot
   * reloads a page or logic change. True when it's done (or a stop moved on); false: restart as always.
   */
  private async quick(next: Fetched, branch: string, from: string, clock: UpdateClock, gen: number): Promise<boolean> {
    const classify = this.d.classify ?? ((dir, a, b, mpr) => classifyUpdate(dir, a, b, mpr, {}));
    const [change, brought] = await Promise.all([classify(this.checkout, from, next.sha, this.mprRel!), commitsIn(this.checkout, from, next.sha)]);
    if (gen !== this.gen) return true;
    clock.lap('classify');
    if (brought) [clock.commits, clock.included] = [brought.count, brought.included];
    this.note(`what changed ${short(from)}..${short(next.sha)}${brought && brought.count > 1 ? ` (${brought.count} commits)` : ''}: ${change.kind}, ${change.reason}${change.touched.length ? ` (${change.touched.join(', ')})` : ''}`);
    clock.reason = change.reason;
    if (change.kind === 'none') {
      clock.mode = 'none';
      const co = await checkoutFetched(this.checkout, branch);
      if (gen !== this.gen) return true;
      clock.lap('apply');
      const was = this.s.served!;
      this.serve({ sha: co.sha, ...(co.subject ? { subject: co.subject } : {}), ...(co.at ? { commitAt: co.at } : {}), builtAt: was.builtAt, built: was.built ?? was.sha });
      return true;
    }
    if (change.kind !== 'hot') return false;
    if (!this.watching) {
      clock.reason = `${change.reason}, but ${!this.d.prefs?.().hotReload ? 'hot reload is off' : this.hotMisses >= 2 ? "hot reload is paused (mxcli's watch didn't answer)" : 'hot reload starts with the next restart'}`;
      return false;
    }
    clock.mode = 'hot';
    this.set({ message: `Updating to ${short(next.sha)}: hot reload (${change.reason})…` });
    const outcome = watchFor(this.d.hotTimes ?? HOT_TIMES, () => gen === this.gen, (on) => (this.hotWait = on));
    // The move: mxcli's watch sees the checkout change and builds it into the running app.
    await checkoutFetched(this.checkout, branch).catch((err) => this.hotWait?.({ kind: 'failed', why: `the checkout didn't move: ${(err as Error).message}` }));
    let o: HotOutcome = await outcome;
    if (gen !== this.gen) return true;
    clock.lap('apply');
    if (o.ok) {
      const port = this.s.appPort;
      const up = !!port && (await answersWithin(port, 15_000, () => gen === this.gen));
      if (gen !== this.gen) return true;
      clock.lap('answer');
      if (up) {
        this.hotMisses = 0;
        this.serve();
        return true;
      }
      o = { ok: false, why: "the app didn't answer after the hot reload" };
    }
    // A failed watch build leaves the app answering 404 and mxcli's watch stuck: what served serves no more, and it restarts.
    this.note(`hot reload didn't confirm: ${o.why}; restarting`);
    clock.mode = 'restart';
    clock.fallback = o.why;
    this.cleanNext = true;
    if (/didn't pick the change up/.test(o.why) && ++this.hotMisses >= 2) this.note("hot reload: mxcli's watch didn't answer twice in a row, so updates restart until the next ▶ Start or ⟳ Restart");
    if (this.s.served) this.set({ ...this.unserved(), message: `Updating to ${short(next.sha)}: hot reload didn't confirm, restarting…` });
    return false;
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
    // The floor's toolkit.env (its MXBUILD_PATH) over the office's own, as for its workers.
    const floorEnv = floorToolkitEnv(this.d.floorDir);
    // The mxbuild, told to mxcli rather than left to its resolution (a cached Linux download can't run on Windows).
    const pick = (this.d.mxbuild?.pick ?? pickMxbuild)(mpr, floorEnv);
    let flag: boolean | undefined;
    const extra: Record<string, string> = {};
    if (pick.path) {
      flag = await (this.d.mxbuild?.supportsFlag ?? supportsMxbuildPath)(this.d.mxcli!);
      if (gen !== this.gen) return;
      if (flag) args.push('--mxbuild-path', pick.path);
      extra.MXBUILD_PATH = pick.path;
    }
    this.mxbuild = { pick, flag };
    // Hot reload on: mxcli watches the checkout, so a page or logic change the office moves in applies in place.
    const watch = !!this.d.prefs?.().hotReload && (await (this.d.supportsWatch ?? supportsWatch)(this.d.mxcli!));
    if (gen !== this.gen) return;
    if (watch && this.hotMisses < 2) args.push('--watch');
    else if (this.d.prefs?.().hotReload) this.note("hot reload: this mxcli has no --watch, so every update restarts");
    this.watching = watch && this.hotMisses < 2;
    for (const s of pick.skipped) this.note(`mxbuild: ${s}`);
    if (pick.path) this.note(`mxbuild: ${pick.path} (${MXBUILD_FROM[pick.source!]})${flag ? '' : ': this mxcli has no --mxbuild-path, so it only gets MXBUILD_PATH'}`);
    else if (pick.expected) this.note(`mxbuild: Studio Pro ${pick.version} isn't installed (no ${pick.expected}); mxcli picks one itself`);
    this.note(`$ mxcli ${args.map((a, i) => (args[i - 1] === '--db-password' ? '***' : a)).join(' ')}`);
    const child = startTree(this.d.mxcli!, args, path.dirname(mpr), { ...floorEnv, ...extra, PGPASSWORD: cfg.db.password }, pgBinDir());
    this.child = child;
    this.set({ appPort: app });
    let partial = '';
    const onData = (buf: Buffer) => {
      const lines = (partial + buf.toString('utf8')).split(/\r?\n/);
      partial = lines.pop() ?? '';
      for (const l of lines) {
        if (!l.trim()) continue;
        // The build that serves outlives the action that started it: its lines (a hot reload's) belong to the one under way.
        const serving = child === this.serving;
        this.note(l, serving ? this.gen : gen);
        const said = this.hotWait && serving ? watchLine(l) : undefined;
        if (said) this.hotWait?.(said);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', (err) => gen === this.gen && this.fail(`mxcli didn't start: ${err.message}`));
    child.once('exit', (code) => {
      if (this.child === child) this.child = null;
      const wasServing = this.serving === child;
      if (wasServing) this.serving = null;
      // Gone during a hot apply: what served serves no more, and the hot path restarts it.
      if (wasServing && this.hotWait) {
        if (this.s.served) this.set(this.unserved());
        this.hotWait({ kind: 'exited' });
        return;
      }
      if (gen !== this.gen || !isUp(this.s.status)) {
        // The build that served ended outside the current action (stopped, or gone during an update's fetch): it serves no more.
        if (wasServing && this.s.served) this.set(this.unserved());
        return;
      }
      // mxcli picked a Linux mxbuild on Windows: no retry fixes that, so say why and how to fix it.
      const linux = this.s.status !== 'running' ? linuxMxbuildIn(this.s.log) : undefined;
      if (linux) {
        this.fail(linuxMxbuildMessage(linux, this.mxbuild?.pick ?? { skipped: [] }, this.mxbuild?.flag, this.d.mxcli!));
        return;
      }
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
      // It was running and stopped by itself: mxcli says why ("the app stopped: the Mendix runtime is no longer running").
      const said = [...this.s.log].reverse().find((l) => /the app stopped|no longer running|^error\b|exception/i.test(l));
      this.fail(said ? `${said.replace(/^error:\s*/i, '')} (mxcli exited, code ${code ?? '?'})` : `mxcli exited (code ${code ?? '?'})`);
    });
    void this.waitReady(app, gen);
  }

  /** Asks the app's port until it answers; past the timeout, gives up and stops it. */
  private async waitReady(port: number, gen: number) {
    const deadline = Date.now() + this.d.cfg.readyTimeoutMs;
    while (gen === this.gen && isUp(this.s.status) && this.s.status !== 'running') {
      if (await answers(port)) {
        if (gen !== this.gen || !isUp(this.s.status)) return;
        this.serve();
        return;
      }
      if (Date.now() > deadline) {
        this.fail(`The app didn't answer on port ${port} within ${Math.round(this.d.cfg.readyTimeoutMs / 60_000)} min`, 'timeout');
        void this.enqueue(() => this.kill());
        return;
      }
      await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
  }

  private async kill() {
    const child = this.child;
    this.child = null;
    if (child && child === this.serving) {
      this.serving = null;
      Object.assign(this.s, this.unserved());
    }
    if (child) await stopTree(child);
    this.ports = [];
  }

  /** The new build answered: it is what serves now (and on disk, for after an office restart). */
  private serve(taken?: LiveServed) {
    const t = this.s.target;
    const now = Date.now();
    this.serving = this.child;
    const served: LiveServed | undefined = taken ?? (t ? { sha: t.sha, ...(t.subject ? { subject: t.subject } : {}), ...(t.commitAt ? { commitAt: t.commitAt } : {}), builtAt: now } : undefined);
    if (served) writeServed(this.d.liveDir, this.d.floorId, served);
    const clock = this.clock;
    if (clock && (clock.mode === 'cold' || clock.mode === 'restart')) clock.lap(clock.has('build') ? 'start' : 'build');
    this.clock = undefined;
    const lastUpdate = clock?.done(true);
    if (clock) this.note(`✔ ${updateWord(lastUpdate)} (${clock.line()})`);
    this.set({ status: nextStatus(this.s.status, 'ready') ?? 'running', phase: 'running', message: undefined, since: taken ? this.s.since : now, served, target: undefined, lastServed: undefined, ...(lastUpdate ? { lastUpdate } : {}) });
    this.followPending();
  }

  /** Main moved while this was under way: one more update, to the newest (it fetches the branch's tip). */
  private followPending(skip?: string) {
    const head = this.pendingHead;
    this.pendingHead = undefined;
    if (head && head !== this.s.served?.sha && head !== skip) setImmediate(() => void this.follow(head));
  }

  /** The patch for "what served serves no more": it becomes `lastServed`, until now. */
  private unserved(): Partial<LiveAppState> {
    const s = this.s.served;
    if (!s) return {};
    const lastServed = { ...s, until: Date.now() };
    writeServed(this.d.liveDir, this.d.floorId, lastServed);
    return { served: undefined, lastServed };
  }

  /** It stopped without being asked: a crash when it was running, else its build or start failed (or `kind`). */
  private fail(why: string, kind?: LiveAppFailure['kind']) {
    const to = nextStatus(this.s.status, 'crash');
    if (!to) return;
    const k = kind ?? (this.s.status === 'running' ? 'crash' : 'build');
    this.note(`✖ ${why}`);
    // A crash names the build that served; a build, start or timeout the one it was on its way to.
    const sha = k === 'crash' ? this.s.served?.sha : this.s.target?.sha;
    const failure: LiveAppFailure | undefined = to === 'failed' ? { kind: k, at: Date.now(), why, lines: this.s.log.slice(-FAIL_LINES), ...(sha ? { sha } : {}) } : undefined;
    // Whatever served is gone by now (or never answered: a timeout's process is stopped next).
    this.serving = null;
    this.pendingHead = undefined;
    const lastUpdate = k !== 'crash' ? this.clock?.done(false) : undefined;
    this.clock = undefined;
    this.set({ ...this.unserved(), ...(lastUpdate ? { lastUpdate } : {}), status: to, phase: to === 'failed' ? 'failed' : 'stopped', message: to === 'failed' ? (k === 'crash' ? `The app stopped by itself: ${why}` : why) : undefined, appPort: to === 'failed' ? undefined : this.s.appPort, failure });
  }

  /** An update or restart failed before the running build was stopped: that build still serves, and it says so. */
  private failUpdate(why: string) {
    this.note(`✖ ${why}`);
    const sha = this.s.target?.sha;
    const failure: LiveAppFailure = { kind: 'update', at: Date.now(), why, lines: this.s.log.slice(-FAIL_LINES), ...(sha ? { sha } : {}) };
    const lastUpdate = this.clock?.done(false);
    this.clock = undefined;
    this.set({ status: nextStatus(this.s.status, 'ready') ?? 'running', phase: 'running', message: undefined, since: this.s.served?.builtAt ?? Date.now(), failure, ...(lastUpdate ? { lastUpdate } : {}) });
    this.followPending(sha);
  }

  /** How the last look for a newer main went: said in the log and to the page when it changes, not every minute. */
  private noteRefresh(branch: string, look: FloorLook) {
    const was = this.s.refresh;
    const refresh = { ok: look.ok, at: look.at, ...(look.error ? { error: look.error } : {}) };
    if (was && was.ok === look.ok && was.error === look.error) {
      this.s.refresh = refresh;
      return;
    }
    if (!look.ok) this.note(`auto-refresh: couldn't fetch ${branch} into the project's folder: ${look.error ?? '?'}`);
    this.set({ refresh });
  }

  /** A line in the log file, and in the page's tail while it's starting or has failed. */
  private note(line: string, gen = this.gen) {
    try {
      appendFileSync(this.logFile, `${line}\n`);
    } catch {
      // The log is a convenience.
    }
    if (gen !== this.gen) return;
    if (this.s.phase === 'building' && this.child && this.clock?.mode !== 'hot' && RUNTIME_STARTING.test(line)) {
      this.s.phase = 'starting';
      this.clock?.lap('build');
    }
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
