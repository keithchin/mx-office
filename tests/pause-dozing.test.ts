// ⏸ Pause project puts each agent to sleep with WorkerManager.sleep. The journey test
// (scripts/perf/journey.mjs) found every paused agent awake again seconds later: the next page to
// connect to the floor runs wakeAll ("anyone whose process ended gets up as you walk in"), and sleep
// didn't mark the worker as left asleep on purpose (dozing), so wakeAll resumed it. Now it does, and only
// an explicit resume (▶ Resume project, a prompt, a person's R) wakes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerManager } from '../src/server/workers/manager.js';

type Fake = { info: { id: string; name: string }; pty?: { kill(): void }; dsh?: unknown; dozing?: boolean };

function manager(workers: Fake[]) {
  const resumed: string[] = [];
  const self = {
    workers: new Map(workers.map((w) => [w.info.id, w])),
    resume: (id: string) => {
      resumed.push(id);
      return undefined;
    },
  };
  const sleep = (id: string) => WorkerManager.prototype.sleep.call(self as unknown as WorkerManager, id);
  const wakeAll = () => WorkerManager.prototype.wakeAll.call(self as unknown as WorkerManager);
  return { self, sleep, wakeAll, resumed };
}

test('an agent put to sleep stays asleep when a page connects (wakeAll)', () => {
  let killed = 0;
  const w: Fake = { info: { id: 'a1', name: 'Ada' }, pty: { kill: () => void killed++ } };
  const m = manager([w]);
  assert.equal(m.sleep('a1'), undefined);
  assert.equal(killed, 1, 'its terminal is stopped');
  assert.equal(w.dozing, true, 'marked as asleep on purpose');
  w.pty = undefined; // its exit
  m.wakeAll();
  assert.deepEqual(m.resumed, [], 'not woken by someone walking in');
});

test('one whose process just ended (not put to sleep) still gets up when a page connects', () => {
  const w: Fake = { info: { id: 'b1', name: 'Bob' } };
  const m = manager([w]);
  m.wakeAll();
  assert.deepEqual(m.resumed, ['b1']);
});

test('sleep refuses a worker with no terminal, and marks nothing', () => {
  const w: Fake = { info: { id: 'c1', name: 'Cy' } };
  const m = manager([w]);
  assert.match(m.sleep('c1') ?? '', /no terminal/);
  assert.equal(w.dozing, undefined);
  assert.equal(m.sleep('nobody'), 'No such worker');
});
