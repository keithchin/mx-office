// The Expert wizard's routes (server/expert/create.ts): GET /api/expert/setup-info is what its pin dropdowns offer;
// POST /api/expert/create {name, mendix, app, appId?, toolkit, mxcli, demoUsers, budget, model, brief?} starts the
// setup of a new Expert-mode project on the same setup as Team mode (wizard/index.ts) and answers with its JobView,
// which the page follows with GET /api/wizard/job like any setup (Retry and Cancel & undo included). Admins only,
// from the office's own pages: making a project creates an app on Team Server.

import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { wizardOf } from '../../wizard/index.js';
import { mendixVersions } from '../../wizard/config.js';
import { credential } from '../../connections/resolve.js';
import { expertPlanOf, expertSetupInfo } from '../../expert/create.js';

export const expertCreateRoutes = {
  setupInfo: {
    method: 'GET',
    path: '/api/expert/setup-info',
    auth: 'session',
    async handle(ctx, { res }) {
      return send(res, 200, await expertSetupInfo(wizardOf(ctx).cfg.toolkitDir, ctx.cfg.dataDir), { 'cache-control': 'no-store' });
    },
  },
  create: {
    method: 'POST',
    path: '/api/expert/create',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins (operators) can set up projects' });
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req, 32 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const w = wizardOf(ctx);
      const named = typeof (body as { by?: unknown })?.by === 'string' ? (body as { by: string }).by.replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 60) : '';
      const who = session.account?.name ?? (named || 'an admin');
      const plan = expertPlanOf(body, { versions: mendixVersions(w.cfg.mendixDir), org: w.cfg.org, offline: !!w.cfg.offlineDir, mendixToken: !!credential('mendix') }, who);
      if (typeof plan === 'string') return send(res, 400, { error: plan });
      const r = w.start(plan, who, session.account?.id);
      if (typeof r === 'string') return send(res, 400, { error: r });
      console.log(`  ${who} started setting up ${r.plan.owner}/${r.plan.name} in Expert mode`);
      return send(res, 200, r);
    },
  },
} satisfies Record<string, Route>;
