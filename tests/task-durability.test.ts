// Task identity durability (reliability pass, docs: task-identity-durability.md): nothing is sent with a new
// task id before the task's record has it on disk; a failed write stops the send with an honest error;
// flushed() reports lost lines; the dispatch record carries the task's ids before typing, and a restart
// recovers the attempt from it; an ambiguous send is never replayed. Fake floors, no agents, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditInput } from '../src/shared/audit.js';
import type { DispatchRecord } from '../src/shared/dispatch.js';
import type { Proposal } from '../src/shared/roster/types.js';
import { taskIdIn, withTaskLine } from '../src/shared/tasks.js';
import { useAudit } from '../src/server/audit/index.js';
import { TaskStore, type TaskFs } from '../src/server/tasks/store.js';
import { taskStoreAt } from '../src/server/tasks/index.js';
import { queueTaskIds } from '../src/server/tasks/queue.js';
import { attemptFromDispatch } from '../src/server/roster/dispatch-hooks.js';
import { personAct } from '../src/server/roster/dispatch-person.js';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { FakeFloor, crashAndRestart, failWritesFrom, office, records } from './dispatch-helpers.js';

const events: AuditInput[] = [];
useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);

/** File operations whose appends fail while `fail()` says so (from the `from`th open on). */
function flakyFs(fail: (n: number) => boolean): TaskFs {
  let n = 0;
  return { open: ((...a: Parameters<typeof fsp.open>) => (fail(++n) ? Promise.reject(new Error('disk full')) : fsp.open(...a))) as typeof fsp.open, mkdir: fsp.mkdir, readFile: fsp.readFile };
}
/** The roster's task store (one per data folder) with its file operations swapped. */
const breakTasks = (dataDir: string, fs: TaskFs) => Object.assign(taskStoreAt(dataDir) as unknown as { fs: TaskFs }, { fs });

const STUCK = 'Unblock PR #12: rebase it onto main and fix the failing checkout test';

/** A floor whose Coordinator (pm) is at work. */
function withCoordinator() {
  const floor = new FakeFloor();
  const o = office(floor);
  const pm = floor.add('p1', 'Niklaus', 'idle');
  const d = o.roster.data(floor.id);
  d.members.pm = { ...d.members.pm, phase: 'active', workerId: pm };
  // The hire is on disk (as a real one is long before a task is typed).
  o.roster.flush();
  return { floor, o, pm };
}

test('store-write-failure: createDurable rejects and forgets the task; flushed() reports the lost line (and keeps saying so)', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'td-store-'));
  let broken = true;
  const s = new TaskStore(dir, flakyFs(() => broken));
  await assert.rejects(s.createDurable('f1', { source: 'console', text: 'Build the checkout' }), /disk full/);
  assert.equal((await s.all('f1')).length, 0, 'not known in memory either');
  assert.deepEqual(await s.flushed('f1'), { ok: false, failed: 1, error: 'disk full' });
  // A plain create is in memory at once; durable() is what a sender waits for, and it says the line was lost.
  const t = s.create('f1', { source: 'console', text: 'Another' });
  await assert.rejects(s.durable('f1', t.id), /disk full/);
  assert.equal(s.has('f1', t.id), false);
  broken = false;
  const ok = await s.createDurable('f1', { source: 'console', text: 'Third' });
  assert.equal((await s.flushed('f1')).ok, false, 'a lost line stays lost');
  assert.deepEqual((await new TaskStore(dir).all('f1')).map((x) => x.id), [ok.id], 'only what reached the disk reads back');
  // An id this process didn't make (from the file) is durable.
  await new TaskStore(dir).durable('f1', ok.id);
  const fine = new TaskStore(mkdtempSync(path.join(os.tmpdir(), 'td-store-')));
  fine.create('f2', { source: 'queue', text: 'x' });
  assert.deepEqual(await fine.flushed('f2'), { ok: true });
});

