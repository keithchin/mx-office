// App Insights › Testing (server/testing/): a floor's test-run records and what they say against the
// files at main, read-only. Signed-in users, like the other App Insights pages. `part=plan` hands the
// test plan's markdown, asked only when its panel opens.
import { officeDeps, testingView, testPlanText } from '../../testing/index.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const testingRoutes = {
  /** GET /api/testing?floor=<id>[&part=plan]: the TestingView (or the test plan's text). */
  view: {
    method: 'GET',
    path: '/api/testing',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      try {
        if (url.searchParams.get('part') === 'plan') {
          const plan = await testPlanText(floor);
          return plan ? send(res, 200, plan) : send(res, 404, { error: 'No test plan at main' });
        }
        return send(res, 200, await testingView(ctx.cfg.dataDir, floor, officeDeps(ctx)));
      } catch (err) {
        return send(res, 500, { error: (err as Error).message });
      }
    },
  },
} satisfies Record<string, Route>;
