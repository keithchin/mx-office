// The office's walkthroughs (./index.ts): made the first time someone asks, or when the live app says a
// milestone is ready (liveapp/ready-bus.ts). The live app is read without starting anything: its state as
// it stands (status, commit) and its recording proxy's port; the recorder only ever opens that proxy.

import type { Ctx } from '../office/context.js';
import { gh } from '../github.js';
import { liveAppsIfMade } from '../liveapp/index.js';
import { onLiveReady, type ReadyCtx } from '../liveapp/ready-bus.js';
import { audit } from '../audit/index.js';
import { Walkthroughs } from './index.js';

type Deps = ReadyCtx;

/** The address the proxy answers on from this machine: its bind address, or loopback when it binds everywhere. */
export const proxyHost = (host: string | undefined) => (!host || host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host);

const offices = new WeakMap<object, Walkthroughs>();

export function walkthroughsOf(ctx: Deps): Walkthroughs {
  let w = offices.get(ctx.cfg);
  if (!w) {
    w = new Walkthroughs({
      dataDir: ctx.cfg.dataDir,
      floorDir: (id) => ctx.floors.get(id)?.dir,
      live: (id) => {
        const s = liveAppsIfMade(ctx)?.peek(id);
        if (!s) return undefined;
        const running = s.status === 'running';
        return {
          running,
          ...(s.sha ? { commit: s.sha } : {}),
          ...(running && s.viewPort ? { url: `http://${proxyHost(ctx.cfg.host)}:${s.viewPort}/` } : {}),
          title: s.readiness?.goal && s.readiness.goal !== 'the whole build plan' ? s.readiness.goal : (ctx.floors.get(id)?.def.name ?? 'the app'),
        };
      },
      gh: (args, cwd) => gh(args, cwd, 120_000),
      changed: (id, m) => {
        if (!m || (m.status !== 'passed' && m.status !== 'failed' && m.status !== 'error') || m.saved) return;
        const floor = ctx.floors.get(id);
        const what = m.kind === 'tour' ? 'Guided tour' : `Walkthrough “${m.journey.title}”`;
        const said = m.status === 'passed' ? `${what} recorded @${m.app.commit.slice(0, 7)}` : `${what} ${m.status === 'failed' ? `failed at step ${m.failure?.step ?? '?'}` : 'didn’t finish'}: ${m.failure?.why ?? ''}`;
        ctx.toastFloor?.(floor, `🎬 ${said}. Watch it on the Live app tab`, m.status === 'passed' ? 'info' : 'warn');
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