test('attempt-idempotent: an execution id minted before the send is written once', async () => {
  const s = new TaskStore(mkdtempSync(path.join(os.tmpdir(), 'td-store-')));
  const t = await s.createDurable('f1', { source: 'mcr', text: 'MCR-1' });
  assert.equal(s.attempt('f1', t.id, { worker: 'a1', executionId: 'exe_01M51QWRVJJTX3VQ4SYXRYQP2B' }), 'exe_01M51QWRVJJTX3VQ4SYXRYQP2B');
  assert.equal(s.attempt('f1', t.id, { worker: 'a1', executionId: 'exe_01M51QWRVJJTX3VQ4SYXRYQP2B' }), 'exe_01M51QWRVJJTX3VQ4SYXRYQP2B');
  assert.equal(s.get('f1', t.id)!.events.length, 1);
});

test('stuck-ask-write-failure: the task record can\'t be written → nothing typed, no answer, no dispatch; an honest error, audited', async () => {
  const { floor, o } = withCoordinator();
  breakTasks(o.dataDir, flakyFs(() => true));
  events.length = 0;
  const err = await o.roster.interrupts.tell(floor, STUCK, 'Keith', 'now', {}, undefined, 'stuck:abc');
  assert.match(String(err), /couldn't save the task's record \(disk full\), so nothing was sent/);
  assert.equal(floor.prompts.length, 0);
  assert.equal(records(o, floor).length, 0);
  assert.equal(o.roster.dispatch.answers.rev(floor.id, 'stuck:abc'), 0);
  assert.equal(o.roster.data(floor.id).members.pm.task, undefined);
  assert.ok(events.some((e) => e.action === 'task.unsaved' && e.severity === 'warning'));
  // A quick question (not a task) still goes: it has no task record to wait for.
  assert.equal(await o.roster.interrupts.tell(floor, 'Status?', 'Keith', 'now'), undefined);
  assert.equal(floor.prompts.length, 1);
  breakTasks(o.dataDir, fsp as unknown as TaskFs);
});

test('hire-write-failure: a hire with a task is refused before anything is typed or marked in flight', async () => {
  const floor = new FakeFloor();
  const o = office(floor);
  breakTasks(o.dataDir, flakyFs(() => true));
  const err = await o.roster.members.hire(floor, 'lead-developer', 'Keith', undefined, 'Build the visitor checkout');
  assert.match(String(err), /nothing was sent/);
  assert.equal(o.roster.data(floor.id).members['lead-developer'].workerId, undefined, 'never hired (FakeFloor.hire would throw)');
  breakTasks(o.dataDir, fsp as unknown as TaskFs);
});

test('stuck-ask-ids-in-dispatch: the dispatch record has the new task and execution ids before typing; one attempt, read back after a restart', async () => {
  const { floor, o } = withCoordinator();
  assert.equal(await o.roster.interrupts.tell(floor, STUCK, 'Keith', 'now', {}, undefined, 'stuck:abc'), undefined);
  const typed = floor.prompts[0].text;
  const id = taskIdIn(typed)!;
  const [rec] = records(o, floor);
  assert.equal(rec.task?.taskId, id, 'the handed-over task, not the one it was on');
  const m = o.roster.data(floor.id).members.pm.task!;
  assert.equal(m.taskId, id);
  assert.equal(rec.task?.executionId, m.executionId);
  const store = taskStoreAt(o.dataDir);
  await store.flushed(floor.id);
  const read = (await new TaskStore(path.join(o.dataDir, 'tasks')).all(floor.id)).find((t) => t.id === id)!;
  assert.deepEqual(read.events.map((e) => e.type === 'assigned' && e.executionId), [m.executionId]);
});

