// Expert mode's routes (server/expert/): GET /api/expert/proof?floor=<id> is the session's proof strip (signed in):
// the branch and last commit with its push, the budget, stuck status and the decision count.
import { expertProofView, isExpertProject } from '../../expert/index.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const expertRoutes = {
  /** GET /api/expert/proof?floor=<id>: { branch, commit, budget, stuck, decisions }. 409 for a Team project. */
  proof: {
    method: 'GET',
    path: '/api/expert/proof',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (!isExpertProject(floor)) return send(res, 409, { error: 'Not an Expert project' });
      return send(res, 200, await expertProofView(ctx, floor));
    },
  },
} satisfies Record<string, Route>;
