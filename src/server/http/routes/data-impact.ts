// The data-impact guard's routes (server/data-impact/). Anyone signed in reads a project's hold; taking a dump
// and approving need the `data-impact approval` permission (office admins by default, plus accounts the policy
// names; not the project owner unless named); the policy is an admin's. All of it audited. Through Phone
// access an approval or a dump needs the password again.
//   GET  /api/data-impact?floor=        the hold on the live preview, its findings, approvals, dumps, who may approve
//   POST /api/data-impact               {floor, action: dump}                                  pg_dump of the live preview's database
//                                       {floor, action: approve, base, target, reason, dump | noData: true}
//                                       {action: policy, policy: {admins, accounts}}           admins only
// An approval restarts the live app onto the approved candidate (the guard lets it through).
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { dataImpactOf } from '../../data-impact/index.js';
import { liveAppsIfMade } from '../../liveapp/index.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

export const dataImpactRoutes = {
  view: {
    method: 'GET',
    path: '/api/data-impact',
    auth: 'session',
    handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, dataImpactOf(ctx).view(floor.id, session.account?.id));
    },
  },
  act: {
    method: 'POST',
    path: '/api/data-impact',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      let body: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 8 * 1024)) || '{}');
        body = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const di = dataImpactOf(ctx);
      const accountId = session.account?.id;
      const by = { name: session.account?.name ?? 'The Project Manager', ...(accountId ? { id: accountId } : {}) };
      if (body.action === 'policy') {
        if (!ctx.meOf(accountId).admin) return send(res, 403, { error: 'Only an admin can say who holds the data-impact approval permission' });
        if (refuseStale(ctx, req, res)) return;
        const p = body.policy && typeof body.policy === 'object' ? (body.policy as Record<string, unknown>) : {};
        const policy = di.setPolicy({ admins: p.admins !== false, accounts: Array.isArray(p.accounts) ? p.accounts.filter((x): x is string => typeof x === 'string') : [] }, by);
        return send(res, 200, { policy, approvers: di.approvers(policy) });
      }
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (body.action !== 'dump' && body.action !== 'approve') return send(res, 400, { error: 'action: dump, approve or policy' });
      if (!di.mayApprove(accountId)) return send(res, 403, { error: `You don't have the data-impact approval permission. Who has it: ${di.approvers()}` });
      if (refuseStale(ctx, req, res)) return;
      if (body.action === 'dump') {
        const d = await di.dump(floor.id, by);
        return typeof d === 'string' ? send(res, 409, { error: d }) : send(res, 200, { dump: d, view: di.view(floor.id, accountId) });
      }
      const a = await di.approve(floor.id, by, accountId, body);
      if (Array.isArray(a)) return send(res, a[0], { error: a[1] });
      // The guard lets the approved candidate through now: the live app takes it (a restart: the change is structural).
      const app = liveAppsIfMade(ctx)?.of(floor);
      if (app && (app.status === 'running' || app.status === 'failed')) void app.restart(`${by.name} (data-impact approval)`);
      return send(res, 200, { approval: a, view: di.view(floor.id, accountId) });
    },
  },
} satisfies Record<string, Route>;
