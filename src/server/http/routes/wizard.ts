// The new-project wizard (server/wizard/): what it needs to know before it opens, starting, carrying
// on and editing a project's setup, and the setup panel over a toolkit project's board. Making a
// project creates a repository with the admin token, so everything that changes something is for
// admins (operators) only, and only from the office's own pages.

import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { wizardOf } from '../../wizard/index.js';
import { floorParam } from './files.js';

export const wizardRoutes = {
  wizard: {
    prefix: '/api/wizard/',
    auth: 'session',
    async handle(ctx, { req, res, url, path: p, session }) {
      const w = wizardOf(ctx);
      const admin = ctx.meOf(session.account?.id).admin;
      if (req.method === 'GET') {
        if (p === '/api/wizard/info') return send(res, 200, w.info(admin));
        if (p === '/api/wizard/job') {
          const job = w.job(url.searchParams.get('id') ?? '');
          return job ? send(res, 200, job) : send(res, 404, { error: 'No such setup' });
        }
        const floor = floorParam(ctx, url);
        if (p === '/api/wizard/setup') return floor ? send(res, 200, w.setup(floor)) : send(res, 404, { error: 'No such floor' });
        if (p === '/api/wizard/answers') return floor ? send(res, 200, { repo: floor.def.repo, answers: w.answersOf(floor) }) : send(res, 404, { error: 'No such floor' });
        return send(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (p === '/api/wizard/recheck') {
        // Anyone on the floor can ask for fresh verdicts: it only reads the project and rewrites its dashboard.
        const floor = floorParam(ctx, url);
        if (!floor) return send(res, 404, { error: 'No such floor' });
        w.recheck(floor);
        return send(res, 202, { checking: true });
      }
      if (!admin) return send(res, 403, { error: 'Only admins (operators) can set up projects' });
      let body: unknown = {};
      try {
        const text = await readBody(req, 256 * 1024);
        body = text ? JSON.parse(text) : {};
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      // Who it's by: the account, or on the shared password the name on the page's profile (only ever shown, never trusted for anything).
      const named = typeof (body as { by?: unknown }).by === 'string' ? (body as { by: string }).by.replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 60) : '';
      const who = session.account?.name ?? (named || 'an admin');
      const id = url.searchParams.get('id') ?? '';
      const r =
        p === '/api/wizard/start' ? w.start(body, who, session.account?.id) : p === '/api/wizard/retry' ? w.retry(id) : p === '/api/wizard/edit' ? w.edit(id, body) : undefined;
      if (r === undefined) return send(res, 404, { error: 'Not found' });
      if (typeof r === 'string') return send(res, 400, { error: r });
      if (p === '/api/wizard/start') console.log(`  ${who} started setting up ${r.plan.owner}/${r.plan.name} in the new-project wizard`);
      return send(res, 200, r);
    },
  },
} satisfies Record<string, Route>;
