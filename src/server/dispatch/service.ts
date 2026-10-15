// The dispatcher (Slice 1B-1, plan §2.2): every answer path goes through answer(), in this order:
//   1. the stale check (the page's expectedRev against the decision's current revision): a mismatch is a
//      409 with the current state, and nothing is written or typed;
//   2. a synchronous claim on the decision, before the first await, so two answers at once can't both pass;
//   3. the answer revision appended to the answer store (awaited, fsync'd);
//   4. each dispatch intent written `prepared`, with the exact payload, worker, session and transcript
//      offset (awaited, critical write);
//   5. marked `in-flight` (awaited);
//   6. the act (typing through the roster's delivery, holding, or making an issue);
//   7. settled: submitted | held | refused | failed (or outcome-unknown for an issue whose result is unclear);
//   8. only then the caller's apply: the escalation, the questions book or the proposal points at
//      {answerRev, dispatchId}.
// What this guarantees: durable intent plus reconciliation, and no automatic replay of an ambiguous
// attempt. A dispatch whose outcome can't be established stays outcome-unknown until a person settles it
// (Send again, It went through, Abandon). Never exactly-once.

import path from 'node:path';
import { answerMarker, decisionLabel, isUnsettled, issueMarker, type AnswerRevisionKind, type DecisionRef, type DispatchChannel, type DispatchRecord, type DispatchState } from '../../shared/dispatch.js';
import { ulid } from '../../shared/evidence/ids.js';
import type { AuditActor } from '../../shared/audit.js';
import { audit, human, office } from '../audit/index.js';
import { AnswerStore, type AnswerLine } from '../answers/store.js';
import { DispatchStore } from './store.js';
import type { CriticalFs } from '../flow/critical-write.js';

/** What an act came to. */
export interface Outcome {
  state: Extract<DispatchState, 'submitted' | 'held' | 'refused' | 'failed' | 'outcome-unknown'>;
  note?: string;
  issue?: { number?: number; url?: string };
}

/** Where to look for evidence, captured before the act. */
export interface SessionAt {
  sessionId?: string;
  transcriptPath?: string;
  transcriptOffset?: number;
}

/** One dispatch of a revision. */
export interface Target {
  channel: DispatchChannel;
  workerId?: string;
  workerName?: string;
  covers?: { decision: DecisionRef; answerRev: number }[];
  proposalId?: string;
  supersedes?: string;
  /** The exact text it types (or the issue body), given its marker line. */
  payload(marker: string): string;
  session?(): Promise<SessionAt>;
  act(r: DispatchRecord): Outcome | Promise<Outcome>;
}

export interface AnswerSpec {
  decision: DecisionRef;
  /** The revision the page saw; undefined skips the check (an older client, or the office's own path). */
  expectedRev?: number;
  /**
   * Read at the claim (after the stores are loaded, before the first await of the answer): the revision
   * the decision's own record points at now (0 when never applied), its state in a few words for a 409,
   * and, when it takes no answer now, why (a 409 when expectedRev was given, else an error).
   */
  current(): { rev: number; state?: string; open?: string };
  /** The revision appended; omitted when an existing revision is dispatched (useRev). */
  revision?: { kind: AnswerRevisionKind; option?: string; text: string; by: string; supersedes?: number; basis?: 'recorded-differently' };
  useRev?: number;
  /** Checks once claimed, before anything is written: an error, or undefined. */
  check?(): string | undefined;
  targets?(rev: number): Target[];
  /** Step 8: the decision's own record, once every dispatch settled. */
  apply?(rev: number, records: DispatchRecord[]): void | Promise<void>;
}

export type AnswerResult = { ok: true; results: { decision: DecisionRef; rev: number; records: DispatchRecord[]; /** A dispatch's outcome isn't settled: step 8 waits for reconcile or a person. */ pending?: boolean }[] } | { ok: false; status: 400 | 409 | 500; error: string; current?: { decision: DecisionRef; rev: number; state?: string } };

/** Settles a record from what reconcile or a person found, for the decision's own record (escalation, book, proposal). */
export type Applier = (floorId: string, r: DispatchRecord, line: AnswerLine | undefined) => void | Promise<void>;

