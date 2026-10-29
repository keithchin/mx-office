// Typed is not delivered (the typed-evidence fix, after Sophie's answers of 16 Oct sat unsent in her input box
// while the office said "submitted"): an answer typed into an agent's terminal stays `in-flight` with its
// typedAt (typed, not received yet) until the agent's own session shows the typed message carrying its marker
// (evidence.ts: a type:user entry in the recorded session, after the recorded offset). This watch looks, a
// bounded read every couple of seconds:
//   - the typed message is there → submitted, confirmed by the system, and the decision's step 8 (apply);
//   - Claude Code queued typed input (the agent is mid-turn: a queue-operation enqueue after the typing) → it
//     goes in when the turn ends, so it waits longer (QUEUED_MAX_MS), still not called received;
//   - nothing within GRACE_MS → one safe action: if the agent's input box still holds the text (its screen), one
//     Enter, recorded as enterAt so it is never pressed twice, and another GRACE_MS to show up; otherwise
//     outcome-unknown, said to the person ("Typed into Sophie's terminal but not received"), never typed again
//     by the office (Send again is the person's);
//   - the worker stopped (asleep or gone) before its session showed it → outcome-unknown at once, said so;
//   - the worker's session switched since the typing (woken with a new session id): its new session is looked in too;
//   - an outcome-unknown one that turns up in the session later (until LATE_MS) is settled submitted then.
// Only one check runs at a time per record, and it settles under the decision's claim, so a person's choice
// on the card and the watch never both act.

import { isTypedUnconfirmed, type DispatchRecord } from '../../shared/dispatch.js';
import { typedLook, typedLookSwitched, type TypedLook } from './evidence.js';
import type { Dispatcher } from './service.js';

/** How often a typed dispatch's session is looked at. */
export const POLL_MS = 2_000;
/** How long typed text may take to show in the session before the office does anything about it. */
export const GRACE_MS = 30_000;
/** How long typed input Claude Code queued (the agent mid-turn) may wait for the turn to end. */
export const QUEUED_MAX_MS = 30 * 60_000;
/** How long after typing an outcome-unknown one is still looked for (it may turn up late). */
export const LATE_MS = 30 * 60_000;
const QUEUED_POLL_MS = 5_000;
/** How long after typing a worker found stopped is taken as stopped (its status may lag the wake by a moment). */
export const STOPPED_AFTER_MS = 5_000;
const LATE_POLL_MS = 30_000;

export interface TypedWatchDeps {
  /** What the session shows (evidence.ts typedLook by default). */
  look?(r: DispatchRecord): Promise<TypedLook>;
  /** typedLookSwitched by default (the tests' own). */
  lookSwitched?(r: DispatchRecord, now: { sessionId?: string; transcriptPath: string }): Promise<TypedLook>;
  /** Whether the worker's input box still holds the dispatch's text and may take an Enter now; undefined: can't tell. */
  inputHolds?(floorId: string, r: DispatchRecord): boolean | undefined;
  /** Whether the worker is still booting (woken with the answer as its first message): the grace starts once it's up. */
  starting?(floorId: string, r: DispatchRecord): boolean;
  /** Presses Enter once in the worker's terminal: why not, when it couldn't. */
  pressEnter?(floorId: string, r: DispatchRecord): string | undefined;
  /**
   * The worker's session now (its id and transcript), when it may differ from the one recorded before typing: an
   * agent woken with the answer can start a new session, and the message then lands there (evidence.ts typedLookSwitched).
   */
  sessionNow?(floorId: string, r: DispatchRecord): { sessionId?: string; transcriptPath?: string } | undefined;
  /** Whether the worker is asleep (its terminal exited) or gone: a message its session never showed can't arrive any more. */
  stopped?(floorId: string, r: DispatchRecord): boolean;
  /** A typed dispatch is outcome-unknown now: the person is told. */
  lost?(floorId: string, r: DispatchRecord): void;
  /** Runs `fn` after `ms` (a timer that never keeps the process alive, by default). */
  schedule?(fn: () => Promise<void>, ms: number): void;
}

