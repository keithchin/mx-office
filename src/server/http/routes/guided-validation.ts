// The App Workspace's guided validation (C5, server/guided-validation/): GET the scenarios of one version with
// their results at exactly that version and the marks made there; POST a mark ("Works as expected" or
// "Something's wrong", which becomes a correction through the change requests' path). Who may mark is who may
// ask for a change: anyone signed in, from the office's own pages (another site's page is refused).
import type { Route } from '../router.js';
import { validationBook, validationOf } from '../../guided-validation/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';

const SHA = /^[0-9a-f]{7,64}$/i;

export const guidedValidationRoutes = {
  /** GET /api/guided-validation?floor=<id>&revision=<sha>: that version's scenarios, results and marks, and the project's corrections. */
  view: {
    method: 'GET',
    path: '/api/guided-validation',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const revision = url.searchParams.get('revision') ?? '';
      if (!SHA.test(revision)) return send(res, 400, { error: 'Say which version' });
      return send(res, 200, await validationOf(ctx, floor, revision.toLowerCase()));
    },
  },
  /** POST /api/guided-validation/mark {floor, revision, scenario, verdict: works|wrong, note?, page?, pageMoved?}: the mark as kept; audited. */
  mark: {
    method: 'POST',
    path: '/api/guided-validation/mark',
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
      const r = await validationBook(ctx).mark(floor.id, { revision: body.revision, scenario: body.scenario, verdict: body.verdict, note: body.note, page: body.page, pageMoved: body.pageMoved, by, ...(session.account?.id ? { owner: session.account.id } : {}) });
      if (!r.ok) return send(res, r.status, { error: r.error, ...(r.served ? { served: r.served } : {}) });
      return send(res, 200, { finding: r.finding });
    },
  },
} satisfies Record<string, Route>;
