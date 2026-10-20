// The setup's side of the autonomy step (shared/roster/autonomy-step.ts): the team step applies the plan's
// autonomy record to the project first, before the budget level and the hires, so the Playbooks are written
// at the chosen level and a budget level can tell that this project's autonomy is its own (budget/index.ts).
// A plan from before the step (no record) and an edit's team step (only roles added) leave it alone.

import type { AutonomyChoice } from '../../shared/roster/autonomy-step.js';
import type { StepId } from '../../shared/wizard.js';
import type { Ctx } from '../office/context.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { applyAutonomyChoice } from '../roster/autonomy-choice.js';
import type { StepImpl } from './job.js';

export interface AutonomyDeps {
  /** Applies the plan's autonomy record to the floor (once); what happened, for the log. `since`: when the setup started. */
  applyAutonomy?(floor: string, choice: AutonomyChoice, since: number): string;
}

export function withAutonomy(deps: AutonomyDeps, steps: Record<StepId, StepImpl>): Record<StepId, StepImpl> {
  const { team } = steps;
  return {
    ...steps,
    async team(job, io) {
      const a = job.plan.autonomy;
      if (!job.addRoles && job.floor && a?.source && a.at && a.by && deps.applyAutonomy) io.log(`  ${deps.applyAutonomy(job.floor, a as AutonomyChoice, job.startedAt)}`);
      return team(job, io);
    },
  };
}

/** The office's applyAutonomy: through the Team settings' own change (audited, Playbooks rewritten). */
export function applyAutonomyAt(ctx: Ctx, floorId: string, choice: AutonomyChoice, since: number): string {
  const floor = ctx.floors.get(floorId);
  if (!floor) return 'autonomy: the project is gone';
  const roster = rosterOf(ctx);
  const tf = teamFloor(ctx, floor);
  return applyAutonomyChoice(floorId, choice, floor.def.addedAt < since, {
    dataDir: ctx.cfg.dataDir,
    level: () => roster.data(floorId).settings.autonomy,
    settings: (patch, by, byId) => roster.members.settings(tf, patch, by, byId),
  });
}
