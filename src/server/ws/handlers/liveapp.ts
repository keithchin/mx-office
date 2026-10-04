// The live app tab: what your floor's app is doing, and ▶ / ⟳ / ■. Anyone signed in to the office is
// an admin or a member, and both may run the floor's app; nobody picks what it runs (server/liveapp/).
import type { LiveAppClientMsg } from '../../../shared/protocol.js';
import { throttle } from '../../office/client.js';
import { liveAppsOf } from '../../liveapp/index.js';
import { here } from './common.js';
import type { HandlerMap } from './types.js';

export const liveAppHandlers = {
  'liveapp.status'(ctx, c) {
    const floor = ctx.floorOf(c);
    if (floor) ctx.sendTo(c, { t: 'liveapp.state', state: liveAppsOf(ctx).stateOf(floor) });
  },
  'liveapp.start'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor || !throttle(c, 'liveapp', 1500)) return;
    void liveAppsOf(ctx).of(floor).start(c.peer.name);
  },
  'liveapp.restart'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor || !throttle(c, 'liveapp', 1500)) return;
    void liveAppsOf(ctx).of(floor).restart(c.peer.name);
    ctx.toastFloor(floor, `🌐 ${c.peer.name} is restarting the live app`);
  },
  'liveapp.stop'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor || !throttle(c, 'liveapp', 1500)) return;
    void liveAppsOf(ctx).of(floor).stop(c.peer.name);
  },
} satisfies HandlerMap<LiveAppClientMsg>;
