// Expert mode's Lock in (server/expert-lockin/): GET /api/expert/lockin?floor= is the panel (the checks at the
// session branch's head, what step 2 allows, demo users, licence, phase); POST /api/expert/lockin/run {floor}
// starts the checks (pending changes committed first; 409 while the session is working); POST
// /api/expert/lockin/merge {floor, commit, accept?, confirmImpact?} merges the checked commit into main with a
// receipt; POST /api/expert/lockin/publish {floor} opens Studio Pro on the merged main (Free App); POST
// /api/expert/lockin/deploy {floor} raises a deploy request to approval; POST /api/expert/lockin/close-phase
// {floor, phase}. Signed in; the POSTs from the office's own pages, and admins only (the project's operators):
// they move main, open a program on the office's machine, or raise a deploy.

import type { Route, RouteRequest } from '../router.js';
import type { Session } from '../../auth.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import { isExpert } from '../../expert/shell.js';
import { lockInOf } from '../../expert-lockin/index.js';
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';

async function json(req: Parameters<Route['handle']>[1]['req']): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

const lf = (floor: Floor) => ({ id: floor.id, dir: floor.dir, name: floor.def.name, workers: floor.workers });

type Args = RouteRequest & { session: Session };

/** The checks every POST makes: same origin, an admin, JSON, an Expert project. */
async function posted(ctx: Ctx, a: Args): Promise<{ floor: Floor; body: Record<string, unknown>; by: string } | undefined> {
  if (!sameOrigin(a.req, ctx.cfg)) return void send(a.res, 403, { error: 'Forbidden' });
  if (!ctx.meOf(a.session.account?.id).admin) return void send(a.res, 403, { error: 'Only admins (the project’s operators) can lock in' });
  const body = await json(a.req);
  if (!body) return void send(a.res, 400, { error: 'Send JSON' });
  const floor = ctx.floors.get(String(body.floor ?? ''));
  if (!floor) return void send(a.res, 404, { error: 'No such project' });
  if (!isExpert(floor)) return void send(a.res, 409, { error: 'Lock in is for Expert projects: a Team project merges through its review' });
  return { floor, body, by: a.session.account?.name ?? 'An admin' };
}

const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 80)).slice(0, 10) : []);

export const expertLockInRoutes = {
  view: {
    method: 'GET',
    path: '/api/expert/lockin',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (!isExpert(floor)) return send(res, 409, { error: 'Not an Expert project' });
      return send(res, 200, await lockInOf(ctx).view(lf(floor)), { 'cache-control': 'no-store' });
    },
  },
  run: {
    method: 'POST',
    path: '/api/expert/lockin/run',
    auth: 'session',
    async handle(ctx, a) {
      const p = await posted(ctx, a);
      if (!p) return;
      const r = await lockInOf(ctx).start(lf(p.floor), p.by);
      return r.ok ? send(a.res, 200, { run: r.run }) : send(a.res, r.status, { error: r.error });
    },
  },
  merge: {
    method: 'POST',
    path: '/api/expert/lockin/merge',
    auth: 'session',
    async handle(ctx, a) {
      const p = await posted(ctx, a);
      if (!p) return;
      const commit = typeof p.body.commit === 'string' && /^[0-9a-f]{40}$/i.test(p.body.commit) ? p.body.commit : undefined;
      if (!commit) return send(a.res, 400, { error: 'Which commit? (the full id the checks ran at)' });
      const r = await lockInOf(ctx).merge(lf(p.floor), p.by, { commit, accept: names(p.body.accept), confirmImpact: p.body.confirmImpact === true });
      return r.ok ? send(a.res, 200, { merged: r.merged }) : send(a.res, r.status, { error: r.error });
    },
  },
  publish: {
    method: 'POST',
    path: '/api/expert/lockin/publish',
    auth: 'session',
    async handle(ctx, a) {
      const p = await posted(ctx, a);
      if (!p) return;
      const r = await lockInOf(ctx).publish(lf(p.floor), p.by);
      return r.ok ? send(a.res, 200, { ok: true, ...(r.note ? { note: r.note } : {}) }) : send(a.res, r.status, { error: r.error });
    },
  },
  deploy: {
    method: 'POST',
    path: '/api/expert/lockin/deploy',
    auth: 'session',
    async handle(ctx, a) {
      const p = await posted(ctx, a);
      if (!p) return;
      const r = await lockInOf(ctx).requestDeploy(lf(p.floor), p.by);
      return r.ok ? send(a.res, 200, { id: r.id }) : send(a.res, r.status, { error: r.error });
    },
  },
  closePhase: {
    method: 'POST',
    path: '/api/expert/lockin/close-phase',
    auth: 'session',
    async handle(ctx, a) {
      const p = await posted(ctx, a);
      if (!p) return;
      const phase = typeof p.body.phase === 'string' ? p.body.phase.slice(0, 40) : '';
      if (!phase) return send(a.res, 400, { error: 'Which phase?' });
      const r = await lockInOf(ctx).closePhase(lf(p.floor), p.by, phase);
      return r.ok ? send(a.res, 200, { ok: true }) : send(a.res, r.status, { error: r.error });
    },
  },
} satisfies Record<string, Route>;
