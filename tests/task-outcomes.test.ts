// How a member's task ended (roster/task-outcome.ts, roster/resume.ts): only a merged PR or an issue
// closed as completed is delivery. A PR closed without merging is never success (replaced by a newer PR
// from the same worker, or a decision for the Project Manager in Needs you), an issue closed as not
// planned cancels the task, and an agent's own `task done` is a claim pending verification. Neither of
// those gets the back-to-work nudge: they wait for the person, as finished work does. Fake floors only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { outcomeOf, reviveAssignment, taskOutcome, type Assignment } from '../src/server/roster/resume.js';
import { BACK_GRACE_MS } from '../src/server/roster/back-to-work.js';
import { reviveRoster } from '../src/server/roster/store.js';
import type { PullLook } from '../src/server/roster/task-outcome.js';
import { markOutcomesStart, outcomesSince } from '../src/server/roster/closed-since.js';
import { closeConnections } from '../src/server/connections/store.js';

const task: Assignment = { text: 'build the Orders module (issue #5)', at: 0, by: 'Keith', issue: 5 };
const pull = (number: number, state: string, headRefName = 'feat/orders', closes: number[] = []): PullLook => ({ number, state, headRefName, closes });
// A merge counts only after the task and carrying its id (task-outcome.ts): tests/task-outcome-truth.test.ts walks that rule.
const ID = 'tsk_01M526SK6TXBBJ53EAPEDG0FQQ';
const owned: Assignment = { ...task, taskId: ID };
const merged = (number: number, headRefName = 'feat/orders', closes: number[] = [], id = ID): PullLook => ({ ...pull(number, 'MERGED', headRefName, closes), mergedAt: '2026-10-16T12:00:00Z', body: `Work.

Task: ${id}` });

// ---- The rules, pure ----------------------------------------------------------------------------------------

test('T1: a PR closed without merging is never success: replaced by a newer PR from the same worker, else a decision', () => {
  // Nothing replaced it: the Project Manager decides.
  assert.deepEqual(taskOutcome({ task, pr: { number: 9 }, pulls: [pull(9, 'CLOSED')] }), { kind: 'decision', why: 'PR #9 was closed without merging', pr: 9 });
  // A newer open PR from the same branch carries the work on: still open, superseded.
  const open = taskOutcome({ task, pr: { number: 9 }, pulls: [pull(9, 'CLOSED'), pull(12, 'OPEN')] });
  assert.equal(open?.kind, 'superseded');
  assert.deepEqual(open && 'by' in open ? [open.pr, open.by] : [], [9, 12]);
  // A newer merged one from the worker's own branch: integrated, by that PR.
  const replaced = taskOutcome({ task: owned, pr: { number: 9 }, branch: 'feat/orders-2', pulls: [pull(9, 'CLOSED'), merged(14, 'feat/orders-2', [5])] });
  assert.equal(replaced?.kind, 'integrated');
  assert.equal(replaced?.why, 'PR #14 merged (it replaced PR #9, closed unmerged)');
  // Not a replacement: someone else's branch, an older PR, or one for another issue.
  for (const other of [pull(12, 'OPEN', 'feat/someone-else'), pull(7, 'MERGED'), pull(12, 'OPEN', 'feat/orders', [8])]) {
    assert.equal(taskOutcome({ task, pr: { number: 9 }, pulls: [pull(9, 'CLOSED'), other] })?.kind, 'decision', JSON.stringify(other));
  }
  // Closed with "task done" said too: still a decision, not a claim.
  assert.equal(taskOutcome({ task, pr: { number: 9 }, pulls: [pull(9, 'CLOSED')], lastWords: 'Task done.' })?.kind, 'decision');
});

test('T2: an agent saying task done alone is a claim pending verification; a merged PR is integrated', () => {
  assert.deepEqual(taskOutcome({ task, lastWords: 'Task done: Orders is on the branch.' }), { kind: 'claimed', why: 'it said task done (pending verification)' });
  assert.equal(taskOutcome({ task, pr: { number: 9 }, pulls: [pull(9, 'OPEN')], lastWords: 'Task done.' })?.kind, 'claimed', 'an open PR verifies nothing');
  assert.deepEqual(taskOutcome({ task: owned, pr: { number: 9 }, pulls: [merged(9)] }), { kind: 'integrated', why: 'PR #9 merged', pr: 9 });
  // A claim stands until something stronger: a merge then integrates it.
  const claimed: Assignment = { ...owned, pending: { kind: 'claimed', at: 1, why: 'it said task done (pending verification)' } };
  assert.equal(taskOutcome({ task: claimed, lastWords: 'Working on tests' })?.kind, 'claimed');
  assert.equal(taskOutcome({ task: claimed, pr: { number: 9 }, pulls: [merged(9)] })?.kind, 'integrated');
  // A decision stands while the PR stays closed, or falls out of the list; it reopens when the PR is open again.
  const deciding: Assignment = { ...task, pending: { kind: 'decision', at: 1, why: 'PR #9 was closed without merging', pr: 9 } };
  assert.equal(taskOutcome({ task: deciding, pr: { number: 9 }, pulls: [] })?.kind, 'decision');
  assert.equal(taskOutcome({ task: deciding, pr: { number: 9 }, pulls: [pull(9, 'OPEN')] }), undefined, 'reopened: back to work');
});

