// Every floor's live app, as the office runs them: made the first time someone asks (liveAppsOf),
// told to the people on the floor whenever it changes, refreshed when the floor's main moves, and
// stopped with the office. Nothing a browser sends picks what runs: the command, the checkout and the
// ports are all the office's own.
//
// Beside the process, the office says what the app actually has (./readiness.ts): where main is against
// the served build (the commit actually running and answering, never the one being built), and which of
// the plan's milestones are in it, verified by a journey run against that very build. It's read again
// when something changes it, never on a timer of its own: the app started, stopped or crashed, a fetch
// landed in the floor's folder (floor-sync/bus.ts), new test evidence landed (testing/news.ts), or
// someone opened the tab and nothing was read yet. A milestone
// becoming ready, or a crash, is a toast and a Needs-you row the notification channels send once.

import { liveAppConstants } from '../app-instance/constants.js';
import { forgetWith } from '../office/forget.js';
import path from 'node:path';
import type { LiveAppState } from '../../shared/protocol.js';
import type { LiveReadiness } from '../../shared/liveapp/readiness.js';
import { stamp } from '../../shared/liveapp/status.js';
import { resolveCommand } from '../workers/process.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { onOriginNews } from '../floor-sync/bus.js';
import { onTestRuns } from '../testing/news.js';
import { audit } from '../audit/index.js';
import { LiveApp } from './app.js';
import { floorRef } from './checkout.js';
import { liveAppConfig, type LiveAppConfig } from './config.js';
import { killTreeNow } from './process.js';
import { ReadyNews } from './news.js';
import { readReadiness } from './readiness.js';
import { findMpr } from './checkout.js';
import { LiveConsoles } from './console/index.js';
import { emitLiveReady } from './ready-bus.js';
import { forgetServed, readLastServed } from './served.js';
import { instancePorts } from '../app-instance/index.js';
import { ModelUnits } from '../model/units.js';
import { classifyUpdate } from './classify.js';
import { forgetPrefs, readPrefs, writePrefs } from './prefs.js';
import type { LiveAppPrefs } from '../../shared/protocol.js';
import { availableMemory } from '../machine.js';
import { dataImpactOf } from '../data-impact/index.js';

type Deps = Pick<Ctx, 'cfg' | 'floors' | 'toFloor'> & Partial<Pick<Ctx, 'toastFloor' | 'accounts' | 'meOf'>>;

/** <live checkout>/.mxcli/runtime.log, in mxcli's working folder (the .mpr's). */
export function runtimeLogOf(projectDir: string | undefined, checkout: string): string {
  let dir = projectDir;
  if (!dir) {
    // No checkout yet (never started here) has no .mpr: the log would be at the checkout's root.
    let mpr: string | undefined;
    try {
      mpr = findMpr(checkout);
    } catch {
      mpr = undefined;
    }
    dir = mpr ? path.dirname(mpr) : checkout;
  }
  return path.join(dir, '.mxcli', 'runtime.log');
}

/** A reading waits this long for more news before it starts (a merge is a fetch, then a sync, then a build). */
const SETTLE_MS = 400;

interface Extra {
  main?: LiveAppState['main'];
  readiness?: LiveReadiness;
  /** A reading is due or running. */
  timer?: NodeJS.Timeout;
  reading?: Promise<void>;
  again?: boolean;
  /** Read again even when main and the running build are where they were (test evidence landed). */
  force?: boolean;
  /** What the last reading was of: main's commit, the running commit, whether it ran. */
  key?: string;
  news?: ReadyNews;
}

export class LiveApps {
  readonly cfg: LiveAppConfig;
  private apps = new Map<string, LiveApp>();
  private extras = new Map<string, Extra>();
  /** Lets go of a deleted project's floor (office/forget.ts). */
  private readonly forgetsFloor = forgetWith(this, (o, f) => {
    const app = o.apps.get(f.id);
    clearTimeout(o.extras.get(f.id)?.timer);
    o.extras.delete(f.id);
    o.blanks.delete(f.id);
    void o.consoles.forget(f.id);
    forgetPrefs(o.liveDir, f.id);
    // What served last goes with the project (after its app stopped, which writes it one last time).
    if (!app) return forgetServed(o.liveDir, f.id);
    o.apps.delete(f.id);
    void app
      .shutdown()
      .catch(() => undefined)
      .then(() => forgetServed(o.liveDir, f.id));
  });
  private timer: NodeJS.Timeout | undefined;
  private mxcli: string | null;
  private readonly unsubs: (() => void)[] = [];
  private readonly liveDir: string;
  /** Reads the model units an update touched (./classify.ts), its .mpr copies in <live>/.model-units. */
  private readonly units: ModelUnits;
  /** Each floor's Console: the runtime log and the app's requests (./console/). */
  readonly consoles: LiveConsoles;

