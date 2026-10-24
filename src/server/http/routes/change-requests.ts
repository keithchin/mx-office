// The App Workspace's change requests (server/change-requests/): GET a project's requests with their state in
// business words, POST a new one (the person's words, the page and the version on screen), which becomes a task
// for the team's lead. Who may ask is who may create work today: anyone signed in, from the office's own pages
// (another site's page is refused), as the lead panel's tell and the Model tab's Change this are.
import type { Route } from '../router.js';
import { requestsOf } from '../../change-requests/index.js';
import { devChangesOf } from '../../dev-changes/index.js';
import { currentRequest } from '../../../shared/change-requests.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';

export const changeRequestRoutes = {
  /** GET /api/change-requests?floor=<id>: the requests with their state, newest first, and the current one's id. */
  list: {
    method: 'GET',
    path: '/api/change-requests',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const requests = await requestsOf(ctx, floor);
      return send(res, 200, { floor: floor.id, requests, current: currentRequest(requests)?.id ?? null });
    },
  },
  /**
   * POST /api/change-requests {floor, text, page?, pageMoved?, revision?, source?, ref?, key?, by?}: a Developer change
   * (server/dev-changes/), queued and on disk, handed to the lead as a task when it's its turn and the team can take it
   * (else it waits, saying why). The same `key` again gives back the same change. Audited.
   */
  create: {
    method: 'POST',
    path: '/api/change-requests',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let body: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
        body = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such project' });
      const by = session.account?.name ?? (typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 32) : 'The Project Manager');
      const r = await devChangesOf(ctx).changes.intake(floor.id, { text: body.text, page: body.page, pageMoved: body.pageMoved, revision: body.revision, source: body.source, ref: body.ref, key: body.key, by, ...(session.account?.id ? { owner: session.account.id } : {}) });
      if (typeof r === 'string') return send(res, 400, { error: r });
      return send(res, 200, { change: r.change, again: r.again });
    },
  },
} satisfies Record<string, Route>;
