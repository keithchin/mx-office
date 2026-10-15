// Decision cards' routes (server/decisions/): GET /api/decisions?floor=<id> is what the cards are built
// with besides the other feeds (the Separate choices, the status checks after I've done it); POST
// /api/decisions/action is a card's button. Every action is an admin's (checked here, on the server),
// from the office's own page, and re-asks the password through Phone access where an answer could let
// code land (isRisky, as the escalation answer does).
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { isRisky } from '../../../shared/mobile.js';
import { isEscalationVerdict } from '../../../shared/roster/escalation.js';
import { rosterOf } from '../../roster/adapter.js';
import { decisionsOf, isDecisionAction, DECISION_ACTIONS } from '../../decisions/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));
const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

async function jsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 32 * 1024)) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return undefined;
  }
}

export const decisionRoutes = {
  /** GET /api/decisions?floor=<id>: the floor's Separate choices and status checks, and whether you may act. */
  view: {
    method: 'GET',
    path: '/api/decisions',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, await decisionsOf(ctx).view(floor, ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/decisions/action {floor, action, escalation?, others?, verdict?, text?, cardId?, sourceId?, expectedRev?}: admins only, audited. */
  act: {
    method: 'POST',
    path: '/api/decisions/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can act on decision cards' });
      const body = await jsonBody(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such floor' });
      if (!isDecisionAction(body.action)) return send(res, 400, { error: `action is one of ${DECISION_ACTIONS.join(', ')}` });
      const verdict = isEscalationVerdict(body.verdict) ? body.verdict : undefined;
      const esc = str(body.escalation);
      // An approval through Phone access needs the password again, as on the escalation route.
      const risky = () => body.action === 'answer' && !!verdict && isRisky({ do: 'escalation', verdict }, rosterOf(ctx).data(floor.id).escalations.find((e) => e.id === esc));
      if (refuseStale(ctx, req, res, risky)) return;
      const by = session.account?.name ?? (str(body.by, 32) ?? 'The Project Manager');
      const others = Array.isArray(body.others) ? body.others.map((x) => str(x, 40)).filter((x): x is string => !!x).slice(0, 20) : [];
      const expectedRev = typeof body.expectedRev === 'number' && Number.isInteger(body.expectedRev) ? body.expectedRev : undefined;
      const failed = await decisionsOf(ctx).actResult(
        floor,
        { action: body.action, ...(esc ? { escalation: esc } : {}), others, ...(verdict ? { verdict } : {}), ...(typeof body.text === 'string' ? { text: body.text } : {}), ...(str(body.cardId) ? { cardId: str(body.cardId) } : {}), ...(str(body.sourceId) ? { sourceId: str(body.sourceId) } : {}), ...(expectedRev !== undefined ? { expectedRev } : {}) },
        by,
        session.account?.id,
      );
      // A stale answer is a 409 with the decision's current state; nothing was written or typed.
      if (failed) return send(res, failed.status, { error: failed.error, ...(failed.current ? { current: failed.current } : {}) });
      return send(res, 200, await decisionsOf(ctx).view(floor, true));
    },
  },
} satisfies Record<string, Route>;
