// The office's walkthroughs (./index.ts): made the first time someone asks, when new test evidence lands
// (testing/news.ts: a build on main whose journeys passed), or when the live app says a milestone is ready
// (liveapp/ready-bus.ts). Recordings never use the person's live app: each batch starts the office's own
// copy of the app at the commit it records (app-instance/: its own work folder, ports and fresh database,
// stopped when the batch is done), with mxcli and PostgreSQL as the live apps have them (liveapp/config.ts).

import type { Ctx } from '../office/context.js';
import { gh } from '../github.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import { liveAppConfig } from '../liveapp/config.js';
import { journeyResults } from '../liveapp/readiness.js';
import { onLiveReady, type ReadyCtx } from '../liveapp/ready-bus.js';
import { onTestRuns } from '../testing/news.js';
import { resolveCommand } from '../workers/process.js';
import { startAppInstance } from '../app-instance/index.js';
import { audit } from '../audit/index.js';
import { testModeOf } from '../testmode.js';
import { liveAppBuilding } from './busy.js';
import { Walkthroughs } from './index.js';

type Deps = ReadyCtx;

const offices = new WeakMap<object, Walkthroughs>();

export function walkthroughsOf(ctx: Deps): Walkthroughs {
  let w = offices.get(ctx.cfg);
  if (!w) {
    const dataDir = ctx.cfg.dataDir;
    const cfg = () => liveAppConfig(dataDir);
    w = new Walkthroughs({
      dataDir,
      floorDir: (id) => ctx.floors.get(id)?.dir,
      boot: async (id, commit, signal, progress, onPhase) => {
        const floor = ctx.floors.get(id);
        if (!floor) throw new Error('no such project');
        const c = cfg();
        // A live app building now goes first (./busy.ts).
        const busy = () => {
          const apps = liveAppsIfMade(ctx);
          return apps ? liveAppBuilding(ctx.floors.values(), (f) => apps.peek(f)?.status, id) : undefined;
        };
        return startAppInstance({ floorId: id, floorDir: floor.dir, commit, purpose: 'rec', dataDir, cfg: c, mxcli: resolveCommand(c.mxcli), taken: () => liveAppsIfMade(ctx)?.takenPorts() ?? [], busy, signal, progress, ...(onPhase ? { onPhase } : {}) });
      },
      bootBlocked: () => {
        const c = cfg();
        return resolveCommand(c.mxcli) ? undefined : `mxcli isn’t installed on the office’s machine (looked for "${c.mxcli}"; set AGENT_OFFICE_LIVE_MXCLI)`;
      },
      // A test office never starts a real app (and a real database) by itself: only when someone asks.
      autoBlocked: (id) => (testModeOf(ctx.floors.get(id)?.dir).on ? 'this is a test office (recordings start only when an admin asks)' : undefined),
      passedAt: async (id, sha, ids) => (await journeyResults(dataDir, id, sha, ids)).filter((r) => r.status === 'passed').map((r) => r.journey),
      title: (id) => {
        const goal = liveAppsIfMade(ctx)?.peek(id)?.readiness?.goal;
        return goal && goal !== 'the whole build plan' ? goal : (ctx.floors.get(id)?.def.name ?? 'the app');
      },
      gh: (args, cwd) => gh(args, cwd, 120_000),
      changed: (id, m) => {
        if (!m || (m.status !== 'passed' && m.status !== 'failed' && m.status !== 'error') || m.saved) return;
        const floor = ctx.floors.get(id);
        const what = m.kind === 'tour' ? 'Guided tour' : `Walkthrough “${m.journey.title}”`;
        const said = m.status === 'passed' ? `${what} recorded @${m.app.commit.slice(0, 7)}` : `${what} ${m.status === 'failed' ? `failed at step ${m.failure?.step ?? '?'}` : 'didn’t finish'}: ${m.failure?.why ?? ''}`;
        ctx.toastFloor?.(floor, `🎬 ${said}. Watch it on the Walkthroughs page`, m.status === 'passed' ? 'info' : 'warn');
        audit.record({ floor: id, actor: { kind: 'office', name: 'Walkthroughs' }, action: 'liveapp.walkthrough.recorded', target: { kind: 'liveapp', id: m.id, label: m.journey.title }, summary: said, details: { status: m.status, commit: m.app.commit, trigger: m.trigger, journey: m.journey.id }, severity: 'info' });
      },
    });
    offices.set(ctx.cfg, w);
  }
  return w;
}

export const walkthroughsIfMade = (ctx: Pick<Ctx, 'cfg'>) => offices.get(ctx.cfg);

// A milestone ready in the live app: its passing journeys are recorded when the project's switch is on.
onLiveReady((ctx, floorId, news, readiness) => walkthroughsOf(ctx).onReady(floorId, news, readiness));

/**
 * At the office's start (office/timers.ts): new test evidence for a project records the journeys that passed
 * against main's newest commit (the service is made only then). Returns what stops it, and the running batch.
 */
export function startWalkthroughs(ctx: Deps): () => void {
  const off = onTestRuns((floorId) => {
    if (!ctx.floors.get(floorId)) return;
    void walkthroughsOf(ctx)
      .onTestRuns(floorId)
      .catch((err) => console.error('agent-office: walkthrough auto-record failed', err));
  });
  return () => {
    off();
    walkthroughsIfMade(ctx)?.shutdown();
  };
}
