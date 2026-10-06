// The Budget (server/budget/): GET a project's numbers and breakdowns, GET the office-wide view, and
// admins POST the currency settings (or fetch the day's rate now).

import { audit, human } from '../../audit/index.js';
import { applyChoice, budgetOf, controlOf } from '../../budget/index.js';
import { applyFirm, editPlan, numbersOf, regeneratePlan, resume, setSettings } from '../../budget/control.js';
import { firmForecastOf, projectShape } from '../../budget/plan-source.js';
import { firmIfMade } from '../../firm/adapter.js';
import { spentOf } from '../../../shared/firm/engagement.js';
import { cleanChoice, levelCards } from '../../../shared/budget/levels.js';
import { generatePlan, planTotal } from '../../../shared/budget/plan.js';
import { ENTRY_MODES, type EntryMode } from '../../../shared/wizard.js';
import type { Ctx } from '../../office/context.js';
import type { FirmForecast } from '../../../shared/budget/types.js';
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
      return send(res, 200, floorView(b, { id: floor.id, name: floor.def.name, dir: floor.dir }, ctx.meOf(session.account?.id).admin, firmFor(ctx, floor.id)));
    },
  },
  /** GET /api/budget/office: every project, the office's background calls, the Firm. */
  office: {
    method: 'GET',
    path: '/api/budget/office',
    auth: 'session',
    handle(ctx, { res, session }) {
      const v = officeView(budgetOf(ctx), ctx.meOf(session.account?.id).admin);
      // The Firm's audits, newest first, when this office has run any.
      const firm = firmIfMade(ctx);
      if (firm) {
        const list = firm.list().filter((e) => !e.sample).sort((a, z) => z.requestedAt - a.requestedAt);
        v.firm.audits = list.length;
        v.firm.list = list.slice(0, 10).map((e) => ({ id: e.id, floor: e.floor, floorName: e.floorName, phase: e.phase, spent: Math.round(spentOf(e) * 100) / 100, budget: e.config.budget, at: e.requestedAt }));
      }
      return send(res, 200, v);
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
  /**
   * POST /api/budget/action {floor, action, ...}. Admins only. Actions: settings {total?, threshold?, autoPause?};
   * plan {lines: [{id, usd?, days?}]}; regenerate; firm (apply the latest audit's re-forecast); resume;
   * level {choice: {level, total, threshold, autoPause, settings}}; officeThreshold {threshold}.
   */
  action: {
    method: 'POST',
    path: '/api/budget/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only admins can change the budget' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const b = budgetOf(ctx);
      const who = whoOf(session.account?.name, body.by);
      const deps = controlOf(ctx);
      if (body.action === 'officeThreshold') {
        const t = Number(body.threshold);
        if (!(t >= 1 && t <= 99)) return send(res, 400, { error: 'The alert threshold is a percentage between 1 and 99' });
        const o = b.store.office();
        const before = o.threshold;
        o.threshold = Math.round(t);
        b.store.changed('office');
        audit.record({ actor: human(who, session.account?.id), action: 'settings.change', target: { kind: 'setting', id: 'budget.threshold', label: 'Budget alert threshold' }, summary: `Set the office's default budget alert to ${o.threshold} %`, details: { before, after: o.threshold }, severity: 'notice' });
        return send(res, 200, { ok: true });
      }
      const fl = ctx.floors.get(typeof body.floor === 'string' ? body.floor : '');
      if (!fl) return send(res, 404, { error: 'No such floor' });
      const floor = { id: fl.id, name: fl.def.name, dir: fl.dir };
      let err: string | undefined;
      let note: string | undefined;
      switch (body.action) {
        case 'settings':
          err = setSettings(b, floor, body, who, deps);
          break;
        case 'plan':
          err = editPlan(b, floor, body, who, deps);
          break;
        case 'regenerate':
          regeneratePlan(b, floor, who, deps);
          break;
        case 'firm': {
          const f = firmFor(ctx, fl.id);
          err = f ? applyFirm(b, floor, f, who, deps) : 'No Firm audit of this project with a re-forecast';
          break;
        }
        case 'resume':
          err = resume(b, floor, who, deps);
          break;
        case 'level': {
          const c = cleanChoice(body.choice);
          if (!c) {
            err = 'Pick a level and a budget';
            break;
          }
          const problems = applyChoice(ctx, fl.id, c, who);
          note = problems.length ? `Applied, with problems: ${problems.join('; ')}` : 'Applied: the team picks it up from its next hire or Playbook rewrite';
          break;
        }
        default:
          err = 'Unknown action';
      }
      if (err) return send(res, 400, { error: err });
      b.onSpend?.(floor);
      return send(res, 200, { ok: true, ...(note ? { note } : {}), view: floorView(b, floor, true, firmFor(ctx, fl.id)) });
    },
  },
  /**
   * GET /api/budget/estimate?tier=small|standard&entry=<mode>, or ?floor=<id> for a project's own: the plan's
   * estimate at Balanced and the three level cards (preset budget, duration, what each changes).
   */
  estimate: {
    method: 'GET',
    path: '/api/budget/estimate',
    auth: 'session',
    handle(ctx, { res, url }) {
      const b = budgetOf(ctx);
      const fl = ctx.floors.get(url.searchParams.get('floor') ?? '');
      const shape = fl ? projectShape(fl.dir) : undefined;
      const entryRaw = url.searchParams.get('entry');
      const entry = (ENTRY_MODES as readonly string[]).includes(entryRaw ?? '') ? (entryRaw as EntryMode) : (shape?.entry ?? 'requirements-driven');
      const tier = url.searchParams.get('tier') === 'small' ? 'small' : url.searchParams.get('tier') === 'standard' ? 'standard' : (shape?.tier ?? 'standard');
      const history = b.deps.runs().map((r) => ({ types: r.types ?? [], cost: r.cost ?? 0 }));
      const plan = fl ? numbersOf(b, { id: fl.id, name: fl.def.name, dir: fl.dir }).plan : generatePlan({ tier, entry, history, start: b.today, now: Date.now() });
      const estimate = planTotal(plan);
      const days = plan.lines.reduce((n, l) => n + l.days, 0);
      return send(res, 200, { tier, entry, estimate, days, basis: plan.basis, levels: levelCards(estimate, days), threshold: b.store.office().threshold, fx: b.fx() });
    },
  },
} satisfies Record<string, Route>;

/** The latest Firm audit of the floor that gave a re-forecast. */
function firmFor(ctx: Ctx, floorId: string): FirmForecast | undefined {
  const firm = firmIfMade(ctx);
  if (!firm) return undefined;
  const done = firm.list().filter((e) => e.floor === floorId && e.reportId).sort((a, z) => (z.endedAt ?? 0) - (a.endedAt ?? 0));
  for (const e of done) {
    const r = firm.report(e.reportId!);
    const f = r && !r.sample ? firmForecastOf(r) : undefined;
    if (f) return f;
  }
  return undefined;
}
