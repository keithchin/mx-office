// The data-impact guard's routes (server/data-impact/). Anyone signed in reads a project's hold; taking a dump
// and approving need the `data-impact approval` permission (office admins by default, plus accounts the policy
// names; not the project owner unless named); the policy is an admin's. All of it audited. Through Phone
// access an approval or a dump needs the password again.
//   GET  /api/data-impact?floor=        the hold on the live preview, its findings, approvals, dumps, who may approve
//   POST /api/data-impact               {floor, action: dump, env?}                            pg_dump of the live preview's database, bound to the hold in env
//                                       {floor, action: release, env?, base, target, reason}    a stale hold released (the office checks it is stale)
//                                       {floor, action: approve, base, target, reason, dump | noData: true}
//                                       {action: policy, policy: {admins, accounts}}           admins only
// An approval restarts the live app onto the approved candidate (the guard lets it through).
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { dataImpactOf } from '../../data-impact/index.js';
import { cleanEnv, ENV_LIVE } from '../../../shared/data-impact.js';
import { liveAppsIfMade } from '../../liveapp/index.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';
import { staleWhy } from '../../data-impact/stale.js';

/** A Developer change's hold approved or released: its queue moves now (the guard lets the candidate through). */
async function nudgeQueue(ctx: Ctx, floorId: string, env: string): Promise<void> {
  if (!env.startsWith('candidate:')) return;
  try {
    const { devChangesOf } = await import('../../dev-changes/index.js');
    void devChangesOf(ctx).changes.advance(floorId).catch(() => undefined);
  } catch {
    /* the queue moves on its next look */
  }
}

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

export const dataImpactRoutes = {
  view: {
    method: 'GET',
    path: '/api/data-impact',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const env = url.searchParams.get('env');
      const which = env ? cleanEnv(env) : ENV_LIVE;
      if (!which) return send(res, 400, { error: 'Which environment? (live-preview, candidate:DC-n or external:<branch>)' });
      const v = dataImpactOf(ctx).view(floor.id, session.account?.id, which);
      // A stale hold (data-impact/stale.ts) offers Release stale hold; a dump can be taken for any hold (the live preview's database).
      const stale = v.held ? await staleWhy(ctx, floor, v.held).catch(() => undefined) : undefined;
      const dumpable = !!v.held && !!dataImpactOf(ctx).guard.d.pg?.(floor.id, ENV_LIVE);
      return send(res, 200, { ...v, ...(stale ? { stale } : {}), ...(dumpable ? { dumpable } : {}) });
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
      if (body.action !== 'dump' && body.action !== 'approve' && body.action !== 'release') return send(res, 400, { error: 'action: dump, approve, release or policy' });
      if (!di.mayApprove(accountId)) return send(res, 403, { error: `You don't have the data-impact approval permission. Who has it: ${di.approvers()}` });
      if (refuseStale(ctx, req, res)) return;
      if (body.action === 'dump') {
        const env = body.env === undefined ? ENV_LIVE : cleanEnv(body.env);
        if (!env) return send(res, 400, { error: 'Which environment? (live-preview, candidate:DC-n or external:<branch>)' });
        const d = await di.dump(floor.id, by, env);
        return typeof d === 'string' ? send(res, 409, { error: d }) : send(res, 200, { dump: d, view: di.view(floor.id, accountId, env) });
      }
      if (body.action === 'release') {
        // Stale only by the office's own look now (never the request's word): the change is over, or the live preview has it.
        const env = body.env === undefined ? ENV_LIVE : cleanEnv(body.env);
        const held = env ? di.guard.store.get(floor.id).holds[env] : undefined;
        const stale = held ? await staleWhy(ctx, floor, held).catch(() => undefined) : undefined;
        const a = di.releaseStale(floor.id, by, accountId, body, stale);
        if (Array.isArray(a)) return send(res, a[0], { error: a[1] });
        await nudgeQueue(ctx, floor.id, a.env);
        return send(res, 200, { approval: a, view: di.view(floor.id, accountId, a.env) });
      }
      const a = await di.approve(floor.id, by, accountId, body);
      if (Array.isArray(a)) return send(res, a[0], { error: a[1] });
      if (a.env !== ENV_LIVE) {
        await nudgeQueue(ctx, floor.id, a.env);
        return send(res, 200, { approval: a, view: di.view(floor.id, accountId, a.env) });
      }
      // The guard lets the approved candidate through now: the live app takes it (a restart: the change is structural).
      const app = liveAppsIfMade(ctx)?.of(floor);
      if (app && (app.status === 'running' || app.status === 'failed')) void app.restart(`${by.name} (data-impact approval)`);
      return send(res, 200, { approval: a, view: di.view(floor.id, accountId) });
    },
  },
} satisfies Record<string, Route>;
