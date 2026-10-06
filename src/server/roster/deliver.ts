// The one way the office types into an agent: every prompt the roster sends (an escalation's answer, a
// review nudge, a standup, a relay to the Project Coordinator, a settings change) and an agent's
// `office-workers tell` go through here, so none of them is typed into a dialog. A prompt is pasted
// and then submitted with Enter (WorkerManager.prompt), and while a permission prompt or a question is
// up (needs_input), or Claude Code is still booting (starting, when the trust dialog may be up), that
// Enter would pick one of the dialog's options and the prompt would be lost. So it's never typed then:
// a prompt that must arrive is held and typed once the agent's turn is over (idle or done), together
// with the escalation answers it's owed (Escalations.owedTo), in one message; anything else is refused
// and its sender tries again later, as it did for an agent that was asleep.
//
// It also holds the floor's daily spend cap: once it's reached, prompts the office or another agent
// would send (origin 'office' or 'agent') aren't sent, so no new turn starts on the office's say-so;
// what a person sends ('person': their answers, the Team tab) still goes through, and a turn already
// running is never stopped.

import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import { isAsleepStatus } from './bench.js';
import type { Roster } from './index.js';
import { owedAnswersPrompt } from './prompts.js';
import type { TeamFloor } from './types.js';

/** Who a prompt is from: a person, the office itself, or another agent (`office-workers tell`). */
export type Origin = 'person' | 'office' | 'agent';

/** Whether a prompt may be typed into an agent in this status: not with a dialog that may be up. */
export const mayType = (s: WorkerStatus) => s !== 'needs_input' && s !== 'starting';

/** Between turns: when held prompts and owed answers go in. */
const between = (s: WorkerStatus) => s === 'idle' || s === 'done';

export interface SendOpts {
  origin: Origin;
  /** Who it's from, for the terminal's "last typed by" (the office's name otherwise). */
  by?: string;
  /** An asleep (exited, offline) agent is woken with it as its next message; otherwise that's refused. */
  wake?: boolean;
  /** When it can't be typed now (a dialog may be up), keep it and type it once the turn is over. */
  hold?: boolean;
  /** Only between turns (idle or done), never into one under way: held then with `hold`, else refused. */
  between?: boolean;
  /** Called once it's typed (or woken with): now, or when a held prompt goes in. */
  onSent?: () => void;
}

export type Sent = { status: 'sent' | 'woke' | 'held' } | { status: 'refused'; why: string };

interface Held {
  text: string;
  origin: Origin;
  by?: string;
  onSent?: () => void;
}

/** Between two held prompts typed as one message. */
const JOIN = '\n\n---\n\n';

export class Delivery {
  private held = new Map<string, Held[]>();

  constructor(private roster: Roster) {}

  /** Why the office starts no turn on this floor now: its daily spend cap is reached. */
  paused(floor: TeamFloor): string | undefined {
    return this.roster.pauseOf(this.roster.data(floor.id));
  }

  /** Types `text` into agent `w`, or wakes it with it, holds it, or says why not. */
  send(floor: TeamFloor, w: WorkerInfo, text: string, o: SendOpts): Sent {
    if (w.kind !== 'agent') return { status: 'refused', why: `${w.name} is a shell, not an agent` };
    // A person's prompt with no name is still theirs: the turn it starts flags when done (OFFICE_BY's wouldn't).
    if (o.origin === 'person' && !o.by) o = { ...o, by: 'The Project Manager' };
    if (o.origin !== 'person') {
      const p = this.paused(floor);
      if (p) return { status: 'refused', why: `Spend cap reached: ${p}` };
    }
    if (isAsleepStatus(w.status)) {
      if (!o.wake) return { status: 'refused', why: `${w.name} is asleep` };
      const err = floor.wake(w.id, text, o.by);
      if (err) return { status: 'refused', why: err };
      o.onSent?.();
      return { status: 'woke' };
    }
    if (!mayType(w.status) || (o.between && !between(w.status))) {
      if (!o.hold) return { status: 'refused', why: mayType(w.status) ? `${w.name} is busy` : `${w.name} is waiting on an answer in its terminal` };
      const list = this.held.get(w.id) ?? [];
      list.push({ text, origin: o.origin, by: o.by, onSent: o.onSent });
      this.held.set(w.id, list);
      return { status: 'held' };
    }
    let err = floor.prompt(w.id, text, o.by);
    if (err === 'Worker is not running' && o.wake) {
      err = floor.wake(w.id, text, o.by);
      if (!err) {
        o.onSent?.();
        return { status: 'woke' };
      }
    }
    if (err) return { status: 'refused', why: err };
    o.onSent?.();
    return { status: 'sent' };
  }

  /** The usual case: a prompt only worth typing now (its caller tries again later). Why not, if not. */
  prompt(floor: TeamFloor, w: WorkerInfo, text: string, origin: Origin = 'office'): string | undefined {
    const r = this.send(floor, w, text, { origin });
    return r.status === 'refused' ? r.why : undefined;
  }

  /** How many prompts are held for a worker (the tests, and `tell`'s answer). */
  heldFor(workerId: string): number {
    return this.held.get(workerId)?.length ?? 0;
  }

  /**
   * Every worker update: once its turn is over, the answers it's owed and the prompts held for it go
   * in, as one message. An agent that went to sleep with prompts held is woken with them. While the
   * cap holds, only what people sent goes; the rest waits.
   */
  onWorker(floor: TeamFloor, w: WorkerInfo) {
    if (w.kind !== 'agent') return;
    const asleep = isAsleepStatus(w.status);
    if (!between(w.status) && !asleep) return;
    const paused = !!this.paused(floor);
    const queued = this.held.get(w.id) ?? [];
    const going = queued.filter((h) => !paused || h.origin === 'person');
    // An asleep one isn't woken for owed answers alone: its next hire or wake carries them.
    const owed = asleep ? undefined : this.roster.escalations.owedTo(floor, w);
    if (!going.length && !owed?.lines.length) return;
    const text = [...(owed?.lines.length ? [owedAnswersPrompt(owed.lines)] : []), ...going.map((h) => h.text)].join(JOIN);
    // Whose turn it starts: a person's when it carries their words (an answer owed, or what they sent),
    // so it flags when done; else the one sender's, else the office's (workers/lifecycle.ts OFFICE_BY).
    const fromPerson = going.find((h) => h.origin === 'person');
    const person = fromPerson || owed?.lines.length ? (fromPerson?.by ?? 'The Project Manager') : undefined;
    const by = person ?? (going.length === 1 ? going[0].by : undefined);
    const err = asleep ? floor.wake(w.id, text, by) : floor.prompt(w.id, text, by);
    if (err) return;
    owed?.mark();
    const left = queued.filter((h) => !going.includes(h));
    if (left.length) this.held.set(w.id, left);
    else this.held.delete(w.id);
    for (const h of going) h.onSent?.();
  }

  /** A worker left the floor: what was held for it goes with it. */
  forget(workerId: string) {
    this.held.delete(workerId);
  }
}
