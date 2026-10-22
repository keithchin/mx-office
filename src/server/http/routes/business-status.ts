// The business status (server/business-status/, shared/business-status.ts): anyone signed in GETs a
// project's status and each milestone's, derived from the records the office keeps, each naming its
// revision and what is missing for the next status. Read-only.

import { businessViewOf } from '../../business-status/index.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const businessStatusRoutes = {
  /** GET /api/business-status?floor=<id>: the project's business status and its milestones'. */
  view: {
    method: 'GET',
    path: '/api/business-status',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const v = await businessViewOf(ctx, floor);
      return v ? send(res, 200, v) : send(res, 503, { error: "The project's status couldn't be worked out just now" });
    },
  },
} satisfies Record<string, Route>;
