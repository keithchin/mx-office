// The Budget (server/budget/): GET a project's numbers and breakdowns, GET the office-wide view, and
// admins POST the currency settings (or fetch the day's rate now).

import { audit, human } from '../../audit/index.js';
import { budgetOf } from '../../budget/index.js';
import { cleanFx } from '../../budget/fx.js';
import { floorView, officeView } from '../../budget/view.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';
import { whoOf } from './notify-teams.js';

export const budgetRoutes = {
  /** GET /api/budget?floor=<id>: the project's spend, budget and breakdowns. */
  view: {
    method: 'GET',
    path: '/api/budget',
    auth: 'session',
    handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const b = budgetOf(ctx);
      return send(res, 200, floorView(b, { id: floor.id, name: floor.def.name, dir: floor.dir }, ctx.meOf(session.account?.id).admin));
    },
  },
  /** GET /api/budget/office: every project, the office's background calls, the Firm. */
  office: {
    method: 'GET',
    path: '/api/budget/office',
    auth: 'session',
    handle(ctx, { res, session }) {
      return send(res, 200, officeView(budgetOf(ctx), ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/budget/fx {currency, mode: manual|daily, manualRate?, refresh?}. Admins only. */
  fx: {
    method: 'POST',
    path: '/api/budget/fx',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins can change the currency' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 4096)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const b = budgetOf(ctx);
      const o = b.store.office();
      const before = { ...o.fx };
      const next = cleanFx(body, o.fx);
      if (typeof next === 'string') return send(res, 400, { error: next });
      o.fx = next;
      b.store.changed('office');
      const who = whoOf(session.account?.name, body.by);
      if (JSON.stringify(before) !== JSON.stringify(next)) audit.record({ actor: human(who, session.account?.id), action: 'settings.change', target: { kind: 'setting', id: 'budget.fx', label: 'Budget currency' }, summary: `Set the budget's local currency to ${next.currency} (${next.mode === 'manual' ? `rate ${next.manualRate} set by hand` : 'ECB rate fetched daily'})`, details: { before, after: next }, severity: 'notice' });
      const fx = body.refresh || next.currency !== before.currency || next.mode !== before.mode ? await b.refreshFx() : b.fx();
      return send(res, 200, { fx, fxSettings: o.fx });
    },
  },
} satisfies Record<string, Route>;
