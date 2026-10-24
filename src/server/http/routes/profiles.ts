// Agent profiles' routes (server/profiles/). Reading is for anyone signed in (the owner's notes for admins
// only); every change is an admin's, checked here, from the office's own page, and audited:
//   GET  /api/profiles          every profile: name, roles, projects with dates, where it is now, an open move
//   POST /api/profiles/action   {action: hire|rename|notes|retry|cancel, profile?, floor?, role?, task?, move?, name?, text?, move_id?}
// A hire of a profile linked to a seat elsewhere answers 409 with `needsMove` until the person confirms the
// Move (`move: true`); there is no concurrent ("on loan") hire.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { profilesOf } from '../../profiles/index.js';
import { isMoveId, isProfileId } from '../../../shared/profiles.js';
import { isRoleId } from '../../../shared/roster/roles.js';
import { readBody, send } from '../util.js';
import { fromOffice } from '../origin.js';
import type { Route } from '../router.js';
import { refuseStale } from '../../phone-access/reauth.js';

const fromUs = (req: http.IncomingMessage, ctx: Ctx) => fromOffice(req, ctx.cfg);

async function jsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return undefined;
  }
}

export const profileRoutes = {
  view: {
    method: 'GET',
    path: '/api/profiles',
    auth: 'session',
    async handle(ctx, { res, session }) {
      return send(res, 200, await profilesOf(ctx).view(ctx.meOf(session.account?.id).admin));
    },
  },
  act: {
    method: 'POST',
    path: '/api/profiles/action',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!fromUs(req, ctx)) return send(res, 403, { error: 'Forbidden' });
      if (!ctx.meOf(session.account?.id).admin) return send(res, 403, { error: 'Only the Project Manager (an admin) can change agents' });
      const body = await jsonBody(req);
      if (!body) return send(res, 400, { error: 'Send JSON' });
      // Through Phone access, a hire needs the password again, as on the Team tab.
      if (refuseStale(ctx, req, res, () => body.action === 'hire' || body.action === 'retry')) return;
      const by = session.account?.name ?? 'The Project Manager';
      const owner = session.account?.id;
      const s = profilesOf(ctx);
      const done = async (r: { error?: string; status?: number; needsMove?: unknown }) => (r.error ? send(res, r.status ?? 400, { error: r.error, ...(r.needsMove ? { needsMove: r.needsMove } : {}) }) : send(res, 200, { ...r, view: await s.view(true) }));
      switch (body.action) {
        case 'hire': {
          if (!isProfileId(body.profile) || typeof body.floor !== 'string' || !isRoleId(body.role)) return send(res, 400, { error: 'Say which agent, project and role' });
          const task = typeof body.task === 'string' && body.task.trim() ? body.task.slice(0, 4000) : undefined;
          return done(await s.moves.hire({ profileId: body.profile, floor: body.floor, role: body.role, by, ...(owner ? { owner } : {}), ...(task ? { task } : {}), move: body.move === true }));
        }
        case 'rename': {
          if (!isProfileId(body.profile)) return send(res, 400, { error: 'Which agent?' });
          const err = await s.rename(body.profile, body.name, by);
          return done(err ? { error: err } : {});
        }
        case 'notes': {
          if (!isProfileId(body.profile) || typeof body.text !== 'string') return send(res, 400, { error: 'Which agent, and what notes?' });
          const err = await s.setNotes(body.profile, body.text, by);
          return done(err ? { error: err } : {});
        }
        case 'retry':
        case 'cancel': {
          if (!isMoveId(body.move_id)) return send(res, 400, { error: 'Which move?' });
          return done(body.action === 'retry' ? await s.moves.retry(body.move_id, by) : await s.moves.cancel(body.move_id, by));
        }
        default:
          return send(res, 400, { error: 'action is one of hire, rename, notes, retry, cancel' });
      }
    },
  },
} satisfies Record<string, Route>;