const later = (fn: () => Promise<void>, ms: number) => {
  const t = setTimeout(fn, ms);
  (t as { unref?: () => void }).unref?.();
};

export class TypedWatch {
  /** Records watched now (floor|id): one check at a time each. */
  private watched = new Set<string>();

  constructor(
    private d: Dispatcher,
    private deps: TypedWatchDeps = {},
  ) {}

  /** Replaces some of its deps (a test's clockwork). */
  configure(deps: Partial<TypedWatchDeps>) {
    this.deps = { ...this.deps, ...deps };
  }

  /** Starts watching a typed record (again after a restart); a record already watched is left as it is. */
  watch(floorId: string, r: Pick<DispatchRecord, 'id'>, ms = POLL_MS): void {
    const key = `${floorId}|${r.id}`;
    if (this.watched.has(key)) return;
    this.watched.add(key);
    this.next(floorId, r.id, ms);
  }

  /** Whether a record is being watched (the tests). */
  watching(floorId: string, id: string) {
    return this.watched.has(`${floorId}|${id}`);
  }

  private next(floorId: string, id: string, ms: number) {
    (this.deps.schedule ?? later)(() => this.check(floorId, id), ms);
  }

  private stop(floorId: string, id: string) {
    this.watched.delete(`${floorId}|${id}`);
    this.booted.delete(`${floorId}|${id}`);
  }

  /** One look at a watched record; schedules the next one or stops. Never throws. */
  async check(floorId: string, id: string): Promise<void> {
    try {
      const again = await this.look(floorId, id);
      if (again === undefined) this.stop(floorId, id);
      else this.next(floorId, id, again);
    } catch (err) {
      console.error(`agent-office: dispatch: couldn't check ${id} was received: ${(err as Error).message}`);
      this.next(floorId, id, LATE_POLL_MS);
    }
  }

  /** What one look found: when to look again, or undefined when there's nothing more to watch. */
  private async look(floorId: string, id: string): Promise<number | undefined> {
    const r = this.d.store.get(floorId, id);
    if (!r || r.typedAt === undefined) return undefined;
    const now = this.d.now();
    const late = r.state === 'outcome-unknown';
    if (!late && !isTypedUnconfirmed(r)) return undefined;
    if (late && now - r.typedAt > LATE_MS) return undefined;
    const seen = await this.seen(floorId, r);
    if (seen.found) return this.settle(floorId, id, r.state, async (cur) => {
      const next = await this.d.settle(floorId, cur, 'submitted', { confirmedBy: 'system', note: late ? 'seen in the agent’s session after all' : 'seen in the agent’s session' });
      await this.d.apply(floorId, next);
      return undefined;
    });
    if (late) return LATE_POLL_MS;
    const who = r.workerName ?? 'the agent';
    // Woken with it (or typed) and then its terminal stopped before its session showed it: said now, not after the grace.
    if (now - r.typedAt >= STOPPED_AFTER_MS && this.deps.stopped?.(floorId, r)) return this.lose(floorId, id, `typed into ${who}'s terminal, but ${who} stopped (asleep or gone) before its session showed it: send it again (it wakes ${who})`);
    if (seen.unavailable) return this.lose(floorId, id, `typed into ${who}'s terminal, and its session can't be read (${seen.unavailable})`);
    if (seen.queued) return now - r.typedAt < QUEUED_MAX_MS ? QUEUED_POLL_MS : this.lose(floorId, id, `typed into ${who}'s terminal and queued, still not received after ${Math.round(QUEUED_MAX_MS / 60_000)} min`);
    if (this.deps.starting?.(floorId, r)) {
      this.booted.set(`${floorId}|${id}`, now);
      return now - r.typedAt < QUEUED_MAX_MS ? POLL_MS : this.lose(floorId, id, `typed into ${who}'s terminal as it woke, still not received after ${Math.round(QUEUED_MAX_MS / 60_000)} min`);
    }
    if (now - (r.enterAt ?? this.upAt(floorId, r)) < GRACE_MS) return POLL_MS;
    if (r.enterAt === undefined && this.deps.inputHolds?.(floorId, r) === true) {
      return this.settle(floorId, id, r.state, async (cur) => {
        const why = this.deps.pressEnter?.(floorId, cur) ?? (this.deps.pressEnter ? undefined : 'no way to press Enter');
        if (why) return this.lostNow(floorId, cur, `typed into ${who}'s terminal but not received; Enter couldn't be pressed (${why})`);
        await this.d.settle(floorId, cur, 'in-flight', { enterAt: this.d.now(), note: `still in ${who}'s input box: pressed Enter once` });
        return POLL_MS;
      });
    }
    return this.lose(floorId, id, `typed into ${who}'s terminal but not received within ${Math.round((r.enterAt === undefined ? GRACE_MS : 2 * GRACE_MS) / 1000)} s${r.enterAt !== undefined ? ' (Enter pressed once)' : ''}`);
  }

