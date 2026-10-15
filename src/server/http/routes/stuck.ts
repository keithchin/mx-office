// Stuck detection's routes (server/stuck/): GET /api/stuck?floor=<id> is what Needs you shows (signed in);
// POST /api/stuck/action is a button on an item (admins: it messages the team lead, or snoozes or dismisses);
// /api/stuck/settings reads (signed in) and changes (admins, audited) on/off and the thresholds.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { stuckFloor, stuckOf } from '../../stuck/index.js';
import { setStuckSettings, stuckSettings } from '../../stuck/settings.js';
import type { StuckAction } from '../../../shared/stuck.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const ACTIONS: readonly StuckAction[] = ['ask-lead', 'answer', 'accept', 'blockers', 'snooze', 'dismiss'];
const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

async function jsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return undefined;
  }
}

export const stuckRoutes = {
  /** GET /api/stuck?floor=<id>: the floor's visible stuck items, its lead's state and whether you may act. */
  view: {
    method: 'GET',
    path: '/api/stuck',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, await stuckOf(ctx).view(stuckFloor(floor), ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/stuck/action {floor, id, action, text?, when?: 'after'|'now'}: admins only, audited. */
  act: {
    method: 'POST',
    path: '/api/stuck/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can act on stuck items' });
      const body = await jsonBody(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      if (refuseStale(ctx, req, res)) return;
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      const action = body.action as StuckAction;
      if (!ACTIONS.includes(action)) return send(res, 400, { error: `action is one of ${ACTIONS.join(', ')}` });
      const by = session.account?.name ?? (typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 32) : 'The Project Manager');
      const error = await stuckOf(ctx).act(stuckFloor(floor), String(body.id ?? ''), action, {
        by,
        ...(session.account?.id ? { owner: session.account.id } : {}),
        ...(typeof body.text === 'string' ? { text: body.text.slice(0, 4000) } : {}),
        when: body.when === 'now' ? 'now' : 'after',
      });
      if (error) return send(res, 400, { error });
      return send(res, 200, await stuckOf(ctx).view(stuckFloor(floor), true));
    },
  },
  /** GET /api/stuck/settings: on/off and the thresholds, and whether you may change them. */
  settings: {
    method: 'GET',
    path: '/api/stuck/settings',
    auth: 'session',
    handle: (ctx, { res, session }) => send(res, 200, { settings: stuckSettings(), admin: ctx.meOf(session.account?.id).admin }),
  },
  /** POST /api/stuck/settings {on?, prHours?, decisionHours?, failingHours?, circlesHours?}: admins only, each change audited. */
  setSettings: {
    method: 'POST',
    path: '/api/stuck/settings',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can change stuck detection' });
      const body = await jsonBody(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      if (refuseStale(ctx, req, res)) return;
      const name = session.account?.name ?? (typeof body.by === 'string' ? body.by.trim().slice(0, 80) : '');
      const r = setStuckSettings(body, { name: name || 'An admin', ...(session.account?.id ? { accountId: session.account.id } : {}) });
      if (typeof r === 'string') return send(res, 400, { error: r });
      // Turned on or a threshold moved: look again now rather than in five minutes.
      void stuckOf(ctx).lookAll();
      return send(res, 200, { settings: r, admin: true });
    },
  },
} satisfies Record<string, Route>;
