// The queue's side of task identity (Slice 1B-4): a queued task is a durable task from when it's added
// (its hex queue id kept as legacyId), and each seating of a worker for it is an attempt with its own
// execution id. A retry is the same task again, so it keeps the task id; a queue task from before task ids
// has none and gets none.

import type { QueueTask, WorkerInfo } from '../../shared/protocol.js';
import type { TaskStore } from './store.js';

export interface QueueTaskIds {
  /** The task id for a task just added. */
  create(t: Pick<QueueTask, 'id' | 'title' | 'issue'>): string;
  /** The execution id of a seating, on the task's record (`assigned` the first time, `reassigned` after). */
  attempt(t: Pick<QueueTask, 'taskId' | 'workerId'>, w: Pick<WorkerInfo, 'id'>): string | undefined;
}

export function queueTaskIds(store: TaskStore, floorId: string): QueueTaskIds {
  return {
    create: (t) => {
      void store.load(floorId);
      // A queue task for an issue that already has a task (a proposal's) is that task.
      const had = t.issue !== undefined ? store.byIssue(floorId, t.issue) : undefined;
      return had?.id ?? store.create(floorId, { source: 'queue', text: t.title, ...(t.issue !== undefined ? { issue: t.issue } : {}), legacyId: t.id }).id;
    },
    attempt: (t, w) => (t.taskId ? store.attempt(floorId, t.taskId, { worker: w.id, ...(t.workerId && t.workerId !== w.id ? { from: t.workerId } : {}) }) : undefined),
  };
}
