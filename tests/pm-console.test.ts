// The board's project manager console (src/client/ui/pm/): what it shows for each state the PM can be
// in, from the team's view of it and its live worker, and the prompt history behind Up and Down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptHistory, pmView } from '../src/client/ui/pm/state.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { MemberView } from '../src/shared/roster/types.js';

const member = (o: Partial<MemberView> = {}): MemberView => ({ role: 'pm', title: 'Project Manager', team: 'management', icon: '🧭', name: 'Maya', model: 'sonnet', status: 'not-hired', ...o }) as MemberView;
const worker = (o: Partial<WorkerInfo> = {}): WorkerInfo => ({ id: 'w1', kind: 'agent', provider: 'claude', status: 'idle', name: 'Maya', cols: 80, rows: 24, viewers: [], ...o }) as WorkerInfo;

test('no PM hired: the empty state with 🤝 Hire, no terminal and no box', () => {
  const v = pmView(member(), undefined);
  assert.equal(v.state, 'not-hired');
  assert.equal(v.hire, 'first');
  assert.equal(v.live, false);
  assert.equal(v.canPrompt, false);
  assert.equal(v.workerId, undefined);
});

test('a benched PM: "Hire again", whatever worker id the roster still remembers', () => {
  const v = pmView(member({ status: 'benched', handoffAt: 1 }), undefined);
  assert.equal(v.state, 'benched');
  assert.equal(v.hire, 'again');
  assert.equal(v.canPrompt, false);
});

test("the live worker's status wins over the roster's (fetched now and then)", () => {
  const pm = member({ status: 'idle', workerId: 'w1' });
  assert.equal(pmView(pm, worker({ status: 'working' })).state, 'working');
  assert.equal(pmView(pm, worker({ status: 'done' })).state, 'idle');
  assert.equal(pmView(pm, worker({ status: 'offline' })).state, 'asleep');
  // Another worker is not the PM's.
  assert.equal(pmView(pm, worker({ id: 'w2', status: 'working' })).state, 'idle');
});

test('idle: a prompt goes straight in; busy: it waits in its input box', () => {
  const pm = member({ status: 'idle', workerId: 'w1' });
  const idle = pmView(pm, worker());
  assert.deepEqual([idle.live, idle.canPrompt, idle.ack, idle.hint], [true, true, 'sent', undefined]);
  const busy = pmView(pm, worker({ status: 'working' }));
  assert.deepEqual([busy.canPrompt, busy.ack], [true, 'queued']);
});

test('asking you something: no typed prompt (it is not an answer to a choice), a hint to answer in ⤢ Open', () => {
  const v = pmView(member({ status: 'needs-you', workerId: 'w1' }), worker({ status: 'needs_input' }));
  assert.equal(v.state, 'needs-you');
  assert.equal(v.canPrompt, false);
  assert.equal(v.live, true);
  assert.match(v.hint ?? '', /Open/);
});

test('asleep: ⏰ Wake, no terminal, no box', () => {
  const v = pmView(member({ status: 'asleep', workerId: 'w1' }), worker({ status: 'exited' }));
  assert.deepEqual([v.state, v.canWake, v.live, v.canPrompt], ['asleep', true, false, false]);
});

test('writing its handoff: the roster says so, and the box stays shut', () => {
  const v = pmView(member({ status: 'benching', workerId: 'w1' }), worker({ status: 'working' }));
  assert.deepEqual([v.state, v.canPrompt, v.live], ['benching', false, true]);
});

test("the model and cost: its session's when known, else the roster's", () => {
  const pm = member({ status: 'idle', workerId: 'w1', cost: 0.5 });
  const v = pmView(pm, worker({ usage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 1.25, calls: 1, model: 'claude-opus-5-5' } }));
  assert.deepEqual([v.model, v.cost], ['claude-opus-5-5', 1.25]);
  assert.deepEqual([pmView(pm, undefined).model, pmView(pm, undefined).cost], ['sonnet', 0.5]);
});

test('the prompt history walks back with Up and forward to a blank box with Down', () => {
  const hist = new PromptHistory(3);
  assert.equal(hist.back(), undefined);
  for (const p of ['a', 'b', 'b', 'c', 'd']) hist.add(p);
  // Repeats aren't kept twice in a row, and only the newest 3 stay.
  assert.equal(hist.back(), 'd');
  assert.equal(hist.back(), 'c');
  assert.equal(hist.back(), 'b');
  assert.equal(hist.back(), undefined);
  assert.equal(hist.forward(), 'c');
  assert.equal(hist.forward(), 'd');
  assert.equal(hist.forward(), '');
  assert.equal(hist.forward(), undefined);
});
