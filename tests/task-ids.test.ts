// Task identity (Slice 1B-4, shared/tasks.ts, server/tasks/, roster/task-ids.ts): every new assignment gets
// a durable `tsk_` id in a record of its own, hash-chained; reassignment and restarts keep it with a new
// `exe_` per attempt; the id rides in the typed task, desk-opened PR bodies, audit ids and the budget ledger.
// Legacy tasks keep having no id. Fake floors only, no agents, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditInput } from '../src/shared/audit.js';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { cleanIds, isExecutionId } from '../src/shared/evidence/ids.js';
import { taskIdIn, taskLine, withTaskLine } from '../src/shared/tasks.js';
import { useAudit } from '../src/server/audit/index.js';
import { Roster } from '../src/server/roster/index.js';
import { reviveAssignment } from '../src/server/roster/resume.js';
import { reviveRoster } from '../src/server/roster/store.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { TaskStore } from '../src/server/tasks/store.js';
import { taskStoreAt, currentTaskIds } from '../src/server/tasks/index.js';
import { queueTaskIds } from '../src/server/tasks/queue.js';
import { draftPr } from '../src/server/workers/pr.js';
import { book, emptyLedger } from '../src/server/budget/ledger.js';
import { closeConnections } from '../src/server/connections/store.js';

const events: AuditInput[] = [];
useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);

const TSK = /^tsk_[0-9A-Z]{26}$/;

class FakeFloor implements TeamFloor {
  id = `tid-${Math.random().toString(36).slice(2, 8)}`;
  name = 'task-ids-test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'tid-floor-'));
  map = new Map<string, WorkerInfo>();
  typed: { id: string; text: string }[] = [];
  hired: HireAsk[] = [];
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo> {
    this.hired.push(ask);
    const id = `a${(++this.n).toString(16).padStart(7, '0')}`;
    const w = { id, kind: 'agent', provider: 'claude', deskId: 'd', name: ask.name, color: '#fff', status: 'working', acked: true, createdBy: ask.by, createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [], prompt: ask.prompt, worktree: { path: `wt/${id}`, branch: `feat/${id}`, base: 'main' } } as unknown as WorkerInfo;
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
  openPulls = () => [];
  pulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = () => {};
  set(id: string, status: WorkerStatus) {
    Object.assign(this.map.get(id)!, { status });
    this.roster.onWorker(this, this.map.get(id)!);
  }
}

async function office() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'tid-data-'));
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({ number: 2 }), analysis: () => '', now: () => Date.now() }, 0);
  floor.roster = roster;
  return { dataDir, floor, roster, store: taskStoreAt(dataDir) };
}

test('tasks-store-hash-chain: every line is chained; an edited line breaks it; a restart reads the tasks back', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tid-store-'));
  const s = new TaskStore(dir);
  const t = s.create('f1', { source: 'console', text: 'Build the visitor checkout', issue: 7 });
  assert.match(t.id, TSK);
  const exe = s.attempt('f1', t.id, { worker: 'a1' });
  assert.ok(isExecutionId(exe));
  s.event('f1', t.id, { type: 'completed', at: 5, why: 'PR #9 merged' });
  await s.flushed('f1');
  assert.deepEqual(await s.verify('f1'), { ok: true });
  // Read back by a fresh store (a restart).
  const again = new TaskStore(dir);
  const back = (await again.all('f1'))[0];
  assert.equal(back.id, t.id);
  assert.deepEqual(back.events.map((e) => e.type), ['assigned', 'completed']);
  assert.equal(back.issue, 7);
  // An edited line shows.
  const file = s.file('f1');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines[0] = lines[0].replace('visitor', 'admin');
  writeFileSync(file, lines.join('\n'));
  assert.deepEqual(await new TaskStore(dir).verify('f1'), { ok: false, brokenAt: 1 });
});

test('tsk-minted-and-propagated: a hire and a console task carry Task: tsk_ in the typed text; audit ids and the ledger get it', async () => {
  const { floor, roster, store } = await office();
  events.length = 0;
  assert.equal(await roster.members.hire(floor, 'lead-developer', 'Keith', undefined, 'Build the visitor checkout'), undefined);
  const m = roster.data(floor.id).members['lead-developer'];
  const t = m.task!;
  assert.match(t.taskId!, TSK);
  assert.ok(isExecutionId(t.executionId));
  // In the typed (hire) prompt.
  assert.equal(taskIdIn(floor.hired[0].prompt), t.taskId);
  // On the record, independent of the member.
  assert.equal(store.get(floor.id, t.taskId!)?.source, 'hire');
  assert.deepEqual(store.get(floor.id, t.taskId!)?.events.map((e) => e.type), ['assigned']);
  // Audit: the hire and the assignment carry both ids, and the log's cleaner keeps them.
  const hire = events.find((e) => e.action === 'worker.hire')!;
  assert.equal(hire.ids?.taskId, t.taskId);
  assert.equal(hire.ids?.executionId, t.executionId);
  assert.deepEqual(cleanIds(hire.ids), hire.ids);
  assert.ok(events.some((e) => e.action === 'task.assign' && e.ids?.taskId === t.taskId));
  // A console task: prepared (minted before typing), then assigned with the same id.
  const prep = await roster.tasks.prepare(floor, m.workerId!, 'Add the payment step to checkout, with tests', 'console');
  const typed = prep.text!;
  const id2 = taskIdIn(typed)!;
  assert.match(id2, TSK);
  assert.notEqual(id2, t.taskId);
  assert.equal(roster.tasks.assign(floor, m.workerId!, typed, 'Keith', 'console'), true);
  assert.equal(m.task!.taskId, id2);
  assert.equal(m.prevTasks?.[0]?.taskId, t.taskId, 'the earlier task is cached');
  assert.deepEqual(store.get(floor.id, t.taskId!)?.events.map((e) => e.type), ['assigned', 'superseded']);
  // A reply isn't a task: typed as it was, no id.
  assert.deepEqual(await roster.tasks.prepare(floor, m.workerId!, 'yes, go ahead', 'console'), { text: 'yes, go ahead' });
  // The desk-opened PR body's Task section ends with the task line, even when the task is cut short.
  const long = `${'x'.repeat(5000)}\n\n${taskLine(id2)}`;
  const body = draftPr({ prompt: long, name: 'Linus', deskId: 'd' } as unknown as WorkerInfo, ['abc1234 add checkout'], 'Keith').body;
  assert.equal(taskIdIn(body), id2);
  // The ledger keeps rows per task.
  const d = emptyLedger(0);
  book(d, { day: '2026-10-15', agent: 'a', model: 'opus', stage: 'build' as never, cost: 1, calls: 1, taskId: id2 }, { key: 'a', label: 'A' } as never);
  book(d, { day: '2026-10-15', agent: 'a', model: 'opus', stage: 'build' as never, cost: 1, calls: 1 }, { key: 'a', label: 'A' } as never);
  assert.deepEqual(d.rows.map((r) => r.taskId), [id2, undefined]);
  assert.deepEqual(currentTaskIds(m), { taskId: id2, executionId: m.task!.executionId });
  roster.stop();
});