test('restart-recovers-attempt: typed, then the attempt line lost (process stopped) → the restart puts it back from the dispatch record', async () => {
  const { floor, o } = withCoordinator();
  // The create line goes; every line after it fails (the process "stops" writing there).
  breakTasks(o.dataDir, flakyFs((n) => n > 1));
  assert.equal(await o.roster.interrupts.tell(floor, STUCK, 'Keith', 'now', {}, undefined, 'stuck:abc'), undefined);
  const id = taskIdIn(floor.prompts[0].text)!;
  const [rec] = records(o, floor);
  assert.equal((await taskStoreAt(o.dataDir).flushed(floor.id)).ok, false);
  breakTasks(o.dataDir, fsp as unknown as TaskFs);
  const fresh = new TaskStore(path.join(o.dataDir, 'tasks'));
  assert.deepEqual((await fresh.all(floor.id)).find((t) => t.id === id)?.events, [], 'on disk: made, never assigned');
  const o2 = crashAndRestart(floor, o);
  Object.assign(o2.roster.tasks.ids as unknown as { store: TaskStore }, { store: fresh });
  await o2.roster.reconcile();
  const ev = fresh.get(floor.id, id)!.events;
  assert.deepEqual(ev.map((e) => (e.type === 'assigned' ? [e.worker, e.role, e.executionId] : e.type)), [[rec.workerId, 'pm', rec.task!.executionId]]);
  assert.equal(floor.prompts.length, 1, 'nothing typed again');
  await o2.roster.reconcile();
  assert.equal(fresh.get(floor.id, id)!.events.length, 1, 'once');
});

test('ambiguous-send-not-replayed: an unclear dispatch is never typed again; "It went through" keeps one attempt per execution id', async () => {
  const { floor, o } = withCoordinator();
  floor.unrecorded = true;
  failWritesFrom(o, 3);
  await o.roster.interrupts.tell(floor, STUCK, 'Keith', 'now', {}, undefined, 'stuck:abc');
  floor.unrecorded = false;
  const id = taskIdIn(floor.prompts[0].text)!;
  const fresh = new TaskStore(path.join(o.dataDir, 'tasks'));
  await fresh.load(floor.id);
  const o2 = crashAndRestart(floor, o);
  Object.assign(o2.roster.tasks.ids as unknown as { store: TaskStore }, { store: fresh });
  // The member's assignment (roster save timer) never made it: only the records on disk count.
  await o2.roster.reconcile();
  const [rec] = records(o2, floor);
  assert.equal(rec.state, 'outcome-unknown');
  assert.equal(rec.task?.taskId, id);
  const before = fresh.get(floor.id, id)!.events.filter((e) => e.executionId === rec.task!.executionId);
  assert.equal(floor.prompts.length, 1, 'not replayed');
  assert.equal(await personAct(o2.roster, floor, rec.id, 'went-through', 'Keith').then((r) => r.error), undefined);
  const after = fresh.get(floor.id, id)!.events.filter((e) => 'executionId' in e && e.executionId === rec.task!.executionId);
  assert.equal(after.length, 1, `recorded once (${before.length} before)`);
  assert.equal(floor.prompts.length, 1);
});

test('attemptFromDispatch: only a dispatch that handed the task over and reached its agent', async () => {
  const { floor, o, pm } = withCoordinator();
  const store = taskStoreAt(o.dataDir);
  const t = await store.createDurable(floor.id, { source: 'stuck', text: 'x' });
  const base = { id: 'dsp_01M51S9XJC1XR77CBX8MK6HWVY', decision: 'stuck:x', answerRev: 1, channel: 'type', workerId: pm, payload: withTaskLine('Do x', t.id), task: { taskId: t.id, executionId: 'exe_01M51QWRVJJTX3VQ4SYXRYQP2C', text: 'x' }, createdAt: 0, updatedAt: 0, history: [] } as unknown as DispatchRecord;
  for (const state of ['in-flight', 'outcome-unknown', 'held', 'failed'] as const) await attemptFromDispatch(o.roster, floor.id, { ...base, state });
  await attemptFromDispatch(o.roster, floor.id, { ...base, state: 'submitted', payload: 'An escalation answer, the task only captured' });
  assert.equal(store.get(floor.id, t.id)!.events.length, 0);
  await attemptFromDispatch(o.roster, floor.id, { ...base, state: 'person-confirmed-sent' });
  assert.equal(store.get(floor.id, t.id)!.events.length, 1);
});

