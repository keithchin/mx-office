// Portfolios' routes (server/portfolios/). Reading is for anyone signed in; every change is an admin's
// (checked here, on the server), from the office's own page, and audited:
//   GET  /api/portfolios                 every portfolio, its projects, its brain as last read; the ungrouped projects
//   POST /api/portfolios/action          {action: create|rename|add|connect|disconnect, portfolio?, label?, floor?, path?}
//   GET  /api/portfolios/context?floor=  what a project already has wired (shown before Add to portfolio)
//   GET  /api/portfolios/changes?floor=  the project's brain-change and wiring cards, for Needs you
//   POST /api/portfolios/card            {floor, act: rehire|dismiss|rewire|dismiss-wiring}: a card's button
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { portfoliosOf } from '../../portfolios/index.js';
import { isBrainAct, isPortfolioId } from '../../../shared/portfolios.js';
import { readBody, send } from '../util.js';
import { fromOffice } from '../origin.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => fromOffice(req, ctx.cfg);
const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const ONLY_ADMINS = 'Only an admin can change clients';

async function jsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return undefined;
  }
}

export const portfolioRoutes = {
  view: {
    method: 'GET',
    path: '/api/portfolios',
    auth: 'session',
    async handle(ctx, { res, session }) {
      return send(res, 200, await portfoliosOf(ctx).view(ctx.meOf(session.account?.id).admin));
    },
  },
  act: {
    method: 'POST',
    path: '/api/portfolios/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: ONLY_ADMINS });
      const body = await jsonBody(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      const by = session.account?.name ?? 'The Project Manager';
      const s = portfoliosOf(ctx);
      const pid = isPortfolioId(body.portfolio) ? body.portfolio : undefined;
      switch (body.action) {
        case 'create': {
          const p = await s.create(str(body.label, 80) ?? '', by);
          return typeof p === 'string' ? send(res, 400, { error: p }) : send(res, 200, { portfolio: p, view: await s.view(true) });
        }
        case 'rename': {
          // A new name for a client (same rules as create); its id never changes.
          if (!pid) return send(res, 400, { error: 'Say which client' });
          const err = await s.rename(pid, typeof body.label === 'string' ? body.label : '', by);
          if (err) return send(res, err === 'No such client' ? 404 : 400, { error: err });
          return send(res, 200, { view: await s.view(true) });
        }
        case 'add': {
          const floor = str(body.floor, 200);
          if (!pid || !floor) return send(res, 400, { error: 'Say which client and which project' });
          const r = await s.addProject(pid, floor, by);
          // S03: a cross-portfolio move is refused with a clear message (409: the project's state forbids it).
          if (r.error) return send(res, 409, { error: r.error });
          return send(res, 200, { ...r, view: await s.view(true) });
        }
        case 'connect': {
          const p = str(body.path, 1000);
          if (!pid || !p) return send(res, 400, { error: 'Say which client and the brain folder' });
          const r = await s.connect(pid, p, by);
          if (r.error) return send(res, 400, { error: r.error });
          const partial = Object.entries(r.results ?? {}).filter(([, c]) => !c.ok);
          return send(res, 200, { ...r, ...(partial.length ? { warning: `Wiring is incomplete on ${partial.length} project${partial.length === 1 ? '' : 's'}: see Needs you on ${partial.length === 1 ? 'it' : 'each'}.` } : {}), view: await s.view(true) });
        }
        case 'disconnect': {
          if (!pid) return send(res, 400, { error: 'Say which client' });
          const r = await s.disconnect(pid, by);
          if (r.error) return send(res, 400, { error: r.error });
          return send(res, 200, { ...r, view: await s.view(true) });
        }
        default:
          return send(res, 400, { error: 'action is one of create, rename, add, connect, disconnect' });
      }
    },
  },
  context: {
    method: 'GET',
    path: '/api/portfolios/context',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, await portfoliosOf(ctx).existingContext(floor.id));
    },
  },
  changes: {
    method: 'GET',
    path: '/api/portfolios/changes',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      return send(res, 200, portfoliosOf(ctx).changeView(floor.id, ctx.meOf(session.account?.id).admin));
    },
  },
  card: {
    method: 'POST',
    path: '/api/portfolios/card',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can act on this card' });
      const body = await jsonBody(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      if (!isBrainAct(body.act)) return send(res, 400, { error: 'act is one of rehire, dismiss, rewire, dismiss-wiring' });
      const err = await portfoliosOf(ctx).act(floor.id, body.act, session.account?.name ?? 'The Project Manager');
      if (err) return send(res, 400, { error: err });
      return send(res, 200, portfoliosOf(ctx).changeView(floor.id, true));
    },
  },
} satisfies Record<string, Route>;
