// Every floor's live app, as the office runs them: made the first time someone asks (liveAppsOf),
// told to the people on the floor whenever it changes, refreshed when the floor's main moves on
// GitHub, and stopped with the office. Nothing a browser sends picks what runs: the command, the
// checkout and the ports are all the office's own.

import { forgetWith } from '../office/forget.js';
import path from 'node:path';
import type { LiveAppState } from '../../shared/protocol.js';
import { resolveCommand } from '../workers/process.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { LiveApp } from './app.js';
import { liveAppConfig, type LiveAppConfig } from './config.js';
import { killTreeNow } from './process.js';

type Deps = Pick<Ctx, 'cfg' | 'floors' | 'toFloor'>;

export class LiveApps {
  readonly cfg: LiveAppConfig;
  private apps = new Map<string, LiveApp>();
  /** Lets go of a deleted project's floor (office/forget.ts). */
  private readonly forgetsFloor = forgetWith(this, (o, f) => {
    const app = o.apps.get(f.id);
    if (!app) return;
    o.apps.delete(f.id);
    void app.shutdown().catch(() => undefined);
  });
  private timer: NodeJS.Timeout | undefined;
  private mxcli: string | null;

  constructor(private ctx: Deps) {
    this.cfg = liveAppConfig(ctx.cfg.dataDir);
    this.mxcli = resolveCommand(this.cfg.mxcli);
    // Should the office's process end without its shutdown (a crash), the apps' processes go with it.
    process.once('exit', () => {
      for (const a of this.apps.values()) if (a.pid) killTreeNow(a.pid);
    });
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
        remote: floor.project.remote,
        liveDir: path.join(this.ctx.cfg.dataDir, 'live'),
        taken: () => new Set([...this.apps.values()].flatMap((a) => a.ports)),
        changed: (state) => this.changed(state),
      });
      this.apps.set(floor.id, app);
    }
    return app;
  }

  /** What a floor's app is doing, without making one. */
  stateOf(floor: Floor): LiveAppState {
    return this.apps.get(floor.id)?.state ?? { floor: floor.id, status: 'stopped', log: [], available: !!this.mxcli };
  }

  /** Every running app asks GitHub whether its branch moved, while any is up. */
  private changed(state: LiveAppState) {
    const floor = this.ctx.floors.get(state.floor);
    if (floor) this.ctx.toFloor(floor, { t: 'liveapp.state', state });
    const anyUp = [...this.apps.values()].some((a) => a.status === 'running');
    if (anyUp && !this.timer && this.cfg.pollMs > 0) {
      this.timer = setInterval(() => void this.pollAll(), this.cfg.pollMs);
      this.timer.unref();
    } else if (!anyUp && this.timer && ![...this.apps.values()].some((a) => a.status === 'updating' || a.status === 'starting')) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async pollAll() {
    for (const a of this.apps.values()) await a.poll().catch((err) => console.error('agent-office: live app auto-refresh failed', err));
  }

  /** The office is closing: every app's process goes. */
  async shutdown() {
    clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all([...this.apps.values()].map((a) => a.shutdown()));
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

/** For the office's shutdown: stops the apps if any were ever made, without making the manager. */
export function stopLiveApps(ctx: Pick<Ctx, 'cfg'>): Promise<void> {
  return offices.get(ctx.cfg)?.shutdown() ?? Promise.resolve();
}
