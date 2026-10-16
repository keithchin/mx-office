// Start from a team (server/wizard/team-from-office.ts): the projects whose team the New project flow can copy,
// fetched once when its Team & budget step opens. Admins only (only admins make projects); read-only.
//   GET /api/team-sources   {sources: [{floor, project, client?, shape, roles, models, level?, agents}]}
import type { Route } from '../router.js';
import { send } from '../util.js';
import { teamSources } from '../../wizard/team-from-office.js';

export const teamSourceRoutes = {
  list: {
    method: 'GET',
    path: '/api/team-sources',
    auth: 'session',
    async handle(ctx, { res, session }) {
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins (operators) can set up projects' });
      return send(res, 200, { sources: await teamSources(ctx) });
    },
  },
} satisfies Record<string, Route>;