test('queue-write-failure: a queued task whose record can\'t be written is never seated; restart keeps a queued task\'s ids', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'td-queue-'));
  const spawned: string[] = [];
  const workers: WorkerInfo[] = [];
  const manager: QueueWorkers = {
    defaultProvider: 'claude',
    list: () => workers,
    deskOccupied: (desk) => workers.some((w) => w.deskId === desk),
    spawn(deskId, by, prompt) {
      spawned.push(prompt);
      const w = { id: `w${spawned.length}`, deskId, kind: 'agent', provider: 'claude', prompt, name: 'T', color: '#fff', status: 'working', acked: false, createdBy: by, createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo;
      workers.push(w);
      return w;
    },
    kill: () => Promise.resolve({}),
  };
  const toasts: string[] = [];
  const tasksDir = mkdtempSync(path.join(os.tmpdir(), 'td-qtasks-'));
  const open = (store: TaskStore) => new TaskQueue(dir, manager, false, { update() {}, toast: (t: string) => void toasts.push(t), claimIssue: async () => undefined, refreshGitHub() {}, hiringPaused: () => undefined, emptied() {}, taskIds: queueTaskIds(store, 'q1') });
  const bad = open(new TaskStore(tasksDir, flakyFs(() => true)));
  assert.equal(bad.add('Fix the footer', 'Keith'), undefined);
  assert.equal(spawned.length, 0, 'held off the desks until its record is on disk');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(spawned.length, 0);
  const [t] = bad.state().tasks;
  assert.equal(t.outcome, 'failed');
  assert.match(String(t.error), /task record couldn't be saved/);
  assert.ok(toasts.some((x) => /couldn't save its task record/.test(x)));
  bad.shutdown();
  // A good store: seated once the line is on disk, with its task line; the queue's file keeps the ids.
  const store = new TaskStore(tasksDir);
  const q = open(store);
  q.setLimit(0);
  assert.equal(q.add('Fix the header', 'Keith'), undefined);
  const added = q.state().tasks.find((x) => x.title === 'Fix the header')!;
  await store.flushed('q1');
  q.shutdown();
  const saved = JSON.parse(readFileSync(path.join(dir, 'queue.json'), 'utf8')) as { tasks: { taskId?: string }[] };
  assert.ok(saved.tasks.some((x) => x.taskId === added.taskId));
  const again = open(store);
  assert.equal(again.state().tasks.find((x) => x.title === 'Fix the header')?.taskId, added.taskId, 'read back after the restart');
  again.setLimit(1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(taskIdIn(spawned.at(-1)), added.taskId);
  again.shutdown();
});

test('proposal-write-failure: the task record can\'t be written → no issue is made, the proposal stays pending', async () => {
  const floor = new FakeFloor();
  const o = office(floor);
  const p: Proposal = { id: 'p-csv', standup: '2026-10-15', role: 'lead-developer', team: 'dev' as Proposal['team'], by: 'Ada', kind: 'task', title: 'Add CSV export', detail: 'Users want it.', status: 'pending' };
  o.roster.data(floor.id).proposals.push(p);
  breakTasks(o.dataDir, flakyFs(() => true));
  const err = await o.roster.standups.decide(floor, 'p-csv', 'approve', 'Keith');
  assert.match(String(err), /task's record couldn't be saved/);
  assert.equal(o.issues.length, 0);
  assert.equal(o.roster.data(floor.id).proposals[0].taskId, undefined);
  breakTasks(o.dataDir, fsp as unknown as TaskFs);
});
