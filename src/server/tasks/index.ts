// Task identity wired to the office (Slice 1B-4): one task record per data folder (store.ts), shared by
// the roster's task book (roster/resume.ts Tasks), the queue (floor.ts), proposals' issues, model change
// requests and stuck items. What a task id and an execution id are is shared/tasks.ts; the links from a
// decision's revision to the work, and their evidence, are links.ts and evaluate.ts.

import path from 'node:path';
import type { TaskRef } from '../../shared/tasks.js';
import { TaskStore } from './store.js';

const stores = new Map<string, TaskStore>();

/** The task record under `dataDir` (one instance per folder, so every caller sees the same memory). */
export function taskStoreAt(dataDir: string): TaskStore {
  const dir = path.join(dataDir, 'tasks');
  let s = stores.get(dir);
  if (!s) stores.set(dir, (s = new TaskStore(dir)));
  return s;
}

/** What a member is on now, by its ids: what a context manifest or a trace names as its task and attempt. */
export interface MemberTaskLike {
  task?: TaskRef & { doneAt?: number };
}

/**
 * The task and execution ids of a member's open task, for anything that records what an agent is doing
 * (a context manifest, a trace): undefined when it has none, or a legacy task without ids.
 */
export function currentTaskIds(m: MemberTaskLike | undefined): TaskRef | undefined {
  const t = m?.task;
  if (!t || t.doneAt !== undefined || !t.taskId) return undefined;
  return { taskId: t.taskId, ...(t.executionId ? { executionId: t.executionId } : {}) };
}
