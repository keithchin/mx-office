// A pull request's checks on the board (server/prshots/): its scorecard and screenshots, and each
// screenshot's picture. Signed-in only, like the board itself; the pictures come from the office's
// data folder, never from a path the browser names outside a run's own folder.
import { readFile } from 'node:fs/promises';
import { prShotsOf } from '../../prshots/index.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const prNumber = (url: URL) => {
  const n = Number(url.searchParams.get('pr'));
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export const prShotRoutes = {
  /** GET /api/pr-shots?floor=<id>&pr=<n>: the newest pr-checks run, its scorecard and its screenshots (PrChecks). */
  checks: {
    method: 'GET',
    path: '/api/pr-shots',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      const pr = prNumber(url);
      if (!floor || !pr) return send(res, 404, { error: 'No such floor or pull request' });
      if (!floor.def.repo) return send(res, 200, { pr, rows: [], shots: [], note: 'This floor has no GitHub repository' });
      const head = floor.github.pulls.items.find((p) => p.number === pr)?.headRefName;
      try {
        return send(res, 200, await prShotsOf(ctx).checks(floor.def.repo, floor.dir, pr, head));
      } catch (err) {
        return send(res, 502, { error: (err as Error).message });
      }
    },
  },
  /** GET /api/pr-shots/file?floor=<id>&pr=<n>&run=<id>&name=<path in the artifact>: one screenshot. */
  file: {
    method: 'GET',
    path: '/api/pr-shots/file',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      const pr = prNumber(url);
      const run = Number(url.searchParams.get('run'));
      if (!floor?.def.repo || !pr || !Number.isInteger(run)) return send(res, 404, { error: 'No such screenshot' });
      const file = prShotsOf(ctx).file(floor.def.repo, pr, run, url.searchParams.get('name') ?? '');
      if (!file) return send(res, 404, { error: 'No such screenshot' });
      const png = await readFile(file);
      // A run's pictures never change: the browser may keep them.
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length), 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' });
      res.end(png);
    },
  },
} satisfies Record<string, Route>;
