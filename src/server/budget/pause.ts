// What the budget does at 100 %: pause the project. `pauseFloorForBudget(floor, why)` is the one seam.
// When the office has a Pause project (Resume/Pause project, registered with registerProjectPause), it's
// used; until then the floor's existing pause (roster/pause.ts) holds it, which stops new hires and the
// office's own prompts (nudges, standups, relays, wakes) the way the daily spend cap does. Either way a
// person's own messages still go through and no running turn is stopped.

import { setFloorHold } from '../roster/pause.js';

/** A Pause project the office can call: the budget's way in. */
export interface ProjectPauser {
  pause(floorId: string, why: string, by: string): void;
  resume(floorId: string, by: string): void;
}

let pauser: ProjectPauser | undefined;

/** Registers the office's Pause project (the Resume/Pause project feature); undefined takes it out. */
export function registerProjectPause(p: ProjectPauser | undefined) {
  pauser = p;
}

export const BUDGET_BY = 'The office (budget)';
const HOLD = 'budget';

/** Pauses the floor because its budget is spent. Says which pause it used. */
export function pauseFloorForBudget(floorId: string, why: string): 'project' | 'floor' {
  if (pauser) {
    pauser.pause(floorId, why, BUDGET_BY);
    return 'project';
  }
  setFloorHold(floorId, HOLD, why);
  return 'floor';
}

/** Takes the budget's pause off the floor (Resume, or a raised budget). */
export function resumeFloorFromBudget(floorId: string, by: string) {
  pauser?.resume(floorId, by);
  setFloorHold(floorId, HOLD, undefined);
}
