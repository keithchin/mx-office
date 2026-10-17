// Tasks recorded as done by a PR that can't be theirs (task-outcome.ts: a merge counts only after the task
// was given, and only with its id). Before that rule the office closed every new task of a worker whose
// old PR had merged: on packtrack six of Sophie's tasks read "PR #3 merged", though PR #3 merged at 11:01Z
// and they were given from 11:15Z on. Each time a member's task is read, a recorded end like that is taken
// back: the task is open again (or, among the earlier ones, was open when it was replaced), with a note of
// what it said. The durable task record (server/tasks/, append only) is never rewritten; the roster's own
// copy keeps the old end under `shownDone`, so nothing is lost.

import { pullEvidence, type PullLook } from './task-outcome.js';
import type { Assignment } from './resume.js';

export interface ReopenLook {
  pulls?: readonly PullLook[];
  /** The task ids a PR's commits carry, or undefined while that isn't known (pr-task-ids.ts). */
  carries?: (p: PullLook) => ReadonlySet<string> | undefined;
}

/**
 * Why a task's recorded end doesn't stand, or undefined when it does (or the office can't tell yet). Only
 * a PR end is looked at, and only on evidence: the PR merged before the task was given, or it merged after
 * it while neither its description nor its commits (once read) carry the task's id.
 */
export function staleDone(t: Assignment, l: ReopenLook): string | undefined {
  if (t.doneAt === undefined || t.outcome !== 'integrated' || t.pr === undefined) return undefined;
  const pull = l.pulls?.find((p) => p.number === t.pr && p.state === 'MERGED');
  if (!pull?.mergedAt || !Number.isFinite(Date.parse(pull.mergedAt))) return undefined;
  const e = pullEvidence(pull, { since: t.at, ...(t.taskId ? { taskId: t.taskId } : {}), ...(l.carries ? { carries: l.carries } : {}) });
  if (e === 'predates') return `earlier shown as done by PR #${pull.number} — that PR predates the task`;
  // Merged after it: wrong only once its commits are known not to carry the id (a legacy task has none).
  if (e === 'unconfirmed' && t.taskId && l.carries?.(pull)) return `earlier shown as done by PR #${pull.number} — that PR doesn't carry Task: ${t.taskId}`;
  return undefined;
}

/** Takes back a stale end in place (see the head of this file); true when it did. */
export function reopenStale(t: Assignment | undefined, l: ReopenLook): boolean {
  const why = t && staleDone(t, l);
  if (!t || !why) return false;
  t.shownDone = { at: t.doneAt!, why: t.doneWhy ?? 'finished', pr: t.pr!, note: why };
  delete t.doneAt;
  delete t.doneWhy;
  delete t.outcome;
  delete t.pr;
  delete t.verify;
  delete t.superseded;
  return true;
}
