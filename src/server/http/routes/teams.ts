// The sub-boards' routes (docs/teams.md, "Sub-boards"): GET what a team's page reads from the project
// (its journal, memos, design artifacts, the newest standup), and POST to make the `team:` labels the
// Project Manager is about to tag with. Reading is for anyone signed in; making labels is the Project Manager's (an admin).

import { isCardTeam } from '../../../shared/roster/card-team.js';
import { envDryRun } from '../../roster/issues.js';
import { rosterOf } from '../../roster/adapter.js';
import { ensureTeamLabels } from '../../teams/labels.js';
import { teamPageData } from '../../teams/page-data.js';
import { deliverablesOf } from '../../deliverables/index.js';
import { sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const teamRoutes = {
  /** GET /api/teams/page?floor=<id>&team=<team> */
  page: {
    method: 'GET',
    path: '/api/teams/page',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const team = url.searchParams.get('team');
      if (!isCardTeam(team) || team === 'unassigned') return send(res, 400, { error: 'Which team?' });
      const [data, all] = await Promise.all([teamPageData(floor.id, floor.dir, team), deliverablesOf(ctx, floor)]);
      return send(res, 200, { ...data, deliverables: { ...all, items: all.items.filter((i) => i.team === team) } });
    },
  },
  /** POST /api/teams/labels?floor=<id>: makes the team labels the repo hasn't got, as the office's gh account. */
  labels: {
    method: 'POST',
    path: '/api/teams/labels',
    auth: 'session',
    async handle(ctx, { req, res, url, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can tag cards with a team' });
      const dryRun = envDryRun() || rosterOf(ctx).data(floor.id).settings.dryRunIssues;
      const r = await ensureTeamLabels(floor, dryRun);
      return r.error ? send(res, 502, r) : send(res, 200, r);
    },
  },
} satisfies Record<string, Route>;
