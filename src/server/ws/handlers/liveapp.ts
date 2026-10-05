// The live app tab: what your floor's app is doing, and ▶ / ⟳ / ■. Everyone may watch it; only admins
// (an admin account, or the shared password) start, restart and stop it, since it runs processes on the
// office's machine. Nobody picks what it runs (server/liveapp/).
import type { LiveAppClientMsg } from '../../../shared/protocol.js';
import type { Client } from '../../office/client.js';
import { throttle } from '../../office/client.js';
import type { Ctx } from '../../office/context.js';
import { liveAppsOf } from '../../liveapp/index.js';
import { here } from './common.js';
import { audit, human } from '../../audit/index.js';
import type { HandlerMap } from './types.js';

/** Whether `c` may run the live app; if not, they're told so. */
const admin = (ctx: Ctx, c: Client): boolean => {
  if (ctx.meOf(c.accountId).admin) return true;
  ctx.warn(c, 'Only admins can start, restart or stop the live app');
  return false;
};

export const liveAppHandlers = {
  'liveapp.status'(ctx, c) {
    const floor = ctx.floorOf(c);
    if (floor) ctx.sendTo(c, { t: 'liveapp.state', state: liveAppsOf(ctx).stateOf(floor) });
  },
  'liveapp.start'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor || !admin(ctx, c) || !throttle(c, 'liveapp', 1500)) return;
    void liveAppsOf(ctx).of(floor).start(c.peer.name);
    audit.record({ floor: floor.id, actor: human(c.peer.name, c.accountId), action: 'liveapp.start', target: { kind: 'liveapp', id: floor.id, label: 'Live app' }, summary: 'Started the live app' });
  },
  'liveapp.restart'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor || !admin(ctx, c) || !throttle(c, 'liveapp', 1500)) return;
    void liveAppsOf(ctx).of(floor).restart(c.peer.name);
    audit.record({ floor: floor.id, actor: human(c.peer.name, c.accountId), action: 'liveapp.restart', target: { kind: 'liveapp', id: floor.id, label: 'Live app' }, summary: 'Restarted the live app' });
    ctx.toastFloor(floor, `🌐 ${c.peer.name} is restarting the live app`);
  },
  'liveapp.stop'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor || !admin(ctx, c) || !throttle(c, 'liveapp', 1500)) return;
    void liveAppsOf(ctx).of(floor).stop(c.peer.name);
    audit.record({ floor: floor.id, actor: human(c.peer.name, c.accountId), action: 'liveapp.stop', target: { kind: 'liveapp', id: floor.id, label: 'Live app' }, summary: 'Stopped the live app' });
  },
} satisfies HandlerMap<LiveAppClientMsg>;
