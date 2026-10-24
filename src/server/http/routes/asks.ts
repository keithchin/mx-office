// The surfaced asks' routes (server/asks/): GET /api/asks?floor=<id> is what Needs you shows (signed in);
// POST /api/asks/act is a button on an item (admins: a message to whoever covers Management after their
// turn, your consent, or "seen"), audited.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { asksFloor, asksOf } from '../../asks/index.js';
import { isAskAct } from '../../../shared/asks.js';
import { readBody, send } from '../util.js';
import { fromOffice } from '../origin.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => fromOffice(req, ctx.cfg);

async function jsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return undefined;
  }
}

/** What the toast says once a button did its thing. */
const SENT: Record<string, string> = { 'docs-pr': 'Asked the lead to open a docs PR, after their turn', agree: 'Your consent goes to the lead, after their turn', discuss: 'Asked the lead to raise it with you, after their turn', 'ask-lead': 'Asked the lead about it, after their turn', seen: 'Hidden until it changes' };

export const asksRoutes = {
  /** GET /api/asks?floor=<id>: the floor's surfaced asks and whether you may act. */
  view: {
    method: 'GET',
    path: '/api/asks',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, await asksOf(ctx).view(asksFloor(ctx, floor), ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/asks/act {floor, id, act}: admins only, audited. */
  act: {
    method: 'POST',
    path: '/api/asks/act',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can act on these' });
      const body = await jsonBody(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      if (refuseStale(ctx, req, res)) return;
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (!isAskAct(body.act)) return send(res, 400, { error: 'Which action?' });
      const by = session.account?.name ?? (typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 32) : 'The Project Manager');
      const f = asksFloor(ctx, floor);
      const error = await asksOf(ctx).act(f, String(body.id ?? ''), body.act, { by, ...(session.account?.id ? { owner: session.account.id } : {}) });
      if (error) return send(res, 400, { error });
      return send(res, 200, { ...(await asksOf(ctx).view(f, true)), sent: SENT[body.act] });
    },
  },
} satisfies Record<string, Route>;
