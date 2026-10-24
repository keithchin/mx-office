// POST /api/signoff {floor, stage, escalations?}: the Project Manager signs off a ✋ MANUAL toolkit stage in
// play (server/signoff/): the lead is told "Signed off: Stage N" with the toolkit's CONFIRMED Decisions row
// to add, after their turn. Admins only, same origin, the password again through Phone access, audited.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { refuseStale } from '../../phone-access/reauth.js';
import { decisionsOf } from '../../decisions/index.js';
import { signOff, signoffDeps } from '../../signoff/index.js';
import { wizardOf } from '../../wizard/index.js';
import { readBody, send } from '../util.js';
import { fromOffice } from '../origin.js';
import type { Route } from '../router.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => fromOffice(req, ctx.cfg);
const str = (v: unknown, max = 40) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

export const signoffRoutes = {
  act: {
    method: 'POST',
    path: '/api/signoff',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can sign off a stage' });
      let body: Record<string, unknown>;
      try {
        const v = JSON.parse((await readBody(req, 8 * 1024)) || '{}');
        body = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      // A sign-off is an approval: through Phone access it needs the password again.
      if (refuseStale(ctx, req, res, () => true)) return;
      const floor = ctx.floors.get(String(body.floor ?? ''));
      if (!floor) return send(res, 404, { error: 'No such project' });
      const stage = str(body.stage, 4);
      if (!stage || !/^(P|[0-7])$/i.test(stage)) return send(res, 400, { error: 'Say which stage (P or 0 to 7)' });
      const folded = Array.isArray(body.escalations) ? body.escalations.map((x) => str(x)).filter((x): x is string => !!x).slice(0, 20) : [];
      const by = session.account?.name ?? 'The Project Manager';
      const owner = session.account?.id;
      const deps = signoffDeps(
        ctx,
        (f) => wizardOf(ctx).setup(f).catch(() => undefined),
        async (f, ids, text, who, acct) => (await decisionsOf(ctx).actResult(f, { action: 'answer', escalation: ids[0], others: ids.slice(1), verdict: 'approve', text }, who, acct))?.error,
      );
      const r = await signOff(deps, floor, stage, by, owner, folded);
      if (!r.ok) return send(res, r.status, { error: r.error });
      return send(res, 200, { ok: true, request: r.request });
    },
  },
} satisfies Record<string, Route>;
