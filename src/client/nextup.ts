// The workers waiting on you on this floor, the ones that need you before the ones that are done and
// longest first: N on the 2D Office view goes to the first, and the 1D view lists and counts them.

import type { WorkerInfo } from '../shared/protocol';
import { isAsleep, isBusy } from '../shared/status';
import { needingYou, waitingInOrder, waitingOnSomeone } from '../shared/waiting';

// Who's waiting and in what order is shared with the server's Teams notifications (shared/waiting.ts).
export { needingYou, waitingInOrder };

/**
 * Every worker, as the 1D view lists them: the ones waiting on someone first (see waitingInOrder), then
 * the ones at work, then the rest (ready, or done and seen to), asleep last; hired first within each.
 */
export function byUrgency(workers: Iterable<WorkerInfo>): WorkerInfo[] {
  const all = [...workers];
  const rank = (w: WorkerInfo) => (isBusy(w.status) ? 0 : isAsleep(w.status) ? 2 : 1);
  const rest = all.filter((w) => !waitingOnSomeone(w)).sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return [...waitingInOrder(all), ...rest];
}

/** "2 need you · 1 done": the ones that need input, then the ones that finished. */
export function waitingLabel(waiting: readonly WorkerInfo[]): string {
  const needs = waiting.filter((w) => w.status === 'needs_input').length;
  const done = waiting.length - needs;
  return [needs && `🙋 ${needs} ${needs === 1 ? 'needs' : 'need'} you`, done && `✅ ${done} done`].filter(Boolean).join(' · ');
}
