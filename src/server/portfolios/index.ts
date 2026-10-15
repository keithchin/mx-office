// Portfolios' composition (./service.ts): the office's floors, the roster, the toolkit and the audit log
// behind PortfolioDeps, one service per office (portfoliosOf), and the five-minute look started with the
// office's other timers (office/timers.ts). The roster asks hireContext at each hire (roster/adapter.ts).

import path from 'node:path';
import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { toolkitDirFor } from '../toolkit-pin/index.js';
import { wizardConfig } from '../wizard/config.js';
import { isRoleId, type RoleId } from '../../shared/roster/roles.js';
import { PortfolioService } from './service.js';

/** The look at each connected brain, on the cadence the other Needs-you sources use. */
export const PORTFOLIO_TICK_MS = 5 * 60_000;

const services = new WeakMap<object, PortfolioService>();

export function portfoliosOf(ctx: Ctx): PortfolioService {
  let s = services.get(ctx.cfg);
  if (!s) {
    s = new PortfolioService({
      dataDir: ctx.cfg.dataDir,
      floors: () => [...ctx.floors.values()].map((f) => ({ id: f.id, name: f.def.name, dir: f.dir, ...(f.def.projectId ? { projectId: f.def.projectId } : {}) })),
      wireEnv: async (dir) => {
        const cfg = wizardConfig();
        return { bash: cfg.bash, toolkitDir: (await toolkitDirFor(dir, cfg.toolkitDir)).dir, denyFile: path.join(path.resolve(cfg.toolkitDir), '.leakguard-deny') };
      },
      hired: (id) => {
        const floor = ctx.floors.get(id);
        if (!floor) return [];
        const r = rosterOf(ctx);
        const d = r.data(id);
        return Object.entries(d.members)
          .filter(([, m]) => m.workerId && (m.phase === 'active' || m.phase === 'benching'))
          .map(([role, m]) => ({ role, name: m.name, workerId: m.workerId! }));
      },
      phase: (id, role) => (isRoleId(role) ? rosterOf(ctx).data(id).members[role]?.phase : undefined),
      bench: (id, role, by) => {
        const floor = ctx.floors.get(id);
        if (!floor || !isRoleId(role)) return 'No such member';
        return rosterOf(ctx).members.bench(teamFloor(ctx, floor), role, by);
      },
      hire: async (id, role, by) => {
        const floor = ctx.floors.get(id);
        if (!floor || !isRoleId(role)) return 'No such member';
        return rosterOf(ctx).members.hire(teamFloor(ctx, floor), role as RoleId, by);
      },
      audit: (e) => void audit.record(e),
      now: () => Date.now(),
    });
    services.set(ctx.cfg, s);
  }
  return s;
}

export function startPortfolios(ctx: Ctx): () => void {
  const s = portfoliosOf(ctx);
  const look = () => void s.tick().catch(() => undefined);
  // A first look soon after start (not during it), then every five minutes.
  const first = setTimeout(look, 30_000);
  const timer = setInterval(look, PORTFOLIO_TICK_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    s.stop();
  };
}
