// The roster's dispatch targets (server/dispatch/service.ts Target): a person's answer typed to an agent
// through the one way the office types (deliver.ts), carrying its dispatch id and marker; held for after
// the agent's turn when that's what delivery does, the held prompt then written with a critical roster
// flush so a `held` dispatch never points at a prompt a crash could lose; and an answer owed to an agent
// that can't take it now (a dialog up, writing its handoff, gone home: Escalations.owedTo / owed type it
// later, the same dispatch id). Durable intent plus reconciliation, and no automatic replay of an
// ambiguous attempt; never exactly-once.

import type { WorkerInfo } from '../../shared/protocol.js';
import { withMarker, type DecisionRef, type DispatchTask } from '../../shared/dispatch.js';
import type { AnswerResult, Outcome, Target } from '../dispatch/service.js';
import type { SendOpts, Sent } from './deliver.js';
import { sessionAt } from './dispatch-session.js';
import type { Roster } from './index.js';
import type { TeamFloor } from './types.js';

/** A target that types `text` to `w` (or holds it, as delivery decides), with what delivery said. */
export function typeTarget(roster: Roster, floor: TeamFloor, w: WorkerInfo, text: string, opts: SendOpts, extra: Partial<Pick<Target, 'covers' | 'supersedes' | 'task'>> = {}): Target & { sent?: Sent } {
  let typedNow = false;
  const t: Target & { sent?: Sent } = {
    channel: 'type',
    workerId: w.id,
    workerName: w.name,
    ...extra,
    // Typed now: the resume line goes inside the payload, so the marker is the message's own last line.
    // Held: the text and its marker, a block of the message that goes in after the turn (its resume line after it).
    payload: (marker) => {
      typedNow = roster.delivery.typesNow(floor, w, opts);
      return withMarker(typedNow ? roster.delivery.resumed(floor, w, text, opts) : text, marker);
    },
    session: () => sessionAt(floor, w),
    act: async (r): Promise<Outcome> => {
      const now = floor.worker(w.id) ?? w;
      // Exactly the recorded payload: typed now (never held, its resume line in it), or held as recorded.
      const sent = roster.delivery.send(floor, now, text, { ...opts, ...(typedNow ? { hold: false, resume: false } : {}), dispatch: { id: r.id, marker: r.marker, payload: r.payload } });
      t.sent = sent;
      if (sent.status === 'refused') return { state: 'refused', note: sent.why };
      if (sent.status === 'held') {
        try {
          await roster.file(floor.id).flushCritical();
        } catch (err) {
          roster.delivery.unhold(floor, r.id);
          return { state: 'failed', note: `the held answer couldn't be saved (${(err as Error).message}), so it was not kept` };
        }
        return { state: 'held', note: 'held for after its turn' };
      }
      // Typed (or woken with) is not received: the dispatcher waits for the agent's session to show it.
      return { state: 'submitted', typed: true, note: sent.status === 'woke' ? 'woke the agent with it' : 'typed' };
    },
  };
  return t;
}

/** A target for an answer owed to an agent: settled held, typed later by owedTo / owed (or a hire) with the same id. */
export function owedTarget(who: { workerId?: string; name: string }, line: string, why: string): Target {
  return {
    channel: 'hold',
    ...(who.workerId ? { workerId: who.workerId } : {}),
    workerName: who.name,
    payload: (marker) => `${line}\n${marker}`,
    act: () => ({ state: 'held', note: why }),
  };
}

/** The error a path gives back for an answer result (undefined when it went). */
export const answerError = (r: AnswerResult): string | undefined => (r.ok ? undefined : r.error);

/**
 * A person's words for one agent as a durable dispatch: a revision of `decision` (kind reply) and one typed
 * target. For the lead-panel tell, Can't now / Still needed, stuck answers and model change requests.
 * `task`: the new task it hands over (its ids go in the dispatch record, written before typing).
 */
export async function sendAsAnswer(roster: Roster, floor: TeamFloor, w: WorkerInfo, text: string, opts: SendOpts, a: { decision: DecisionRef; by: string; expectedRev?: number; currentRev?: number; kind?: 'reply' | 'answer'; task?: DispatchTask; apply?: (sent: Sent | undefined) => void | Promise<void> }): Promise<{ result: AnswerResult; sent?: Sent }> {
  let target: (Target & { sent?: Sent }) | undefined;
  const result = await roster.dispatch.answer(floor.id, {
    decision: a.decision,
    expectedRev: a.expectedRev,
    current: () => ({ rev: a.currentRev ?? roster.dispatch.answers.rev(floor.id, a.decision) }),
    revision: { kind: a.kind ?? 'reply', text, by: a.by },
    targets: () => [(target = typeTarget(roster, floor, w, text, opts, a.task ? { task: a.task } : {}))],
    apply: async () => a.apply?.(target?.sent),
  });
  return { result, sent: target?.sent };
}
