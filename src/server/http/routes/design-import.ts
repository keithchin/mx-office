// Import a design system from a folder (server/design/import/). For admins, from the office's own pages; the
// folder is only read (never written, nothing in it run or fetched) and nothing is published by itself.
//   GET  /api/design/import?client=   (admins) what the client's draft (or newest version) was imported from, if anything
//   POST /api/design/import           {action: 'scan', client, path} → the review's material (ImportScanView)
//                                     {action: 'save', client, scanId, name, choices, passthrough, dark} → a draft
import type { Route } from '../router.js';
import { importsOf } from '../../design/import/index.js';
import { isPortfolioId } from '../../../shared/portfolios.js';
import { readBody, sameOrigin, send } from '../util.js';

export const designImportRoutes = {
  view: {
    method: 'GET',
    path: '/api/design/import',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const client = url.searchParams.get('client');
      if (!isPortfolioId(client)) return send(res, 404, { error: 'No such client' });
      // A path on the office's machine: for admins (who import), like the rest of this.
      if (!ctx.meOf(session.account?.id).admin) return send(res, 200, { imported: null });
      return send(res, 200, {
        imported: (await importsOf(ctx).summary(client)) ?? null,
      });
    },
  },
  act: {
    method: 'POST',
    path: '/api/design/import',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg) && (req.headers.origin || !/^application\/json\b/i.test(req.headers['content-type'] ?? ''))) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin)
        return send(res, 403, {
          error: 'Only an admin can import a design system',
        });
      let b: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
        b = v && typeof v === 'object' ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      if (!isPortfolioId(b.client)) return send(res, 400, { error: 'Say which client' });
      const s = importsOf(ctx);
      if (b.action === 'scan') {
        const r = await s.scan(b.client, b.path);
        return typeof r === 'string' ? send(res, 400, { error: r }) : send(res, 200, r);
      }
      if (b.action === 'save') {
        const r = await s.save(b.client, b, session.account?.name ?? 'The Project Manager');
        return typeof r === 'string' ? send(res, 400, { error: r }) : send(res, 200, r);
      }
      return send(res, 400, { error: 'action is scan or save' });
    },
  },
} satisfies Record<string, Route>;
