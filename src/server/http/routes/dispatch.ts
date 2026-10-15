// Durable dispatch's routes (server/dispatch/, roster/dispatch-person.ts): GET /api/dispatch?floor=<id> is
// the floor's dispatches that need a person (outcome unknown: the card in Needs you), POST
// /api/dispatch/action is a person's choice on one (Send again, It went through, Abandon; for an issue
// Check GitHub, Create it, It exists: link #…). Every action is an admin's, checked here on the server,
// from the office's own page. A viewer who isn't an admin sees the cards without the answer's text.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { DISPATCH_PERSON_ACTIONS, isDispatchPersonAction, type DispatchView } from '../../../shared/dispatch.js';
import { rosterOf, teamFloor } from '../../roster/adapter.js';
import { personAct } from '../../roster/dispatch-person.js';
import { readBody, sameOrigin, send } from '../util.js';
import { refuseStale } from '../../phone-access/reauth.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

/** The floor's records a person must settle (outcome unknown), the answer's text only for admins. */
export async function dispatchView(ctx: Ctx, floorId: string, admin: boolean): Promise<DispatchView> {
  const d = rosterOf(ctx).dispatch;
  await d.ready(floorId);
  const unsettled = d
    .unsettled(floorId)
    .filter((r) => r.state === 'outcome-unknown')
    .map((r) => (admin ? r : { ...r, payload: '', transcriptPath: undefined }));
  return { floor: floorId, admin, unsettled };
}

export const dispatchRoutes = {
  /** GET /api/dispatch?floor=<id>: the dispatches whose outcome a person must settle. */
  view: {
    method: 'GET',
    path: '/api/dispatch',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, await dispatchView(ctx, floor.id, ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/dispatch/action {floor, id, action, issue?, url?}: admins only, audited as dispatch.*. */
  act: {
    method: 'POST',
    path: '/api/dispatch/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can settle an answer whose outcome is unknown' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such floor' });
      if (!isDispatchPersonAction(body.action)) return send(res, 400, { error: `action is one of ${DISPATCH_PERSON_ACTIONS.join(', ')}` });
      // Through Phone access, what types an answer again or makes an issue needs the password again (phone-access/reauth.ts).
      if (refuseStale(ctx, req, res, () => body.action === 'send-again' || body.action === 'create-issue')) return;
      const as = session.account?.id ? ctx.signins.ghAs(session.account.id) : undefined;
      const by = session.account?.name ?? 'The Project Manager';
      const issue = typeof body.issue === 'number' ? body.issue : typeof body.issue === 'string' && /^#?\d{1,9}$/.test(body.issue.trim()) ? Number(body.issue.trim().replace('#', '')) : undefined;
      const r = await personAct(rosterOf(ctx), teamFloor(ctx, floor), String(body.id ?? ''), body.action, by, { ...(session.account?.id ? { owner: session.account.id } : {}), ...(issue ? { issue } : {}), ...(as && typeof as !== 'string' ? { env: as.env } : {}) });
      if (r.error) return send(res, 400, { error: r.error });
      return send(res, 200, { ...(await dispatchView(ctx, floor.id, true)), ...(r.note ? { note: r.note } : {}) });
    },
  },
} satisfies Record<string, Route>;