test('an issue closed as not planned (or a duplicate) cancels the task; completed, or no reason given, delivers it', () => {
  const closed = (reason: string) => new Map([[5, reason]]);
  assert.deepEqual(taskOutcome({ task, closed: closed('NOT_PLANNED') }), { kind: 'cancelled', why: 'issue #5 closed as not planned', issue: 5, closeReason: 'NOT_PLANNED' });
  assert.equal(taskOutcome({ task, closed: closed('DUPLICATE') })?.kind, 'cancelled');
  assert.deepEqual(taskOutcome({ task, closed: closed('COMPLETED') }), { kind: 'delivered', why: 'issue #5 closed', issue: 5, closeReason: 'COMPLETED' });
  assert.deepEqual(taskOutcome({ task, closed: closed('') }), { kind: 'delivered', why: 'issue #5 closed', issue: 5 });
});

test('old task records load as they were: a doneAt with no outcome is legacy; the new fields survive a save', async () => {
  const legacy = reviveAssignment({ text: 'issue #1', at: 1, by: 'K', issue: 1, doneAt: 2, doneWhy: 'PR #9 is no longer open' })!;
  assert.deepEqual(legacy, { text: 'issue #1', at: 1, by: 'K', issue: 1, doneAt: 2, doneWhy: 'PR #9 is no longer open' }, 'nothing added or rewritten');
  assert.equal(outcomeOf(legacy), 'legacy');
  assert.equal(taskOutcome({ task: legacy, pr: { number: 9 }, pulls: [pull(9, 'OPEN')] })?.why, 'PR #9 is no longer open', 'a finished record is never re-judged');
  const saved = { text: 'x', at: 1, by: 'K', v: 2, pending: { kind: 'decision', at: 3, why: 'PR #9 was closed without merging', pr: 9, escalationId: 'abc' }, superseded: { pr: 4, by: 9 } };
  assert.deepEqual(JSON.parse(JSON.stringify(reviveAssignment(saved))), saved);
  assert.equal(outcomeOf(reviveAssignment(saved)!), 'decision');
  assert.equal(reviveAssignment({ ...saved, pending: { kind: 'bogus', at: 3 } })?.pending, undefined);
  assert.equal(outcomeOf(reviveAssignment({ text: 'x', at: 1, doneAt: 2, outcome: 'cancelled', v: 2 })!), 'cancelled');
  assert.equal(reviveRoster({ members: { 'lead-developer': { name: 'Grace', phase: 'active', task: legacy } } }).members['lead-developer'].task?.doneWhy, 'PR #9 is no longer open');
});

// ---- On a fake floor: the nudge, Needs you, and what counts --------------------------------------------------

class FakeFloor implements TeamFloor {
  id = `outcome-${Math.random().toString(36).slice(2, 8)}`;
  name = 'outcomes-test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'outcome-floor-'));
  map = new Map<string, WorkerInfo>();
  typed: { id: string; text: string }[] = [];
  activities: string[] = [];
  list: PullLook[] = [];
  lastWords?: (w: WorkerInfo) => string | undefined;
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo> {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: this.roster.deps.now(), cols: 80, rows: 24, viewers: [], viewerIds: [], worktree: { path: `wt/${id}`, branch: 'feat/orders', base: 'main' } } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.map.delete(id);
    this.roster.onWorkerGone(this, id);
  }
  prompt(id: string, text: string) {
    this.typed.push({ id, text });
    return undefined;
  }
  wake() {
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => this.list.filter((p) => p.state === 'OPEN').map((p) => ({ number: p.number, title: `PR ${p.number}`, url: '', headRefName: p.headRefName ?? '' }));
  pulls = () => this.list;
  toast = () => {};
  changed = () => {};
  activity = (text: string) => void this.activities.push(text);
  set(id: string, status: WorkerStatus) {
    Object.assign(this.map.get(id)!, { status });
    this.roster.onWorker(this, this.map.get(id)!);
  }
}

