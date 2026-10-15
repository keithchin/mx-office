// Change answer's routes (server/change-answer/): GET /api/answers/detail?floor=<id>&decision=<ref> is one
// decision's current answer, its full history from the answer store and the work that used it (asked once,
// when the dialog opens or the history is expanded); POST /api/answers/change is the new answer. Both are an
// admin's, checked here on the server; the change comes from the office's own page, with the decision's
// expectedRev (a 409 with the current revision when it changed meanwhile).
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import type { ChangeBody } from '../../../shared/change-answer.js';
import { changeAnswerOf } from '../../change-answer/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import { refuseStale } from '../../phone-access/reauth.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));
const DECISION = /^(esc|q):./;
const ADMIN_ONLY = 'Only the Project Manager (an admin) can change an answer or see its history';

export const changeAnswerRoutes = {
  /** GET /api/answers/detail?floor=<id>&decision=<ref>: admins only. */
  detail: {
    method: 'GET',
    path: '/api/answers/detail',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: ADMIN_ONLY });
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const decision = url.searchParams.get('decision') ?? '';
      if (!DECISION.test(decision)) return send(res, 400, { error: 'decision is esc:<id> or q:<file>#<id>' });
      const d = await changeAnswerOf(ctx).detail(floor.id, decision);
      if (typeof d === 'string') return send(res, 404, { error: d });
      return send(res, 200, d);
    },
  },
  /** POST /api/answers/change {floor, decision, expectedRev, verdict | kind, text, option}: admins only, audited as answer.change. */
  change: {
    method: 'POST',
    path: '/api/answers/change',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: ADMIN_ONLY });
      let body: Partial<ChangeBody>;
      try {
        body = JSON.parse((await readBody(req, 32 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      const decision = String(body.decision ?? '');
      if (!DECISION.test(decision)) return send(res, 400, { error: 'decision is esc:<id> or q:<file>#<id>' });
      if (typeof body.expectedRev !== 'number') return send(res, 400, { error: 'expectedRev is the revision you saw' });
      // Through Phone access, what types a change needs the password again (phone-access/reauth.ts).
      if (refuseStale(ctx, req, res, () => true)) return;
      const by = session.account?.name ?? 'The Project Manager';
      const s = changeAnswerOf(ctx);
      const r = await s.change(floor.id, { ...body, floor: floor.id, decision, expectedRev: body.expectedRev } as ChangeBody, { by, ...(session.account?.id ? { owner: session.account.id } : {}) });
      if (!r.ok) return send(res, r.status, { error: r.error, ...(r.current ? { current: r.current } : {}) });
      const d = await s.detail(floor.id, decision);
      return send(res, 200, { rev: r.rev, ...(r.note ? { note: r.note } : {}), ...(typeof d === 'string' ? {} : { detail: d }) });
    },
  },
} satisfies Record<string, Route>;
