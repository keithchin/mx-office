// The floor's loading overlay's accounting (src/client/ui/loading/progress.ts): steps done in any order,
// the percentage only reaching 100 with every step in, a step for another floor or one the view doesn't
// wait for ignored, changing floor again cancelling the load before, and the slow and give-up limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_STEPS, LoadTracker, StepLoad, type FloorStep } from '../src/client/ui/loading/progress.js';

const limits = { slowMs: 5_000, maxMs: 15_000 };
const steps: FloorStep[] = ['enter', 'workers', 'roster', 'summary', 'budget', 'view'];

test('steps come in any order; the percentage counts them and reaches 100 only with all of them', () => {
  const l = new StepLoad('a', steps, 1000, limits);
  assert.equal(l.pct, 0);
  assert.equal(l.next, 'enter');
  assert.equal(l.done('budget', 1100), true);
  assert.equal(l.done('summary', 1200), true);
  assert.equal(l.pct, 33);
  assert.equal(l.next, 'enter', 'the first one still to come, in the listed order');
  assert.equal(l.done('budget', 1300), false, 'a step counts once');
  assert.equal(l.done('convo', 1300), false, 'a step this view does not wait for is ignored');
  for (const s of ['view', 'roster', 'workers'] as const) l.done(s, 1400);
  assert.equal(l.pct, 83);
  assert.equal(l.phase(1400), 'loading');
  assert.equal(l.allBut('enter'), true);
  l.done('enter', 1500);
  assert.equal(l.pct, 100);
  assert.equal(l.phase(1500), 'done');
  assert.deepEqual(Object.keys(l.timings()), ['budget', 'summary', 'view', 'roster', 'workers', 'enter'], 'timings in the order they came');
  assert.equal(l.timings().enter, 500);
});

test('slow after slowMs (still loading…), given up after maxMs, never stuck; nothing counts once it is over', () => {
  const l = new StepLoad('a', steps, 0, limits);
  l.done('enter', 10);
  assert.equal(l.phase(4_999), 'loading');
  assert.equal(l.phase(5_000), 'slow');
  assert.equal(l.phase(15_000), 'timeout');
  const done = new StepLoad('a', ['enter'], 0, limits);
  done.done('enter', 20_000);
  assert.equal(done.phase(20_000), 'done', 'a step that comes is counted; the tracker decides whether it was late');
});

test('a load with no steps is done at once', () => {
  assert.equal(new StepLoad('a', [], 0, limits).pct, 100);
});

test('changing floor again cancels the load before; its late steps are ignored', () => {
  const t = new LoadTracker<FloorStep>(limits);
  const { load: a } = t.begin('a', steps, 0);
  assert.equal(t.done('enter', 'a', 100), true);
  const { load: b, cancelled } = t.begin('b', steps, 200);
  assert.equal(cancelled, a);
  assert.equal(a.phase(200), 'cancelled');
  assert.equal(t.done('summary', 'a', 300), false, 'a step for the floor left behind');
  assert.equal(a.has('summary'), false);
  assert.equal(t.done('summary', 'b', 300), true);
  assert.equal(b.pct, 16);
  assert.equal(t.done('roster', null, 300), false, 'no floor, no step');
});

test('a load that is over is not cancelled by the next one, and takes no more steps', () => {
  const t = new LoadTracker<FloorStep>(limits);
  const { load: a } = t.begin('a', ['enter'], 0);
  t.done('enter', 'a', 10);
  assert.equal(a.phase(10), 'done');
  const { cancelled } = t.begin('b', ['enter'], 20);
  assert.equal(cancelled, undefined);
  assert.equal(a.phase(20), 'done');
  const { load: c } = t.begin('c', ['enter', 'budget'], 0);
  assert.equal(t.done('enter', 'c', 20_000), false, 'past maxMs the tracker takes no more steps');
  assert.equal(c.phase(20_000), 'timeout');
});

test('every step has words for the overlay', () => {
  for (const s of steps) assert.ok(FLOOR_STEPS[s].length > 3);
});
