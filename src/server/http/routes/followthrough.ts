// Recorded as given's routes (server/followthrough/): GET /api/followthrough?floor=<id> is each answered
// decision still being followed through (Needs you's status cards, the Questions page's line), POST
// /api/followthrough/action is the person's choice on one (Accept as recorded, Send correction, Dismiss).
// Every action is an admin's, checked here on the server, from the office's own page, with the decision's
// expectedRev (a 409 with the current revision when it changed).
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { FOLLOW_ACTIONS, isFollowAction } from '../../../shared/followthrough.js';
import { followThroughOf } from '../../followthrough/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import { refuseStale } from '../../phone-access/reauth.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

export const followThroughRoutes = {
  /** GET /api/followthrough?floor=<id>: the answered decisions not yet recorded as given and merged. */
  view: {
    method: 'GET',
    path: '/api/followthrough',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, await followThroughOf(ctx).view(floor.id, ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/followthrough/action {floor, decision, action, expectedRev}: admins only, audited as followthrough.*. */
  act: {
    method: 'POST',
    path: '/api/followthrough/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can accept a record or send a correction' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such floor' });
      if (!isFollowAction(body.action)) return send(res, 400, { error: `action is one of ${FOLLOW_ACTIONS.join(', ')}` });
      const decision = String(body.decision ?? '');
      if (!/^(esc|q):/.test(decision)) return send(res, 400, { error: 'decision is esc:<id> or q:<file>#<id>' });
      // Through Phone access, what types a correction needs the password again (phone-access/reauth.ts).
      if (refuseStale(ctx, req, res, () => body.action === 'send-correction')) return;
      const by = session.account?.name ?? 'The Project Manager';
      const expectedRev = typeof body.expectedRev === 'number' ? body.expectedRev : undefined;
      const s = followThroughOf(ctx);
      const r = await s.act(floor.id, decision, body.action, { by, ...(session.account?.id ? { owner: session.account.id } : {}), ...(expectedRev !== undefined ? { expectedRev } : {}) });
      if (!r.ok) return send(res, r.status, { error: r.error, ...(r.current ? { current: r.current } : {}) });
      return send(res, 200, { ...(await s.view(floor.id, true)), ...(r.note ? { note: r.note } : {}) });
    },
  },
} satisfies Record<string, Route>;
