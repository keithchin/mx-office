// The home page's numbers (its 📊 Statistics tab, see server/home-stats.ts) and its 🗺️ 2D Overview's
// floors (server/overview.ts).
import { homeStats } from '../../home-stats.js';
import { overview } from '../../overview.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

export const homeRoutes = {
  /** GET /api/home/stats: the office in totals and a row per project, a few seconds old at most. */
  stats: { method: 'GET', path: '/api/home/stats', auth: 'session', handle: (ctx, { res }) => send(res, 200, homeStats(ctx)) },
  /** GET /api/home/overview: every floor's plan, workers and team, to draw as a pixel office. */
  overview: { method: 'GET', path: '/api/home/overview', auth: 'session', handle: (ctx, { res }) => send(res, 200, overview(ctx)) },
} satisfies Record<string, Route>;
