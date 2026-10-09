// A project's pinned toolkit (server/toolkit-pin/): its Toolkit line for the setup panel and the progress
// bar's chip (answered from a cache; git off the event loop, the fork never fetched on a page load), 🔄 Check
// now (a fetch of the fork, at most once a minute), and Update toolkit's preview, update and roll back,
// which run scripts and push a commit to the project: admins only, from the office's own pages.

import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { pinFloor, toolkitOfOffice } from '../../toolkit-pin/office.js';
import { floorParam } from './files.js';

export const toolkitRoutes = {
  toolkit: {
    prefix: '/api/toolkit',
    auth: 'session',
    async handle(ctx, { req, res, url, path: p, session }) {
      const { svc, jobs } = toolkitOfOffice(ctx);
      const admin = ctx.meOf(session.account?.id).admin;
      if (req.method === 'GET') {
        if (p === '/api/toolkit/job') {
          const job = jobs.get(url.searchParams.get('id') ?? '');
          return job ? send(res, 200, job) : send(res, 404, { error: 'No such toolkit job (the office may have restarted)' });
        }
        if (p !== '/api/toolkit') return send(res, 404, { error: 'Not found' });
        const floor = floorParam(ctx, url);
        if (!floor) return send(res, 404, { error: 'No such floor' });
        const status = await svc.status(pinFloor(floor));
        const job = jobs.runningFor(floor.id);
        return send(res, 200, { ...status, fetching: svc.isFetching, admin, ...(job ? { job: { id: job.id, kind: job.kind, status: job.status } } : {}) });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      if (p === '/api/toolkit/check') {
        void svc.fetch(true);
        return send(res, 202, { fetching: true });
      }
      if (!admin) return send(res, 403, { error: 'Only admins (operators) can update a project’s toolkit' });
      let body: { to?: unknown; by?: unknown } = {};
      try {
        const text = await readBody(req, 16 * 1024);
        body = text ? JSON.parse(text) : {};
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const to = typeof body.to === 'string' && /^([0-9a-f]{7,40}|latest|previous|current)$/i.test(body.to) ? body.to : 'latest';
      const named = typeof body.by === 'string' ? body.by.replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 60) : '';
      const by = { name: session.account?.name ?? (named || 'an admin'), id: session.account?.id };
      const r = p === '/api/toolkit/preview' ? await jobs.preview(pinFloor(floor), to, by) : p === '/api/toolkit/apply' ? await jobs.apply(pinFloor(floor), to, by) : undefined;
      if (r === undefined) return send(res, 404, { error: 'Not found' });
      if (typeof r === 'string') return send(res, 400, { error: r });
      return send(res, 202, r);
    },
  },
} satisfies Record<string, Route>;
