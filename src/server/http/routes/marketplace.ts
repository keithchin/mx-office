// The Marketplace action's routes (server/marketplace/). Reading is for anyone signed in; every action is an
// admin's (checked here), from the office's own page, audited, and re-asks the password through Phone access
// (it puts code into the project).
//   GET  /api/marketplace?floor=                      the project's requests, and whether the office can download
//   POST /api/marketplace/action                      {floor, rid, action: approve|decline|path, words?, path?}
//   POST /api/marketplace/upload?floor=&rid=&name=    a .mpk the PM picked, as the raw body (application/octet-stream)
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import type { Session } from '../../auth.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { marketplaceOf } from '../../marketplace/index.js';
import { MPK_MAX_BYTES } from '../../marketplace/mpk.js';
import type { Outcome } from '../../marketplace/service.js';
import { readBody, readBytes, send } from '../util.js';
import { fromOffice } from '../origin.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const ONLY_ADMINS = 'Only the Project Manager (an admin) can add Marketplace packages';
const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** The checks every action shares: from our page, an admin, not a stale Phone-access session. */
function refused(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, session: Session): boolean {
  if (!fromOffice(req, ctx.cfg)) return void send(res, 403, { error: 'Forbidden' }), true;
  if (!ctx.meOf(session.account?.id).admin) return void send(res, 403, { error: ONLY_ADMINS }), true;
  return refuseStale(ctx, req, res);
}

async function answer(ctx: Ctx, res: http.ServerResponse, floor: string, out: Outcome) {
  if (!out.ok) return send(res, out.status, { error: out.error });
  return send(res, 200, { request: out.request, view: await marketplaceOf(ctx).view(floor, true) });
}

export const marketplaceRoutes = {
  view: {
    method: 'GET',
    path: '/api/marketplace',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, await marketplaceOf(ctx).view(floor.id, ctx.meOf(session.account?.id).admin));
    },
  },
  action: {
    method: 'POST',
    path: '/api/marketplace/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (refused(ctx, req, res, session)) return;
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 16 * 1024)) || '{}') as Record<string, unknown>;
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      const rid = str(body.rid, 60) ?? '';
      const by = session.account?.name ?? 'The Project Manager';
      const s = marketplaceOf(ctx);
      if (body.action === 'approve') return answer(ctx, res, floor.id, await s.approve(floor.id, rid, by));
      if (body.action === 'decline') return answer(ctx, res, floor.id, await s.decline(floor.id, rid, by, typeof body.words === 'string' ? body.words : ''));
      if (body.action === 'path') return answer(ctx, res, floor.id, await s.importFile(floor.id, rid, by, { path: str(body.path, 1000) ?? '' }));
      return send(res, 400, { error: 'action is approve, decline or path' });
    },
  },
  upload: {
    method: 'POST',
    path: '/api/marketplace/upload',
    auth: 'session',
    async handle(ctx, { req, res, url, session }) {
      if (refused(ctx, req, res, session)) return;
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      let bytes: Buffer;
      try {
        bytes = await readBytes(req, MPK_MAX_BYTES);
      } catch {
        return send(res, 413, { error: `The file is over ${MPK_MAX_BYTES / 1024 / 1024} MB` });
      }
      const by = session.account?.name ?? 'The Project Manager';
      const name = (url.searchParams.get('name') ?? '').replace(/[\\/]/g, '_').slice(0, 200);
      return answer(ctx, res, floor.id, await marketplaceOf(ctx).importFile(floor.id, url.searchParams.get('rid') ?? '', by, { bytes, name }));
    },
  },
} satisfies Record<string, Route>;
