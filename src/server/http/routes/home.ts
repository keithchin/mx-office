// The home page's numbers (its 📊 Statistics tab, see server/home-stats.ts).
import { homeStats } from '../../home-stats.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

export const homeRoutes = {
  /** GET /api/home/stats: the office in totals and a row per project, a few seconds old at most. */
  stats: { method: 'GET', path: '/api/home/stats', auth: 'session', handle: (ctx, { res }) => send(res, 200, homeStats(ctx)) },
} satisfies Record<string, Route>;
