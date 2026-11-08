// Expert mode's readiness check routes (server/expert-ready/): POST /api/expert/ready {path, fresh?} checks a
// folder on the office's machine and answers its report (cached a minute; `fresh` is "Check again"); the check
// never writes to the folder. POST /api/expert/ready/fix {path, fix, total?, projectId?, name?} runs one fix the
// person clicked and answers {message, report}. Both: signed in, admins only, the office's own pages only, and
// the same folder rules as attaching (no system folders, no office folders, no whole drive or home folder).

import type { Route, RouteRequest } from '../router.js';
import type { Ctx } from '../../office/context.js';
import type { Session } from '../../auth.js';
import { readBody, sameOrigin, send } from '../util.js';
import { checkSourcePath } from '../../wizard/source-folder.js';
import { readyOf } from '../../expert-ready/index.js';
import { audit } from '../../audit/index.js';
import type { ReadyFixId } from '../../../shared/expert-ready.js';

type Req = RouteRequest & { session: Session };

const FIXES: readonly ReadyFixId[] = ['pin-toolkit', 'add-teamserver', 'seed-users', 'add-tests', 'set-budget'];

async function body(req: Req['req']): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** The admin, same-origin, JSON and folder checks both routes share; the folder's real path, or undefined when answered. */
async function folderOf(ctx: Ctx, { req, res, session }: Req): Promise<{ dir: string; b: Record<string, unknown> } | undefined> {
  if (!sameOrigin(req, ctx.cfg)) return void send(res, 403, { error: 'Forbidden' });
  if (!ctx.meOf(session.account?.id).admin) return void send(res, 403, { error: 'Only admins (operators) can check and add projects' });
  const b = await body(req);
  if (!b) return void send(res, 400, { error: 'Send JSON' });
  const checked = await checkSourcePath(b.path, { dataDir: ctx.cfg.dataDir, projectsDir: ctx.building.projectsDir });
  if ('error' in checked) return void send(res, 400, { error: checked.error });
  return { dir: checked.path, b };
}

export const expertReadyRoutes = {
  check: {
    method: 'POST',
    path: '/api/expert/ready',
    auth: 'session',
    async handle(ctx, a) {
      const f = await folderOf(ctx, a);
      if (!f) return;
      return send(a.res, 200, await readyOf(ctx).check(f.dir, f.b.fresh === true), { 'cache-control': 'no-store' });
    },
  },
  fix: {
    method: 'POST',
    path: '/api/expert/ready/fix',
    auth: 'session',
    async handle(ctx, a) {
      const f = await folderOf(ctx, a);
      if (!f) return;
      const fix = String(f.b.fix ?? '') as ReadyFixId;
      if (!FIXES.includes(fix)) return send(a.res, 400, { error: 'No such fix' });
      const by = a.session.account?.name ?? 'an admin';
      const svc = readyOf(ctx);
      const r = await svc.fix(f.dir, { fix, total: f.b.total, projectId: f.b.projectId, name: f.b.name }, by);
      if ('error' in r) return send(a.res, 409, { error: r.error });
      audit.record({ actor: { kind: 'human', name: by }, action: 'expert.ready.fix', target: { kind: 'setting', id: `expert-ready.${fix}`, label: 'Readiness fix' }, summary: `${r.message} (${f.dir})`, severity: 'info' });
      return send(a.res, 200, { message: r.message, report: await svc.check(f.dir, true) });
    },
  },
} satisfies Record<string, Route>;
