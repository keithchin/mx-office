// Design systems' composition (./service.ts): the office's floors, its clients (server/portfolios/), the
// wizard's mxcli, the live apps (read-only: a capture never starts one) and the audit log behind DesignDeps,
// one service per office (designOf). Started with the office's other timers: it loads its files and adds
// the agent-context line to new tasks (tasks/lines.ts); no timer of its own.

import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { onForgetFloor } from '../office/forget.js';
import { liveAppsOf } from '../liveapp/index.js';
import { portfoliosOf } from '../portfolios/index.js';
import { addTaskLineHook } from '../tasks/lines.js';
import { wizardConfig } from '../wizard/config.js';
import { DesignService } from './service.js';
import { useDesignBound } from './bound.js';

const services = new WeakMap<object, DesignService>();

export function designOf(ctx: Ctx): DesignService {
  let s = services.get(ctx.cfg);
  if (!s) {
    const portfolios = portfoliosOf(ctx).store;
    s = new DesignService({
      dataDir: ctx.cfg.dataDir,
      floors: () => [...ctx.floors.values()].map((f) => ({ id: f.id, name: f.def.name, dir: f.dir })),
      clientOf: (floor) => {
        const p = portfolios.ofFloor(floor);
        return p ? { id: p.id, label: p.label } : undefined;
      },
      clientLabel: (id) => portfolios.get(id)?.label,
      mxcli: () => wizardConfig().mxcli,
      live: (id) => {
        const floor = ctx.floors.get(id);
        if (!floor) return { running: false, status: 'stopped' };
        const st = liveAppsOf(ctx).stateOf(floor);
        const running = st.status === 'running' && !!st.appPort;
        return { running, status: st.status, ...(running ? { url: `http://127.0.0.1:${st.appPort}/` } : {}), ...(st.sha ? { sha: st.sha } : {}) };
      },
      audit: (e) => void audit.record(e),
      now: () => Date.now(),
    });
    services.set(ctx.cfg, s);
  }
  return s;
}

export function startDesignSystems(ctx: Ctx): () => void {
  const s = designOf(ctx);
  void s.ready().catch((err: Error) => console.warn(`agent-office: design systems: ${err.message}`));
  const offLine = addTaskLineHook((t) => s.lines.line(t));
  useDesignBound((floor) => !!s.projects.binding(floor));
  const offForget = onForgetFloor((f) => void s.forget(f.id).catch(() => undefined));
  return () => {
    offLine();
    useDesignBound(() => false);
    offForget();
  };
}
