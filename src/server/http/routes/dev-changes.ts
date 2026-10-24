// Developer changes (server/dev-changes/): GET a project's changes with their state and the revision strip,
// POST cancel for one that hasn't started. A new change is made through the change requests' POST (C4's entry,
// http/routes/change-requests.ts), which queues it here. Who may cancel: whoever asked for it, or an admin; from
// the office's own pages only.
import type { Route } from '../router.js';
import { changesView, devChangesOf } from '../../dev-changes/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';

export const devChangeRoutes = {
  /** GET /api/dev-changes?floor=<id>: the changes with their state (newest first), the current one and the revision strip. */
  list: {
    method: 'GET',
    path: '/api/dev-changes',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const id = session.account?.id;
      return send(res, 200, await changesView(ctx, floor, { name: session.account?.name ?? 'The Project Manager', ...(id ? { id } : {}), admin: ctx.meOf(id).admin }));
    },
  },
  /** POST /api/dev-changes/cancel {floor, id}: cancels a change that hasn't started (theirs, or an admin's); audited. */
  cancel: {
    method: 'POST',
    path: '/api/dev-changes/cancel',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let body: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 8 * 1024)) || '{}');
        body = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (typeof body.id !== 'string' || !/^DC-\d{1,7}$/.test(body.id)) return send(res, 400, { error: 'Say which change' });
      const id = session.account?.id;
      const admin = ctx.meOf(id).admin;
      const r = await devChangesOf(ctx).changes.cancel(floor.id, body.id, { name: session.account?.name ?? 'The Project Manager', ...(id ? { id } : {}), admin });
      if (typeof r === 'string') return send(res, /Only whoever/.test(r) ? 403 : 400, { error: r });
      return send(res, 200, { change: r });
    },
  },
} satisfies Record<string, Route>;
