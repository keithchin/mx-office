// 🗺️ GET /api/process-map/pins?floor=: the floor's process map (where the deliverables scan found it) and
// where each open question and ASSUMED decision is pinned on it, for the decision cards' "See where this
// fits" link (server/process-map/). Read-only; anyone signed in may read it, as the documents themselves.

import { deliverablesOf, sourceOf } from '../../deliverables/index.js';
import { pinsView } from '../../process-map/index.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const processMapRoutes = {
  pins: {
    method: 'GET',
    path: '/api/process-map/pins',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const view = await deliverablesOf(ctx, floor);
      return send(res, 200, await pinsView(floor.id, view, (src) => sourceOf(ctx, floor, src)));
    },
  },
} satisfies Record<string, Route>;
