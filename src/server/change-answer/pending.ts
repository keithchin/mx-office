// Pending changes (Slice 1B-3, and 1B-2's Send correction): a new revision whose dispatch hasn't settled yet.
// Durable intent plus reconciliation means the decision's own record moves to the new revision only once
// its dispatch settled, and that has to survive a restart. So, before anything is typed (inside the
// target's act, once the dispatch record exists), the pending entry is written with the critical write
// (<data>/change-answer/<project>.pending.json: fsync'd, atomic rename) or nothing is sent. Afterwards:
//   - settled as typed (system-confirmed, held, or a person's "It went through"): its handler moves the
//     decision to the new revision, and the entry is cleared;
//   - abandoned, not sent, refused or failed: the decision stays on the old revision, the entry is cleared,
//     and the audit says so;
//   - Send again: the entry follows the new attempt;
//   - outcome unknown: nothing moves, ever, until one of the above.
// It hears the dispatcher through its hooks (dispatch/service.ts), and sweep() looks at what a restart left
// once the start's reconcile has run. One per dispatcher (pendingFor), shared by Change answer and Send correction.

import path from 'node:path';
import { loadJson } from '../durable/read.js';
import type { AuditInput } from '../../shared/audit.js';
import { decisionLabel, type DecisionRef, type DispatchRecord, type DispatchState } from '../../shared/dispatch.js';
import type { Dispatcher, Outcome, Target } from '../dispatch/service.js';
import { writeJsonCritical } from '../flow/critical-write.js';

export type PendingKind = 'change' | 'correction';

export interface PendingEntry {
  decision: DecisionRef;
  fromRev: number;
  toRev: number;
  dispatchId: string;
  kind: PendingKind;
  at: number;
  /** What the handler needs to move the decision on (the new answer's verdict or kind, text, who, the dispatch replaced). */
  input: Record<string, unknown>;
}

/** Moves the decision to entry.toRev, given the record that carried it; idempotent (a decision already past fromRev is left). */
export type PendingHandler = (floorId: string, e: PendingEntry, r: DispatchRecord) => Promise<void>;

const TYPED: ReadonlySet<DispatchState> = new Set(['submitted', 'held', 'person-confirmed-sent']);
const DROPPED: ReadonlySet<DispatchState> = new Set(['person-abandoned', 'not-sent', 'refused', 'failed']);

export class PendingAnswers {
  private floors = new Map<string, Promise<PendingEntry[]>>();
  private chains = new Map<string, Promise<unknown>>();
  private handlers = new Map<PendingKind, PendingHandler>();
  /** Audit lines go here (the office's audit; a test's list). */
  record: (e: AuditInput) => void = () => {};

  constructor(
    readonly dir: string,
    private readonly dispatcher: Dispatcher,
  ) {
    // A stand-in dispatcher (a test's) may have no hooks: then nothing settles later.
    dispatcher.hooks?.add({ apply: (f, r) => this.typed(f, r), settled: (f, r) => this.settled(f, r) });
  }

  register(kind: PendingKind, fn: PendingHandler) {
    this.handlers.set(kind, fn);
  }

  private file(floorId: string) {
    return path.join(this.dir, `${floorId.replace(/[^A-Za-z0-9_-]/g, '_')}.pending.json`);
  }

  /** The floor's pending entries, read once from disk. */
  list(floorId: string): Promise<PendingEntry[]> {
    let p = this.floors.get(floorId);
    if (!p) {
      // Only a missing file is empty; a locked one rejects and is read again next time (durable/read.ts).
      p = loadJson(
        this.file(floorId),
        (v) => (Array.isArray(v) ? (v as PendingEntry[]).filter((x) => x && typeof x.dispatchId === 'string' && typeof x.decision === 'string') : []),
        () => this.floors.delete(floorId),
      );
      this.floors.set(floorId, p);
    }
    return p;
  }

