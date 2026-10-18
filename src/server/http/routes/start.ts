// Home (/start, client/start.ts; server/start/): its page and GET /api/start, what only the server knows
// about every project (Needs you across everything, stuck and failing work, live apps, recent milestones,
// the office's health). Read-only, for anyone signed in.

import path from 'node:path';
import { serveFile } from '../static.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { startView } from '../../start/index.js';

export const startRoutes = {
  /** GET /api/start: every project's red Needs-you items, stuck and failing counts, live app, milestones and the office's health. */
  view: { method: 'GET', path: '/api/start', auth: 'session', handle: async (ctx, { res }) => send(res, 200, await startView(ctx)) },
  /** Home: the office's landing page, where the wordmark, the 🏠 and a bare / go. Never cached, as the other pages. */
  page: { path: ['/start', '/start.html'], auth: 'session', handle: (ctx, { res }) => serveFile(res, path.join(ctx.publicDir, 'start.html'), false) },
} satisfies Record<string, Route>;