  constructor(private ctx: Deps) {
    this.cfg = liveAppConfig(ctx.cfg.dataDir);
    this.mxcli = resolveCommand(this.cfg.mxcli);
    this.liveDir = path.join(ctx.cfg.dataDir, 'live');
    this.units = new ModelUnits(path.join(this.liveDir, '.model-units'));
    this.consoles = new LiveConsoles({
      host: ctx.cfg.host || '127.0.0.1',
      ports: this.cfg.ports,
      taken: () => new Set([...this.apps.values()].flatMap((a) => a.ports)),
      logFile: (floorId) => {
        const app = this.apps.get(floorId);
        return runtimeLogOf(app?.projectDir, app?.checkoutDir ?? path.join(this.liveDir, floorId));
      },
      portChanged: (floorId) => {
        const floor = this.ctx.floors.get(floorId);
        const app = this.apps.get(floorId);
        if (floor && app) this.ctx.toFloor(floor, { t: 'liveapp.state', state: this.withExtra(app.state) });
      },
    });
    // Should the office's process end without its shutdown (a crash), the apps' processes go with it.
    process.once('exit', () => {
      for (const a of this.apps.values()) if (a.pid) killTreeNow(a.pid);
    });
    // A fetch landed in a floor's folder: a running app follows main, and what main has is read again.
    this.unsubs.push(
      onOriginNews((dir, news) => {
        if (news !== 'fetched') return;
        for (const floor of this.ctx.floors.values()) {
          if (path.resolve(floor.dir) !== path.resolve(dir) || !this.extras.has(floor.id)) continue;
          const app = this.apps.get(floor.id);
          if (app?.status === 'running' && app.state.branch) void floorRef(floor.dir, app.state.branch).then((h) => app.follow(h?.sha)).catch(() => undefined);
          // A fetch that moved nothing reads nothing (it lands every minute and a half).
          this.schedule(floor.id, false);
        }
      }),
      onTestRuns((floorId) => this.extras.has(floorId) && this.schedule(floorId)),
    );
  }

  /** The floor's app (made, stopped, the first time). */
  of(floor: Floor): LiveApp {
    let app = this.apps.get(floor.id);
    if (!app) {
      app = new LiveApp({
        cfg: this.cfg,
        mxcli: this.mxcli,
        floorId: floor.id,
        floorDir: floor.dir,
        liveDir: this.liveDir,
        taken: () => this.takenPorts(),
        changed: (state) => this.changed(state),
        prefs: () => this.prefsOf(floor.id),
        // Too little memory for hot reload's resident bundler: that start restarts for every change instead (./hot-mode.ts).
        freeMemory: availableMemory,
        // The project's instance constants (.agent-office/instance-constants.json) for each run, never the model.
        constants: (dir) => liveAppConstants(dir, this.mxcli),
        // What an update changes, read by the model's unit reader (model/units.ts) from the live checkout's git; its reader let go after.
        classify: (dir, from, to, mpr) => classifyUpdate(dir, from, to, mpr, { units: this.units }).finally(() => this.units.blobs(dir).close()),
        // Nothing that may drop or convert stored data is applied without a data-impact approval (data-impact/guard.ts).
        ...(this.ctx.accounts && this.ctx.meOf ? { guard: (dir: string, from: string, to: string) => dataImpactOf(this.ctx as Parameters<typeof dataImpactOf>[0]).guard.check({ floorId: floor.id, dir, base: from, target: to, units: this.units }).finally(() => this.units.blobs(dir).close()) } : {}),
      });
      this.apps.set(floor.id, app);
    }
    return app;
  }

  /** A project's live app settings (hot reload, keep warm: ./prefs.ts). */
  prefsOf(floorId: string): LiveAppPrefs {
    return readPrefs(this.liveDir, floorId, this.cfg);
  }

