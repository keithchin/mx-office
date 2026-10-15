// The new-project wizard (server/wizard/): what it needs to know before it opens, starting, carrying
// on and editing a project's setup, and the setup panel over a toolkit project's board. Making a
// project creates a repository with the admin token, so everything that changes something is for
// admins (operators) only, and only from the office's own pages.

import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { wizardOf } from '../../wizard/index.js';
import { floorParam } from './files.js';
import { setupCancelsOf, unfinishedSetups } from '../../wizard/unfinished.js';

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
        // Unfinished setups (Home's cards, the wizard's first page), and Cancel & undo's plan and progress.
        if (p === '/api/wizard/unfinished') return send(res, 200, { admin, setups: await unfinishedSetups(ctx, w) });
        if (p === '/api/wizard/cancel-plan') {
          const plan = await setupCancelsOf(ctx, w).plan(url.searchParams.get('id') ?? '');
          return typeof plan === 'string' ? send(res, 404, { error: plan }) : send(res, 200, plan);
        }
        if (p === '/api/wizard/cancel') {
          const job = await setupCancelsOf(ctx, w).job(url.searchParams.get('id') ?? '');
          return job ? send(res, 200, job) : send(res, 404, { error: 'No cancel for that setup' });
        }
        if (p === '/api/wizard/app-version') return send(res, 200, await w.appVersion(url.searchParams.get('repo') ?? ''));
        const floor = floorParam(ctx, url);
        if (p === '/api/wizard/setup') return floor ? send(res, 200, { ...(await w.setup(floor)), admin }) : send(res, 404, { error: 'No such project' });
        if (p === '/api/wizard/answers') return floor ? send(res, 200, { repo: floor.def.repo, answers: w.answersOf(floor) }) : send(res, 404, { error: 'No such project' });
        return send(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (p === '/api/wizard/recheck') {
        // It runs a toolkit script on the office's machine and rewrites files in the floor's checkout: admins only.
        if (!admin) return send(res, 403, { error: 'Only admins (operators) can re-check the gates' });
        const floor = floorParam(ctx, url);
        if (!floor) return send(res, 404, { error: 'No such project' });
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
      if (p === '/api/wizard/cancel') {
        // Cancel & undo: deletes what the setup made (when ticked), GitHub-style typed confirmation.
        const r = await setupCancelsOf(ctx, w).start(id, body, { name: who, id: session.account?.id });
        if (typeof r === 'string') return send(res, 400, { error: r });
        console.log(`  ${who} is cancelling the setup of ${r.repo} (Cancel & undo)`);
        return send(res, 202, r);
      }
      // An operation whose outcome isn't settled: look again ("Check GitHub again"), or use what was found.
      if (p === '/api/wizard/check' || p === '/api/wizard/adopt') {
        const op = typeof (body as { op?: unknown }).op === 'string' ? (body as { op: string }).op : '';
        const r = p === '/api/wizard/check' ? await w.check(id) : await w.adopt(id, op, { name: who, id: session.account?.id });
        if (typeof r === 'string') return send(res, 400, { error: r });
        if (p === '/api/wizard/adopt') console.log(`  ${who} adopted the existing ${r.plan.owner}/${r.plan.name} for its setup`);
        return send(res, 200, r);
      }
      // A Retry looks at an unsettled operation first, and one that would fail anyway (a paused project…) says so first, with what to do.
      const tried = p === '/api/wizard/retry' ? await w.retry(id) : undefined;
      if (tried && typeof tried === 'object' && 'blocker' in tried) return send(res, 409, { error: tried.blocker.text, blocker: tried.blocker });
      const r = p === '/api/wizard/start' ? w.start(body, who, session.account?.id) : p === '/api/wizard/retry' ? tried : p === '/api/wizard/edit' ? w.edit(id, body) : undefined;
      if (r === undefined) return send(res, 404, { error: 'Not found' });
      if (typeof r === 'string') return send(res, 400, { error: r });
      if (p === '/api/wizard/start') console.log(`  ${who} started setting up ${r.plan.owner}/${r.plan.name} in the new-project wizard`);
      return send(res, 200, r);
    },
  },
} satisfies Record<string, Route>;
