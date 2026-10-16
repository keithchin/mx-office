// Which task a new assignment is (Slice 1B-4): a task id already in the text (one the office minted before
// typing it, or a task handed on: "Task: tsk_…"), the open task made for the issue it names (a proposal's
// issue, a queue task), or a new one. Whichever it is, this attempt gets a fresh execution id: reassigning a
// task or restarting its worker keeps the task id and never its execution id.

import { taskIdIn, withTaskLine, type TaskRef, type TaskSource } from '../../shared/tasks.js';
import type { TaskStore } from './store.js';
import { withExtraLines } from './lines.js';

export interface Identify {
  store: TaskStore;
  floorId: string;
  /** The text as it was typed (its `Task:` line, when it has one, names the task). */
  raw: string;
  /** The assignment's own reading of it: its first line and the issue it names. */
  text: string;
  issue?: number;
  source: TaskSource;
  worker: string;
  role?: string;
  /** Task ids the floor's members are on or were on (their tasks and prevTasks caches), with the worker each was with. */
  known: ReadonlyMap<string, { worker?: string }>;
}

/** The task an existing id or issue names, when the office knows it. */
function existing(i: Pick<Identify, 'store' | 'floorId' | 'raw' | 'issue' | 'known'>): string | undefined {
  const id = taskIdIn(i.raw);
  if (id && (i.store.has(i.floorId, id) || i.known.has(id))) return id;
  if (i.issue !== undefined) return i.store.byIssue(i.floorId, i.issue)?.id;
  return undefined;
}

/** The task and this attempt's execution id, minting the task when it's new. */
export function identify(i: Identify): Required<TaskRef> {
  const id = existing(i) ?? i.store.create(i.floorId, { source: i.source, text: i.text, ...(i.issue !== undefined ? { issue: i.issue } : {}) }).id;
  const was = i.known.get(id)?.worker;
  const executionId = i.store.attempt(i.floorId, id, { worker: i.worker, ...(i.role ? { role: i.role } : {}), ...(was && was !== i.worker ? { from: was } : {}) });
  return { taskId: id, executionId };
}

/**
 * The text to type for a new task: with its `Task: tsk_…` line, the task made now (or the existing one it
 * names) so the id is in what the agent reads. A reply or a question (not a task) goes as it was.
 */
export function prepareText(i: Omit<Identify, 'worker' | 'role'>): string {
  const id = existing(i) ?? i.store.create(i.floorId, { source: i.source, text: i.text, ...(i.issue !== undefined ? { issue: i.issue } : {}) }).id;
  // Feature lines under it (./lines.ts: a bound design system's pointer), each at most one short line.
  return withExtraLines(withTaskLine(i.raw, id), { floorId: i.floorId, taskId: id, text: i.text, ...(i.issue !== undefined ? { issue: i.issue } : {}) });
}