test('task-reassignment-keeps-id: the task handed to another member keeps its tsk_ with a new exe_', async () => {
  const { floor, roster, store } = await office();
  await roster.members.hire(floor, 'lead-developer', 'Keith', undefined, 'Build the visitor checkout');
  await roster.members.hire(floor, 'lead-tester', 'Keith');
  const d = roster.data(floor.id);
  const first = d.members['lead-developer'].task!;
  const tester = d.members['lead-tester'];
  // Handed on: the task line goes with it.
  const text = withTaskLine('Take over the visitor checkout from Linus and finish it', first.taskId);
  assert.equal(roster.tasks.assign(floor, tester.workerId!, text, 'Keith', 'tell'), true);
  assert.equal(tester.task!.taskId, first.taskId, 'same task id');
  assert.notEqual(tester.task!.executionId, first.executionId, 'a new attempt');
  const rec = store.get(floor.id, first.taskId!)!;
  assert.deepEqual(rec.events.map((e) => e.type), ['assigned', 'reassigned']);
  assert.equal(rec.events[1].type === 'reassigned' && rec.events[1].from, d.members['lead-developer'].workerId);
  // A queue retry is the same task again: a new execution id.
  const q = queueTaskIds(store, floor.id);
  const tid = q.create({ id: 'abc123', title: 'Fix the footer', issue: undefined });
  const e1 = q.attempt({ taskId: tid }, { id: 'w1' });
  const e2 = q.attempt({ taskId: tid, workerId: 'w1' }, { id: 'w2' });
  assert.notEqual(e1, e2);
  assert.equal(store.get(floor.id, tid)?.legacyId, 'abc123');
  roster.stop();
});

test('task-restart-keeps-id: an office restart and a rehire keep the task id; the rehire is a new attempt', async () => {
  const { dataDir, floor, roster, store } = await office();
  await roster.members.hire(floor, 'lead-developer', 'Keith', undefined, 'Build the visitor checkout');
  const m = roster.data(floor.id).members['lead-developer'];
  const t = { ...m.task! };
  // The office restarts: the roster is read back with the ids.
  roster.flush();
  const saved = JSON.parse(readFileSync(path.join(dataDir, 'roster', `${floor.id}.json`), 'utf8'));
  const back = reviveRoster(saved).members['lead-developer'].task!;
  assert.equal(back.taskId, t.taskId);
  assert.equal(back.executionId, t.executionId);
  // Its worker is gone and it's hired again without a new task: it carries on with the same task, a new attempt.
  await floor.stop(m.workerId!);
  assert.equal(await roster.members.hire(floor, 'lead-developer', 'Keith'), undefined);
  assert.equal(m.task!.taskId, t.taskId);
  assert.notEqual(m.task!.executionId, t.executionId);
  assert.deepEqual(store.get(floor.id, t.taskId!)?.events.map((e) => e.type), ['assigned', 'reassigned']);
  roster.stop();
});

test('legacy-tasks-without-ids: an old task stays without ids, a load never makes one up', () => {
  const old = { text: 'work on GitHub issue #1 (Discovery)', at: 1, by: 'Keith', issue: 1 };
  const revived = reviveAssignment(old)!;
  assert.equal(revived.taskId, undefined);
  assert.equal(revived.executionId, undefined);
  assert.equal(reviveAssignment({ ...old, taskId: 'tsk_not-a-real-id', executionId: 'nope' })?.taskId, undefined, 'a malformed id is dropped, not kept');
  const r = reviveRoster({ members: { 'lead-developer': { name: 'Linus', phase: 'active', task: old, prevTasks: [old] } } });
  assert.equal(r.members['lead-developer'].task?.taskId, undefined);
  assert.equal(r.members['lead-developer'].prevTasks?.[0].taskId, undefined);
  assert.equal(currentTaskIds(r.members['lead-developer']), undefined);
});

test.after(() => closeConnections());
