// The office's workflow runs (server/flow/), read-only: GET /api/flows lists them, newest first, with
// where each one is and why it stopped; ?floor= for one floor's, ?workflow= for one workflow's. Just
// the summary, never a run's state (a plan, a log), which its own feature's page shows to who may see it.

import type { Route } from '../router.js';
import { send } from '../util.js';
import { flowsOf } from '../../flow/index.js';

const param = (url: URL, name: string) => url.searchParams.get(name)?.slice(0, 128) || undefined;

export const flowRoutes = {
  list: {
    method: 'GET',
    path: '/api/flows',
    auth: 'session',
    handle(ctx, { res, url }) {
      return send(res, 200, { runs: flowsOf(ctx).summaries({ floor: param(url, 'floor'), workflow: param(url, 'workflow') }).slice(0, 200) });
    },
  },
} satisfies Record<string, Route>;
