// ⚙️ Settings → Workers → Keep awake (server/keep-awake/): GET whether the office is holding the
// computer awake and why; admins POST the setting and the idle minutes.

import { audit, human } from '../../audit/index.js';
import { keepAwakeOf } from '../../keep-awake/index.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { whoOf } from './notify-teams.js';

export const keepAwakeRoutes = {
  /** GET /api/keep-awake */
  view: {
    method: 'GET',
    path: '/api/keep-awake',
    auth: 'session',
    handle(ctx, { res, session }) {
      return send(res, 200, keepAwakeOf(ctx).view(ctx.meOf(session.account?.id).admin));
    },
  },
  /** POST /api/keep-awake {on?, idleMinutes?}. Admins only. */
  save: {
    method: 'POST',
    path: '/api/keep-awake',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const me = ctx.meOf(session.account?.id);
      if (!me.admin) return send(res, 403, { error: 'Only admins can change keep-awake' });
      let body: { on?: unknown; idleMinutes?: unknown; by?: unknown };
      try {
        body = JSON.parse((await readBody(req, 4096)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON' });
      }
      const who = whoOf(session.account?.name, body.by);
      const k = keepAwakeOf(ctx);
      const before = { ...k.settings };
      const err = k.set(body, who);
      if (err) return send(res, 400, { error: err });
      const after = k.settings;
      audit.record({ actor: human(who, session.account?.id), action: 'settings.change', target: { kind: 'setting', id: 'keepAwake', label: 'Keep awake while agents work' }, summary: after.on ? `Set keep-awake on (${after.idleMinutes} idle minutes)` : 'Turned keep-awake off', details: { before: { on: before.on, idleMinutes: before.idleMinutes }, after: { on: after.on, idleMinutes: after.idleMinutes } }, severity: 'notice' });
      return send(res, 200, k.view(true));
    },
  },
} satisfies Record<string, Route>;
