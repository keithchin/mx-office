// The office's autonomy policy for new projects (roster/autonomy-choice.ts, off by default): GET what it is
// (signed in: the New project flow's autonomy step and the Team settings show it), POST a new one (admins,
// audited as settings.change). Through Phone access a change needs the password again.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { autonomyPolicy, setAutonomyPolicy } from '../../roster/autonomy-choice.js';
import { readBody, send } from '../util.js';
import { fromOffice } from '../origin.js';
import type { Route } from '../router.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => fromOffice(req, ctx.cfg);

export const autonomyPolicyRoutes = {
  /** GET /api/autonomy/policy: the policy, and whether you may change it. */
  view: {
    method: 'GET',
    path: '/api/autonomy/policy',
    auth: 'session',
    handle: (ctx, { res, session }) => send(res, 200, { policy: autonomyPolicy(ctx.cfg.dataDir), admin: ctx.meOf(session.account?.id).admin }),
  },
  /** POST /api/autonomy/policy {mode: none|limit|fixed, allowed?, level?, name?}: admins only, audited. */
  set: {
    method: 'POST',
    path: '/api/autonomy/policy',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can change the autonomy policy' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 8 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      if (refuseStale(ctx, req, res)) return;
      const name = session.account?.name ?? (typeof body.by === 'string' ? body.by.trim().slice(0, 80) : '');
      const r = setAutonomyPolicy(ctx.cfg.dataDir, body, { name: name || 'An admin', ...(session.account?.id ? { id: session.account.id } : {}) });
      if (typeof r === 'string') return send(res, 400, { error: r });
      return send(res, 200, { policy: r, admin: true });
    },
  },
} satisfies Record<string, Route>;
