// The Analysis tab's numbers (which model does well on which kind of task, see server/analysis/) and
// the board's project summary (what's happening on a floor, see server/summary/).
import type { GroupBy } from '../../../shared/analysis.js';
import { analysisOf } from '../../analysis/index.js';
import { summaryOf } from '../../summary/index.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const analysisRoutes = {
  /** GET /api/analysis?scope=global, or ?floor=<id> for one project; &by=effort splits each model by its effort. */
  report: {
    method: 'GET',
    path: '/api/analysis',
    auth: 'session',
    handle(ctx, { res, url }) {
      const floorId = url.searchParams.get('floor');
      if (floorId && url.searchParams.get('scope') !== 'global' && !ctx.floors.has(floorId) && !analysisOf(ctx).store.all().some((r) => r.floor === floorId)) return send(res, 404, { error: 'No such floor' });
      const by: GroupBy = url.searchParams.get('by') === 'effort' ? 'effort' : 'model';
      const floor = url.searchParams.get('scope') === 'global' ? undefined : (floorId ?? undefined);
      return send(res, 200, analysisOf(ctx).report([...ctx.floors.values()], { floor, by }));
    },
  },
  /** POST /api/analysis/backfill: records every worker on every floor again. Admins only: it asks the small model about each new one. */
  backfill: {
    method: 'POST',
    path: '/api/analysis/backfill',
    auth: 'session',
    handle(ctx, { res, session }) {
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can re-run the analysis' });
      const a = analysisOf(ctx);
      if (a.busy) return send(res, 202, { started: false, busy: true });
      void a.backfill([...ctx.floors.values()]).catch((err) => console.error('agent-office: analysis backfill failed', err));
      return send(res, 202, { started: true, busy: true });
    },
  },
  /** GET /api/summary?floor=<id>: what's happening on a floor, for the panel above its board. */
  summary: {
    method: 'GET',
    path: '/api/summary',
    auth: 'session',
    handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, summaryOf(ctx).summary(floor));
    },
  },
} satisfies Record<string, Route>;
