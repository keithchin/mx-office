// The office's pages and the rest of the client bundle.
import path from 'node:path';
import { publicFile, serveFile } from '../static.js';
import { send } from '../util.js';
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
  office: { path: ['/', '/index.html'], auth: 'session', handle: page('index.html') },
  // The home page: every project's card, and the office's statistics (home.ts).
  home: { path: ['/home', '/home.html'], auth: 'session', handle: page('home.html') },
  // The 1D view: the workers, their terminals and the boards, without the 3D office (lite.ts).
  lite: { path: ['/lite', '/lite.html'], auth: 'session', handle: page('lite.html') },
  // The 2D view: the floor from above in pixel art, every worker at its desk (pixel.ts).
  pixel: { path: ['/pixel', '/pixel.html'], auth: 'session', handle: page('pixel.html') },
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
