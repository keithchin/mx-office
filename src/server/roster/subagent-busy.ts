// The workers at work through their subagents, for the floor's "working" count (Floor.info's `busy`, which
// the home page's project cards and the overview banner show): a Lead whose turn is over while a subagent
// it sent off is still going is working, not idle. From the roster's live runs (subagent-live.ts); the
// floors list goes out again only when that set changes (a run began or ended), never per run event.
// A member waiting on its own background work (a Monitor, a background command: workers/background-work.ts)
// counts the same way: busy, not idle, and never "waiting on you". So does one whose terminal, hooks or commits
// show it at work in the last minute or two while its status says idle (workers/pulse.ts: the real build's
// "nobody working" while commits kept landing).

import { busyWorkers } from '../../shared/roster/member-subagents.js';
import { backgroundOpen } from '../workers/background-work.js';
import { isActive } from '../workers/pulse.js';
import type { RosterData } from './store.js';

const last = new Map<string, string>();

/** The floor's workers whose subagents, or whose background work, are at work now. */
export function subagentBusy(d: RosterData, now = Date.now()): Set<string> {
  const out = busyWorkers(d.subagentRuns);
  for (const m of Object.values(d.members)) if (m.workerId && (backgroundOpen(m.workerId, now) || isActive(m.workerId))) out.add(m.workerId);
  return out;
}

/** Whether that set changed since this was last asked for the floor. */
export function subagentBusyMoved(floorId: string, d: RosterData, now = Date.now()): boolean {
  const key = [...subagentBusy(d, now)].sort().join(',');
  if ((last.get(floorId) ?? '') === key) return false;
  last.set(floorId, key);
  return true;
}
