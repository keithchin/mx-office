// Design systems' routes (server/design/). Reading is for anyone signed in; every change is an admin's
// (checked here, on the server), from the office's own page, and audited. Nothing here calls a model, and
// nothing starts a runtime (Capture now uses the live app only when it's already running).
//   GET  /api/design?client=|floor=   the client's design system and versions, or the project's Design gallery
//   GET  /api/design/choices?client=  what a new project of the client may adopt (its default first)
//   GET  /api/design/needs?floor=     the project's ✋ adoption card, for Needs you
//   GET  /api/design/file?…           a package file (system, n, file) or a capture PNG (floor, capture)
//   POST /api/design/action           {action: draft|publish|approve|edit|default|propose|adopt|keep|select|capture, …}
import type http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from '../../office/context.js';
import { designOf } from '../../design/index.js';
import { isDesignId, type DesignOwner, type SelectionScope } from '../../../shared/design/types.js';
import { cleanInput } from '../../../shared/design/tokens.js';
import { isPortfolioId } from '../../../shared/portfolios.js';
import { readBody, send } from '../util.js';
import { fromOffice } from '../origin.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => fromOffice(req, ctx.cfg);
const ONLY_ADMINS = 'Only an admin can change design systems';
/** The package files a page may read (never a path from the request). */
const PACKAGE_FILE = /^(summary\.md|tokens\.css|manifest\.json|import\.json|import\/excerpts\.txt|patterns\/[a-z0-9.-]+\.md)$/;

async function jsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 32 * 1024)) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return undefined;
  }
}

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : undefined);

export const designRoutes = {
  view: {
    method: 'GET',
    path: '/api/design',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const admin = ctx.meOf(session.account?.id).admin;
      const client = url.searchParams.get('client');
      if (client) return isPortfolioId(client) ? send(res, 200, await designOf(ctx).clientView(client, admin)) : send(res, 404, { error: 'No such client' });
      const floor = floorParam(ctx, url);
      const v = floor ? await designOf(ctx).projectView(floor.id, admin) : undefined;
      return v ? send(res, 200, v) : send(res, 404, { error: 'No such project' });
    },
  },
  choices: {
    method: 'GET',
    path: '/api/design/choices',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const client = url.searchParams.get('client');
      return send(res, 200, await designOf(ctx).choices(isPortfolioId(client) ? client : undefined));
    },
  },
  needs: {
    method: 'GET',
    path: '/api/design/needs',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const s = designOf(ctx);
      await s.ready();
      return send(res, 200, s.needView(floor.id, ctx.meOf(session.account?.id).admin));
    },
  },
  file: {
    method: 'GET',
    path: '/api/design/file',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const s = designOf(ctx);
      const cap = url.searchParams.get('capture');
      if (cap) {
        const floor = floorParam(ctx, url);
        const png = floor && /^cap_[0-9A-Z]{26}$/.test(cap) ? await s.captures.png(floor.id, cap) : undefined;
        if (!png) return send(res, 404, { error: 'No such screenshot' });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' });
        return void res.end(png);
      }
      const id = url.searchParams.get('system');
      const n = int(url.searchParams.get('n'));
      const file = url.searchParams.get('file') ?? '';
      if (!isDesignId(id) || !n || !PACKAGE_FILE.test(file)) return send(res, 400, { error: 'Say which package file' });
      const text = await readFile(path.join(s.store.packageDir(id, n), ...file.split('/')), 'utf8').catch(() => undefined);
      if (text === undefined) return send(res, 404, { error: 'No such file' });
      res.writeHead(200, { 'content-type': `${file.endsWith('.json') ? 'application/json' : 'text/plain'}; charset=utf-8`, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
      return void res.end(text);
    },
  },
  act: {
    method: 'POST',
    path: '/api/design/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: ONLY_ADMINS });
      const b = await jsonBody(req);
      if (!b) return send(res, 400, { error: 'Send JSON' });
      const by = session.account?.name ?? 'The Project Manager';
      const s = designOf(ctx);
      const sys = isDesignId(b.system) ? b.system : undefined;
      const n = int(b.n);
      const floor = typeof b.floor === 'string' ? ctx.floors.get(b.floor) : undefined;
      const done = (err: string | undefined) => (err ? send(res, 400, { error: err }) : send(res, 200, { ok: true }));
      switch (b.action) {
        case 'draft': {
          const owner: DesignOwner | undefined = isPortfolioId(b.client) ? { client: b.client } : floor ? { floor: floor.id } : undefined;
          if (!owner) return send(res, 400, { error: 'Say which client or project' });
          return done(await s.saveDraft(owner, b.kind === 'atlas' ? 'atlas' : 'branded', cleanInput(b.input), by));
        }
        case 'publish': {
          if (!sys) return send(res, 400, { error: 'Say which design system' });
          const r = await s.publish(sys, by);
          return typeof r === 'string' ? send(res, 400, { error: r }) : send(res, 200, r);
        }
        case 'approve':
          return sys && n ? done(await s.approve(sys, n, by)) : send(res, 400, { error: 'Say which version' });
        case 'edit':
          return sys && n ? done(await s.editFrom(sys, n, by)) : send(res, 400, { error: 'Say which version' });
        case 'default':
          if (!isPortfolioId(b.client)) return send(res, 400, { error: 'Say which client' });
          return done(await s.setDefault(b.client, sys && n ? { systemId: sys, n } : undefined, by));
        case 'propose':
          return floor && sys && n ? done(await s.propose(floor.id, sys, n, by)) : send(res, 400, { error: 'Say which project and version' });
        case 'adopt':
          return floor ? done(await s.adopt(floor.id, by)) : send(res, 404, { error: 'No such project' });
        case 'keep':
          return floor ? done(await s.keep(floor.id, by)) : send(res, 404, { error: 'No such project' });
        case 'select': {
          if (!floor || typeof b.pattern !== 'string') return send(res, 400, { error: 'Say which project and pattern' });
          const issue = int(b.issue);
          const page = typeof b.page === 'string' && b.page.trim() ? b.page.trim().slice(0, 120) : undefined;
          const scope: SelectionScope = issue ? { issue } : page ? { page } : { project: true };
          return done(await s.select(floor.id, b.pattern, scope, by, b.behalf === true));
        }
        case 'capture': {
          if (!floor) return send(res, 404, { error: 'No such project' });
          const r = await s.capture(floor.id, by).catch((err: Error) => `The capture failed: ${err.message.slice(0, 200)}`);
          return typeof r === 'string' ? send(res, 400, { error: r }) : send(res, 200, { ok: true, made: r });
        }
        default:
          return send(res, 400, { error: 'action is one of draft, publish, approve, edit, default, propose, adopt, keep, select, capture' });
      }
    },
  },
} satisfies Record<string, Route>;
