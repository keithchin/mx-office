// The Developer view's explorer (server/app-explorer/): main's newest commit (the default revision), the
// business tree one level at a time or whole (for the search), the all-files view's folders, files and
// search, the documents with their relationships, and what changed between two revisions. All read-only and
// about one commit (`rev`, a full commit id: main's newest unless the viewer picks another), read from the
// repository, so none of it needs the app to be running. Anyone signed in may look, as
// with the Model tab and the Documents page; the all-files view never lists or opens what the denylist or
// the project's .gitignore hides, and takes only paths inside the project.
import type { Route } from '../router.js';
import { explorerChanges, explorerIndex, explorerLevel } from '../../app-explorer/index.js';
import { fileAt, folderAt, searchFiles } from '../../app-explorer/files.js';
import { explorerHead } from '../../app-explorer/head.js';
import { documentsAt } from '../../app-explorer/documents.js';
import { pageFacts } from '../../app-explorer/page-facts.js';
import { SHA_RE } from '../../../shared/app-explorer.js';
import { send } from '../util.js';
import { floorParam } from './files.js';

/** A commit's answer never changes: the browser may keep it for the visit. */
const KEEP = { 'cache-control': 'private, max-age=3600' };
/** An answer that says the model or files couldn't be read isn't kept (the next look tries again). */
const keepUnless = (r: { problem?: string }) => (r.problem ? { 'cache-control': 'no-store' } : KEEP);

export const appExplorerRoutes = {
  /**
   * GET /api/app-explorer/head?floor=<id>[&served=<commit>]: main's newest commit, and how far the live app's revision is from it;
   * GET /api/app-explorer/index?floor=<id>&rev=<commit>: every level of the business tree at once (the search);
   * GET /api/app-explorer/search?floor=<id>&rev=<commit>&q=<words>: the project's files whose path has every word;
   * GET /api/app-explorer/documents?floor=<id>&rev=<commit>: the documents with their relationships, git dates and status;
   * GET /api/app-explorer/tree?floor=<id>&rev=<commit>&at=<level>: one level of the business tree;
   * GET /api/app-explorer/files?floor=<id>&rev=<commit>&path=<folder>[&cursor=<n>]: one folder of the project's files, paged;
   * GET /api/app-explorer/file?floor=<id>&rev=<commit>&path=<file>: one file, read-only (text, a picture, or why not);
   * GET /api/app-explorer/changes?floor=<id>&from=<commit>&rev=<commit>: what changed between two revisions;
   * GET /api/app-explorer/page-facts?floor=<id>&rev=<commit>&qn=<page>: a page's widgets ($Type, $ID), who shares its snippets, the theme's layout classes.
   */
  explorer: {
    method: 'GET',
    prefix: '/api/app-explorer',
    auth: 'session',
    async handle(ctx, { res, url, path: p }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const q = url.searchParams;
      if (p === '/api/app-explorer/head') {
        try {
          return send(res, 200, await explorerHead(floor.dir, q.get('served') ?? undefined), { 'cache-control': 'no-store' });
        } catch (err) {
          return send(res, 502, { error: (err as Error).message });
        }
      }
      const rev = q.get('rev') ?? '';
      if (!SHA_RE.test(rev)) return send(res, 400, { error: 'Which version? (a full commit id)' });
      try {
        if (p === '/api/app-explorer/tree') {
          const r = await explorerLevel(ctx, floor, rev, q.get('at') ?? '');
          return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, r, keepUnless(r));
        }
        if (p === '/api/app-explorer/index') {
          const r = await explorerIndex(ctx, floor, rev);
          return send(res, 200, r, keepUnless(r));
        }
        if (p === '/api/app-explorer/search') {
          const words = (q.get('q') ?? '').slice(0, 200);
          return send(res, 200, { rev, q: words, ...(await searchFiles(floor.dir, rev, words)) }, KEEP);
        }
        if (p === '/api/app-explorer/documents') {
          const r = await documentsAt(ctx, floor, rev);
          return send(res, 200, r, keepUnless(r));
        }
        if (p === '/api/app-explorer/files') {
          const r = await folderAt(floor.dir, rev, q.get('path') ?? '', Number(q.get('cursor')) || 0);
          return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, { rev, at: q.get('path') ?? '', ...r }, KEEP);
        }
        if (p === '/api/app-explorer/file') {
          const r = await fileAt(floor.dir, rev, q.get('path'));
          return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, r, { ...KEEP, 'x-content-type-options': 'nosniff' });
        }
        if (p === '/api/app-explorer/page-facts') {
          const r = await pageFacts(ctx, floor, rev, q.get('qn') ?? '');
          return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, r, keepUnless(r));
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