export interface DispatcherDeps {
  dataDir: string;
  now(): number;
  fs?: CriticalFs;
}

export const mintDispatchId = (now: number) => `dsp_${ulid(now)}`;

const AUDIT_WORD: Partial<Record<DispatchState, string>> = { prepared: 'prepared', 'in-flight': 'in-flight', submitted: 'submitted', held: 'held', 'outcome-unknown': 'unknown', 'person-confirmed-sent': 'person-confirmed', 'person-chose-resend': 'resent', 'person-abandoned': 'abandoned', refused: 'refused', failed: 'failed', 'not-sent': 'not-sent' };

export class Dispatcher {
  readonly answers: AnswerStore;
  readonly store: DispatchStore;
  private claims = new Set<string>();
  /** Step 8 for records settled later (reconcile, a person, Send again), by decision kind (esc, q, proposal…). */
  readonly appliers = new Map<string, Applier>();

  /** The records this process wrote: reconcile looks only at what an earlier run left (dispatch/reconcile.ts). */
  readonly mine = new Set<string>();

  constructor(private deps: DispatcherDeps) {
    this.answers = new AnswerStore(path.join(deps.dataDir, 'answers'));
    this.store = new DispatchStore(path.join(deps.dataDir, 'dispatch'), deps.fs);
  }

  now() {
    return this.deps.now();
  }

  /** Both stores of a floor read (once). */
  async ready(floorId: string): Promise<void> {
    await Promise.all([this.answers.load(floorId), this.store.load(floorId)]);
  }

  /** Whether a decision is claimed by an answer under way. */
  claimed(floorId: string, decision: DecisionRef) {
    return this.claims.has(`${floorId}|${decision}`);
  }

  /** Runs `fn` holding the decision's claim (a person's choice on a dispatch); a second one at once is refused. */
  async claimRun<T extends { error?: string }>(floorId: string, decision: DecisionRef, fn: () => Promise<T>): Promise<T | { error: string }> {
    const key = `${floorId}|${decision}`;
    if (this.claims.has(key)) return { error: 'This decision is being answered right now' };
    this.claims.add(key);
    try {
      return await fn();
    } finally {
      this.claims.delete(key);
    }
  }

  /** One decision's answer, in the order above. */
  answer(floorId: string, spec: AnswerSpec, groupId?: string): Promise<AnswerResult> {
    return this.answerMany(floorId, [spec], groupId);
  }

  /** Several decisions answered as one (a grouped card): every claim taken first, or none. */
  async answerMany(floorId: string, specs: readonly AnswerSpec[], groupId?: string): Promise<AnswerResult> {
    await this.ready(floorId);
    // ---- 1 and 2: synchronous from here to the first await ----
    for (const s of specs) {
      const c = s.current();
      const conflict = (error: string): AnswerResult => ({ ok: false, status: 409, error, current: { decision: s.decision, rev: c.rev, ...(c.state ? { state: c.state } : {}) } });
      if (s.expectedRev !== undefined && s.expectedRev !== c.rev) return conflict('This decision changed since you opened it');
      if (this.claimed(floorId, s.decision)) return conflict('This decision is being answered right now');
      if (c.open) return s.expectedRev !== undefined ? conflict(`This decision changed since you opened it: ${c.open}`) : { ok: false, status: 400, error: c.open };
    }
    const keys = specs.map((s) => `${floorId}|${s.decision}`);
    keys.forEach((k) => this.claims.add(k));
    try {
      for (const s of specs) {
        const err = s.check?.();
        if (err) return { ok: false, status: 400, error: err };
      }
      const results: { decision: DecisionRef; rev: number; records: DispatchRecord[]; pending?: boolean }[] = [];
      for (const s of specs) {
        // ---- 3 ----
        let rev = s.useRev ?? 0;
        if (s.revision) {
          try {
            const line = await this.answers.append(floorId, { decision: s.decision, kind: s.revision.kind, ...(s.revision.option ? { option: s.revision.option } : {}), text: s.revision.text, by: s.revision.by, at: this.now(), ...(s.revision.supersedes ? { supersedes: s.revision.supersedes } : {}), ...(s.revision.basis ? { basis: s.revision.basis } : {}) });
            rev = line.rev;
          } catch (err) {
            return { ok: false, status: 500, error: `The office couldn't save your answer (${(err as Error).message}), so nothing was sent. Check the office's data folder can be written to, then answer again` };
          }
        }
        // ---- 4 to 7 ----
        const records: DispatchRecord[] = [];
        for (const t of s.targets?.(rev) ?? []) {
          const r = await this.dispatch(floorId, s.decision, rev, t, groupId, s.revision?.by);
          if (typeof r === 'string') return { ok: false, status: 500, error: r };
          records.push(r);
        }
        // ---- 8, only once every dispatch settled: an unclear one waits for reconcile or a person ----
        const pending = records.some((r) => r.state === 'in-flight' || r.state === 'outcome-unknown' || r.state === 'prepared');
        if (!pending) await s.apply?.(rev, records);
        results.push({ decision: s.decision, rev, records, ...(pending ? { pending } : {}) });
      }
      return { ok: true, results };
    } finally {
      keys.forEach((k) => this.claims.delete(k));
    }
  }

