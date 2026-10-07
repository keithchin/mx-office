import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RECONCILE_MS, TaskQueue, type QueueOptions, type QueueWorkers } from '../src/server/queue.js';
import type { QueueTask, WorkerInfo } from '../src/shared/protocol.js';

// A queue task whose worker's terminal may outlive an office restart (ptyhost.ts): the queue waits for
// the worker manager to adopt it (afterRestart) before saying how the task went.

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-queue-reconcile-'));
  const workers: WorkerInfo[] = [];
  let hired = 0;
  const manager: QueueWorkers = {
    defaultProvider: 'claude',
    list: () => workers,
    deskOccupied: (desk) => workers.some((w) => w.deskId === desk),
    spawn(deskId, by, prompt, worktree, kind, provider, model, effort) {
      const id = `worker-${hired++}`;
      const worker: WorkerInfo = {
        id, deskId, kind, provider, model, effort, prompt, name: `Test ${id}`,
        color: '#ffffff', status: 'working', acked: false, createdBy: by,
        createdAt: Date.now(), cols: 80, rows: 24, viewers: [], viewerIds: [],
      };
      workers.push(worker);
      return worker;
    },
    kill(id) {
      const i = workers.findIndex((w) => w.id === id);
      if (i >= 0) workers.splice(i, 1);
      return Promise.resolve({});
    },
  };
  const queues: TaskQueue[] = [];
  const events: { task: string; result: string; why: string; attempt?: string }[] = [];
  const open = (opts?: QueueOptions) => {
    const queue = new TaskQueue(dir, manager, false, {
      update() {}, toast() {}, claimIssue: async () => undefined,
      refreshGitHub() {}, hiringPaused: () => undefined, emptied() {},
      reconciled: (t, result, why) => events.push({ task: t.id, result, why, attempt: t.attemptId }),
    }, opts);
    queues.push(queue);
    return queue;
  };
  /** The office goes down with the queue's worker mid-task; it comes back offline, as workers/persist.ts restores it. */
  const restart = (opts?: QueueOptions) => {
    queues.forEach((q) => q.shutdown());
    for (const w of workers) w.status = 'offline';
    return open(opts);
  };
  return { dir, workers, events, open, restart, close() { queues.forEach((q) => q.shutdown()); rmSync(dir, { recursive: true, force: true }); } };
}

const only = (q: TaskQueue): QueueTask => q.state().tasks[0];

test('a seated task gets an attempt id, kept on disk', (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open();
  q.add('Fix login', 'Tester');
  const attempt = only(q).attemptId;
  assert.match(attempt ?? '', /^[0-9a-f]{12}$/);
  const saved = JSON.parse(readFileSync(path.join(f.dir, 'queue.json'), 'utf8')) as { tasks: QueueTask[] };
  assert.equal(saved.tasks[0].attemptId, attempt);
  assert.equal(existsSync(path.join(f.dir, 'queue.json.tmp')), false);
});

test('a task whose worker survives the restart carries on, same attempt', (t) => {
  const f = fixture(); t.after(() => f.close());
  f.open().add('Fix login', 'Tester');
  const before = f.events.length;
  const q = f.restart();
  const attempt = only(q).attemptId;
  assert.equal(only(q).status, 'running');
  assert.equal(only(q).reconciling, true);
  // Offline until adopted: the pump mustn't read that as finished.
  q.onWorker(f.workers[0]);
  q.pump();
  assert.equal(only(q).status, 'running');
  assert.equal(only(q).outcome, undefined);
  // The worker manager adopts its terminal.
  f.workers[0].status = 'working';
  q.afterRestart();
  assert.equal(only(q).status, 'running');
  assert.equal(only(q).reconciling, undefined);
  assert.equal(only(q).attemptId, attempt);
  assert.deepEqual(f.events.slice(before).map((e) => [e.result, e.attempt]), [['resumed', attempt]]);
  // And it finishes the usual way.
  f.workers[0].status = 'done';
  q.onWorker(f.workers[0]);
  assert.equal(only(q).outcome, 'done');
});

