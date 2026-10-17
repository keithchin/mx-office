// What an agent's `office-workers tell` (and the MCP tool tell_worker) is told happened to its message: only
// what the office has evidence for (the tell-honesty fix, after Katherine's tell_worker said "Told Sophie" twice
// while the messages sat unsent in Sophie's input box for 20 minutes). Typed is not received: a message typed
// into a turn under way is queued by Claude Code until the turn ends, and one typed between turns is only
// received once the agent's session shows it. So the reply never says "Told":
//   - held by the office, or typed while the agent is mid-turn: "Queued for Sophie (she's mid-turn; it goes in when her turn ends)";
//   - typed between turns, or woken with it: "Typed into Sophie's terminal; the office will confirm when she receives it";
//   - received (the session already shows it): "Received by Sophie".
// Pure, so the tests walk every case.

import type { WorkerStatus } from '../../shared/protocol.js';

/** What the office knows of a tell: queued (not in yet), typed (not confirmed), received (the session shows it). */
export type TellState = 'queued' | 'typed' | 'received';

export interface TellLook {
  /** What delivery did with it (roster/deliver.ts Sent). */
  sent: 'sent' | 'woke' | 'held';
  /** The recipient's status when it was sent. */
  status: WorkerStatus;
  /** The recipient's session already shows the message. */
  received?: boolean;
}

/** Statuses in which typed text waits behind a turn under way (Claude Code queues it). */
const MID_TURN: ReadonlySet<WorkerStatus> = new Set<WorkerStatus>(['working', 'needs_input', 'starting']);

export function tellState(l: TellLook): TellState {
  if (l.received) return 'received';
  if (l.sent === 'held') return 'queued';
  if (l.sent === 'sent' && MID_TURN.has(l.status)) return 'queued';
  return 'typed';
}

/** The reply's words for `name`. */
export function tellReply(name: string, l: TellLook): { state: TellState; note: string } {
  const state = tellState(l);
  if (state === 'received') return { state, note: `Received by ${name}.` };
  if (state === 'queued') {
    const why = l.status === 'needs_input' ? 'answering a question in its terminal' : 'mid-turn';
    return { state, note: `Queued for ${name} (${why}; it goes in when ${name}'s turn ends). Not received yet; don't send it again.` };
  }
  const how = l.sent === 'woke' ? `${name} was asleep and starts up with it` : 'typed between turns';
  return { state, note: `Typed into ${name}'s terminal (${how}); the office will confirm when ${name} receives it. Don't send it again.` };
}
