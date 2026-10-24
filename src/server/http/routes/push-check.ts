// The direct-push check's state per project and reconciling an unchecked range (review-gate/baseline.ts):
//   GET  /api/push-check?floor=   where the office watches main from, whether commits before that were checked
//   POST /api/push-check          {floor, action: 'scan', count?}: check the last commits up to there (anyone signed in)
//                                 {floor, action: 'accept'}: accept that commit as the starting point (admins only)
// Both writes are audited and refused from another origin; through Phone access they need the password again.
import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import { audit, human } from '../../audit/index.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { localOnlyAt } from '../../local-only.js';
import { readPushState } from '../../review-gate/pushes.js';
import { acceptUnchecked, scanUnchecked, SCAN_DEFAULT } from '../../review-gate/baseline.js';
import { mergesOf } from '../../review-gate/index.js';

const NO_STORE = { 'cache-control': 'no-store' };

export const pushCheckRoutes = {
  view: {
    method: 'GET',
    path: '/api/push-check',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (localOnlyAt(floor.dir)) return send(res, 200, { localOnly: true }, NO_STORE);
      const s = await readPushState(ctx.cfg.dataDir, floor.id);
      const { events, ...rest } = s;
      return send(res, 200, { ...rest, events: events.length, scanDefault: SCAN_DEFAULT, admin: ctx.meOf(session.account?.id).admin }, NO_STORE);
    },
  },
  reconcile: {
    method: 'POST',
    path: '/api/push-check',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (refuseStale(ctx, req, res)) return;
      let body: Record<string, unknown> = {};
      try {
        const text = await readBody(req, 4 * 1024);
        body = text ? JSON.parse(text) : {};
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such project' });
      const admin = ctx.meOf(session.account?.id).admin;
      const name = session.account?.name ?? (admin ? 'An admin' : 'Someone');
      const target = { kind: 'project', id: floor.id, label: floor.def.name };
      if (body.action === 'accept') {
        if (!admin) return send(res, 403, { error: 'Only an admin can accept a starting point for the direct-push check' });
        const r = await acceptUnchecked(ctx.cfg.dataDir, floor.id, name);
        if ('error' in r) return send(res, 409, { error: r.error });
        const from = r.state.reconciled?.from ?? '';
        audit.record({ floor: floor.id, actor: human(name, session.account?.id), action: 'pushes.baseline.accept', target, summary: `Accepted ${from.slice(0, 7)} as the direct-push check's starting point: commits before it won't be checked`, details: { from }, severity: 'notice' });
        return send(res, 200, { ok: true }, NO_STORE);
      }
      if (body.action === 'scan') {
        const n = Number(body.count) || SCAN_DEFAULT;
        const r = await scanUnchecked(ctx.cfg.dataDir, floor.id, floor.dir, mergesOf(floor.github?.pulls.items ?? []), n, name);
        if ('error' in r) return send(res, 409, { error: r.error });
        const from = r.state.reconciled?.from ?? '';
        audit.record({ floor: floor.id, actor: human(name, session.account?.id), action: 'pushes.baseline.scan', target, summary: `Checked the last ${r.scanned} commits up to ${from.slice(0, 7)} for ones that skipped a pull request: ${r.found} found`, details: { from, scanned: r.scanned, found: r.found }, severity: 'notice' });
        void import('../../asks/index.js').then((m) => m.asksOf(ctx).soon(floor.id, 'the push check')).catch(() => undefined);
        return send(res, 200, { ok: true, scanned: r.scanned, found: r.found }, NO_STORE);
      }
      return send(res, 400, { error: 'Send action scan or accept' });
    },
  },
} satisfies Record<string, Route>;