test('a task whose worker is gone after the restart stops, with the reason', (t) => {
  const f = fixture(); t.after(() => f.close());
  f.open().add('Fix login', 'Tester');
  const q = f.restart();
  f.workers.splice(0);
  q.afterRestart();
  assert.equal(only(q).status, 'done');
  assert.equal(only(q).outcome, 'exited');
  assert.match(only(q).error ?? '', /restarted.*gone/);
  assert.equal(only(q).reconciling, undefined);
  assert.deepEqual(f.events.map((e) => e.result), ['abandoned']);
});

test('a task whose worker was not adopted (still offline) stops', (t) => {
  const f = fixture(); t.after(() => f.close());
  f.open().add('Fix login', 'Tester');
  const q = f.restart();
  q.afterRestart();
  assert.equal(only(q).outcome, 'exited');
  assert.match(only(q).error ?? '', /didn't survive/);
});

test('reconciling gives up after the timeout if the worker manager never answers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(); t.after(() => f.close());
  f.open().add('Fix login', 'Tester');
  const q = f.restart();
  t.mock.timers.tick(RECONCILE_MS - 1);
  assert.equal(only(q).reconciling, true);
  t.mock.timers.tick(1);
  assert.equal(only(q).reconciling, undefined);
  assert.equal(only(q).outcome, 'exited');
  assert.match(only(q).error ?? '', /wasn't back within 2 minutes/);
  // Adoption finishing late changes nothing, and isn't recorded twice.
  f.workers[0].status = 'working';
  q.afterRestart();
  assert.equal(only(q).outcome, 'exited');
  assert.equal(f.events.length, 1);
});

test('a worker adopted before the timeout keeps the timeout from firing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = fixture(); t.after(() => f.close());
  f.open().add('Fix login', 'Tester');
  const q = f.restart();
  f.workers[0].status = 'working';
  q.afterRestart();
  t.mock.timers.tick(RECONCILE_MS * 2);
  assert.equal(only(q).status, 'running');
  assert.deepEqual(f.events.map((e) => e.result), ['resumed']);
});

test('nobody else is seated for a reconciling task, and it cannot be removed', (t) => {
  const f = fixture(); t.after(() => f.close());
  const first = f.open();
  first.setLimit(1);
  first.add('Fix login', 'Tester');
  first.add('Next task', 'Tester');
  assert.equal(f.workers.length, 1);
  const q = f.restart();
  q.pump();
  q.onWorker(f.workers[0]);
  assert.equal(f.workers.length, 1, 'no second worker while reconciling');
  assert.equal(q.state().tasks[1].status, 'queued');
  assert.match(q.remove(only(q).id) ?? '', /is on it/);
  // Once it's found gone, the slot frees up and the next task is seated.
  f.workers.splice(0);
  q.afterRestart();
  assert.equal(only(q).outcome, 'exited');
  assert.equal(q.state().tasks[1].status, 'running');
  assert.equal(f.workers.length, 1);
});

test('an older queue.json without attempt ids loads, its running task reconciling', (t) => {
  const f = fixture(); t.after(() => f.close());
  writeFileSync(path.join(f.dir, 'queue.json'), JSON.stringify({ maxWorkers: 3, tasks: [
    { id: 'legacy', title: 'Legacy', prompt: 'Legacy task', addedBy: 'Tester', addedAt: 1, status: 'running', workerId: 'old', workerName: 'Old', startedAt: 1 },
    { id: 'waiting', title: 'Waiting', prompt: 'Waiting task', addedBy: 'Tester', addedAt: 2, status: 'queued' },
  ] }));
  const q = f.open();
  const task = only(q);
  assert.equal(task.status, 'running');
  assert.equal(task.reconciling, true);
  assert.match(task.attemptId ?? '', /^[0-9a-f]{12}$/);
  // The queued task still gets seated: the reconciling one holds one slot of three.
  q.pump();
  assert.equal(q.state().tasks[1].status, 'running');
  q.afterRestart();
  assert.equal(only(q).outcome, 'exited');
});
