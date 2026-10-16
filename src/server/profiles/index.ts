// Agent profiles' composition (./service.ts, ./moves.ts): one service per office (profilesOf) over the real
// roster and floors (roster-deps.ts), the roster's hooks (profileHooksOf, given to the roster in
// roster/adapter.ts), a removed project let go of (office/forget.ts), and the start's migration and
// reconcile, a few seconds after the office starts (startProfiles, from office/timers.ts).

import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { forgetWith } from '../office/forget.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import type { ProfileHooks } from '../roster/types.js';
import { profileHooks, rosterProfileDeps } from './roster-deps.js';
import { ProfileService } from './service.js';

const services = new WeakMap<object, ProfileService>();

export function profilesOf(ctx: Ctx): ProfileService {
  let s = services.get(ctx.cfg);
  if (!s) {
    s = new ProfileService(
      rosterProfileDeps({
        dataDir: ctx.cfg.dataDir,
        roster: () => rosterOf(ctx),
        floors: () => [...ctx.floors.values()].map((f) => teamFloor(ctx, f)),
        audit: (e) => void audit.record(e),
        now: () => Date.now(),
      }),
    );
    forgetWith(s, (svc, f) => void svc.forgetFloor(f.id));
    services.set(ctx.cfg, s);
  }
  return s;
}

/** The roster's hooks, reaching the service only when called (the roster and the service each make the other lazily). */
export const profileHooksOf = (ctx: Ctx): ProfileHooks => profileHooks(() => profilesOf(ctx));

export function startProfiles(ctx: Ctx): () => void {
  // After the projects have opened and the roster's own reconcile (3 s): the migration, then any move a restart left.
  const first = setTimeout(() => void profilesOf(ctx).start().catch((err: unknown) => console.error(`agent-office: agent profiles: ${(err as Error)?.message ?? err}`)), 5_000);
  first.unref?.();
  return () => clearTimeout(first);
}
