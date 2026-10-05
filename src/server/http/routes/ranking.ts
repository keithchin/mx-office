// The Workers tab's ranking: every worker graded A–F on the standard criteria and its team role's own
// (shared/ranking/), ranked in the building, on its floor, among its model and its role (server/ranking/).
import { analysisOf } from '../../analysis/index.js';
import { rankingReport } from '../../ranking/index.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

export const rankingRoutes = {
  /** GET /api/ranking?floor=<id>, or ?floor=all (or none) for the whole building. */
  report: {
    method: 'GET',
    path: '/api/ranking',
    auth: 'session',
    handle(ctx, { res, url }) {
      const asked = url.searchParams.get('floor');
      const floor = asked && asked !== 'all' ? asked : undefined;
      if (floor && !ctx.floors.has(floor) && !analysisOf(ctx).store.all().some((r) => r.floor === floor)) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, rankingReport(ctx, floor));
    },
  },
} satisfies Record<string, Route>;
