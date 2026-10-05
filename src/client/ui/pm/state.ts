// What the project console (ui/pm/console.ts) shows, worked out from the team's view of
// the PM (GET /api/roster) and its worker as the page knows it right now. Pure: no DOM, so a test can
// check every case. The roster is fetched now and then; the worker updates live, so where it's there
// its status wins, and the roster's word covers the rest (not hired, benched, writing its handoff).

import type { WorkerInfo } from '../../../shared/protocol';
import type { MemberView } from '../../../shared/roster/types';

/** Where the PM stands, as the console's pill says it. */
export type PmState = 'not-hired' | 'starting' | 'working' | 'needs-you' | 'idle' | 'asleep' | 'benching' | 'benched';

export const PM_STATE_TEXT: Record<PmState, string> = {
  'not-hired': 'Not hired',
  starting: 'Starting',
  working: 'Working',
  'needs-you': 'Needs you',
  idle: 'Idle',
  asleep: 'Asleep',
  benching: 'Writing handoff',
  benched: 'Benched',
};

export interface PmView {
  state: PmState;
  /** The PM's worker, when it has one at a desk on this floor. */
  workerId?: string;
  /** Its live terminal is worth showing (it has a worker that isn't asleep). */
  live: boolean;
  /** A typed prompt can go to it now. */
  canPrompt: boolean;
  /** What a sent prompt does: goes straight in, or waits in its input box until its turn is over. */
  ack: 'sent' | 'queued';
  /** Why the box is closed, or what to do instead of typing; undefined when there's nothing to say. */
  hint?: string;
  /** ⏰ Wake is offered. */
  canWake: boolean;
  /** The empty state with 🤝 Hire (or "Hire again" with its handoff note, when benched). */
  hire?: 'first' | 'again';
  model?: string;
  /** Its session's cost, in dollars, when known. */
  cost?: number;
}

/** A worker status, in the console's words. */
function fromWorker(w: WorkerInfo): PmState {
  switch (w.status) {
    case 'starting':
      return 'starting';
    case 'working':
      return 'working';
    case 'needs_input':
      return 'needs-you';
    case 'exited':
    case 'offline':
      return 'asleep';
    default:
      return 'idle';
  }
}

/** A roster status, for when the page hasn't got the worker (yet). */
function fromMember(m: MemberView): PmState {
  return m.status;
}

/**
 * What the console shows for `pm` (the roster's member for the PM role, undefined before the roster
 * loads or when it couldn't) and `worker` (the page's copy of its worker, when it's on this floor).
 */
export function pmView(pm: MemberView | undefined, worker: WorkerInfo | undefined): PmView {
  const hiredWorker = pm?.workerId && worker && worker.id === pm.workerId ? worker : undefined;
  // Writing its handoff is the roster's to say: the worker just looks busy.
  const state: PmState = !pm ? 'not-hired' : pm.status === 'benching' ? 'benching' : hiredWorker ? fromWorker(hiredWorker) : fromMember(pm);
  const workerId = hiredWorker?.id ?? (state === 'not-hired' || state === 'benched' ? undefined : pm?.workerId);
  const live = !!hiredWorker && state !== 'asleep';
  const canPrompt = live && (state === 'idle' || state === 'working' || state === 'starting');
  const hint =
    state === 'needs-you'
      ? 'The Project Coordinator is asking you something: answer it in ⤢ Open (a typed prompt is not an answer to a choice).'
      : state === 'asleep'
        ? 'The Project Coordinator is asleep: ⏰ Wake carries on its session, then ask away.'
        : state === 'benching'
          ? 'The Project Coordinator is writing its handoff note before being benched.'
          : state === 'starting'
            ? 'The Project Coordinator is starting up: what you send waits until it is ready.'
            : undefined;
  return {
    state,
    workerId,
    live,
    canPrompt,
    ack: state === 'idle' ? 'sent' : 'queued',
    hint,
    canWake: state === 'asleep' && !!workerId,
    hire: state === 'not-hired' ? 'first' : state === 'benched' ? 'again' : undefined,
    model: hiredWorker?.usage?.model ?? hiredWorker?.model ?? pm?.model,
    cost: hiredWorker?.usage && hiredWorker.usage.costKnown !== false ? hiredWorker.usage.cost : pm?.cost,
  };
}

/** The session's prompt history: Up goes back through what you sent, Down comes forward again to a blank box. */
export class PromptHistory {
  private items: string[] = [];
  /** Where Up/Down is: items.length is the blank box after the newest. */
  private at = 0;

  constructor(private readonly max = 20) {}

  add(text: string) {
    if (text && this.items[this.items.length - 1] !== text) this.items.push(text);
    if (this.items.length > this.max) this.items.shift();
    this.at = this.items.length;
  }

  /** The one before (Up), or undefined at the oldest. */
  back(): string | undefined {
    if (this.at === 0) return undefined;
    return this.items[--this.at];
  }

  /** The one after (Down): '' once past the newest, undefined when already at the blank box. */
  forward(): string | undefined {
    if (this.at >= this.items.length) return undefined;
    this.at++;
    return this.at === this.items.length ? '' : this.items[this.at];
  }
}
