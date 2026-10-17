// "main is behind the work" (server/branch-ahead/): GET /api/branch-ahead?floor= is the banner's view for
// the Model and Live app tabs (everyone signed in may look, as with the Git tab); POST
// /api/branch-ahead/review {floor, branch} asks the lead, after their turn, for a review per the review
// gate. Admins only, same origin, audited. Nothing in the project changes.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { aheadOf, askReview } from '../../branch-ahead/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));
const BRANCH_OK = /^[\w./-]{1,200}$/;

export const branchAheadRoutes = {
  view: {
    method: 'GET',
    path: '/api/branch-ahead',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      try {
        return send(res, 200, await aheadOf(ctx, floor));
      } catch (err) {
        return send(res, 502, { error: (err as Error).message });
      }
    },
  },
  review: {
    method: 'POST',
    path: '/api/branch-ahead/review',
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
      const branch = String(body.branch ?? '');
      if (!BRANCH_OK.test(branch)) return send(res, 400, { error: 'Not a branch name' });
      const r = await askReview(ctx, floor, branch, session.account?.name ?? 'The Project Manager', session.account?.id);
      if (!r.ok) return send(res, r.status, { error: r.error });
      return send(res, 200, { ok: true, lead: r.lead });
    },
  },
} satisfies Record<string, Route>;
