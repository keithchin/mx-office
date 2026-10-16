// An escalation answer held for its raiser (mid-turn: Delivery's held list types it once the turn ends) is not
// delivered: the escalation says "held, not delivered yet" until the dispatch is received, is never owed (typed
// twice) meanwhile, and turns delivered once the held answer goes in and its session shows it. Fake floors only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeFloor, ask, office, records, settle } from './dispatch-helpers.js';
import { stillOwed } from '../src/server/roster/escalation-answer.js';

test('a held answer is held, not delivered, until its dispatch is received; typed once', async () => {
  const floor = new FakeFloor();
  const o = office(floor);
  const ada = floor.add('a1', 'Ada');
  const e = o.roster.escalations.raise(floor, floor.worker(ada)!, ask('Approve the schema change?'));
  floor.set(ada, 'working');
  // Delivery holds it for after the turn (as it would a send with hold set, the agent mid-turn).
  const d = o.roster.delivery;
  const orig = d.send.bind(d);
  d.send = (f, w, t, opts) => {
    d.send = orig;
    return orig(f, w, t, { ...opts, hold: true, between: true });
  };
  const r = await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: 'Go ahead.', by: 'Keith', expectedRev: 0 });
  assert.ok(r.ok);
  const [rec] = records(o, floor);
  assert.deepEqual([rec.channel, rec.state], ['type', 'held']);
  const x = () => o.roster.data(floor.id).escalations.find((y) => y.id === e.id)!;
  assert.equal(x().status, 'resolved');
  assert.equal(x().resolution!.delivered, false, 'held is not delivered');
  assert.equal(x().resolution!.held, true);
  assert.equal(o.roster.escalations.owedTo(floor, floor.worker(ada)!).lines.length, 0, 'not owed too: the held list carries it');
  assert.equal(stillOwed(o.roster, floor.id, rec), false, 'reconcile asks the held list, not the escalation');
  assert.equal(floor.prompts.length, 0);
  floor.set(ada, 'done');
  await settle();
  assert.equal(floor.prompts.length, 1, 'typed once, when the turn ended');
  assert.equal(records(o, floor)[0].state, 'submitted');
  assert.equal(x().resolution!.delivered, true, 'received: delivered now');
  assert.equal(x().resolution!.held, undefined);
  floor.set(ada, 'working');
  floor.set(ada, 'done');
  await settle();
  assert.equal(floor.prompts.length, 1, 'never typed twice');
});

test('an idle raiser: delivered at once, never flagged held', async () => {
  const floor = new FakeFloor();
  const o = office(floor);
  const ada = floor.add('a1', 'Ada');
  const e = o.roster.escalations.raise(floor, floor.worker(ada)!, ask('Approve?'));
  await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: 'Yes.', by: 'Keith', expectedRev: 0 });
  const res = o.roster.data(floor.id).escalations.find((y) => y.id === e.id)!.resolution!;
  assert.deepEqual([res.delivered, res.held], [true, undefined]);
});
