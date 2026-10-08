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
// running is never stopped. A floor paused with ⏸ Pause project (project-run/store.ts) holds the
// same way: nothing of the office's or another agent's goes in until it's resumed; a person's does.
//
// What's held is kept in the roster file (held.ts), so a restart doesn't lose a promise: it goes in once
// the agent is next between turns (or the minute's look finds it so), and one that waited past its
// expiry is let go and said so. The same prompt held twice (its id) goes in once.
//
// The office's own messages (origin 'office': a scheduled standup, a settings notice, relays, notes)
// never go into a turn under way: they're held and typed once it's over, so an agent mid-task finishes
// what it was doing first (only a caller that says `interrupt` may cut in). And every message the
// office composes ends with the resume line (resume.ts), "When you've done this, carry on with: <task>",
// added as it's typed (one line for several held messages typed together), so it never replaces the task.

import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import { isAsleepStatus } from './bench.js';
import type { Roster } from './index.js';
import { owedAnswersPrompt } from './prompts.js';
import { projectPauseOf } from '../project-run/store.js';
import { audit, office } from '../audit/index.js';
import { HELD_TTL_MS, heldId, holdOnce, type HeldPrompt } from './held.js';
import { withResume } from './resume.js';
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
  /** Called once it's typed (or woken with): now, or when a held prompt goes in (not after a restart). */
  onSent?: () => void;
  /** A held prompt's idempotency key: held again with the same one, it still goes in once. Made from the prompt otherwise. */
  id?: string;
  /** How long a held prompt waits before it's let go (HELD_TTL_MS, a day, otherwise). */
  ttlMs?: number;
  /** End it with the resume line (resume.ts): the office's own messages do unless they say not; a person's decision the office words says so. */
  resume?: boolean;
  /** An office message that may go into a turn under way (the default holds it for the turn's end). */
  interrupt?: boolean;
}

export type Sent = { status: 'sent' | 'woke' | 'held' } | { status: 'refused'; why: string };

