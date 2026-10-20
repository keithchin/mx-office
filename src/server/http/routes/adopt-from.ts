// Start from another app's routes (server/adopt-from/). Reading only; what's adopted is chosen in ✨ New project
// and carried out by its setup:
//   GET /api/adopt-from/sources?client=<id>[&all=1]  the apps a new project of the client can start from, and what
//                                                     each offers; all=1 (other clients' apps too) is for admins only
//   GET /api/adopt-from/record?floor=<id>            what a project was set up with from another app (Project Settings)
import { adoptFromOf } from '../../adopt-from/index.js';
import { isPortfolioId } from '../../../shared/portfolios.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const adoptFromRoutes = {
  sources: {
    method: 'GET',
    path: '/api/adopt-from/sources',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const admin = ctx.meOf(session.account?.id).admin;
      const all = url.searchParams.get('all') === '1';
      if (all && !admin) return send(res, 403, { error: 'Only an admin can start from another client’s app' });
      const c = url.searchParams.get('client') ?? '';
      return send(res, 200, await adoptFromOf(ctx).sources(isPortfolioId(c) ? c : undefined, { all, admin }));
    },
  },
  record: {
    method: 'GET',
    path: '/api/adopt-from/record',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, { record: (await adoptFromOf(ctx).record(floor.id)) ?? null });
    },
  },
} satisfies Record<string, Route>;
