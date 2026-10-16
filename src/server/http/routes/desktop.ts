// The desktop app (desktop/, server/desktop/): its tray's Needs-you count and notifications, read with the
// session its window signed in with. Read-only.

import { desktopStatus } from '../../desktop/status.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

export const desktopRoutes = {
  /** GET /api/desktop/status: every project's red Needs-you items (with their paths) and the agents working. */
  status: { method: 'GET', path: '/api/desktop/status', auth: 'session', handle: async (ctx, { res }) => send(res, 200, await desktopStatus(ctx)) },
} satisfies Record<string, Route>;
