// What would stop a setup's Retry right now, said before it runs (shared/setup-cancel.ts SetupBlocker):
// a Retry on a paused project used to fail at "Hire the project team" with "Project paused: no new
// agents until it's resumed", every time, without saying what to do (equipment-rental, 2026-10-09..11).
// Pure: the facts come from the office (unfinished.ts), so the tests give their own.

import type { PauseWhy } from '../../shared/project-run.js';
import type { SetupBlocker } from '../../shared/setup-cancel.js';
import type { StepId, StepStatus } from '../../shared/wizard.js';

export interface BlockerFacts {
  /** A safe restart is under way. */
  restart: boolean;
  /** The floor's pause, when it's paused. */
  pause?: { why: PauseWhy; by: string };
  /** A pause or resume of the floor that's going now. */
  run?: 'pause' | 'resume';
  /** Studio Pro has the floor's project open. */
  studioOpen: boolean;
}

/** Steps that hire or queue for the team: a paused project takes no new agents and no office prompts. */
const NEEDS_RUNNING: readonly StepId[] = ['team', 'queue'];
/** Steps that write in the floor's own folder: never under an open Studio Pro. */
const WRITES_FOLDER: readonly StepId[] = ['app', 'init', 'hooks', 'intake', 'decisions', 'settings', 'gates', 'commit'];

const finished = (s: StepStatus | undefined) => s === 'done' || s === 'skipped';

/** Why Retry would fail now (undefined: it can go). `steps` is the setup's, `floor` the floor it made. */
export function setupBlocker(job: { steps: Partial<Record<StepId, { status: StepStatus }>>; floor?: string }, f: BlockerFacts): SetupBlocker | undefined {
  if (f.restart) return { kind: 'restart', text: 'A safe restart is under way: Retry once the office is back.' };
  if (!job.floor) return undefined;
  const left = (ids: readonly StepId[]) => ids.some((id) => !finished(job.steps[id]?.status));
  if (left(NEEDS_RUNNING)) {
    if (f.run === 'pause') return { kind: 'pause-run', text: 'This project is being paused: let the pause finish, resume the project, then Retry.' };
    if (f.run === 'resume') return { kind: 'resume-run', text: 'This project is being resumed: Retry once the resume has finished.' };
    if (f.pause?.why === 'budget') return { kind: 'budget', text: 'This project is paused because its budget is reached: raise the budget or resume it, then Retry.', resume: job.floor };
    if (f.pause) return { kind: 'paused', text: `This project is paused${f.pause.why === 'restart' ? ' (for a safe restart)' : f.pause.by ? ` (by ${f.pause.by})` : ''}: resume it, then Retry. A paused project takes no new agents, so the team can't be hired.`, resume: job.floor };
  }
  if (f.studioOpen && left(WRITES_FOLDER)) return { kind: 'studio', text: 'Studio Pro has this project open: close it, then Retry (the office never changes files under an open Studio Pro).' };
  return undefined;
}
