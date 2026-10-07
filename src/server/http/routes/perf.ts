// POST /api/perf/longtask: a page telling the office one of its tasks ran too long (the live warnings,
// server/perfwatch/). Anyone signed in may report; what they send is only ever shown in an incident.

import { readPageReport } from '../../perfwatch/index.js';
import { reportPage } from '../../perfwatch/office.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

export const perfRoutes = {
  longTask: {
    path: '/api/perf/longtask',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const r = readPageReport(body);
      if (!r) return send(res, 400, { error: 'Send { view, ms, stack? } for a task over the threshold' });
      const raised = reportPage(r, session.account?.name ?? 'Someone');
      return send(res, 202, { raised });
    },
  },
} satisfies Record<string, Route>;
