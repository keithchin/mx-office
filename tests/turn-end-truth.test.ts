// A turn that ended is not a finished task (server/workers/lifecycle.ts, server/queue.ts, server/queue-finish.ts):
// an API error (StopFailure), a cancel (StopCancelled) or an Esc (Interrupt) ends a turn and is recorded as such
// (WorkerInfo.lastStop); the queue stops such a task short ("stopped before finishing", requeue), and even a clean
// stop toasts "turn ended … not confirmed finished" until the task's PR merged. Fakes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import { reduceLifecycle } from '../src/server/workers/lifecycle.js';
import type { WorkerHandle } from '../src/server/workers/types.js';
import { turnEnd, turnEndedToast } from '../src/server/queue-finish.js';
import type { GhPull, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

function handle(): WorkerHandle & { info: WorkerInfo } {
  const info = { id: 'w1', status: 'working', sessionId: 's1' } as WorkerInfo;
  return {
    info,
    leftNeedsInputAt: 0,
    bootBlocked: false,
    setStatus(s: WorkerStatus) { info.status = s; },
    emit() {}, persist() {}, clearTask() {}, notePrompt() {}, noteTool() {}, prompt() {},
  } as unknown as WorkerHandle & { info: WorkerInfo };
}

test('each turn-ending hook records how the turn ended; a new turn clears it', () => {
  for (const [event, kind] of [['Stop', 'stop'], ['StopFailure', 'error'], ['StopCancelled', 'cancelled'], ['Interrupt', 'interrupted']] as const) {
    const h = handle();
    reduceLifecycle(h, { sessionId: 's1', event });
    assert.equal(h.info.status, 'done', event);
    assert.equal(h.info.lastStop?.kind, kind, event);
    reduceLifecycle(h, { sessionId: 's1', event: 'UserPromptSubmit', prompt: 'next' });
    assert.equal(h.info.lastStop, undefined, 'a new turn clears it');
  }
});

test('turnEnd: only a clean stop is the turn ending by itself; the toast says finished only with a merged PR', () => {
  assert.deepEqual(turnEnd({ status: 'done', lastStop: { kind: 'stop', at: 1 } }), { outcome: 'done' });
  assert.deepEqual(turnEnd({ status: 'done' }), { outcome: 'done' });
  assert.deepEqual(turnEnd({ status: 'done', lastStop: { kind: 'error', at: 1 } }), { outcome: 'exited', error: 'its turn ended with an API error' });
  assert.deepEqual(turnEnd({ status: 'done', lastStop: { kind: 'interrupted', at: 1 } }), { outcome: 'exited', error: 'its turn was interrupted' });
  assert.deepEqual(turnEnd({ status: 'exited' }), { outcome: 'exited' });
  assert.equal(turnEndedToast('Ada', '#5', {}), "📋 Ada's turn ended on #5: not confirmed finished (no PR found yet)");
  assert.equal(turnEndedToast('Ada', '#5', { pr: { number: 9, url: '', state: 'OPEN', title: '' } }), "📋 Ada's turn ended on #5: not confirmed finished (PR #9 is open, not merged)");
  assert.equal(turnEndedToast('Ada', '#5', { pr: { number: 9, url: '', state: 'MERGED', title: '' } }), '📋 Ada finished #5: PR #9 merged');
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-turn-end-'));
  const workers: WorkerInfo[] = [];
  const toasts: { text: string; level: string }[] = [];
  const manager: QueueWorkers = {
    defaultProvider: 'claude',
    list: () => workers,
    deskOccupied: (desk) => workers.some((w) => w.deskId === desk),
    spawn(deskId, by, prompt, worktree, kind) {
      const w = { id: `worker-${workers.length}`, deskId, kind, prompt, name: 'Ada', color: '#fff', status: 'working', acked: false, createdBy: by, createdAt: Date.now(), cols: 80, rows: 24, viewers: [], viewerIds: [], worktree: worktree ? { path: 'wt', branch: `office/w${workers.length}`, base: 'abc' } : undefined } as WorkerInfo;
      workers.push(w);
      return w;
    },
    kill: () => Promise.resolve({}),
  };
  const q = new TaskQueue(dir, manager, true, { update() {}, toast: (text, level) => toasts.push({ text, level }), claimIssue: async () => undefined, refreshGitHub() {}, hiringPaused: () => undefined, emptied() {} });
  return { q, workers, toasts, close: () => { q.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}

test('an API error, a cancel or an Esc stops the queue task short, never "finished"', (t) => {
  for (const kind of ['error', 'cancelled', 'interrupted'] as const) {
    const f = fixture(); t.after(() => f.close());
    f.q.add('Fix login', 'Tester');
    const w = f.workers[0];
    w.status = 'done'; w.lastStop = { kind, at: Date.now() };
    f.q.onWorker(w);
    const task = f.q.state().tasks[0];
    assert.equal(task.outcome, 'exited', kind);
    assert.match(task.error ?? '', /its turn/);
    assert.ok(f.toasts.every((x) => !/finished “/.test(x.text) && !/ finished /.test(x.text.replace('before finishing', ''))), JSON.stringify(f.toasts));
    assert.match(f.toasts.at(-1)!.text, /stopped before finishing .* — requeue it/);
  }
});

test('a clean stop is "turn ended, not confirmed finished" until its PR merges; then finished', (t) => {
  const f = fixture(); t.after(() => f.close());
  f.q.add('Fix login', 'Tester');
  const w = f.workers[0];
  w.status = 'done'; w.lastStop = { kind: 'stop', at: Date.now() };
  f.q.onWorker(w);
  assert.equal(f.q.state().tasks[0].outcome, 'done');
  assert.match(f.toasts.at(-1)!.text, /turn ended on “Fix login”: not confirmed finished \(no PR found yet\)/);
  const pull = (state: string) => ({ number: 7, url: 'u', state, isDraft: false, title: 'Fix login', headRefName: w.worktree!.branch, closes: [], createdAt: new Date().toISOString() }) as unknown as GhPull;
  f.q.onPulls([pull('OPEN')]);
  assert.ok(!f.toasts.some((x) => / finished “Fix login”/.test(x.text) || /finished: PR/.test(x.text)), 'an open PR is no evidence');
  f.q.onPulls([pull('MERGED')]);
  assert.equal(f.toasts.at(-1)!.text, '📋 “Fix login” finished: PR #7 merged');
  f.q.onPulls([pull('MERGED')]);
  assert.equal(f.toasts.filter((x) => /finished: PR #7/.test(x.text)).length, 1, 'said once');
});
