// A New project draft's source folder (server/wizard/source-folder.ts): POST /api/source-folder/scan with
// the folder's path checks it (refused: the office's own folders, the projects home, system folders),
// scans it off the event loop for the summary, and keeps it on the draft; /clear forgets it. Like the
// rest of the brief, for admins only, from the office's own pages, and each draft is its owner's. The
// folder stays on the office's machine: it is only read here, and copied at setup.

import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { plannerOf, type Who } from '../../wizard/planner/index.js';
import { draftView } from '../../wizard/planner/drafts.js';
import { checkSourcePath, scanSourceFolder } from '../../wizard/source-folder.js';

export const sourceFolderRoutes = {
  sourceFolder: {
    prefix: '/api/source-folder/',
    auth: 'session',
    async handle(ctx, { req, res, url, path: p, session }) {
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins (operators) can set up projects' });
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const planner = plannerOf(ctx);
      const named = (url.searchParams.get('by') ?? '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 60);
      const who: Who = { id: session.account?.id ?? 'shared', name: session.account?.name ?? (named || 'an admin') };
      const d = planner.get(url.searchParams.get('id') ?? '', who);
      if (!d) return send(res, 404, { error: 'No such draft' });
      if (p === '/api/source-folder/clear') {
        planner.clearSource(d);
        return send(res, 200, draftView(d));
      }
      if (p !== '/api/source-folder/scan') return send(res, 404, { error: 'Not found' });
      let body: Record<string, unknown> = {};
      try {
        const text = await readBody(req, 8 * 1024);
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const checked = await checkSourcePath(body.path, { dataDir: ctx.cfg.dataDir, projectsDir: ctx.building.projectsDir });
      if ('error' in checked) return send(res, 400, { error: checked.error });
      const scan = await scanSourceFolder(checked.path);
      if ('error' in scan) return send(res, 400, { error: scan.error });
      const bad = planner.setSource(d, scan);
      return bad ? send(res, 409, { error: bad, draft: draftView(d) }) : send(res, 200, draftView(d));
    },
  },
} satisfies Record<string, Route>;
