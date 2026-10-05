// The Git tab's branch graph (see server/gitgraph/): the floor's default branch, its history and every
// other branch with its worker and pull request.
import { gitGraphsOf } from '../../gitgraph/index.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const gitRoutes = {
  /** GET /api/git?floor=<id>: the floor's branches as a graph (shared/gitgraph.ts). */
  graph: {
    method: 'GET',
    path: '/api/git',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      try {
        return send(res, 200, await gitGraphsOf(ctx).graph(floor));
      } catch (err) {
        return send(res, 500, { error: `git couldn't read this floor's branches: ${(err as Error).message}` });
      }
    },
  },
} satisfies Record<string, Route>;