  /** Steps 4 to 7 for one target: the settled record, or why it stopped (nothing typed when the intent wasn't saved). */
  async dispatch(floorId: string, decision: DecisionRef, rev: number, t: Target, groupId?: string, by?: string): Promise<DispatchRecord | string> {
    const at = this.now();
    const id = mintDispatchId(at);
    const marker = t.channel === 'github-issue' && t.proposalId ? issueMarker(t.proposalId, rev) : answerMarker(id, decision, rev, t.covers);
    let session: SessionAt = {};
    try {
      session = (await t.session?.()) ?? {};
    } catch {
      // no transcript: reconcile can't prove it, and says unknown
    }
    let r: DispatchRecord = {
      id,
      decision,
      answerRev: rev,
      ...(t.covers?.length ? { covers: t.covers } : {}),
      ...(groupId ? { groupId } : {}),
      ...(t.workerId ? { workerId: t.workerId } : {}),
      ...(t.workerName ? { workerName: t.workerName } : {}),
      ...session,
      payload: t.payload(marker),
      marker,
      channel: t.channel,
      state: 'prepared',
      ...(t.proposalId ? { proposalId: t.proposalId } : {}),
      ...(t.supersedes ? { supersedes: t.supersedes } : {}),
      createdAt: at,
      updatedAt: at,
      history: [{ state: 'prepared', at }],
    };
    try {
      r = await this.put(floorId, r, undefined, by);
      r = await this.put(floorId, this.advance(r, 'in-flight', { dispatchedAt: this.now() }), undefined, by);
    } catch (err) {
      return `The office couldn't save its record before sending (${(err as Error).message}), so nothing was sent. Check the office's data folder can be written to, then try again`;
    }
    let o: Outcome;
    try {
      o = await t.act(r);
    } catch (err) {
      // It may or may not have gone: never guessed.
      o = { state: 'outcome-unknown', note: (err as Error).message?.slice(0, 200) };
    }
    try {
      return await this.settle(floorId, r, o.state, { note: o.note, ...(o.issue ? { issue: o.issue } : {}), ...(o.state === 'submitted' ? { confirmedBy: 'system' as const } : {}) }, by);
    } catch {
      // The act happened, its outcome isn't on disk: the record stays in-flight and reconcile looks at the next start.
      return { ...r, state: 'in-flight' };
    }
  }

  /** A record moved on to `state`, its history kept. */
  advance(r: DispatchRecord, state: DispatchState, patch: Partial<DispatchRecord> & { note?: string; by?: string } = {}): DispatchRecord {
    const at = this.now();
    const { note, by, ...rest } = patch;
    return { ...r, ...rest, state, updatedAt: at, history: [...r.history, { state, at, ...(note ? { note } : {}), ...(by ? { by } : {}) }].slice(-30) };
  }

  /** Writes a record's new state (critical write), audited as dispatch.<state>. */
  async settle(floorId: string, r: DispatchRecord, state: DispatchState, patch: Partial<DispatchRecord> & { note?: string } = {}, by?: string, actor?: AuditActor): Promise<DispatchRecord> {
    return this.put(floorId, this.advance(r, state, { ...patch, ...(by ? { by } : {}) }), actor, by);
  }