  /** What the recorded session shows, and else the worker's session now when it switched since (a wake with a new session id). */
  private async seen(floorId: string, r: DispatchRecord): Promise<TypedLook> {
    const first = await (this.deps.look ?? typedLook)(r);
    if (first.found) return first;
    let cur: { sessionId?: string; transcriptPath?: string } | undefined;
    try {
      cur = this.deps.sessionNow?.(floorId, r);
    } catch {
      cur = undefined;
    }
    if (!cur?.transcriptPath || cur.transcriptPath === r.transcriptPath) return first;
    const there = await (this.deps.lookSwitched ?? typedLookSwitched)(r, { ...(cur.sessionId ? { sessionId: cur.sessionId } : {}), transcriptPath: cur.transcriptPath });
    // Found or queued there counts; the recorded file being unreadable doesn't, once the session it moved to can be read.
    if (there.found || there.queued) return there;
    return first.unavailable ? there : first;
  }

  /** Booting ones: when the watch last saw it booting (its grace counts from then), else when it was typed. */
  private booted = new Map<string, number>();
  private upAt(floorId: string, r: DispatchRecord): number {
    return this.booted.get(`${floorId}|${r.id}`) ?? r.typedAt!;
  }

  /** Runs `fn` on the record as it is now, under its decision's claim, if it's still in `state`; busy: looked at again soon. */
  private async settle(floorId: string, id: string, state: DispatchRecord['state'], fn: (r: DispatchRecord) => Promise<number | undefined>): Promise<number | undefined> {
    const r = this.d.store.get(floorId, id);
    if (!r || r.state !== state) return undefined;
    const out = await this.d.claimRun<{ error?: string; again?: number }>(floorId, r.decision, async () => {
      const cur = this.d.store.get(floorId, id);
      if (!cur || cur.state !== state) return {};
      return { again: await fn(cur) };
    });
    // Claimed (an answer or a person's choice under way): looked at again soon.
    return out.error ? POLL_MS : (out as { again?: number }).again;
  }

  private lose(floorId: string, id: string, note: string): Promise<number | undefined> {
    return this.settle(floorId, id, 'in-flight', (cur) => this.lostNow(floorId, cur, note));
  }

  private async lostNow(floorId: string, r: DispatchRecord, note: string): Promise<number | undefined> {
    const next = await this.d.settle(floorId, r, 'outcome-unknown', { note });
    try {
      this.deps.lost?.(floorId, next);
    } catch {
      // telling is best effort; the card shows it anyway
    }
    // Still looked for a while: it may turn up late (then submitted, never typed again).
    return LATE_POLL_MS;
  }
}
