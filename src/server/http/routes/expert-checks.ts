// Expert mode's background checks (server/expert-checks/, slice 6): POST /api/expert/send {floor, text} fills the
// session's input with a short prompt about a failure and never submits it (409 with why when the session isn't
// idle at its prompt); POST /api/expert/checks {floor, scope?} starts a run now on the folder's HEAD (or says one is
// under way). The cells themselves come with GET /api/expert/proof. Signed in, from the office's own pages only.

import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { isExpert } from '../../expert/shell.js';
import { sessionWorker } from '../../expert/session-worker.js';
import { backgroundChecksOf, fillSession } from '../../expert-checks/index.js';

async function json(req: Parameters<Route['handle']>[1]['req']): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export const expertChecksRoutes = {
  send: {
    method: 'POST',
    path: '/api/expert/send',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const body = await json(req);
      if (!body || typeof body.text !== 'string') return send(res, 400, { error: 'Send JSON with floor and text' });
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (!isExpert(floor)) return send(res, 409, { error: 'This project is in Team mode: it has no session of its own' });
      const why = fillSession(floor.workers, sessionWorker(floor)?.id, body.text, session.account?.name ?? 'someone');
      return why ? send(res, 409, { error: why }) : send(res, 200, { ok: true });
    },
  },
  run: {
    method: 'POST',
    path: '/api/expert/checks',
    auth: 'session',
    async handle(ctx, { req, res }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const body = await json(req);
      const floor = ctx.floors.get(String(body?.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (!isExpert(floor)) return send(res, 409, { error: 'Not an Expert project' });
      const checks = backgroundChecksOf(ctx);
      const on = checks.runningOn(floor.id);
      if (on) return send(res, 409, { error: `A check is running on ${on.commit.slice(0, 7)}: it shows on the strip when it ends` });
      void checks.runChecks(floor.id, floor.dir, { scope: body?.scope === 'all' ? 'all' : 'affected' });
      return send(res, 202, { started: true });
    },
  },
} satisfies Record<string, Route>;
