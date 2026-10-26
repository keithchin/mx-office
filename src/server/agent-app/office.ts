// The office's agents' app instances (./service.ts), made the first time an agent asks, with the office's
// mxcli and PostgreSQL as the live apps have them (liveapp/config.ts) and the walkthroughs' rule that a live
// app building now goes first (walkthroughs/busy.ts). At the office's start, what a crashed office left
// running is cleaned up a little later, off the event loop (`startAgentApps`, office/timers.ts).

import type { Ctx } from '../office/context.js';
import { liveAppConfig } from '../liveapp/config.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import { resolveCommand } from '../workers/process.js';
import { instanceDir, startAppInstance } from '../app-instance/index.js';
import { dropLeftovers, instanceDbStem, realPsql } from '../app-instance/db.js';
import { liveAppBuilding } from '../walkthroughs/busy.js';
import { runnerConfigAt } from '../walkthroughs/identity.js';
import { mxcliFor } from '../testing/mxcli-tool.js';
import { playSeed, type JourneyDeps } from './journey.js';
import { AgentApps } from './service.js';

type Deps = Pick<Ctx, 'cfg' | 'floors'>;

const offices = new WeakMap<object, AgentApps>();

/** What a journey run on `floorId` needs (the mxcli version is read once per run, cached by mxcliFor's caller). */
export async function journeyDeps(ctx: Deps, floorId: string): Promise<JourneyDeps | undefined> {
  const floor = ctx.floors.get(floorId);
  if (!floor) return undefined;
  const tool = await mxcliFor(ctx.cfg.dataDir, floor.dir).catch(() => ({ why: '' }));
  return { dataDir: ctx.cfg.dataDir, floorDir: floor.dir, ...('version' in tool ? { mxcliVersion: tool.version } : {}) };
}

export function agentAppsOf(ctx: Deps): AgentApps {
  let a = offices.get(ctx.cfg);
  if (a) return a;
  const dataDir = ctx.cfg.dataDir;
  const made: AgentApps = new AgentApps({
    dataDir,
    floorDir: (id) => ctx.floors.get(id)?.dir,
    boot: async (s) => {
      const c = liveAppConfig(dataDir);
      const busy = () => {
        const apps = liveAppsIfMade(ctx as Ctx);
        return apps ? liveAppBuilding(ctx.floors.values(), (f) => apps.peek(f)?.status, s.floorId) : undefined;
      };
      const app = await startAppInstance({ floorId: s.floorId, floorDir: s.floorDir, commit: s.commit, purpose: s.purpose, dataDir, cfg: c, mxcli: resolveCommand(c.mxcli), taken: () => liveAppsIfMade(ctx as Ctx)?.takenPorts() ?? [], busy, signal: s.signal, progress: s.progress, onPhase: s.onPhase });
      return Object.assign(app, { workspace: instanceDir(dataDir, s.floorId, s.purpose) });
    },
    users: async (dir, commit) => {
      const cfg = await runnerConfigAt(dir, commit);
      if (!cfg) return [];
      const out = [...(cfg.user ? [{ user: cfg.user, role: 'default' }] : []), ...cfg.roles.map((r) => ({ user: r.user, role: r.label ?? r.key }))];
      return out.filter((u, i) => out.findIndex((x) => x.user === u.user) === i);
    },
    seed: async (e) => {
      const d = await journeyDeps(ctx, e.floorId);
      return d ? playSeed(e, d) : undefined;
    },
    dropDatabases: async (floorId, purpose) => {
      await dropLeftovers(realPsql, liveAppConfig(dataDir).db, instanceDbStem(floorId, purpose));
    },
  });
  offices.set(ctx.cfg, made);
  return (a = made);
}

/** At the office's start: a crashed office's leftovers cleaned up after a minute; every instance stopped when it stops. */
export function startAgentApps(ctx: Deps): () => void {
  const t = setTimeout(() => {
    void agentAppsOf(ctx)
      .recover()
      .then((said) => said.length && console.log(`agent-office: cleaned up agents' app instances an earlier office left: ${said.join('; ')}`))
      .catch(() => undefined);
  }, 60_000);
  t.unref?.();
  return () => {
    clearTimeout(t);
    void offices.get(ctx.cfg)?.shutdown();
  };
}
