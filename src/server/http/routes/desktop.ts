// The desktop app (desktop/, server/desktop/): its tray's Needs-you count and notifications, read with the
// session its window signed in with, and the live app's proxy port for its Show here (desktop/src/core/embed.ts). Read-only.

import { desktopStatus } from '../../desktop/status.js';
import { send } from '../util.js';
import { floorParam } from './files.js';
import { liveAppsOf } from '../../liveapp/index.js';
import type { Route } from '../router.js';

export const desktopRoutes = {
  /** GET /api/desktop/status: every project's red Needs-you items (with their paths) and the agents working. */
  status: { method: 'GET', path: '/api/desktop/status', auth: 'session', handle: async (ctx, { res }) => send(res, 200, await desktopStatus(ctx)) },
  /** GET /api/desktop/liveapp?floor=<id>: the port of the project's live app proxy (viewPort), the only address the app shows in the office window; null when it isn't up. */
  liveapp: {
    method: 'GET',
    path: '/api/desktop/liveapp',
    auth: 'session',
    handle: (ctx, { res, url }) => {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const s = liveAppsOf(ctx).peek(floor.id);
      return send(res, 200, { floor: floor.id, viewPort: s?.status === 'running' && s.viewPort ? s.viewPort : null });
    },
  },
} satisfies Record<string, Route>;
