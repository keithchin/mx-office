// What the budget does at 100 %: pause the project. `pauseFloorForBudget(floor, why)` is the one seam,
// and the pause is the office's real ⏸ Pause project (server/project-run/), which registers itself here
// (project-run/adapter.ts): agents finish their turn, hand off and sleep; the office's own prompts are
// held (roster/deliver.ts) and nobody new is hired (roster/pause.ts, Members.hire); a person's messages
// still go through. So there is one source of truth for "this floor is paused", recorded with the reason
// 'budget' so its line reads "⏸ Paused: budget reached".

/** The office's Pause project, as the budget uses it. */
export interface ProjectPauser {
  /** Pauses the floor for its budget. */
  pause(floorId: string, by: string): void;
  /** Resumes it the default way (those with work waiting). */
  resume(floorId: string, by: string): void;
  /** Whether the floor is paused because of its budget now (a person may have resumed it from ▶ Resume project). */
  pausedForBudget(floorId: string): boolean;
}

let pauser: ProjectPauser | undefined;

/** Registers the office's Pause project; undefined takes it out (tests). */
export function registerProjectPause(p: ProjectPauser | undefined) {
  pauser = p;
}

/** Who the pause is recorded as. */
export const BUDGET_BY = 'Budget';

/** Pauses the floor because its budget is spent; false when there's no Pause project to do it with. */
export function pauseFloorForBudget(floorId: string): boolean {
  if (!pauser) {
    console.error(`agent-office: the budget of ${floorId} is reached, but there's no Pause project to pause it with`);
    return false;
  }
  pauser.pause(floorId, BUDGET_BY);
  return true;
}

/** Resumes the floor the default way (Resume, or a raised budget). */
export function resumeFloorFromBudget(floorId: string, by: string) {
  pauser?.resume(floorId, by);
}

/** Whether the floor is still paused for its budget; undefined with no Pause project to ask. */
export const pausedForBudget = (floorId: string): boolean | undefined => pauser?.pausedForBudget(floorId);