/** How long a held prompt was kept, for its activity line. */
const waited = (ms: number) => (ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.max(1, Math.round(ms / 60_000))} min`);

/** Between two held prompts typed as one message. */
const JOIN = '\n\n---\n\n';

export class Delivery {
  /** What to call once a held prompt goes in, by its id: in memory only (held.ts). */
  private sentFns = new Map<string, (() => void)[]>();

  constructor(private roster: Roster) {}

  /** Why the office starts no turn on this floor now: its daily spend cap is reached, or it's paused (⏸ Pause project). */
  paused(floor: TeamFloor): string | undefined {
    return this.roster.pauseOf(this.roster.data(floor.id)) ?? projectPauseOf(floor.id);
  }

  /** Types `text` into agent `w`, or wakes it with it, holds it, or says why not. */
  send(floor: TeamFloor, w: WorkerInfo, text: string, o: SendOpts): Sent {
    if (w.kind !== 'agent') return { status: 'refused', why: `${w.name} is a shell, not an agent` };
    // A person's prompt with no name is still theirs: the turn it starts flags when done (OFFICE_BY's wouldn't).
    if (o.origin === 'person' && !o.by) o = { ...o, by: 'The Project Manager' };
    if (o.origin !== 'person') {
      const cap = this.roster.pauseOf(this.roster.data(floor.id));
      if (cap) return { status: 'refused', why: `Spend cap reached: ${cap}` };
      const held = projectPauseOf(floor.id);
      if (held) return { status: 'refused', why: held };
    }
    // The office's own words wait for the turn under way to end, and are typed then.
    if (o.origin === 'office' && !o.interrupt) o = { ...o, hold: true, between: true };
    const typed = this.resumes(o) ? withResume(text, this.roster.tasks.line(floor, w)) : text;
    if (isAsleepStatus(w.status)) {
      if (!o.wake) return { status: 'refused', why: `${w.name} is asleep` };
      const err = floor.wake(w.id, typed, o.by);
      if (err) return { status: 'refused', why: err };
      this.typed(floor, w, text, o);
      return { status: 'woke' };
    }
    if (!mayType(w.status) || (o.between && !between(w.status))) {
      if (!o.hold) return { status: 'refused', why: mayType(w.status) ? `${w.name} is busy` : `${w.name} is waiting on an answer in its terminal` };
      this.hold(floor, w, text, o);
      return { status: 'held' };
    }
    let err = floor.prompt(w.id, typed, o.by);
    if (err === 'Worker is not running' && o.wake) {
      err = floor.wake(w.id, typed, o.by);
      if (!err) {
        this.typed(floor, w, text, o);
        return { status: 'woke' };
      }
    }
    if (err) return { status: 'refused', why: err };
    this.typed(floor, w, text, o);
    return { status: 'sent' };
  }

  private resumes = (o: SendOpts) => o.resume ?? o.origin === 'office';

  /** Typed (or woken with) now: its sender hears, and the same prompt, if it was held before, has gone in. */
  private typed(floor: TeamFloor, w: WorkerInfo, text: string, o: SendOpts) {
    const id = o.id ?? heldId(w.id, o.origin, text, o.by);
    const fns = this.sentFns.get(id) ?? [];
    o.onSent?.();
    this.drop(floor, [id]);
    for (const fn of fns) fn();
  }

  /** Keeps a prompt for after the turn, in the roster file, once per id. */
  private hold(floor: TeamFloor, w: WorkerInfo, text: string, o: SendOpts) {
    const now = this.roster.deps.now();
    const id = o.id ?? heldId(w.id, o.origin, text, o.by);
    holdOnce(this.roster.data(floor.id).held, { id, workerId: w.id, origin: o.origin, ...(o.by ? { by: o.by } : {}), text, createdAt: now, expiresAt: now + (o.ttlMs ?? HELD_TTL_MS), ...(this.resumes(o) ? { resume: true } : {}) });
    if (o.onSent) this.sentFns.set(id, [...(this.sentFns.get(id) ?? []), o.onSent]);
    this.roster.touch(floor, true);
  }

  /** Takes held prompts off the floor's list (typed, or let go). */
  private drop(floor: TeamFloor, ids: string[]) {
    const d = this.roster.data(floor.id);
    const before = d.held.length;
    d.held = d.held.filter((h) => !ids.includes(h.id));
    for (const id of ids) this.sentFns.delete(id);
    if (d.held.length !== before) this.roster.touch(floor, true);
  }

  private heldOf(floorId: string, workerId: string): HeldPrompt[] {
    return this.roster.data(floorId).held.filter((h) => h.workerId === workerId);
  }

  /** The usual case: a prompt only worth typing now (its caller tries again later). Why not, if not. */
  prompt(floor: TeamFloor, w: WorkerInfo, text: string, origin: Origin = 'office'): string | undefined {
    const r = this.send(floor, w, text, { origin });
    return r.status === 'refused' ? r.why : undefined;
  }

  /** How many prompts are held for a worker (the tests, and the run preview), on its floor or any. */
  heldFor(workerId: string, floorId?: string): number {
    const floors = floorId ? [floorId] : this.roster.deps.floors().map((f) => f.id);
    return floors.reduce((n, id) => n + this.heldOf(id, workerId).length, 0);
  }

  /**
   * The minute's look: held prompts past their expiry are let go (an activity line and an audit event
   * each). Gives back the workers with prompts still held that could go in now, for the roster to
   * hand to onWorker (after a restart nothing else may announce them).
   */
  tick(floor: TeamFloor, now = this.roster.deps.now()): string[] {
    const d = this.roster.data(floor.id);
    const expired = d.held.filter((h) => h.expiresAt <= now);
    for (const h of expired) {
      const name = floor.worker(h.workerId)?.name ?? h.workerId;
      const from = h.by ?? (h.origin === 'office' ? 'the office' : 'someone');
      floor.activity?.(`⌛ A message from ${from} held for ${name} was let go: its turn didn't end within ${waited(h.expiresAt - h.createdAt)}`);
      audit.record({ floor: floor.id, actor: office(), action: 'delivery.expired', target: { kind: 'worker', id: h.workerId, label: name }, summary: `A held message from ${from} for ${name} expired before it could be typed`, details: { id: h.id, origin: h.origin, by: h.by, createdAt: h.createdAt, expiresAt: h.expiresAt, length: h.text.length } });
    }
    if (expired.length) this.drop(floor, expired.map((h) => h.id));
    const due = new Set<string>();
    for (const h of d.held) {
      const w = floor.worker(h.workerId);
      if (w?.kind === 'agent' && (between(w.status) || isAsleepStatus(w.status))) due.add(w.id);
    }
    return [...due];
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
    const now = this.roster.deps.now();
    const queued = this.heldOf(floor.id, w.id).filter((h) => h.expiresAt > now);
    const going = queued.filter((h) => !paused || h.origin === 'person');
    // An asleep one isn't woken for owed answers alone: its next hire or wake carries them.
    const owed = asleep ? undefined : this.roster.escalations.owedTo(floor, w);
    if (!going.length && !owed?.lines.length) return;
    const joined = [...(owed?.lines.length ? [owedAnswersPrompt(owed.lines)] : []), ...going.map((h) => h.text)].join(JOIN);
    // One resume line at the end, for the office's words and the answers it's owed (resume.ts).
    const text = owed?.lines.length || going.some((h) => h.resume) ? withResume(joined, this.roster.tasks.line(floor, w)) : joined;
    // Whose turn it starts: a person's when it carries their words (an answer owed, or what they sent),
    // so it flags when done; else the one sender's, else the office's (workers/lifecycle.ts OFFICE_BY).
    const fromPerson = going.find((h) => h.origin === 'person');
    const person = fromPerson || owed?.lines.length ? (fromPerson?.by ?? 'The Project Manager') : undefined;
    const by = person ?? (going.length === 1 ? going[0].by : undefined);
    const err = asleep ? floor.wake(w.id, text, by) : floor.prompt(w.id, text, by);
    if (err) return;
    owed?.mark();
    const fns = going.flatMap((h) => this.sentFns.get(h.id) ?? []);
    this.drop(floor, going.map((h) => h.id));
    for (const fn of fns) fn();
  }

  /** A worker left the floor: what was held for it goes with it. */
  forget(floor: TeamFloor, workerId: string) {
    this.drop(floor, this.heldOf(floor.id, workerId).map((h) => h.id));
  }
}
