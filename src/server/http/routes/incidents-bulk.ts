// "Resolve old incidents…" on the Incidents page (ui/incidents/bulk.ts): POST /api/incidents/bulk-resolve
// {ids, note} resolves the ticked incidents that may be (server/incidents/bulk.ts). Admins only, same
// origin, and through Phone access the password again, as resolving one is.

import { BULK_MAX } from '../../../shared/incidents-bulk.js';
import { bulkResolve } from '../../incidents/bulk.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { send } from '../util.js';
import { actorOf, adminBody } from './incidents.js';
import type { Route } from '../router.js';

export const incidentBulkRoutes = {
  resolve: {
    method: 'POST',
    path: '/api/incidents/bulk-resolve',
    auth: 'session',
    async handle(ctx, r) {
      const body = await adminBody(ctx, r);
      if (!body) return;
      if (refuseStale(ctx, r.req, r.res)) return;
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 64) : [];
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
      if (!note) return send(r.res, 400, { error: 'A bulk resolve needs a short note saying why' });
      if (!ids.length) return send(r.res, 400, { error: 'Tick at least one incident' });
      if (ids.length > BULK_MAX) return send(r.res, 400, { error: `At most ${BULK_MAX} at once` });
      return send(r.res, 200, bulkResolve(ids, note, actorOf(r.session)));
    },
  },
} satisfies Record<string, Route>;
