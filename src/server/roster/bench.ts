// Benching an idle Lead, as a state machine of its own so the tests can walk every path. A Lead that
// has sat idle long enough (or that the Project Manager benches) is asked for a handoff note and its lessons;
// once it has written them and its turn is over, the office stops it and clears its session, so it
// costs nothing until it's hired again, fresh. The one promise: an agent mid-task, or one waiting on a
// person, is never idle and never stopped — it is only ever benched from a finished turn.

import type { WorkerStatus } from '../../shared/protocol.js';

/** Statuses of an agent in the middle of something: booting, working, or asking a person. */
const BUSY = new Set<WorkerStatus>(['starting', 'working', 'needs_input']);
const ASLEEP = new Set<WorkerStatus>(['exited', 'offline']);

export interface WorkerLook {
  status: WorkerStatus;
  /** People with its terminal open: someone is with it, so it isn't idle. */
  viewers: number;
}

/**
 * Whether an idle Lead is due to be benched. Idle means its turn is over (idle or done) and nobody
 * has its terminal open, for at least `idleMinutes` since `idleSince`. An asleep one costs nothing
 * already, so it's left alone; `idleMinutes` 0 turns automatic benching off.
 */
export function dueForBench(w: WorkerLook, idleSince: number | undefined, now: number, idleMinutes: number): boolean {
  if (idleMinutes <= 0 || idleSince === undefined) return false;
  if (BUSY.has(w.status) || ASLEEP.has(w.status)) return false;
  if (w.viewers > 0) return false;
  return now - idleSince >= idleMinutes * 60_000;
}

/** Whether `w` may be asked for its handoff now (on demand, too): never mid-task or mid-question. */
export function mayBench(w: WorkerLook): true | string {
  if (w.status === 'needs_input') return "it's waiting on a person: answer it first";
  if (BUSY.has(w.status)) return "it's in the middle of a task: bench it once its turn is over";
  return true;
}

/** How long a Lead that never got going on its handoff (no busy status seen) is given before the office stops waiting. */
export const HANDOFF_START_MS = 3 * 60_000;

export type BenchStep =
  /** Still writing its handoff, or asking someone something: leave it. */
  | 'wait'
  /** Its handoff turn is over (or it stopped): read the note and stop it. */
  | 'finish';

/**
 * The next step for a Lead being benched, from its status now. `sawBusy` is whether it has been busy
 * since it was asked (which is when it starts writing). It finishes only from a turn that's over —
 * never while it's working or waiting on a person, however long that takes.
 */
export function benchStep(status: WorkerStatus | undefined, sawBusy: boolean, askedAt: number, now: number): BenchStep {
  if (status === undefined) return 'finish'; // sent home meanwhile: nothing left to stop
  if (BUSY.has(status)) return 'wait';
  if (ASLEEP.has(status)) return 'finish';
  // idle or done: over once it has worked on the handoff, or it never started at all.
  return sawBusy || now - askedAt >= HANDOFF_START_MS ? 'finish' : 'wait';
}

/** Busy for the bench machine's purposes (the caller notes sawBusy when this is true). */
export const isBusyStatus = (s: WorkerStatus) => BUSY.has(s);
export const isAsleepStatus = (s: WorkerStatus) => ASLEEP.has(s);