async function office() {
  const clock = { now: Date.UTC(2026, 9, 7, 6, 0) };
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'outcome-data-')), floors: () => [floor], makeIssue: async () => ({ number: 2 }), analysis: () => '', now: () => clock.now }, 0);
  floor.roster = roster;
  assert.equal(await roster.members.hire(floor, 'lead-developer', 'Keith', undefined, 'build the Orders module (issue #5)'), undefined);
  const id = roster.data(floor.id).members['lead-developer'].workerId!;
  const w = floor.worker(id)!;
  floor.set(id, 'working');
  /** Her turn ends and the back-to-work debounce fires: whether she was nudged. */
  const stop = () => {
    floor.set(id, 'done');
    clock.now += BACK_GRACE_MS + 1000;
    const nudged = roster.backToWork.check(floor, 'lead-developer');
    floor.set(id, 'working');
    return nudged;
  };
  const t = () => roster.data(floor.id).members['lead-developer'].task!;
  const member = () => roster.view(floor, true).members.find((m) => m.role === 'lead-developer')!;
  return { clock, floor, roster, id, w, stop, t, member };
}

test('a claim pending verification gets no keep-working nudge, and a merge later turns it into integrated', async () => {
  const { floor, roster, w, stop, t, member } = await office();
  assert.equal(stop(), true, 'an open task: nudged');
  floor.lastWords = () => 'Task done: Orders is on feat/orders.';
  assert.equal(stop(), false, 'claimed: not nudged');
  assert.equal(outcomeOf(t()), 'claimed');
  assert.equal(t().doneAt, undefined, 'not finished, not delivered');
  assert.equal(member().task, undefined, 'not "idle with an open task" in Needs you');
  assert.ok(floor.activities.some((a) => /pending verification/.test(a)));
  floor.lastWords = () => 'Waiting for review.';
  assert.equal(stop(), false, 'still claimed on later stops: no endless loop');
  assert.match(roster.tasks.line(floor, w), /waits on the Project Manager \(it said task done \(pending verification\)\), so don't carry on with it/);
  // The PR merges: integrated, from the PR list alone (no agent words needed).
  w.pr = { number: 21, url: '' };
  floor.list = [merged(21, 'feat/orders', [], t().taskId)];
  assert.equal(roster.tasks.current(floor, w), undefined);
  assert.deepEqual([outcomeOf(t()), t().doneWhy, t().pr, t().v], ['integrated', 'PR #21 merged', 21, 2]);
  roster.stop();
});

test('a PR closed unmerged raises one decision in Needs you, is never delivered, and gets no nudge; a replacement PR reopens the work', async () => {
  const { floor, roster, w, stop, t } = await office();
  w.pr = { number: 9, url: '' };
  floor.list = [pull(9, 'CLOSED')];
  assert.equal(stop(), false, 'awaiting the decision: not nudged');
  assert.equal(outcomeOf(t()), 'decision');
  assert.equal(t().doneAt, undefined);
  const open = roster.data(floor.id).escalations.filter((e) => e.status === 'open');
  assert.equal(open.length, 1);
  assert.equal(open[0].title, 'PR #9 was closed without merging: rework, cancel, or replaced?');
  assert.equal(open[0].fyi, false, 'in Needs you, not filed as FYI');
  assert.equal(t().pending?.escalationId, open[0].id);
  // Answered: still no nudge loop, and no second escalation.
  assert.equal(await roster.escalations.resolve(floor, open[0].id, 'reply', 'Leave it for now', 'Keith'), undefined);
  assert.equal(stop(), false, 'answered, still waiting on the person');
  assert.equal(roster.data(floor.id).escalations.length, 1, 'asked once');
  // She opens a new PR from her branch: superseded, and the task is open again.
  floor.list = [pull(9, 'CLOSED'), pull(12, 'OPEN')];
  assert.equal(roster.tasks.current(floor, w), 'build the Orders module (issue #5)');
  assert.deepEqual(t().superseded, { pr: 9, by: 12 });
  assert.equal(t().pending, undefined);
  assert.equal(stop(), true, 'work carries on: the usual nudge');
  roster.stop();
});

test('an issue closed as not planned cancels the task: finished, not delivered, no nudge', async () => {
  const { floor, roster, stop, t } = await office();
  roster.onIssues(floor, [{ number: 5, title: 'Orders', state: 'CLOSED', stateReason: 'NOT_PLANNED', body: '', labels: [] }]);
  assert.equal(stop(), false);
  assert.deepEqual([outcomeOf(t()), t().doneWhy, t().closeReason], ['cancelled', 'issue #5 closed as not planned', 'NOT_PLANNED']);
  roster.stop();
});

// ---- Release 39: PRs closed before task outcomes started on this office raise nothing ----------------------

test('a PR closed unmerged before the office started with outcomes is no decision; one closed after is', () => {
  const since = Date.UTC(2026, 9, 13, 8);
  const closed = (number: number, closedAt?: string): PullLook => ({ ...pull(number, 'CLOSED'), ...(closedAt ? { closedAt } : {}) });
  const old = closed(9, '2026-09-30T10:00:00Z');
  assert.equal(taskOutcome({ task, pr: { number: 9 }, pulls: [old], closedSince: since }), undefined, 'closed before: the task stays as it was (open)');
  assert.equal(taskOutcome({ task, pr: { number: 9 }, pulls: [old], closedSince: since, lastWords: 'Task done.' })?.kind, 'claimed', 'a claim still counts');
  assert.equal(taskOutcome({ task, pr: { number: 9 }, pulls: [closed(9)], closedSince: since }), undefined, 'no close time known: no card');
  assert.equal(taskOutcome({ task, pr: { number: 9 }, pulls: [closed(9, '2026-10-13T09:00:00Z')], closedSince: since })?.kind, 'decision', 'closed after: the decision');
  assert.equal(taskOutcome({ task, pr: { number: 9 }, pulls: [old] })?.kind, 'decision', 'no start known (unit seams): as before');
  // Superseding is unchanged by it.
  assert.equal(taskOutcome({ task, pr: { number: 9 }, pulls: [old, pull(12, 'OPEN')], closedSince: since })?.kind, 'superseded');
});

test('on a floor: an old closed-unmerged PR raises nothing and the task carries on; a newly closed one raises the decision once', async () => {
  const start = markOutcomesStart(Date.UTC(2026, 9, 7, 5, 0));
  try {
    assert.equal(markOutcomesStart(Date.UTC(2027, 0, 1)), start, 'stamped once, never moved');
    assert.equal(outcomesSince(), start);
    const { floor, roster, w, stop, t } = await office();
    w.pr = { number: 9, url: '' };
    floor.list = [{ ...pull(9, 'CLOSED'), closedAt: '2026-10-01T12:00:00Z' }];
    assert.equal(stop(), true, 'closed before the start: an open task, nudged as before');
    assert.equal(outcomeOf(t()), 'open');
    assert.equal(roster.data(floor.id).escalations.length, 0, 'no card for it');
    // Her next PR is closed unmerged after the start: the decision, once.
    w.pr = { number: 10, url: '' };
    floor.list = [{ ...pull(9, 'CLOSED'), closedAt: '2026-10-01T12:00:00Z' }, { ...pull(10, 'CLOSED', 'feat/other'), closedAt: '2026-10-07T07:00:00Z' }];
    assert.equal(stop(), false, 'awaiting the decision');
    assert.equal(outcomeOf(t()), 'decision');
    assert.equal(stop(), false);
    const asks = roster.data(floor.id).escalations;
    assert.equal(asks.length, 1, 'raised once');
    assert.equal(asks[0].title, 'PR #10 was closed without merging: rework, cancel, or replaced?');
    roster.stop();
  } finally {
    closeConnections();
  }
});

test('real-build fix: a change request to a lead mid-build is a note on top of its work, and "task done" for it sends the lead back to the build, never to a stop', async () => {
  const { floor, roster, w, stop, t } = await office();
  assert.equal(t().text, 'build the Orders module (issue #5)');
  const buildId = t().taskId;
  // A DC arrives while the lead is building (change-requests/index.ts records it as a request task).
  assert.equal(roster.tasks.assign(floor, w.id, 'Change request CR-1 from Pat: rename the New button to Add equipment item', 'Pat', 'request'), true);
  assert.match(t().text, /CR-1/);
  assert.equal(roster.tasks.ongoing(floor, w)?.text, 'build the Orders module (issue #5)', 'the build is kept, not superseded');
  // The nudge names the note but tells it the build carries on.
  floor.typed.length = 0;
  assert.equal(stop(), true);
  const nudge = floor.typed.at(-1)?.text ?? '';
  assert.match(nudge, /note on top of your ongoing work \(build the Orders module \(issue #5\)\)/);
  assert.match(nudge, /don't stop that work/);
  assert.doesNotMatch(nudge, /then stop\./);
  // The lead says task done for the note: the office sends it back to the build.
  floor.lastWords = () => 'Task done: CR-1 renamed the button.';
  floor.typed.length = 0;
  assert.equal(stop(), true, 'nudged back to the build');
  assert.equal(t().text, 'build the Orders module (issue #5)');
  assert.equal(t().taskId, buildId);
  assert.match(floor.typed.at(-1)?.text ?? '', /You stopped with build the Orders module/);
  assert.equal(roster.tasks.ongoing(floor, w), undefined);
  roster.stop();
});

test('real-build fix: a task the PM gives (not a change note) still replaces the old one as before', async () => {
  const { floor, roster, w, t } = await office();
  assert.equal(roster.tasks.assign(floor, w.id, 'Stop the Orders work and start on the Invoices module now', 'Pat', 'console'), true);
  assert.equal(roster.tasks.ongoing(floor, w), undefined);
  assert.match(t().text, /Invoices/);
  roster.stop();
});
