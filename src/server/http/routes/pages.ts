// The office's pages and the rest of the client bundle.
import path from 'node:path';
import { publicFile, serveFile } from '../static.js';
import { send } from '../util.js';
import { slugFromPath } from '../../../shared/docsite.js';
import { legacyOfficeUrl } from '../../../shared/home.js';
import type { Route, RouteRequest } from '../router.js';
import type { Ctx } from '../../office/context.js';

/** One of the bundle's own pages, never cached, so a new version is picked up at once. */
const page = (name: string) => (ctx: Ctx, { res }: RouteRequest) => serveFile(res, path.join(ctx.publicDir, name), false);

export const pageRoutes = {
  health: { path: '/api/health', auth: 'public', handle: (_ctx, { res }) => send(res, 200, { ok: true }) },
  assets: {
    prefix: '/assets/',
    auth: 'public',
    handle(ctx, { res, path: p }) {
      const file = publicFile(ctx.publicDir, p);
      if (file) return serveFile(res, file, true);
      res.writeHead(404).end();
    },
  },
  login: { path: ['/login', '/login.html'], auth: 'public', handle: page('login.html') },
  claim: { path: ['/claim', '/claim.html'], auth: 'public', handle: page('claim.html') },
  join: { path: ['/join', '/join.html'], auth: 'public', handle: page('join.html') },
  favicon: { path: '/favicon.svg', auth: 'public', handle: page('favicon.svg') },
  // The 3D office's address, and every old link to it (?view=3d, ?view=retro, ?3d=1…): the 3D and Retro
  // views are gone, so it opens the 1D view (of the floor the link named), which signs in first if need be.
  office: { path: ['/', '/index.html'], auth: 'public', handle: (_ctx, { res, url }) => void res.writeHead(302, { location: legacyOfficeUrl(url.search), 'cache-control': 'no-store' }).end() },
  // The home page: every project's card, and the office's statistics (home.ts).
  home: { path: ['/home', '/home.html'], auth: 'session', handle: page('home.html') },
  // The Firm: the office's Reviewer Agents, their engagements and reports (firm.ts).
  firm: { path: ['/firm', '/firm.html'], auth: 'session', handle: page('firm.html') },
  // The 1D view: where every project opens, on its Command Center (lite.ts).
  lite: { path: ['/lite', '/lite.html'], auth: 'session', handle: page('lite.html') },
  // The 2D Office view: the floor from above in pixel art, every worker at its desk (pixel.ts), reached from the 1D view's Go to Office.
  pixel: { path: ['/pixel', '/pixel.html'], auth: 'session', handle: page('pixel.html') },
  // The documentation site (docs.ts): its bundle and pictures from the build (docs/site.json, docs/images/),
  // and every other address under /docs (a page, a section, one that is not there) to its page, which
  // draws it. Behind the sign-in like the rest of the office, since it names tokens, paths and ports.
  docs: {
    prefix: '/docs',
    auth: 'session',
    handle(ctx, { res, path: p }) {
      const notFound = () => res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      if (slugFromPath(p) === undefined && p !== '/docs.html') return notFound();
      if (p.startsWith('/docs/images/') || p === '/docs/site.json') {
        const file = publicFile(ctx.publicDir, p);
        return file ? serveFile(res, file, false) : notFound();
      }
      return serveFile(res, path.join(ctx.publicDir, 'docs.html'), false);
    },
  },
  /** Anything else in the bundle; last, since it answers every path. */
  bundle: {
    prefix: '/',
    auth: 'session',
    handle(ctx, { res, path: p }) {
      const file = publicFile(ctx.publicDir, p);
      if (file) return serveFile(res, file, false);
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    },
  },
} satisfies Record<string, Route>;
