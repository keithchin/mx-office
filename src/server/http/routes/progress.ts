// The project progress bar and the acceptance record (server/progress/, server/acceptance/): anyone signed
// in GETs a floor's progress (`mini=1` for Home's cards: no deliverables scan), its acceptance records and
// what an Accept would record now; only the Project Manager (an admin) POSTs ✅ Accept or ↩ Reopen, from
// the office's own page (or a script sending JSON), and through Phone access only with the password again.

import type http from 'node:http';
import { accept, acceptanceDraft, acceptanceView, reopen } from '../../acceptance/index.js';
import type { Ctx } from '../../office/context.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { progressOf } from '../../progress/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';
import { whoOf } from './notify-teams.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

export const progressRoutes = {
  /** GET /api/progress?floor=<id>[&mini=1]: the floor's phases, milestones and acceptance, measured. */
  view: {
    method: 'GET',
    path: '/api/progress',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, await progressOf(ctx, floor, ctx.meOf(session.account?.id).admin, url.searchParams.get('mini') === '1'));
    },
  },
  /** GET /api/acceptance?floor=<id>: every delivery cycle and its record, and whether the accepted one changed since. */
  acceptance: {
    method: 'GET',
    path: '/api/acceptance',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, await acceptanceView(ctx, floor, ctx.meOf(session.account?.id).admin));
    },
  },
  /** GET /api/acceptance/draft?floor=<id>: what ✅ Accept would record now (for the dialog's review). */
  draft: {
    method: 'GET',
    path: '/api/acceptance/draft',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, await acceptanceDraft(ctx, floor, ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/acceptance {floor, action: accept|reopen, version?, scopeNote?, exceptions?, build?, deploy?}. The Project Manager (an admin) only. */
  act: {
    method: 'POST',
    path: '/api/acceptance',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can accept or reopen a delivery' });
      let body: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
        body = v && typeof v === 'object' ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      if (refuseStale(ctx, req, res)) return;
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const who = { name: whoOf(session.account?.name, body.by), ...(session.account?.id ? { accountId: session.account.id } : {}) };
      if (body.action === 'accept') {
        if (body.confirm !== true) return send(res, 400, { error: 'Confirm the acceptance' });
        const r = await accept(ctx, floor, body, who);
        return typeof r === 'string' ? send(res, 409, { error: r }) : send(res, 200, { record: r });
      }
      if (body.action === 'reopen') {
        const r = reopen(ctx, floor, body, who);
        return typeof r === 'string' ? send(res, 409, { error: r }) : send(res, 200, { reopen: r });
      }
      return send(res, 400, { error: 'action: accept or reopen' });
    },
  },
} satisfies Record<string, Route>;
