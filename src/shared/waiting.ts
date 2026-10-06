// Who's waiting on a person, and in what order: the rules the browser's N key, compass and Needs you
// strip use (client/nextup.ts re-exports them), and the server's Teams notifications (server/notify-teams/)
// read too, so both decide the same way. Pure, no DOM.

import type { WorkerInfo } from './protocol.js';

type Waiting = WorkerInfo & { status: 'needs_input' | 'done' };

/** Waiting on a person: needs input, or finished its turn and nobody has looked yet. */
export function waitingOnSomeone(w: WorkerInfo): w is Waiting {
  return w.status === 'needs_input' || (w.status === 'done' && !w.acked);
}

/** Since when it's been waiting (an office from before waitingSince had only the hire time). */
export function waitingSince(w: WorkerInfo): number {
  return w.waitingSince ?? w.createdAt;
}

/** The ones stopped on a question or a permission come first: they can't go on until someone answers. */
const blocked = (w: WorkerInfo) => (w.status === 'needs_input' ? 0 : 1);

/** Workers waiting on someone: the ones that need you, then the ones that are done, whoever has waited longest first. */
export function waitingInOrder(workers: Iterable<WorkerInfo>): Waiting[] {
  return [...workers].filter(waitingOnSomeone).sort((a, b) => blocked(a) - blocked(b) || waitingSince(a) - waitingSince(b) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Workers stopped until someone answers them, whoever has waited longest first. */
export function needingYou(workers: Iterable<WorkerInfo>): (WorkerInfo & { status: 'needs_input' })[] {
  return waitingInOrder(workers).filter((w): w is WorkerInfo & { status: 'needs_input' } => w.status === 'needs_input');
}
