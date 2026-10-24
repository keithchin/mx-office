// Seams for the two other places the guard applies, wired in Increment B (dev-changes/wire.ts, external.ts):
//
// - A Developer change's candidate (server/dev-changes/, Increment B): before a DC may settle as
//   implemented, `checkCandidate` with the DC's base and candidate commits; a hold means the DC shows
//   "merged/candidate at <sha>; held: possible data impact" and can't settle until approved. Its approval
//   binds env `candidate:<DC id>`, so a live-preview approval never covers it and vice versa.
// - An external commit on main (server/review-gate/pushes.ts, with T3's persisted baseline): for a push
//   detected from `before` to `after`, `checkExternal` records the hold under env `external:<branch>`, so the
//   commit is flagged with its findings even before the live app follows main. The live app's own guard
//   still holds its update independently (env live-preview).
//
// Both return the same Verdict the live app gets, and neither changes any execution or verification state:
// the hold is its own fact (shared/data-impact.ts HeldFact).

import type { ModelUnits } from '../model/units.js';
import type { Ctx } from '../office/context.js';
import { dataImpactOf } from './index.js';
import type { Verdict } from './guard.js';

type Deps = Parameters<typeof dataImpactOf>[0];

export interface SeamInput {
  floorId: string;
  /** A repository holding both commits. */
  dir: string;
  base: string;
  target: string;
  units: ModelUnits;
}

/** A Developer change's candidate (dev-changes follow-up): may it settle as implemented? */
export function checkCandidate(ctx: Deps, change: string, i: SeamInput): Promise<Verdict> {
  return dataImpactOf(ctx).guard.check({ ...i, env: `candidate:${change}` });
}

/** An external push on `branch` (review-gate pushes follow-up): flags data impact of the commit range. */
export function checkExternal(ctx: Deps, branch: string, i: SeamInput): Promise<Verdict> {
  return dataImpactOf(ctx).guard.check({ ...i, env: `external:${branch}` });
}

/** Whether something is held in `env` on a project now, without assessing anything (for state lines). */
export function heldIn(ctx: Pick<Ctx, 'cfg' | 'accounts' | 'meOf'>, floorId: string, env: string) {
  return dataImpactOf(ctx).guard.store.get(floorId).holds[env];
}
