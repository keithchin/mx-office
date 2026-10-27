// The default of Local only (ProjectPlan.localOnly, server/wizard/local-only.ts) for a new project: off, a private GitHub
// repository being the usual home even for a migration with a source folder (sources/legacy/ is git-ignored, so the code
// itself is never pushed), until repo-home-field.ts's Where the code lives picks otherwise (Team Server, when the office
// has a Mendix token). A choice made by hand there is kept: byHand is shared with that field.
import type { DraftView } from '../../../../shared/brief';
import type { ProjectPlan } from '../../../../shared/wizard';

const byHand = new WeakSet<ProjectPlan>();

/** The person picked where the code lives: defaults leave it alone from now on. */
export const markByHand = (plan: ProjectPlan) => void byHand.add(plan);
export const chosenByHand = (plan: ProjectPlan) => byHand.has(plan);

/** The default: off (a private GitHub repository), unless the person chose. A source folder makes the repository private. */
export function defaultLocalOnly(plan: ProjectPlan, draft: DraftView | null | undefined) {
  if (draft?.source) plan.private = true;
  if (byHand.has(plan)) return;
  plan.localOnly = false;
}
