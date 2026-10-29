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
import { identitiesFor } from './identity.js';
import { instanceConstants, modelConstantsAt } from '../app-instance/constants.js';
import { modelOf } from '../model/index.js';
import { recordAgentCheck } from './checks.js';
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
      const app = await startAppInstance({ floorId: s.floorId, floorDir: s.floorDir, commit: s.commit, purpose: s.purpose, dataDir, cfg: c, mxcli: resolveCommand(c.mxcli), taken: () => liveAppsIfMade(ctx as Ctx)?.takenPorts() ?? [], busy, signal: s.signal, progress: s.progress, onPhase: s.onPhase, constants: s.constants, secrets: s.secrets });
      return Object.assign(app, { workspace: instanceDir(dataDir, s.floorId, s.purpose) });
    },
    users: async (dir, commit, runtimeLog, generated) => {
      const ids = await identitiesFor(dir, commit, runtimeLog, generated ? { generated } : {});
      return { users: ids.users, passwords: ids.passwords };
    },
    // The project's instance constants and the agent's, checked against the model's constants at the commit.
    constants: (dir, commit, requested) =>
      instanceConstants(dir, commit, requested, { model: (d, c) => modelConstantsAt(modelOf(ctx).units, d, c).finally(() => modelOf(ctx).units.blobs(d).close()) }),
    seed: async (e) => {
      const d = await journeyDeps(ctx, e.floorId);
      return d ? playSeed(e, d) : undefined;
    },
    // Each start is a check at its commit: "app start" passed, or couldn't run with the reason (./checks.ts).
    onSettled: (e) =>
      void recordAgentCheck(dataDir, {
        floorId: e.floorId,
        commit: e.commit,
        worker: e.worker,
        workspace: e.workspace,
        suite: 'app start',
        status: e.state === 'ready' ? 'passed' : 'error',
        detail: e.state === 'ready' ? `answered at ${e.instance?.url ?? '?'}${e.instance?.timing?.ms ? ` after ${Math.round(e.instance.timing.ms / 1000)} s` : ''}` : (e.why ?? 'it did not start'),
      }).catch(() => undefined),
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
