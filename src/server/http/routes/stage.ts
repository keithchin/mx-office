// POST /api/stage/fix {floor}: "Ask the lead to fix the paperwork" on the stage card (shared/decisions/
// stage-flags.ts): the lead is told what the office's gate-check on main reports against PROJECT.md, after
// their turn (server/wizard/stage-fix.ts). Admins only, same origin, audited. Nothing in the project changes.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { askStageFix, stageFixDeps } from '../../wizard/stage-fix.js';
import { wizardOf } from '../../wizard/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

export const stageRoutes = {
  fix: {
    method: 'POST',
    path: '/api/stage/fix',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can ask the lead' });
      let body: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 4 * 1024)) || '{}');
        body = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      const r = await askStageFix(
        stageFixDeps(ctx, (f) => wizardOf(ctx).setup(f).catch(() => undefined)),
        floor,
        session.account?.name ?? 'The Project Manager',
        session.account?.id,
      );
      if (!r.ok) return send(res, r.status, { error: r.error });
      return send(res, 200, { ok: true, lead: r.lead });
    },
  },
} satisfies Record<string, Route>;
