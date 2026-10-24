// The Model tab's "Change this" (server/model-change/): POST a change request (the element(s), the branch
// and commit they were read at, what should change, who it goes to and when), and GET the floor's open
// requests with their PRs for the badges. Reading is for anyone signed in; asking is for the Project Manager
// (an admin), checked here as the page's Change this button is shown only to admins: a view never grants it.
// Each request also gets a linked Developer change (DC-n, its alias MCR-n): one request id, still delivered to
// the member chosen here (server/dev-changes/links.ts says why it's linked, not queued).
import type { Route } from '../router.js';
import { changeRequestsOf } from '../../model-change/index.js';
import { devChangesOf } from '../../dev-changes/index.js';
import { mcrLink } from '../../dev-changes/links.js';
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
      if (!floor) return send(res, 404, { error: 'No such project' });
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
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can ask for a change from the Model tab. Use Request a change in the Developer view instead.' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such project' });
      const by = session.account?.name ?? (typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 32) : 'The Project Manager');
      const r = await changeRequestsOf(ctx).request(floor.id, { elements: body.elements, ref: body.ref, sha: body.sha, request: body.request, role: body.role, when: body.when, by, ...(session.account?.id ? { owner: session.account.id } : {}) });
      if (typeof r === 'string') return send(res, 400, { error: r });
      // One identity across entry points: a linked request id (DC-n) beside MCR-n, its alias (dev-changes/links.ts).
      const linked = await devChangesOf(ctx).changes.link(floor.id, mcrLink(r, session.account?.id)).catch(() => undefined);
      return send(res, 200, { request: r, ...(linked ? { change: linked.change.id } : {}) });
    },
  },
} satisfies Record<string, Route>;
