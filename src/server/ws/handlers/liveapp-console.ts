// The live app's Console on the 🌐 Live app tab: the page says when it's showing, and while it is the
// person is sent the runtime log and the app's requests as they come (server/liveapp/console/). Anyone
// on the floor may watch, as anyone may watch the tab; leaving the floor or the office stops it.
import type { LiveAppClientMsg } from '../../../shared/protocol.js';
import { liveAppsIfMade, liveAppsOf } from '../../liveapp/index.js';
import type { FeatureHooks, HandlerMap } from './types.js';

export const liveAppConsoleHandlers = {
  'liveapp.console'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    if (!floor) return;
    try {
      liveAppsOf(ctx).consoles.watch(floor.id, c, (m) => ctx.sendTo(c, m), msg.on === true);
    } catch (err) {
      // The Console is a convenience: whatever went wrong, the office goes on.
      console.error('agent-office: live app console', err);
    }
  },
} satisfies HandlerMap<Extract<LiveAppClientMsg, { t: 'liveapp.console' }>>;

export const liveAppConsoleHooks: FeatureHooks = {
  leaving(ctx, c, was) {
    if (was) liveAppsIfMade(ctx)?.consoles.unwatch(c, was.id);
  },
  closed(ctx, c) {
    liveAppsIfMade(ctx)?.consoles.unwatch(c);
  },
};
