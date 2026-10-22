// The security baseline's routes (server/security-gate/). Looking is for anyone signed in on the office;
// running mx check and changing the policy are an admin's, from the office's own page, and audited.
//   GET  /api/security?floor=   the Security card: what was read at main, the last mx check, the policy, the gates
//   POST /api/security          {floor, action: check}            runs mx check at main's head (or joins the run)
//                               {floor, action: policy, policy}   sets the project's policy (a reason when not the default)
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { human } from '../../audit/index.js';
import { securityOf, setProjectPolicy } from '../../security-gate/index.js';
import { cleanPolicy } from '../../../shared/security.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

export const securityRoutes = {
  view: {
    method: 'GET',
    path: '/api/security',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, await securityOf(ctx).view(floor, ctx.meOf(session.account?.id).admin));
    },
  },
  act: {
    method: 'POST',
    path: '/api/security',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can run mx check or change the security policy' });
      let body: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 8 * 1024)) || '{}');
        body = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      const actor = human(session.account?.name ?? 'The Project Manager', session.account?.id);
      const gate = securityOf(ctx);
      if (body.action === 'check') {
        const main = await gate.d.main(floor.dir);
        if (!main) return send(res, 409, { error: 'The project has no main branch yet' });
        void gate.startCheck(floor, main.sha, actor.name, actor).catch(() => undefined);
        return send(res, 202, { ok: true, running: { commit: main.sha, since: Date.now() } });
      }
      if (body.action === 'policy') {
        const err = await setProjectPolicy(ctx, floor, cleanPolicy(body.policy), actor);
        if (err) return send(res, 400, { error: err });
        return send(res, 200, { ok: true, view: await gate.view(floor, true) });
      }
      return send(res, 400, { error: 'action: check or policy' });
    },
  },
} satisfies Record<string, Route>;
