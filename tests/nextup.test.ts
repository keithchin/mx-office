import test from 'node:test';
import assert from 'node:assert/strict';
import { byUrgency, needingYou, waitingInOrder, waitingLabel } from '../src/client/nextup.js';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

function worker(id: string, status: WorkerStatus, waitingSince?: number, acked = false, createdAt = 0): WorkerInfo {
  return { id, kind: 'agent', deskId: `desk-${id}`, name: id, color: '#fff', status, acked, waitingSince, createdBy: 'test', createdAt, cols: 80, rows: 24, viewers: [] };
}

test('the ones waiting on someone: the ones that need you first and oldest first, then the done ones', () => {
  const workers = new Map(
    [worker('b', 'needs_input', 200), worker('busy', 'working'), worker('a', 'done', 100), worker('c', 'needs_input', 300), worker('seen', 'done', 50, true)].map((w) => [w.id, w]),
  );
  assert.deepEqual(waitingInOrder(workers.values()).map((w) => w.id), ['b', 'c', 'a']);
  const many = [worker('first', 'working', undefined, true, 1), worker('done', 'done', 50, false, 2), worker('late', 'needs_input', 300, false, 3), worker('last', 'idle', undefined, true, 4), worker('early', 'needs_input', 200, false, 5)];
  assert.deepEqual(needingYou(many).map((w) => w.id), ['early', 'late']);
});

test('an office from before waitingSince goes by who was hired first', () => {
  const old = { ...worker('old', 'done'), createdAt: 10 };
  const young = { ...worker('young', 'done'), createdAt: 20 };
  assert.deepEqual(waitingInOrder([young, old]).map((w) => w.id), ['old', 'young']);
});

test('the Workers panel counts who needs input and who is done', () => {
  assert.equal(waitingLabel(waitingInOrder([worker('a', 'needs_input', 1), worker('b', 'needs_input', 2), worker('c', 'done', 3)])), '🙋 2 need you · ✅ 1 done');
  assert.equal(waitingLabel([worker('a', 'needs_input', 1)]), '🙋 1 needs you');
  assert.equal(waitingLabel([worker('c', 'done', 3)]), '✅ 1 done');
  assert.equal(waitingLabel([]), '');
});

test('the 1D view lists the workers waiting on someone first, then the busy ones, then the rest, asleep last', () => {
  const workers = [
    worker('asleep', 'offline', undefined, false, 1),
    worker('seen', 'done', 50, true, 2),
    worker('ready', 'idle', undefined, false, 3),
    worker('late', 'working', undefined, false, 9),
    worker('asks', 'needs_input', 300, false, 4),
    worker('early', 'starting', undefined, false, 5),
    worker('finished', 'done', 100, false, 6),
    worker('gone', 'exited', undefined, false, 0),
  ];
  assert.deepEqual(byUrgency(workers).map((w) => w.id), ['asks', 'finished', 'early', 'late', 'seen', 'ready', 'gone', 'asleep']);
  assert.deepEqual(byUrgency([]), []);
});
