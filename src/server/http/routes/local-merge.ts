// The Project Manager's merge for local-only projects (server/local-merge/): GET /api/local-merge?floor= is the
// branches the team has ahead of main with their review at the head; POST /api/local-merge/review
// {floor, branch, sha, verdict, note?} records a review of the commit seen (and answers with the branch's row as it
// is now); GET /api/local-merge/confirm?floor=&branch=&sha= is the confirm step's facts for merging that commit
// (admins); POST /api/local-merge/merge {floor, branch, sha} merges exactly that reviewed commit into main with
// --no-ff, even if the branch moved on. Admins only for the writes, same origin, audited. No GitHub.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { confirmLocal, localMergeView, mergeLocal, reviewLocal } from '../../local-merge/index.js';
import { readBody, send } from '../util.js';
import { fromOffice } from '../origin.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => fromOffice(req, ctx.cfg);

async function bodyOf(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 8 * 1024)) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return undefined;
  }
}

export const localMergeRoutes = {
  view: {
    method: 'GET',
    path: '/api/local-merge',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      try {
        return send(res, 200, await localMergeView(ctx, floor));
      } catch (err) {
        return send(res, 502, { error: (err as Error).message });
      }
    },
  },
  confirm: {
    method: 'GET',
    path: '/api/local-merge/confirm',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) merges' });
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      try {
        const r = await confirmLocal(ctx, floor, url.searchParams.get('branch') ?? '', url.searchParams.get('sha') ?? '');
        return r.ok ? send(res, 200, r.confirm) : send(res, r.status, { error: r.error });
      } catch (err) {
        return send(res, 502, { error: (err as Error).message });
      }
    },
  },
  review: {
    method: 'POST',
    path: '/api/local-merge/review',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) reviews for a merge' });
      const body = await bodyOf(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      const verdict = body.verdict === 'changes' ? 'changes' : body.verdict === 'approve' ? 'approve' : undefined;
      if (!verdict) return send(res, 400, { error: 'Approve, or ask for changes?' });
      const r = await reviewLocal(ctx, floor, { branch: String(body.branch ?? ''), sha: String(body.sha ?? ''), verdict, ...(typeof body.note === 'string' ? { note: body.note } : {}) }, { name: session.account?.name ?? 'The Project Manager', ...(session.account?.id ? { id: session.account.id } : {}) });
      return r.ok ? send(res, 200, r) : send(res, r.status, { error: r.error });
    },
  },
  merge: {
    method: 'POST',
    path: '/api/local-merge/merge',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) merges' });
      const body = await bodyOf(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      const r = await mergeLocal(ctx, floor, { branch: String(body.branch ?? ''), sha: String(body.sha ?? '') }, { name: session.account?.name ?? 'The Project Manager', ...(session.account?.id ? { id: session.account.id } : {}) });
      return r.ok ? send(res, 200, r) : send(res, r.status, { error: r.error });
    },
  },
} satisfies Record<string, Route>;
