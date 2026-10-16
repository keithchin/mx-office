// Reconcile on start (Slice 1B-1, plan §2.3): every unsettled dispatch the office finds when it starts is
// looked at once, one after another (bounded, off the event loop: the transcript reads are fs/promises):
//   - prepared, never marked in flight → not-sent (it was never attempted);
//   - held → still in the roster's held list (or still owed by its escalation): left held, typed once on the
//     agent's next turn with the same dispatch id; gone from it → the transcript decides;
//   - in-flight (typed) → the transcript decides: the typed message in the recorded session is proof
//     (submitted, confirmed by the system); one typed but not seen yet goes back to the typed-evidence watch
//     (typed-watch.ts: it may still be queued); anything else → outcome-unknown;
//   - in-flight (an issue) → the issue search: only a positive match is conclusive; no match, a search that
//     isn't available, or an inconclusive answer → outcome-unknown. Never recreated because a search came
//     back empty (GitHub's index lags).
// Nothing ambiguous is replayed: an outcome-unknown waits for a person (shared/dispatch.ts).

import type { DispatchRecord } from '../../shared/dispatch.js';
import { transcriptEvidence } from './evidence.js';
import type { Dispatcher } from './service.js';

/** The most records one start looks at per floor (the rest wait for the next start, still unsettled). */
export const RECONCILE_MAX = 200;

export interface ReconcileDeps {
  /** Whether a held dispatch is still waiting in the roster (its held list, or an escalation still owing it). */
  stillHeld(floorId: string, r: DispatchRecord): boolean;
  /**
   * The issue a proposal's marker is in: the issue when a search found it, null when the search found
   * nothing (not conclusive), undefined when it couldn't search.
   */
  findIssue?(floorId: string, r: DispatchRecord): Promise<{ number: number; url?: string } | null | undefined>;
}

export interface Reconciled {
  id: string;
  from: DispatchRecord['state'];
  to: DispatchRecord['state'];
}

/** Looks at one record; its new state, or undefined when it stays as it is. */
export async function reconcileOne(d: Dispatcher, floorId: string, r: DispatchRecord, deps: ReconcileDeps): Promise<DispatchRecord | undefined> {
  if (r.state === 'prepared') {
    if (r.dispatchedAt) return d.settle(floorId, r, 'outcome-unknown', { note: 'marked in flight but its state is unclear' });
    return d.settle(floorId, r, 'not-sent', { note: 'the office stopped before sending it' });
  }
  if (r.channel === 'github-issue') {
    if (r.state !== 'in-flight') return undefined;
    let found: { number: number; url?: string } | null | undefined;
    try {
      found = await deps.findIssue?.(floorId, r);
    } catch {
      found = undefined;
    }
    if (found) return d.settle(floorId, r, 'submitted', { confirmedBy: 'system', issue: { number: found.number, ...(found.url ? { url: found.url } : {}) }, note: `found issue #${found.number} by its marker` });
    return d.settle(floorId, r, 'outcome-unknown', { note: found === null ? 'no issue with its marker found yet (GitHub search can lag): not conclusive' : "GitHub couldn't be searched" });
  }
  if (r.state === 'held') {
    if (deps.stillHeld(floorId, r)) return undefined;
  } else if (r.state !== 'in-flight') return undefined;
  const ev = await transcriptEvidence(r);
  if (ev.found) return d.settle(floorId, r, 'submitted', { confirmedBy: 'system', note: 'found as typed in the agent’s session' });
  // Typed before the restart, not in the session yet: the typed-evidence watch takes it on (it may still be queued).
  if (r.state === 'in-flight' && r.typedAt !== undefined && ev.why === 'no-match' && d.watch) {
    d.watch(floorId, r);
    return undefined;
  }
  return d.settle(floorId, r, 'outcome-unknown', { note: ev.note });
}

/** Reconciles a floor's unsettled records; runs the decision's applier for each one now submitted. */
export async function reconcileFloor(d: Dispatcher, floorId: string, deps: ReconcileDeps): Promise<Reconciled[]> {
  await d.ready(floorId);
  const out: Reconciled[] = [];
  const todo = d.unsettled(floorId).filter((r) => (r.state === 'prepared' || r.state === 'in-flight' || r.state === 'held') && !d.mine.has(r.id)).slice(0, RECONCILE_MAX);
  for (const r of todo) {
    try {
      const next = await reconcileOne(d, floorId, r, deps);
      if (!next) continue;
      out.push({ id: r.id, from: r.state, to: next.state });
      if (next.state === 'submitted') await d.apply(floorId, next);
    } catch (err) {
      console.error(`agent-office: dispatch: couldn't reconcile ${r.id}: ${(err as Error).message}`);
    }
  }
  return out;
}