  /** One change to the floor's list, written with the critical write before it resolves (one at a time per floor). */
  private edit(floorId: string, fn: (list: PendingEntry[]) => PendingEntry[]): Promise<void> {
    const prev = this.chains.get(floorId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const list = await this.list(floorId);
        const out = fn([...list]);
        await writeJsonCritical(this.file(floorId), out);
        this.floors.set(floorId, Promise.resolve(out));
      });
    this.chains.set(floorId, next);
    return next;
  }

  put(floorId: string, e: PendingEntry): Promise<void> {
    return this.edit(floorId, (l) => [...l.filter((x) => x.decision !== e.decision), e]);
  }

  clear(floorId: string, dispatchId: string): Promise<void> {
    return this.edit(floorId, (l) => l.filter((x) => x.dispatchId !== dispatchId));
  }

  /**
   * The target with its act guarded: the pending entry is on disk before the real act runs (with the dispatch
   * id it carries), or nothing is sent and the dispatch is failed.
   */
  guard(floorId: string, t: Target, e: Omit<PendingEntry, 'dispatchId'>): Target {
    return {
      ...t,
      act: async (r): Promise<Outcome> => {
        try {
          await this.put(floorId, { ...e, dispatchId: r.id });
        } catch (err) {
          return { state: 'failed', note: `the pending change couldn't be saved (${(err as Error).message}), so nothing was sent` };
        }
        return t.act(r);
      },
    };
  }

  private async find(floorId: string, r: DispatchRecord) {
    const list = await this.list(floorId);
    return list.find((x) => x.dispatchId === r.id) ?? (r.supersedes ? list.find((x) => x.dispatchId === r.supersedes) : undefined);
  }

  /** A record settled as typed (the dispatcher's apply): a pending change's decision moves on. True when it was one. */
  private async typed(floorId: string, r: DispatchRecord): Promise<boolean> {
    if (!TYPED.has(r.state)) return false;
    const e = await this.find(floorId, r);
    if (!e) return false;
    const fn = this.handlers.get(e.kind);
    if (!fn) return false;
    await fn(floorId, e, r);
    await this.clear(floorId, e.dispatchId);
    return true;
  }

  /** Every write of a record: Send again moves the entry to the new attempt; a dropped one clears it (the decision stays). */
  private async settled(floorId: string, r: DispatchRecord): Promise<void> {
    if (r.state !== 'person-chose-resend' && !DROPPED.has(r.state)) return;
    const e = (await this.list(floorId)).find((x) => x.dispatchId === r.id);
    if (!e) return;
    if (r.state === 'person-chose-resend') {
      if (r.supersededBy) await this.put(floorId, { ...e, dispatchId: r.supersededBy });
      return;
    }
    await this.clear(floorId, e.dispatchId);
    this.record({ floor: floorId, actor: { kind: 'office', name: 'Dispatch' }, action: 'answer.change-dropped', target: { kind: 'dispatch', id: r.id, label: decisionLabel(e.decision) }, summary: `${decisionLabel(e.decision)} stays at rev ${e.fromRev}: the ${e.kind} to rev ${e.toRev} was ${r.state === 'person-abandoned' ? 'abandoned' : r.state === 'not-sent' ? 'never sent' : r.state} (rev ${e.toRev} stays in the history)`, details: { kind: e.kind, fromRev: e.fromRev, toRev: e.toRev, state: r.state }, ids: { decision: e.decision, answerRev: e.toRev, dispatchId: r.id }, severity: 'notice' });
  }

  /** What a restart left, once the start's reconcile ran: settled entries finished, dropped ones cleared, unknown ones kept. */
  async sweep(floorId: string): Promise<void> {
    await this.dispatcher.ready(floorId);
    for (const e of [...(await this.list(floorId))]) {
      let r = this.dispatcher.store.get(floorId, e.dispatchId);
      // Send again happened, but the entry wasn't moved before the office stopped.
      for (let i = 0; r?.state === 'person-chose-resend' && r.supersededBy && i < 10; i++) {
        await this.put(floorId, { ...e, dispatchId: r.supersededBy });
        e.dispatchId = r.supersededBy;
        r = this.dispatcher.store.get(floorId, r.supersededBy);
      }
      if (!r) continue;
      if (TYPED.has(r.state)) await this.typed(floorId, r);
      else if (DROPPED.has(r.state)) await this.settled(floorId, r);
    }
  }
}

const made = new WeakMap<Dispatcher, PendingAnswers>();

/** The dispatcher's pending changes (one per dispatcher, so a restart's new dispatcher gets its own, read from disk). */
export function pendingFor(dataDir: string, dispatcher: Dispatcher): PendingAnswers {
  let p = made.get(dispatcher);
  if (!p) made.set(dispatcher, (p = new PendingAnswers(path.join(dataDir, 'change-answer'), dispatcher)));
  return p;
}
