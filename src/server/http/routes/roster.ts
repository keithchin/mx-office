// The Team tab (see server/roster/): GET what a floor's team looks like and one standup's page, and
// POST what the CTO does: hire, bench, rename, change a model, run a standup, decide on a proposal,
// change the team settings. Deciding and the settings are the CTO's, so they need an admin (anyone
// with the shared office password is one); hiring and benching are open to everyone signed in, like
// hiring any worker.

import { isRoleId } from '../../../shared/roster/roles.js';
import { rosterOf, teamFloor } from '../../roster/adapter.js';
import type { Decision } from '../../roster/standup-run.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

const ADMIN_ONLY = new Set(['settings', 'decide', 'rename', 'model', 'hire', 'bench']);
const DECISIONS = new Set<Decision>(['approve', 'reject', 'change']);

export const rosterRoutes = {
  /** GET /api/roster?floor=<id>: the floor's team, its standups, proposals and approvals queue. */
  view: {
    method: 'GET',
    path: '/api/roster',
    auth: 'session',
    handle(ctx, { res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      return send(res, 200, rosterOf(ctx).view(teamFloor(ctx, floor), ctx.meOf(session.account?.id).admin));
    },
  },
  /** GET /api/roster/standup?floor=<id>&id=<standup>: one standup in full, its page included. */
  standup: {
    method: 'GET',
    path: '/api/roster/standup',
    auth: 'session',
    handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const all = rosterOf(ctx).data(floor.id).standups;
      const id = url.searchParams.get('id');
      const s = id ? all.find((x) => x.id === id) : all[all.length - 1];
      return s ? send(res, 200, s) : send(res, 404, { error: 'No standup yet' });
    },
  },
  /** POST /api/roster/action {floor, action, …}: what the CTO did on the Team tab. */
  action: {
    method: 'POST',
    path: '/api/roster/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const floor = typeof body.floor === 'string' ? ctx.floors.get(body.floor) : undefined;
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const action = String(body.action ?? '');
      const me = ctx.meOf(session.account?.id);
      if (ADMIN_ONLY.has(action) && !me.admin) return send(res, 403, { error: 'Only the CTO (an admin) can do that' });
      const roster = rosterOf(ctx);
      const team = teamFloor(ctx, floor);
      // A person's name for toasts and the record: their account's, else what their browser calls them.
      const by = session.account?.name ?? (typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 32) : 'The CTO');
      const owner = session.account?.id;
      const role = isRoleId(body.role) ? body.role : undefined;
      const needRole = ['hire', 'bench', 'rename', 'model'].includes(action);
      if (needRole && !role) return send(res, 400, { error: 'Which role?' });
      let error: string | undefined;
      switch (action) {
        case 'hire':
          error = await roster.members.hire(team, role!, by, owner, typeof body.task === 'string' ? body.task.slice(0, 4000) : undefined);
          break;
        case 'bench':
          error = roster.members.bench(team, role!, by);
          break;
        case 'rename':
          error = roster.members.rename(team, role!, body.name);
          break;
        case 'model':
          error = roster.members.setModel(team, role!, body.model);
          break;
        case 'settings':
          error = roster.members.settings(team, body.settings);
          break;
        case 'standup': {
          const s = roster.standups.run(team, by);
          error = typeof s === 'string' ? s : undefined;
          break;
        }
        case 'decide': {
          const decision = String(body.decision) as Decision;
          if (!DECISIONS.has(decision)) return send(res, 400, { error: 'approve, reject or change' });
          const as = owner ? ctx.signins.ghAs(owner) : undefined;
          if (typeof as === 'string') return send(res, 400, { error: as });
          error = await roster.standups.decide(team, String(body.proposal ?? ''), decision, by, typeof body.reason === 'string' ? body.reason : undefined, as?.env);
          break;
        }
        default:
          return send(res, 400, { error: 'Unknown action' });
      }
      if (error) return send(res, 400, { error });
      return send(res, 200, roster.view(team, me.admin));
    },
  },
} satisfies Record<string, Route>;
