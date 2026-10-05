// The Firm's page (/firm) and its API: the reviewers and engagements, a floor's audit status for its
// 1D view, the estimate for the Call-an-audit wizard, the reports (and their downloads), and what
// the Project Manager does: call an audit, cancel one, change the reviewers' models. Those are an
// admin's, as on the Team tab.

import { cleanConfig, isActive } from '../../../shared/firm/engagement.js';
import { reportMarkdown } from '../../../shared/firm/report-md.js';
import { firmOf } from '../../firm/adapter.js';
import { firmPeople } from '../../firm/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

export const firmRoutes = {
  /** GET /api/firm: the Firm's people, its engagements (newest first) and the floors an audit can be called on. */
  view: {
    method: 'GET',
    path: '/api/firm',
    auth: 'session',
    handle(ctx, { res, session }) {
      const firm = firmOf(ctx);
      const engagements = firm.list().map(({ transcript, ...e }) => ({ ...e, transcript: transcript.slice(-60) }));
      return send(res, 200, {
        admin: ctx.meOf(session.account?.id).admin,
        people: firmPeople(firm.settings()),
        settings: firm.settings(),
        engagements,
        floors: [...ctx.floors.values()].map((f) => ({ id: f.id, name: f.def.name, repo: f.def.repo, auditing: engagements.some((e) => e.floor === f.id && isActive(e.phase)) })),
      });
    },
  },
  /** GET /api/firm/engagement?id=: one engagement with its whole transcript. */
  engagement: {
    method: 'GET',
    path: '/api/firm/engagement',
    auth: 'session',
    handle(ctx, { res, url }) {
      const e = firmOf(ctx).get(url.searchParams.get('id') ?? '');
      return e ? send(res, 200, e) : send(res, 404, { error: 'No such engagement' });
    },
  },
  /** GET /api/firm/status?floor=: the floor's running audit and alerts, for its 1D view. */
  status: {
    method: 'GET',
    path: '/api/firm/status',
    auth: 'session',
    handle(ctx, { res, url }) {
      return send(res, 200, firmOf(ctx).floorStatus(url.searchParams.get('floor') ?? ''));
    },
  },
  /** GET /api/firm/defaults?floor=: the wizard's starting config and its estimate. */
  defaults: {
    method: 'GET',
    path: '/api/firm/defaults',
    auth: 'session',
    handle(ctx, { res, url }) {
      const floor = url.searchParams.get('floor') ?? '';
      if (!ctx.floors.has(floor)) return send(res, 404, { error: 'No such floor' });
      const firm = firmOf(ctx);
      const config = firm.defaults(floor);
      return send(res, 200, { config, estimate: firm.estimate(config) });
    },
  },
  /** POST /api/firm/estimate {config}: what a configuration would cost, as an estimate. */
  estimate: {
    method: 'POST',
    path: '/api/firm/estimate',
    auth: 'session',
    async handle(ctx, { req, res }) {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = String(body.floor ?? '');
      if (!ctx.floors.has(floor)) return send(res, 404, { error: 'No such floor' });
      const firm = firmOf(ctx);
      const config = cleanConfig(body, firm.defaults(floor));
      if (typeof config === 'string') return send(res, 400, { error: config });
      return send(res, 200, { config, estimate: firm.estimate(config) });
    },
  },
  /** GET /api/firm/report?id=[&format=md|json for a download, an admin's]: a delivered report. */
  report: {
    method: 'GET',
    path: '/api/firm/report',
    auth: 'session',
    handle(ctx, { res, url, session }) {
      const firm = firmOf(ctx);
      const id = url.searchParams.get('id') ?? '';
      const r = firm.report(id);
      if (!r) return send(res, 404, { error: 'No such report' });
      const format = url.searchParams.get('format');
      if (!format) {
        firm.markRead(id);
        return send(res, 200, r);
      }
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can download reports' });
      const name = `audit-${r.floorName.replace(/[^\w-]+/g, '-').toLowerCase()}-${r.engagement}`;
      if (format === 'md') {
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${name}.md"`, 'cache-control': 'no-store' });
        return res.end(reportMarkdown(r));
      }
      return send(res, 200, r, { 'content-disposition': `attachment; filename="${name}.json"` });
    },
  },
  /** POST /api/firm/action {action: start|cancel|models, …}: the Project Manager's. */
  action: {
    method: 'POST',
    path: '/api/firm/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can do that' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const firm = firmOf(ctx);
      const by = session.account?.name ?? (typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 32) : 'The Project Manager');
      switch (body.action) {
        case 'start': {
          const e = firm.start(body.config, by);
          return typeof e === 'string' ? send(res, 400, { error: e }) : send(res, 200, { ok: true, engagement: e });
        }
        case 'cancel': {
          const err = firm.cancel(String(body.id ?? ''), by);
          return err ? send(res, 400, { error: err }) : send(res, 200, { ok: true });
        }
        case 'models': {
          const err = firm.setModels(body.models);
          return err ? send(res, 400, { error: err }) : send(res, 200, { ok: true, settings: firm.settings() });
        }
        default:
          return send(res, 400, { error: 'Unknown action' });
      }
    },
  },
} satisfies Record<string, Route>;
