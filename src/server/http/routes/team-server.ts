// Team Server for a project (team-server/index.ts):
//   GET  /api/team-server?floor=   the record (app id, remote, Portal link), the last sync, whether the office has a token
//   POST /api/team-server          {floor, action: 'sync'}: push main to Team Server now (admins)
//                                  {floor, action: 'connect', projectId?, create?}: Connect to Team Server (admins;
//                                  the page's confirm step said it creates an app in the Portal and pushes the code)
// Writes are refused from another origin and, through Phone access, need the password again; all are audited there.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { teamServerOf } from '../../team-server/index.js';

const NO_STORE = { 'cache-control': 'no-store' };

/** The project's one-line description from its project file (the Portal app's summary). */
function descriptionOf(dir: string): string {
  try {
    const d = (JSON.parse(readFileSync(path.join(dir, 'agent-office.project.json'), 'utf8')) as { description?: unknown }).description;
    return typeof d === 'string' ? d : '';
  } catch {
    return '';
  }
}

export const teamServerRoutes = {
  view: {
    method: 'GET',
    path: '/api/team-server',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, teamServerOf(ctx).view(floor, ctx.meOf(session.account?.id).admin), NO_STORE);
    },
  },
  act: {
    method: 'POST',
    path: '/api/team-server',
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
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only an admin can change where the project’s code goes' });
      const by = { name: session.account?.name ?? 'An admin', ...(session.account?.id ? { id: session.account.id } : {}) };
      const ts = teamServerOf(ctx);
      if (body.action === 'sync') {
        if (!ts.recordOf(floor)) return send(res, 409, { error: 'This project isn’t on Team Server' });
        const s = await ts.sync(floor, by);
        return send(res, 200, { sync: s, view: ts.view(floor, true) }, NO_STORE);
      }
      if (body.action === 'connect') {
        const r = await ts.connect({ id: floor.id, dir: floor.dir, name: floor.def.name, description: descriptionOf(floor.dir) }, { projectId: body.projectId, create: body.create === true }, by);
        if (!r.ok) return send(res, 409, { error: r.error });
        ctx.toastAll(`☁️ ${floor.def.name} is on Mendix Team Server now`);
        return send(res, 200, { view: r.view }, NO_STORE);
      }
      return send(res, 400, { error: 'Send action sync or connect' });
    },
  },
} satisfies Record<string, Route>;
