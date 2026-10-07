// Evidence (server/evidence/): GET a floor's normalized trace view, built on demand from the audit log,
// the team chatter, analysis runs, the budget ledger and incidents. Read-only, no UI yet: the Evals and
// Library work reads it. Signed-in users only, like /api/audit and /api/chatter, which show the same records.

import { auditLog } from '../../audit/index.js';
import { buildTrace, diskSources, TRACE_MAX } from '../../evidence/trace.js';
import { projectIdsFor } from '../../projects/ids.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

/** A time from the query: milliseconds, or anything Date can read. */
const time = (v: string | null): number | undefined => {
  if (!v) return undefined;
  const n = Number(v);
  const t = Number.isFinite(n) ? n : Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
};

export const evidenceRoutes = {
  /** GET /api/evidence/trace?floor=<id>&since=<ms or date>&limit=<n ≤ 2000> */
  trace: {
    method: 'GET',
    path: '/api/evidence/trace',
    auth: 'session',
    handle(ctx, { res, url }) {
      const p = url.searchParams;
      const id = p.get('floor') ?? '';
      const def = ctx.building.list().find((d) => d.id === id);
      if (!def || !ctx.floors.has(id)) return send(res, 404, { error: 'No such floor' });
      const since = time(p.get('since'));
      if (p.get('since') && since === undefined) return send(res, 400, { error: 'since: milliseconds or a date' });
      const projectId = def.projectId ?? projectIdsFor(ctx.cfg.dataDir).byFloorId(id);
      if (!projectId) return send(res, 409, { error: 'That floor has no project id yet' });
      const limit = Math.min(TRACE_MAX, Number(p.get('limit')) || TRACE_MAX);
      return send(res, 200, buildTrace({ floorId: id, projectId, repo: def.repo, since, limit }, diskSources(ctx.cfg.dataDir, id, auditLog())));
    },
  },
} satisfies Record<string, Route>;