  /** Changes them (an admin on the Live app tab), and tells the project. */
  setPrefs(floor: Floor, patch: Partial<LiveAppPrefs>): LiveAppPrefs {
    const prefs = writePrefs(this.liveDir, floor.id, patch, this.cfg);
    this.blanks.delete(floor.id);
    const app = this.apps.get(floor.id);
    if (app) app.prefsChanged();
    else this.ctx.toFloor(floor, { t: 'liveapp.state', state: this.withExtra(this.blank(floor.id)) });
    return prefs;
  }

  /** Every port the live apps, their consoles and the office's own app instances (app-instance/) hold. */
  takenPorts(): Set<number> {
    return new Set([...[...this.apps.values()].flatMap((a) => a.ports), ...this.consoles.ports(), ...instancePorts()]);
  }

  /** What a floor's app is doing, with what it has, without making one; asks for a first reading. */
  stateOf(floor: Floor): LiveAppState {
    const base = this.apps.get(floor.id)?.state ?? this.blank(floor.id);
    if (!this.extras.has(floor.id)) this.schedule(floor.id);
    return this.withExtra(base);
  }

  /** The state as it stands, for the notification channels: no reading started. */
  peek(floorId: string): LiveAppState | undefined {
    const app = this.apps.get(floorId);
    return app ? this.withExtra(app.state) : undefined;
  }

  private withExtra(s: LiveAppState): LiveAppState {
    const e = this.extras.get(s.floor);
    const view = this.consoles.portOf(s.floor);
    const out = view && s.appPort ? { ...s, viewPort: view } : s;
    // A reading of a build that no longer serves (stopped for an update, until the next reading) is not said.
    const r = e?.readiness && (!e.readiness.sha || e.readiness.sha === s.served?.sha) ? e.readiness : undefined;
    return e ? { ...out, ...(e.main ? { main: e.main } : {}), ...(r ? { readiness: r } : {}) } : out;
  }

  /** The status and served commit each floor was last told with. */
  private last = new Map<string, { status: LiveAppState['status']; served?: string }>();

