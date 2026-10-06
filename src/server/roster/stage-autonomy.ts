// Autonomy by pipeline stage (a team setting, off by default): on a toolkit project the floor works at
// one level while the pipeline is still analysing, specifying and designing, and at another once the
// build plan's gate (Stage 4) has passed, read the way the setup panel reads it (wizard/setup.ts: the
// verdicts gate-check wrote into index.html, or a confirmed Stage 4 decision). When the stage calls for
// another level, the office changes it through the same path as a level picked by hand
// (Members.settings): every hired Lead's Playbook rewritten, the ones at work told.

import type { AutonomyLevel } from '../../shared/roster/autonomy.js';
import type { PipelineStage, RosterSettings } from '../../shared/roster/types.js';
import type { Roster } from './index.js';
import type { TeamFloor } from './types.js';

/** Who the office says changed the level, in the audit log and the activity. */
export const BY_STAGE = 'The office (autonomy by stage)';

/** The level the stage calls for, when autonomy by stage is on and the project has a pipeline. */
export function stageLevel(settings: RosterSettings, stage: PipelineStage | undefined): AutonomyLevel | undefined {
  const s = settings.autonomyByStage;
  if (!s?.enabled || !stage) return undefined;
  return stage === 'build' ? s.build : s.early;
}

/** The floor's pipeline stage, when autonomy by stage is on and it's a toolkit project. */
export function stageOf(roster: Roster, floor: TeamFloor): PipelineStage | undefined {
  return roster.data(floor.id).settings.autonomyByStage?.enabled ? roster.deps.pipelineStage?.(floor.dir) : undefined;
}

/** Moves the floor to the level its stage calls for, if it isn't there. True when it changed. */
export function applyStageAutonomy(roster: Roster, floor: TeamFloor): boolean {
  const d = roster.data(floor.id);
  const stage = stageOf(roster, floor);
  const level = stageLevel(d.settings, stage);
  if (level === undefined || level === d.settings.autonomy) return false;
  const from = d.settings.autonomy;
  roster.members.settings(floor, { autonomy: level }, BY_STAGE);
  floor.activity?.(`🎚️ Autonomy ${from} → ${level}: ${stage === 'build' ? 'the build plan (Stage 4) has passed' : 'the build plan (Stage 4) hasn’t passed yet'} (autonomy by stage)`);
  return true;
}
