// Phased delivery's routes (server/phases/): GET /api/phases?floor= is the Roadmap's view (everyone signed in
// may look; `&lite=1` answers a project without phases with just that, for the Overview's strip and the navigation: no git, except for an admin at the Build Plan gate, who is told how many phases the build plan's headings would give (`offer`)), and
// POST /api/phases {floor, action, …} is the Project Manager's: approve the proposed phases at the Build Plan
// gate (with edits), accept or decline a team proposal (accept with `ops`: Edit first), edit the phases with a
// reason, Go or Stop at a checkpoint, set the phases up from the office's first cut of the build plan, and ask
// the team for a change. Admins only, same origin, audited by the service.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { phasesOf, viewOf } from '../../phases/index.js';
import { readRepo } from '../../phases/inputs.js';
import { currentStage } from '../../budget/stage.js';
import { isPhased } from '../../../shared/phases/plan.js';
import { DEFAULT_PREFS, type Who } from '../../../shared/phases/types.js';
import { readBody, send } from '../util.js';
import { fromOffice } from '../origin.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => fromOffice(req, ctx.cfg);

export const phaseRoutes = {
  view: {
    method: 'GET',
    path: '/api/phases',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such project' });
      const plan = phasesOf(ctx).plan(floor.id);
      if (url.searchParams.get('lite') === '1' && !isPhased(plan)) {
        const admin = ctx.meOf(session.account?.id).admin;
        // At the Build Plan gate an admin is offered to set phases up from the build plan (its "Phase N" headings).
        const offer = admin && currentStage(floor.dir) === '4' ? (await readRepo(floor.dir, floor.github?.pulls.items ?? []).catch(() => undefined))?.planPhases.length ?? 0 : 0;
        return send(res, 200, { floor: floor.id, admin, now: Date.now(), plan: { state: plan.state, delivery: plan.delivery, prefs: plan.prefs ?? DEFAULT_PREFS }, phases: [], proposals: [], changes: [], lite: true, ...(offer > 1 ? { offer } : {}) });
      }
      try {
        return send(res, 200, await viewOf(ctx, floor, session.account?.id));
      } catch (err) {
        return send(res, 502, { error: (err as Error).message });
      }
    },
  },
  act: {
    method: 'POST',
    path: '/api/phases',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) changes the phases' });
      let body: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 256 * 1024)) || '{}');
        body = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      const pm: Who = { kind: 'pm', name: session.account?.name ?? 'The Project Manager' };
      const s = phasesOf(ctx);
      const id = String(body.proposal ?? body.phase ?? '');
      const r =
        body.action === 'approve'
          ? s.approve(floor.id, pm, body.ops, body.reason)
          : body.action === 'accept' || body.action === 'decline'
            ? s.decide(floor.id, pm, id, body.action, body.note, body.ops)
            : body.action === 'edit'
              ? s.edit(floor.id, pm, body.ops, body.reason)
              : body.action === 'go'
                ? s.go(floor.id, pm, id)
                : body.action === 'stop'
                  ? s.stop(floor.id, pm, id, body.reason)
                  : body.action === 'setup'
                    ? s.propose(floor.id, pm, { kind: 'plan', phases: body.phases, reason: body.reason || 'Set up by the Project Manager from the build plan', summary: 'Phases set up from the build plan' })
                    : body.action === 'ask'
                      ? await s.ask(floor.id, pm, body.text)
                      : undefined;
      if (!r) return send(res, 400, { error: 'action is approve, accept, decline, edit, go, stop, setup or ask' });
      if (!r.ok) return send(res, r.status, { error: r.error });
      return send(res, 200, { ok: true, ...(r.change ? { change: r.change.id } : {}), ...(r.proposal ? { proposal: r.proposal.id } : {}), ...(r.note ? { note: r.note } : {}) });
    },
  },
} satisfies Record<string, Route>;