  /** Told to everyone on the floor; a start, a stop, a crash or a new commit reads what it has again. */
  private changed(state: LiveAppState) {
    this.consoles.sync(state);
    const floor = this.ctx.floors.get(state.floor);
    if (floor) this.ctx.toFloor(floor, { t: 'liveapp.state', state: this.withExtra(state) });
    const was = this.last.get(state.floor);
    this.last.set(state.floor, { status: state.status, served: state.served?.sha });
    if (!was || was.status !== state.status || was.served !== state.served?.sha) {
      // A new served commit (or none: stopped for an update's build) is read again at once, whatever the status.
      if (state.status === 'running' || state.status === 'failed' || state.status === 'stopped' || was?.served !== state.served?.sha) this.schedule(state.floor);
      if (state.status === 'failed' && state.failure?.kind === 'crash' && was?.status === 'running' && floor) this.ctx.toastFloor?.(floor, `🌐 The live app stopped by itself at ${stamp(state.failure.at)}: Restart it on the Live app tab`, 'warn');
    }
    const anyUp = [...this.apps.values()].some((a) => a.status === 'running');
    if (anyUp && !this.timer && this.cfg.pollMs > 0) {
      this.timer = setInterval(() => void this.pollAll(), this.cfg.pollMs);
      this.timer.unref();
    } else if (!anyUp && this.timer && ![...this.apps.values()].some((a) => a.status === 'updating' || a.status === 'starting')) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Reads what the floor's app has, soon (one reading at a time per floor; news meanwhile reads once more after). */
  schedule(floorId: string, force = true) {
    const e = this.extras.get(floorId) ?? {};
    this.extras.set(floorId, e);
    if (force) e.force = true;
    if (e.reading) {
      e.again = true;
      return;
    }
    if (e.timer) return;
    e.timer = setTimeout(() => {
      e.timer = undefined;
      e.reading = this.read(floorId)
        .catch((err) => console.error('agent-office: live app readiness failed', err))
        .finally(() => {
          e.reading = undefined;
          if (e.again) {
            e.again = false;
            this.schedule(floorId);
          }
        });
    }, SETTLE_MS);
    e.timer.unref?.();
  }

  /** Resolves once any reading due for the floor is done (tests, and the first answer to a page). */
  async settled(floorId: string): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const e = this.extras.get(floorId);
      if (!e || (!e.timer && !e.reading)) return;
      await (e.reading ?? new Promise((r) => setTimeout(r, SETTLE_MS + 20)));
    }
  }

  private async read(floorId: string) {
    const floor = this.ctx.floors.get(floorId);
    const e = this.extras.get(floorId);
    if (!floor || !e) return;
    const app = this.apps.get(floorId);
    const s = app?.state;
    // Judged against the served build only: what's being built or updated to has no evidence that counts yet.
    const served = s?.served?.sha;
    const running = !!served;
    const head = s?.branch ? (await floorRef(floor.dir, s.branch).catch(() => undefined))?.sha : undefined;
    const key = `${head ?? '?'}|${served ?? ''}|${running}`;
    if (!e.force && head && key === e.key) return;
    e.force = false;
    e.key = key;
    const got = await readReadiness({ dataDir: this.ctx.cfg.dataDir, floorId, floorDir: floor.dir, ...(served ? { live: served } : {}), running, pulls: floor.github?.pulls?.items ?? [] });
    if (this.extras.get(floorId) !== e) return;
    e.main = got.main;
    e.readiness = got.readiness;
    if (got.readiness) {
      e.news ??= new ReadyNews(this.liveDir, floorId);
      for (const n of e.news.take(got.readiness, running)) {
        this.tell(floor, n.kind, n.title, n.sha);
        emitLiveReady(this.ctx, floorId, n, got.readiness);
      }
    }
    this.ctx.toFloor(floor, { t: 'liveapp.state', state: this.withExtra(s ?? this.blank(floorId)) });
  }

  private blanks = new Map<string, LiveAppState>();
  /** A floor whose app nobody touched since the office started: not started, with what served last before (read once). */
  private blank(floorId: string): LiveAppState {
    let b = this.blanks.get(floorId);
    if (!b) {
      const last = readLastServed(this.liveDir, floorId);
      b = { floor: floorId, status: 'stopped', phase: 'stopped', log: [], available: !!this.mxcli, started: false, ...(last ? { lastServed: last } : {}), prefs: this.prefsOf(floorId) };
      this.blanks.set(floorId, b);
    }
    return { ...b, log: [] };
  }

  private tell(floor: Floor, kind: 'ready' | 'unready', title: string, sha: string) {
    const text = kind === 'ready' ? `✅ Live app ready: ${title}. Try it on the Live app tab` : `🌐 The live app no longer has ${title} (now @${sha.slice(0, 7)})`;
    this.ctx.toastFloor?.(floor, text, kind === 'ready' ? 'info' : 'warn');
    audit.record({ floor: floor.id, actor: { kind: 'office', name: 'Live app' }, action: kind === 'ready' ? 'liveapp.ready' : 'liveapp.unready', target: { kind: 'liveapp', id: floor.id, label: 'Live app' }, summary: kind === 'ready' ? `Live app ready: ${title} (@${sha.slice(0, 7)})` : `The live app no longer has ${title} (@${sha.slice(0, 7)})`, severity: 'info' });
  }

  async pollAll() {
    for (const a of this.apps.values()) await a.poll().catch((err) => console.error('agent-office: live app auto-refresh failed', err));
  }

  /** The office is closing: every app's process goes. */
  async shutdown() {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const e of this.extras.values()) clearTimeout(e.timer);
    for (const u of this.unsubs.splice(0)) u();
    await Promise.all([...this.apps.values()].map((a) => a.shutdown()));
    await this.consoles.shutdown();
    this.units.close();
  }
}

const offices = new WeakMap<object, LiveApps>();

export function liveAppsOf(ctx: Deps): LiveApps {
  let l = offices.get(ctx.cfg);
  if (!l) {
    l = new LiveApps(ctx);
    offices.set(ctx.cfg, l);
  }
  return l;
}

/** The office's live apps, only when someone made them (the notification channels never make them). */
export const liveAppsIfMade = (ctx: Pick<Ctx, 'cfg'>): LiveApps | undefined => offices.get(ctx.cfg);

/** For the office's shutdown: stops the apps if any were ever made, without making the manager. */
export function stopLiveApps(ctx: Pick<Ctx, 'cfg'>): Promise<void> {
  return offices.get(ctx.cfg)?.shutdown() ?? Promise.resolve();
}
