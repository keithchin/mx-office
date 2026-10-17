// How a queue task's turn ended, in words that claim no more than the office knows. A worker at `done` only
// says its turn is over: an API error (StopFailure), a cancel or an Esc (Interrupt) ends a turn too, and none
// of them is the task finished (WorkerInfo.lastStop says which). Even a clean stop is only "turn ended" until
// there is outcome evidence: the task's pull request merged. Pure, so the tests walk every case.

import type { QueueTask, StopKind, WorkerInfo } from '../shared/protocol.js';

/** Why a turn that ended this way stopped the task short, or undefined for the agent stopping by itself. */
export const STOP_WHY: Record<Exclude<StopKind, 'stop'>, string> = {
  error: 'its turn ended with an API error',
  cancelled: 'its turn was cancelled',
  interrupted: 'its turn was interrupted',
};

/** How the queue ends a running task whose worker is at `w.status`: done (its turn ended by itself) or exited (with why). */
export function turnEnd(w: Pick<WorkerInfo, 'status' | 'lastStop'>): { outcome: 'done' | 'exited'; error?: string } {
  if (w.status !== 'done') return { outcome: 'exited' };
  const k = w.lastStop?.kind;
  return k && k !== 'stop' ? { outcome: 'exited', error: STOP_WHY[k] } : { outcome: 'done' };
}

/** Whether there's evidence the task finished: its pull request merged. */
export const finishedEvidence = (t: Pick<QueueTask, 'pr'>) => t.pr?.state === 'MERGED';

/** The toast for a task whose turn ended by itself: "finished" only with its PR merged, otherwise "turn ended". */
export function turnEndedToast(who: string, label: string, t: Pick<QueueTask, 'pr'>): string {
  if (finishedEvidence(t)) return `📋 ${who} finished ${label}: PR #${t.pr!.number} merged`;
  const pr = t.pr ? `PR #${t.pr.number} is ${t.pr.state.toLowerCase()}, not merged` : 'no PR found yet';
  return `📋 ${who}'s turn ended on ${label}: not confirmed finished (${pr})`;
}

/** The toast for a task ended short by an error, a cancel or an interrupt. */
export const stoppedToast = (who: string, label: string, why?: string) => `📋 ${who} stopped before finishing ${label}${why ? ` (${why})` : ''} — requeue it from the queue board`;