  private async put(floorId: string, r: DispatchRecord, actor?: AuditActor, by?: string): Promise<DispatchRecord> {
    this.mine.add(r.id);
    await this.store.put(floorId, r);
    const word = AUDIT_WORD[r.state] ?? r.state;
    const note = r.history[r.history.length - 1]?.note;
    try {
      audit.record({
        floor: floorId,
        actor: actor ?? (r.state === 'person-confirmed-sent' || r.state === 'person-abandoned' || r.state === 'person-chose-resend' ? human(by ?? 'Someone') : office('Dispatch')),
        action: `dispatch.${word}`,
        target: { kind: 'dispatch', id: r.id, label: decisionLabel(r.decision) },
        summary: `${decisionLabel(r.decision)} rev ${r.answerRev} → ${r.workerName ?? (r.channel === 'github-issue' ? 'GitHub' : 'the agent')}: ${word}${r.state === 'person-confirmed-sent' ? ' (a person said it went through; not seen by the office)' : ''}${note ? ` (${note})` : ''}`,
        details: { channel: r.channel, state: r.state, ...(r.confirmedBy ? { confirmedBy: r.confirmedBy } : {}), ...(r.groupId ? { groupId: r.groupId } : {}), ...(r.issue?.number ? { issue: r.issue.number } : {}), length: r.payload.length },
        ids: { dispatchId: r.id, decision: r.decision, answerRev: r.answerRev },
        severity: r.state === 'outcome-unknown' ? 'warning' : 'info',
      });
    } catch {
      // the audit is a log, not the store
    }
    return r;
  }

  /** Whether a record exists and is past held / in flight (typed, refused, settled by a person…). */
  isSettled(floorId: string, id: string): boolean {
    const r = this.store.get(floorId, id);
    return !!r && r.state !== 'held' && r.state !== 'in-flight' && r.state !== 'prepared';
  }

  /** The floor's records that need the office or a person (the card, the rollback guard). */
  unsettled(floorId: string): DispatchRecord[] {
    return this.store.list(floorId).filter((r) => isUnsettled(r.state));
  }

  /** Runs the applier for a record's decision kind (step 8 after reconcile or a person's word). */
  async apply(floorId: string, r: DispatchRecord) {
    const kind = r.decision.split(':')[0];
    const fn = this.appliers.get(kind);
    if (!fn) return;
    try {
      await fn(floorId, r, this.answers.latest(floorId, r.decision)?.rev === r.answerRev ? this.answers.latest(floorId, r.decision) : (await this.answers.history(floorId, r.decision)).find((l) => l.rev === r.answerRev));
    } catch (err) {
      console.error(`agent-office: dispatch: couldn't apply ${r.id}: ${(err as Error).message}`);
    }
  }

  /** Held (or owed) dispatches about to be typed on a turn's end: marked in flight first, with where to look. Gives back the ids it could mark. */
  async beforeType(floorId: string, ids: readonly string[], session: SessionAt): Promise<Set<string>> {
    await this.store.load(floorId);
    const ok = new Set<string>();
    for (const id of ids) {
      const r = this.store.get(floorId, id);
      // Held, or marked before and not typed since (it is still in the held list, so it wasn't).
      if (!r || (r.state !== 'held' && r.state !== 'in-flight')) continue;
      try {
        await this.put(floorId, this.advance(r, 'in-flight', { ...session, dispatchedAt: this.now(), note: 'typing the held answer' }));
        ok.add(id);
      } catch {
        // not marked: not typed this time
      }
    }
    return ok;
  }

  /** Typed (held, owed or carried by a hire): settled submitted, by the office. Never throws. */
  typed(floorId: string, ids: readonly string[]): Promise<void> {
    return (async () => {
      for (const id of ids) {
        const r = this.store.get(floorId, id);
        if (!r || (r.state !== 'in-flight' && r.state !== 'held')) continue;
        await this.settle(floorId, r, 'submitted', { confirmedBy: 'system', note: 'typed' }).catch(() => undefined);
      }
    })();
  }
}
