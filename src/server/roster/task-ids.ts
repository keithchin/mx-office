// The roster's side of task identity (Slice 1B-4): a member's task (resume.ts Assignment) points at a
// durable task (server/tasks/) and the attempt at it. A new task is minted before it's typed, so its
// `Task: tsk_…` line is in what the agent reads; reassignment and restarts keep the task id with a new
// execution id; the member's earlier tasks are a short cache (prevTasks), never the history. A legacy task
// (from before task ids) keeps having none. Nothing is typed with a new task id before the task's record has
// it on disk (prepare waits for it): when it can't be written, the caller sends nothing and says so.

import type { RoleId } from '../../shared/roster/roles.js';
import { PREV_TASKS_KEPT, type TaskSource } from '../../shared/tasks.js';
import type { DispatchTask } from '../../shared/dispatch.js';
import { audit, office } from '../audit/index.js';
import { identify, prepareTask, type PreparedTask } from '../tasks/identify.js';
import { taskStoreAt } from '../tasks/index.js';
import type { TaskStore } from '../tasks/store.js';
import type { Roster } from './index.js';
import type { Assignment } from './resume.js';
import type { MemberRecord } from './store.js';
import type { TeamFloor } from './types.js';
import { ROLES } from '../../shared/roster/roles.js';

/** A task ready to type, or why nothing may be sent (its record couldn't be written). */
export type Prepared = { text: string; task?: PreparedTask; error?: undefined } | { error: string; text?: undefined; task?: undefined };

/** A prepared task as a dispatch record carries it (written before anything is typed). */
export const dispatchTaskOf = (p: PreparedTask | undefined): DispatchTask | undefined => p && { taskId: p.taskId, executionId: p.executionId, text: p.first };

/** What the person reads when a task's record couldn't be written: nothing was sent. */
export const unsavedTask = (why: string) => `The office couldn't save the task's record (${why.slice(0, 160)}), so nothing was sent. Check the office's data folder can be written to, then try again`;

export class TaskIds {
  private store?: TaskStore;

  constructor(private roster: Roster) {}

  /** The task record (made on first use; its file read in the background the first time a floor uses it). */
  of(floorId: string): TaskStore {
    this.store ??= taskStoreAt(this.roster.deps.dataDir);
    void this.store.load(floorId);
    return this.store;
  }

  /** Every task id the floor's members are on or were on, with the worker each was with. */
  private known(floorId: string): Map<string, { worker?: string }> {
    const out = new Map<string, { worker?: string }>();
    const d = this.roster.data(floorId);
    for (const r of ROLES) {
      const m = d.members[r.id];
      for (const t of [...(m.prevTasks ?? []), m.task]) if (t?.taskId) out.set(t.taskId, { worker: m.workerId });
    }
    return out;
  }

  /**
   * The text to type for `a` (a task, not a reply): with its task line, the task minted now when it's new,
   * once its record is on disk. When it couldn't be written: an error to show, audited, and nothing to type.
   */
  async prepare(floor: TeamFloor, raw: string, a: Assignment, source: TaskSource): Promise<Prepared> {
    try {
      const task = await prepareTask({ store: this.of(floor.id), floorId: floor.id, raw, text: a.text, ...(a.issue !== undefined ? { issue: a.issue } : {}), source, known: this.known(floor.id) });
      return { text: task.text, task };
    } catch (err) {
      const error = unsavedTask((err as Error).message);
      audit.record({ floor: floor.id, actor: office(), action: 'task.unsaved', target: { kind: 'project', id: floor.id, label: floor.name }, summary: `Not sent: the task's record couldn't be saved (${a.text.slice(0, 120)})`, details: { source, error: (err as Error).message.slice(0, 200) }, severity: 'warning' });
      return { error };
    }
  }

  /** Gives `a` its task and a new attempt on `workerId` (`executionId`: the one prepared with it), audited with both ids. */
  attach(floor: TeamFloor, role: RoleId, workerId: string, raw: string, a: Assignment, source: TaskSource, executionId?: string) {
    const ids = identify({ store: this.of(floor.id), floorId: floor.id, raw, text: a.text, ...(a.issue !== undefined ? { issue: a.issue } : {}), source, worker: workerId, role, known: this.known(floor.id), ...(executionId ? { executionId } : {}) });
    a.taskId = ids.taskId;
    a.executionId = ids.executionId;
    this.audit(floor, role, workerId, a, `${a.by} gave ${this.roster.data(floor.id).members[role].name} a task: ${a.text}`);
  }

  /** The member's open task on a new session (a restart): the same task, a new attempt. */
  reattempt(floor: TeamFloor, role: RoleId, workerId: string, from?: string) {
    const t = this.roster.data(floor.id).members[role].task;
    if (!t?.taskId || t.doneAt !== undefined) return;
    t.executionId = this.of(floor.id).attempt(floor.id, t.taskId, { worker: workerId, role, ...(from ? { from } : {}) });
    this.audit(floor, role, workerId, t, `${this.roster.data(floor.id).members[role].name} carries on with its task in a new session: ${t.text}`);
  }

  /** `m`'s task about to be replaced by `next`: kept in the cache (unless it's the same task carried on). */
  retire(floor: TeamFloor, m: MemberRecord, next: Assignment, keepOngoing = false) {
    const old = m.task;
    if (!old || (old.taskId && old.taskId === next.taskId)) return;
    m.prevTasks = [...(m.prevTasks ?? []), old].slice(-PREV_TASKS_KEPT);
    // A change note to a member mid-task: the task it was on carries on afterwards, never superseded by the note.
    if (keepOngoing && old.doneAt === undefined && !old.pending) {
      m.ongoing = old;
      return;
    }
    // Still open when the member was given something else: that task was put aside for this one.
    if (old.taskId && old.doneAt === undefined) this.of(floor.id).event(floor.id, old.taskId, { type: 'superseded', at: this.roster.deps.now(), ...(next.taskId ? { by: next.taskId } : {}) });
  }

  /** A task that ended, on its record: completed, cancelled, or superseded by a newer PR. */
  ended(floor: TeamFloor, t: Assignment, how: 'completed' | 'cancelled' | 'superseded', why?: string) {
    if (!t.taskId) return;
    this.of(floor.id).event(floor.id, t.taskId, { type: how, at: this.roster.deps.now(), ...(why ? { why: why.slice(0, 120) } : {}) });
  }

  private audit(floor: TeamFloor, role: RoleId, workerId: string, a: Assignment, summary: string) {
    const m = this.roster.data(floor.id).members[role];
    audit.record({ floor: floor.id, actor: office(), action: 'task.assign', target: { kind: 'worker', id: workerId, label: m.name }, summary: summary.slice(0, 240), details: { role, ...(a.issue !== undefined ? { issue: a.issue } : {}) }, ids: { ...(a.taskId ? { taskId: a.taskId } : {}), ...(a.executionId ? { executionId: a.executionId } : {}), roleId: role, agentInstanceId: workerId } });
  }
}
