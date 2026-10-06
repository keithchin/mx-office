// ⚙️ Settings → Notifications → Microsoft Teams (server/notify-teams/): GET what's set (never the
// webhook URL, only a hint); admins POST changes and press Test.

import type { TeamsSettingsPatch } from '../../../shared/notify-teams.js';
import { audit, human } from '../../audit/index.js';
import { teamsNotifyOf } from '../../notify-teams/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { refuseStale } from '../../phone-access/reauth.js';

/** An account's name, else what the browser calls its person (the shared password has no name of its own). */
export const whoOf = (account: string | undefined, by: unknown) => account ?? (typeof by === 'string' && by.trim() ? by.trim().slice(0, 32) : 'An admin');

export const notifyTeamsRoutes = {
  /** GET /api/notify/teams: the settings, the last error and what's waiting. */
  view: {
    method: 'GET',
    path: '/api/notify/teams',
    auth: 'session',
    handle(ctx, { res, session }) {
      return send(res, 200, teamsNotifyOf(ctx).view(ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/notify/teams {url?, floors?, level?, quiet?, pauseMinutes?, publicUrl?}. Admins only. */
  save: {
    method: 'POST',
    path: '/api/notify/teams',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const me = ctx.meOf(session.account?.id);
      if (!me.admin) return send(res, 403, { error: 'Only admins can change Teams notifications' });
      // A change in Connections: through Phone access it needs the password again.
      if (refuseStale(ctx, req, res)) return;
      let body: TeamsSettingsPatch;
      try {
        body = JSON.parse((await readBody(req, 16 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const who = whoOf(session.account?.name, (body as { by?: unknown }).by);
      const t = teamsNotifyOf(ctx);
      const before = t.view(true);
      const err = t.settings.patch(body, who);
      if (err) return send(res, 400, { error: err });
      const after = t.view(true);
      // The URL is a secret of its own: only whether there is one, and its hint.
      const pick = (v: typeof before) => ({ on: v.on, floors: v.floors, level: v.level, quiet: v.quiet ?? null, pausedUntil: v.pausedUntil ?? null, publicUrl: v.publicUrl ?? null });
      const what = body.url !== undefined ? (body.url ? 'Set the Teams webhook' : 'Removed the Teams webhook') : 'Changed Teams notifications';
      audit.record({ actor: human(who, session.account?.id), action: 'settings.change', target: { kind: 'setting', id: 'notify.teams', label: 'Teams notifications' }, summary: what, details: { before: pick(before), after: pick(after) }, severity: 'notice' });
      if (body.url !== undefined) void t.poll();
      return send(res, 200, after);
    },
  },
  /** POST /api/notify/teams/test: posts a test card now. Admins only. */
  test: {
    method: 'POST',
    path: '/api/notify/teams/test',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const me = ctx.meOf(session.account?.id);
      if (!me.admin) return send(res, 403, { error: 'Only admins can test Teams notifications' });
      let by: unknown;
      try {
        by = JSON.parse((await readBody(req, 1024)) || '{}').by;
      } catch {
        // no name, then
      }
      const who = whoOf(session.account?.name, by);
      const err = await teamsNotifyOf(ctx).test(who);
      return err ? send(res, 502, { error: err }) : send(res, 200, { ok: true });
    },
  },
} satisfies Record<string, Route>;
