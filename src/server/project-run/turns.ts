// Every turn each worker starts, counted as its status changes (office/floors.ts hears every change).
// ⏸ Pause project asks each agent for a handoff note and then looks at it every couple of seconds:
// a handoff turn shorter than that started and ended between two looks, so the pause never saw it
// busy, and waited out HANDOFF_START_MS (three minutes) before putting it to sleep. With the count
// noted when it asks, a turn that came and went in between still shows (flows.ts windDown).

import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';

const busy = (s: WorkerStatus | undefined) => s === 'working' || s === 'starting';
const turns = new Map<string, number>();
const last = new Map<string, WorkerStatus>();

/** A worker's status as it is now (every change). */
export function noteWorkerStatus(w: Pick<WorkerInfo, 'id' | 'status'>) {
  const before = last.get(w.id);
  last.set(w.id, w.status);
  if (busy(w.status) && !busy(before)) turns.set(w.id, (turns.get(w.id) ?? 0) + 1);
}

/** A worker gone home. */
export function forgetWorker(id: string) {
  turns.delete(id);
  last.delete(id);
}

/** How many turns `id` has started since the office did (0 when none yet). */
export function turnsStarted(id: string): number {
  return turns.get(id) ?? 0;
}
