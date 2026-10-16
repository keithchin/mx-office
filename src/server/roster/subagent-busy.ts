// The workers at work through their subagents, for the floor's "working" count (Floor.info's `busy`, which
// the home page's project cards and the overview banner show): a Lead whose turn is over while a subagent
// it sent off is still going is working, not idle. From the roster's live runs (subagent-live.ts); the
// floors list goes out again only when that set changes (a run began or ended), never per run event.

import { busyWorkers } from '../../shared/roster/member-subagents.js';
import type { RosterData } from './store.js';

const last = new Map<string, string>();

/** The floor's workers whose subagents are at work now. */
export const subagentBusy = (d: RosterData): Set<string> => busyWorkers(d.subagentRuns);

/** Whether that set changed since this was last asked for the floor. */
export function subagentBusyMoved(floorId: string, d: RosterData): boolean {
  const key = [...subagentBusy(d)].sort().join(',');
  if ((last.get(floorId) ?? '') === key) return false;
  last.set(floorId, key);
  return true;
}
