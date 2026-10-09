// Deleting a project (server/project-delete/): GET /api/projects/<floor>/delete-plan for the dialog,
// POST /api/projects/<floor>/delete {mode, deleteFolder, deleteRepo, discardWork, confirm} to start or
// carry on the job, GET /api/projects/<floor>/delete for how far it has got. Admins only; the typed name
// is checked again here; through Phone access it needs the password again; JSON from the office's own
// page only (a cross-site form can't send it).

import type http from 'node:http';
import { projectDeletesOf } from '../../project-delete/office.js';
import { refuseStale } from '../../phone-access/reauth.js';
import type { Ctx } from '../../office/context.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { whoOf } from './notify-teams.js';

const PREFIX = '/api/projects/';

/** /api/projects/<floor>/<what>: the floor and what's asked, or undefined. */
export function projectPath(p: string): { floor: string; what: string } | undefined {
  const m = /^\/api\/projects\/([A-Za-z0-9_.-]{1,64})\/(delete|delete-plan)$/.exec(p);
  return m ? { floor: m[1], what: m[2] } : undefined;
}

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => sameOrigin(req, ctx.cfg) || (!req.headers.origin && /^application\/json\b/i.test(req.headers['content-type'] ?? ''));

export const projectRoutes = {
  /** Every /api/projects/<floor>/… route. */
  project: {
    prefix: PREFIX,
    auth: 'session',
    async handle(ctx, { req, res, path, session }) {
      const at = projectPath(path);
      if (!at) return send(res, 404, { error: 'Not found' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins can delete a project' });
      const svc = projectDeletesOf(ctx);
      if (req.method === 'GET' && at.what === 'delete-plan') {
        const plan = await svc.plan(at.floor);
        return typeof plan === 'string' ? send(res, 404, { error: plan }) : send(res, 200, plan);
      }
      if (req.method === 'GET' && at.what === 'delete') {
        const job = await svc.job(at.floor);
        return job ? send(res, 200, job) : send(res, 404, { error: 'No deletion for that project' });
      }
      if (req.method === 'POST' && at.what === 'delete') {
        if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
        if (refuseStale(ctx, req, res)) return;
        let body: unknown;
        try {
          body = JSON.parse((await readBody(req, 16 * 1024)) || 'null');
        } catch {
          return send(res, 400, { error: 'Send JSON' });
        }
        const who = whoOf(session.account?.name, undefined);
        const job = await svc.start(at.floor, body, {
          name: who,
          id: session.account?.id,
        });
        return typeof job === 'string' ? send(res, job === 'No such project' ? 404 : 400, { error: job }) : send(res, 202, job);
      }
      return send(res, 405, { error: 'Method not allowed' });
    },
  },
} satisfies Record<string, Route>;
