// Expert mode's routes (server/expert/): GET /api/expert?floor= is the session screen's header and loop timer;
// GET /api/expert/choices?floor=&rev= the preview's pages and roles at a commit; POST /api/expert/session
// {floor} starts the session (or wakes it, its conversation carried on); POST /api/expert/open {path} makes a
// folder on the office's machine an Expert-mode project ("Open existing toolkit project", admins only, no
// readiness checks yet); GET /api/expert/proof?floor= is the background proof strip ({ branch, commit, budget,
// stuck, decisions }, 409 for a Team project: ../../expert/index.ts). Signed in, the POSTs from the office's own pages only.

import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import { expertOf, isExpert } from '../../expert/shell.js';
import { expertProofView } from '../../expert/index.js';
import { ensureSession } from '../../expert/session-worker.js';
import { previewChoices } from '../../expert/choices.js';
import { checkSourcePath } from '../../wizard/source-folder.js';
import { audit } from '../../audit/index.js';
import { SHA_RE } from '../../../shared/app-explorer.js';

async function json(req: Parameters<Route['handle']>[1]['req']): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export const expertRoutes = {
  /** GET /api/expert/proof?floor=<id>: { branch, commit, budget, stuck, decisions }. 409 for a Team project. */
  proof: {
    method: 'GET',
    path: '/api/expert/proof',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (!isExpert(floor)) return send(res, 409, { error: 'Not an Expert project' });
      return send(res, 200, await expertProofView(ctx, floor));
    },
  },
  view: {
    method: 'GET',
    path: '/api/expert',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, await expertOf(ctx).view(floor), { 'cache-control': 'no-store' });
    },
  },
  choices: {
    method: 'GET',
    path: '/api/expert/choices',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const rev = url.searchParams.get('rev') ?? '';
      if (!SHA_RE.test(rev)) return send(res, 400, { error: 'Which version? (a full commit id)' });
      return send(res, 200, await previewChoices(ctx, floor, rev), { 'cache-control': 'private, max-age=600' });
    },
  },
  session: {
    method: 'POST',
    path: '/api/expert/session',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const body = await json(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (!isExpert(floor)) return send(res, 409, { error: 'This project is in Team mode: it has no session of its own' });
      const r = await ensureSession(floor, session.account?.name ?? 'someone', session.account?.id);
      if (typeof r === 'string') return send(res, 409, { error: r });
      ctx.floorsChanged();
      return send(res, 200, { workerId: r.id });
    },
  },
  open: {
    method: 'POST',
    path: '/api/expert/open',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins (operators) can add projects' });
      const body = await json(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      const checked = await checkSourcePath(body.path, { dataDir: ctx.cfg.dataDir, projectsDir: ctx.building.projectsDir });
      if ('error' in checked) return send(res, 400, { error: checked.error });
      const by = session.account?.name ?? 'an admin';
      const def = ctx.building.openFolder(checked.path, by, 'expert');
      if (typeof def === 'string') return send(res, 409, { error: def });
      // Opening the floor is a block of its own (its worker manager writes each provider's files).
      await new Promise<void>((done) => setImmediate(done));
      const floor = ctx.floors.get(def.id) ?? ctx.openFloor(def);
      ctx.floorsChanged();
      if (!floor) return send(res, 500, { error: `Couldn't open the project at ${checked.path}: see the office's log` });
      audit.record({ floor: floor.id, actor: { kind: 'human', name: by }, action: 'expert.open', target: { kind: 'floor', id: floor.id, label: floor.def.name }, summary: `Opened ${floor.def.name} in Expert mode from ${checked.path}`, severity: 'info' });
      return send(res, 200, { floor: floor.id });
    },
  },
} satisfies Record<string, Route>;
