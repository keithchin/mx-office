// Task identity (Slice 1B-4, docs/site/teams-and-agents/escalations.md): every new piece of work the
// office hands an agent gets a durable task id, `tsk_<ulid>` (shared/evidence/ids.ts), kept in a record of
// its own (server/tasks/, <data>/tasks/<project>.jsonl) that doesn't belong to any agent. Reassigning the
// task or restarting its worker keeps the id; each attempt (a hire, or the task handed to a worker's
// session) gets its own execution id, `exe_<ulid>`. A member's task on the roster and its short history
// (prevTasks) only point at it. Work from before task ids stays a legacy task: no id is ever made up for it.
// Pure: the browser imports the types and the words.

import { isExecutionId, isTaskId } from './evidence/ids.js';

/** Where a task came from. */
export const TASK_SOURCES = ['hire', 'queue', 'console', 'tell', 'proposal', 'mcr', 'stuck', 'decision', 'request'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];
export const isTaskSource = (v: unknown): v is TaskSource => typeof v === 'string' && (TASK_SOURCES as readonly string[]).includes(v);

/** Something that happened to a task, oldest first in its record. */
export type TaskEvent =
  | { type: 'assigned'; at: number; worker: string; role?: string; executionId: string }
  | { type: 'reassigned'; at: number; worker: string; role?: string; executionId: string; from?: string }
  | { type: 'completed'; at: number; why?: string }
  | { type: 'cancelled'; at: number; why?: string }
  | { type: 'superseded'; at: number; by?: string; why?: string };
export type TaskEventType = TaskEvent['type'];

/** A task as its record reads once every line is folded in. */
export interface TaskRecord {
  id: string;
  createdAt: number;
  source: TaskSource;
  /** Its first line, as the roster shows it. */
  text: string;
  issue?: number;
  /** The id it had before (a queue task's hex id). */
  legacyId?: string;
  events: TaskEvent[];
}

/** One line of the task file: a task made, or an event on one. Each is hash-chained to the line before. */
export type TaskLine = { op: 'create'; task: Omit<TaskRecord, 'events'> } | { op: 'event'; task: string; event: TaskEvent } | { op: 'issue'; task: string; issue: number };

/** What a member's task, a queue task or a dispatch keeps of a task: the ids only. */
export interface TaskRef {
  taskId?: string;
  executionId?: string;
}

/** The line every typed task carries, and agents copy into commit trailers and PR bodies. */
export const taskLine = (id: string) => `Task: ${id}`;

const TASK_LINE_RE = /^\s*Task:\s*(tsk_[0-9A-HJKMNP-TV-Z]{26})\s*$/gm;

/** The last `Task: tsk_…` line in a text (a typed task, a PR body, a commit message), when it has one. */
export function taskIdIn(text: string | undefined): string | undefined {
  if (!text) return undefined;
  let last: string | undefined;
  for (const m of text.matchAll(TASK_LINE_RE)) last = m[1];
  return last && isTaskId(last) ? last : undefined;
}

/** Every task id named in a text, as a `Task:` line or anywhere in it. */
export function taskIdsIn(text: string | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(/\btsk_[0-9A-HJKMNP-TV-Z]{26}\b/g)].map((m) => m[0]))];
}

/** `text` with its task line at the end (once). */
export function withTaskLine(text: string, id: string | undefined): string {
  if (!id || taskIdIn(text) === id) return text;
  return `${text.replace(/\s+$/, '')}\n\n${taskLine(id)}`;
}

/** A task ref from what was saved, each id only when well formed; undefined when neither is. */
export function cleanTaskRef(v: unknown): TaskRef | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const out: TaskRef = {};
  if (typeof r.taskId === 'string' && /^tsk_/.test(r.taskId) && isTaskId(r.taskId)) out.taskId = r.taskId;
  if (isExecutionId(r.executionId)) out.executionId = r.executionId as string;
  return out.taskId || out.executionId ? out : undefined;
}

/** How a task with no id reads wherever it's shown. */
export const LEGACY_TASK = 'legacy task (no id)';

/** How many earlier tasks a member keeps as a cache (the task record is the history). */
export const PREV_TASKS_KEPT = 5;
