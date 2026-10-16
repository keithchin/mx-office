// What the roster gives the dispatcher (server/dispatch/): step 8 for records settled after the answer
// (reconcile found the typed message, a person said "It went through", Send again went), what reconcile
// asks of the roster (is a held dispatch still in the held list, or still owed by its escalation?), and the
// start's reconcile of every floor. Nothing here re-sends anything by itself: durable intent plus
// reconciliation, and no automatic replay of an ambiguous attempt.

import type { AnswerRevisionKind, DispatchRecord, DispatchTask } from '../../shared/dispatch.js';
import { taskIdIn } from '../../shared/tasks.js';
import type { EscalationOutcome, EscalationVerdict } from '../../shared/roster/escalation.js';
import type { AnswerLine } from '../answers/store.js';
import { reconcileFloor, type Reconciled } from '../dispatch/reconcile.js';
import { audit, office } from '../audit/index.js';
import { stillOwed } from './escalation-answer.js';
import type { Roster } from './index.js';

const VERDICT_OF: Partial<Record<AnswerRevisionKind, { verdict: EscalationVerdict; outcome?: EscalationOutcome }>> = { approve: { verdict: 'approve' }, reject: { verdict: 'reject' }, reply: { verdict: 'reply' }, moot: { verdict: 'dismiss' }, noted: { verdict: 'dismiss', outcome: 'noted' }, done: { verdict: 'reply', outcome: 'done' } };

/** An escalation's answer that reached its agent after all: resolved now, pointing at the revision and the dispatch. */
async function applyEscalation(roster: Roster, floorId: string, r: DispatchRecord, line: AnswerLine | undefined) {
  const d = roster.data(floorId);
  const e = d.escalations.find((x) => `esc:${x.id}` === r.decision);
  if (!e) return;
  const also = e.also?.find((x) => x.dispatchId === r.id || (r.workerId && x.workerId === r.workerId));
  if (e.status === 'open') {
    const v = line && VERDICT_OF[line.kind];
    if (!line || !v) return;
    const raiser = !also;
    e.status = 'resolved';
    e.resolution = { verdict: v.verdict, text: line.text.slice(0, 4000), by: line.by, at: line.at, delivered: raiser, ...(v.outcome ? { outcome: v.outcome } : {}), answerRev: r.answerRev, ...(raiser ? { dispatchId: r.id } : {}) };
    audit.record({ floor: floorId, actor: office('Dispatch'), action: 'escalation.answer', target: { kind: 'escalation', id: e.id, label: e.title }, summary: `Resolved from its answer revision once the dispatch settled (${r.state === 'person-confirmed-sent' ? 'a person said it went through' : 'found as typed'}): ${e.title}`, details: { verdict: v.outcome ?? v.verdict, delivered: raiser, answerRev: r.answerRev, settledBy: r.confirmedBy ?? 'system' }, ids: { decision: r.decision, answerRev: r.answerRev, dispatchId: r.id } });
  } else if (e.resolution?.dispatchId === r.id) e.resolution.delivered = true;
  if (also && also.dispatchId === r.id) delete also.pending;
  const floor = roster.deps.floors().find((f) => f.id === floorId);
  if (floor) roster.touch(floor);
  await roster
    .file(floorId)
    .flushCritical()
    .catch(() => undefined);
}

/** The roster's appliers, and what reconcile asks of it. */
export function hookDispatch(roster: Roster) {
  roster.dispatch.appliers.set('esc', (floorId, r, line) => applyEscalation(roster, floorId, r, line));
  // Slice 1B-4: each dispatch to a member captures the task it's on (a candidate link, legacy ones without an id).
  roster.dispatch.taskAt = (floorId, workerId) => memberTaskAt(roster, floorId, workerId);
  roster.dispatch.hooks.add({ settled: (floorId, r) => attemptFromDispatch(roster, floorId, r) });
}

/** The states in which a dispatch is known to have reached its agent (typed, or a person said so). */
const REACHED = new Set<DispatchRecord['state']>(['submitted', 'person-confirmed-sent']);

/**
 * A dispatch that handed over a task (its ids in the record, written before typing) and is now known to have
 * reached its agent: the attempt is on the task's record with the execution id the record carries. Usually it's
 * there already (the sender assigned it); after a restart, or "It went through" on an unclear one, this is
 * what puts it there. Never types anything; an unclear dispatch stays unclear until a person settles it.
 */
export async function attemptFromDispatch(roster: Roster, floorId: string, r: DispatchRecord): Promise<void> {
  const t = r.task;
  // Only one that handed the task over (its Task: line in what was typed), not one that captured the recipient's task.
  if (r.channel !== 'type' || !REACHED.has(r.state) || !t?.taskId || !t.executionId || !r.workerId || taskIdIn(r.payload) !== t.taskId) return;
  const store = roster.tasks.ids.of(floorId);
  await store.load(floorId);
  if (!store.has(floorId, t.taskId)) return;
  const floor = roster.deps.floors().find((f) => f.id === floorId);
  const role = floor ? roster.roleOf(floor, r.workerId) : undefined;
  store.attempt(floorId, t.taskId, { worker: r.workerId, ...(role ? { role } : {}), executionId: t.executionId });
}

/** A member's open task as a dispatch captures it: its ids, first line, branch and PR. */
export function memberTaskAt(roster: Roster, floorId: string, workerId: string): DispatchTask | undefined {
  const floor = roster.deps.floors().find((f) => f.id === floorId);
  if (!floor) return undefined;
  const role = roster.roleOf(floor, workerId);
  const t = role ? roster.data(floorId).members[role].task : undefined;
  if (!t || t.doneAt !== undefined) return undefined;
  const w = floor.worker(workerId);
  return { ...(t.taskId ? { taskId: t.taskId } : {}), ...(t.executionId ? { executionId: t.executionId } : {}), text: t.text, ...(w?.worktree?.branch ? { branch: w.worktree.branch } : {}), ...(w?.pr?.number ? { pr: w.pr.number } : {}) };
}

/** Whether a held dispatch is still waiting: in the held list (its id), or owed by its escalation. */
export function stillHeld(roster: Roster, floorId: string, r: DispatchRecord): boolean {
  return roster.data(floorId).held.some((h) => h.dispatchId === r.id || h.id === r.id) || stillOwed(roster, floorId, r);
}

/** The start's reconcile, every floor one after another; what changed. Never throws. */
export async function reconcileAll(roster: Roster): Promise<Reconciled[]> {
  const out: Reconciled[] = [];
  for (const f of roster.deps.floors()) {
    try {
      out.push(
        ...(await reconcileFloor(roster.dispatch, f.id, {
          stillHeld: (floorId, r) => stillHeld(roster, floorId, r),
          findIssue: roster.deps.findIssue ? (floorId, r) => roster.deps.findIssue!(f.dir, r.marker) : undefined,
        })),
      );
    } catch (err) {
      console.error(`agent-office: dispatch: couldn't reconcile ${f.id}: ${(err as Error).message}`);
    }
    // A task handed over by a dispatch that reached its agent before the restart, its attempt not on the task's
    // record (the process stopped first): put there from the dispatch record, which had the ids before typing.
    for (const r of roster.dispatch.store.list(f.id)) await attemptFromDispatch(roster, f.id, r).catch(() => undefined);
  }
  return out;
}
