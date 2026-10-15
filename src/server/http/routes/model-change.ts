// The Model tab's "Change this" (server/model-change/): POST a change request (the element(s), the branch
// and commit they were read at, what should change, who it goes to and when), and GET the floor's open
// requests with their PRs for the badges. Signed in, as prompting a worker from the Board is.
import type { Route } from '../router.js';
import { changeRequestsOf } from '../../model-change/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';

export const modelChangeRoutes = {
  /** GET /api/model/change-requests?floor=<id>[&all=1]: the floor's change requests (open ones, or all), newest first. */
  list: {
    method: 'GET',
    path: '/api/model/change-requests',
    auth: 'session',
    handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, { requests: changeRequestsOf(ctx).list(floor.id, url.searchParams.get('all') === '1') });
    },
  },
  /** POST /api/model/change-request {floor, elements: [{kind, qn}], ref, sha?, request, role, when?: 'after'|'now', by?}: audited. */
  create: {
    method: 'POST',
    path: '/api/model/change-request',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const by = session.account?.name ?? (typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 32) : 'The Project Manager');
      const r = await changeRequestsOf(ctx).request(floor.id, { elements: body.elements, ref: body.ref, sha: body.sha, request: body.request, role: body.role, when: body.when, by, ...(session.account?.id ? { owner: session.account.id } : {}) });
      if (typeof r === 'string') return send(res, 400, { error: r });
      return send(res, 200, { request: r });
    },
  },
} satisfies Record<string, Route>;
