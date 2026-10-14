// Which build the office runs (server/restart/build.ts): GET /api/office/version for the pages' version
// banner (ui/version/): the build running and since when, a newer one built since, whether a restart
// is under way and on whom it waits, and whether you're an admin who can act on it. /api/health says
// the build too, without a sign-in, for scripts checking that a restart really went through.

import type { OfficeVersionView } from '../../../shared/build-info.js';
import { buildOf } from '../../restart/build.js';
import { safeRestartOf } from '../../restart/office.js';
import type { Ctx } from '../../office/context.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

/** What a page (or anyone signed in) is told about the office's version. */
export function versionView(ctx: Ctx, admin: boolean): OfficeVersionView {
  const b = buildOf(ctx);
  const r = safeRestartOf(ctx);
  const v = r.view(admin);
  const ready = b.ready();
  return {
    running: b.running,
    ...(ready ? { ready } : {}),
    admin,
    loop: v.loop,
    ...(r.active ? { restart: { phase: v.phase, waitingOn: v.waitingOn, ...(v.deadline ? { deadline: v.deadline } : {}) } } : {}),
    now: Date.now(),
  };
}

export const versionRoutes = {
  /** GET /api/office/version: the build running, a newer one ready, a restart under way. */
  version: {
    method: 'GET',
    path: '/api/office/version',
    auth: 'session',
    handle(ctx, { res, session }) {
      return send(res, 200, versionView(ctx, ctx.meOf(session.account?.id).admin));
    },
  },
} satisfies Record<string, Route>;

/** /api/health's body: up, and which build, since when (and a newer one built since). No sign-in. */
export function healthBody(ctx: Ctx) {
  const b = buildOf(ctx);
  const ready = b.ready();
  const { sha, release, ahead, builtAt, startedAt } = b.running;
  return { ok: true, sha, ...(release ? { release } : {}), ...(ahead ? { ahead } : {}), ...(builtAt ? { builtAt } : {}), startedAt, ...(ready ? { newerBuild: ready } : {}) };
}
