// The App Workspace's explorer (server/app-explorer/): the business tree one level at a time, the all-files
// view's folders and files, and what changed between two served revisions. All read-only and about one
// commit (`rev`, a full commit id: the page asks for the served revision). Anyone signed in may look, as
// with the Model tab and the Documents page; the all-files view never lists or opens what the denylist or
// the project's .gitignore hides, and takes only paths inside the project.
import type { Route } from '../router.js';
import { explorerChanges, explorerLevel } from '../../app-explorer/index.js';
import { fileAt, folderAt } from '../../app-explorer/files.js';
import { SHA_RE } from '../../../shared/app-explorer.js';
import { send } from '../util.js';
import { floorParam } from './files.js';

/** A commit's answer never changes: the browser may keep it for the visit. */
const KEEP = { 'cache-control': 'private, max-age=3600' };

export const appExplorerRoutes = {
  /**
   * GET /api/app-explorer/tree?floor=<id>&rev=<commit>&at=<level>: one level of the business tree;
   * GET /api/app-explorer/files?floor=<id>&rev=<commit>&path=<folder>[&cursor=<n>]: one folder of the project's files, paged;
   * GET /api/app-explorer/file?floor=<id>&rev=<commit>&path=<file>: one file, read-only (text, a picture, or why not);
   * GET /api/app-explorer/changes?floor=<id>&from=<commit>&rev=<commit>: what changed between two revisions.
   */
  explorer: {
    method: 'GET',
    prefix: '/api/app-explorer',
    auth: 'session',
    async handle(ctx, { res, url, path: p }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const q = url.searchParams;
      const rev = q.get('rev') ?? '';
      if (!SHA_RE.test(rev)) return send(res, 400, { error: 'Which version? (a full commit id)' });
      try {
        if (p === '/api/app-explorer/tree') {
          const r = await explorerLevel(ctx, floor, rev, q.get('at') ?? '');
          return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, r, KEEP);
        }
        if (p === '/api/app-explorer/files') {
          const r = await folderAt(floor.dir, rev, q.get('path') ?? '', Number(q.get('cursor')) || 0);
          return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, { rev, at: q.get('path') ?? '', ...r }, KEEP);
        }
        if (p === '/api/app-explorer/file') {
          const r = await fileAt(floor.dir, rev, q.get('path'));
          return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, r, { ...KEEP, 'x-content-type-options': 'nosniff' });
        }
        if (p === '/api/app-explorer/changes') {
          const from = q.get('from') ?? '';
          if (!SHA_RE.test(from)) return send(res, 400, { error: 'From which version?' });
          return send(res, 200, await explorerChanges(ctx, floor, from, rev), KEEP);
        }
      } catch (err) {
        return send(res, 502, { error: (err as Error).message });
      }
      return send(res, 404, { error: 'Not found' });
    },
  },
} satisfies Record<string, Route>;
