// Release 81's delivery fixes, from a multi-day build: after an office restart every agent was asleep, and the
// Project Manager's answers to escalation cards never arrived, with nothing said (they went once someone pressed
// Resume); and tells relayed through the Project Coordinator were flagged "typed into the terminal but not
// received" although they had arrived. So: a queued message whose prompt is an array of content blocks counts as
// received; an agent woken with a message into a new session is looked for there; one that stops before its
// session shows the message is said at once; answers owed to an asleep agent wake it; and when what's waiting for
// an agent can't go in, the person is told (once per reason). A fake floor and a hand-driven clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { typedWatchOf } from '../src/server/roster/dispatch-hooks.js';
import { GRACE_MS, STOPPED_AFTER_MS } from '../src/server/dispatch/typed-watch.js';
import { holdsIn, isTypedEvidence } from '../src/server/dispatch/evidence.js';
import { FakeFloor, ask, clock, office, records, userEntry } from './dispatch-helpers.js';

function rig(floor: FakeFloor) {
  const o = office(floor);
  const due: { at: number; fn: () => Promise<void> }[] = [];
  const start = clock.now;
  typedWatchOf(o.roster)!.configure({ schedule: (fn, ms) => void due.push({ at: clock.now + ms, fn }) });
  const tick = async (ms: number) => {
    const until = clock.now + ms;
    for (;;) {
      due.sort((a, b) => a.at - b.at);
      const next = due[0];
      if (!next || next.at > until) break;
      due.shift();
      clock.now = Math.max(clock.now, next.at);
      await next.fn();
    }
    clock.now = until;
  };
  return { o, tick, done: () => void (clock.now = start) };
}

test('a queued message whose prompt is an array of blocks (a hook block, then the typed text) is evidence', () => {
  const payload = 'Go with option B.\n[office answer dsp_1 · TELL-lead rev 1]';
  const r = { payload, marker: '[office answer dsp_1 · TELL-lead rev 1]', sessionId: 's1' };
  const line = (prompt: unknown) => JSON.stringify({ type: 'attachment', sessionId: 's1', attachment: { type: 'queued_command', prompt } });
  assert.equal(isTypedEvidence(line([{ type: 'text', text: '<system-reminder>\nnote\n</system-reminder>\n\n' }, { type: 'text', text: payload }]), r), true);
  assert.equal(isTypedEvidence(line([{ type: 'image', source: {} }, { type: 'text', text: 'Go with option B.\n' }, { type: 'text', text: '[office answer dsp_1 · TELL-lead rev 1]' }]), r), true, 'split blocks still read as one message');
  assert.equal(isTypedEvidence(line([{ type: 'text', text: 'something else' }]), r), false);
  assert.equal(holdsIn([{ type: 'text', text: 'Go with option B.' }], payload), false, 'without the marker it proves nothing');
  // A user entry whose content is blocks, as before.
  assert.equal(isTypedEvidence(userEntry('s1', [{ type: 'text', text: 'note' }, { type: 'text', text: payload }]), r), true);
});

async function answered(floor: FakeFloor, o: ReturnType<typeof office>, status: WorkerInfo['status'] = 'idle') {
  const ada = floor.add('a1', 'Ada', status);
  const e = o.roster.escalations.raise(floor, floor.worker(ada)!, ask('Approve the schema change?'));
  o.roster.flush();
  return { ada, answer: () => o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: 'Go ahead.', by: 'Keith', expectedRev: 0 }) };
}

test('an asleep agent woken with the answer into a new session: looked for there, and received', async () => {
  const floor = new FakeFloor();
  const { o, tick, done } = rig(floor);
  try {
    const { ada, answer } = await answered(floor, o, 'offline');
    floor.unrecorded = true; // the old session never shows it: the wake started a new one
    const res = await answer();
    assert.ok(res.ok);
    assert.equal(records(o, floor)[0].state, 'in-flight');
    // The agent comes up in a new session, whose transcript has the typed message.
    const w = floor.worker(ada)! as WorkerInfo & { sessionId: string };
    w.sessionId = 'sess-a1-0002';
    const file = path.join(floor.dir, 'sess-a1-0002.jsonl');
    writeFileSync(file, `${userEntry('sess-a1-0002', floor.prompts[0].text)}\n`);
    floor.files.set(ada, file);
    Object.assign(w, { status: 'working' });
    await tick(4_000);
    const r = records(o, floor)[0];
    assert.deepEqual([r.state, r.confirmedBy], ['submitted', 'system'], 'received, not a false "not received"');
  } finally {
    done();
  }
});

test('woken with the answer, then stopped before its session showed it: outcome-unknown at once, said to the person', async () => {
  const floor = new FakeFloor();
  const { o, tick, done } = rig(floor);
  try {
    const { ada, answer } = await answered(floor, o, 'offline');
    floor.unrecorded = true;
    assert.ok((await answer()).ok);
    // Its terminal exits during the start (a resume that failed): asleep again.
    Object.assign(floor.worker(ada)!, { status: 'exited' });
    await tick(STOPPED_AFTER_MS + 2_000);
    const r = records(o, floor)[0];
    assert.equal(r.state, 'outcome-unknown', `said well within the ${GRACE_MS / 1000} s grace`);
    assert.match(r.history.at(-1)!.note!, /stopped \(asleep or gone\)/);
    assert.ok(floor.toasts.some((t) => /Ada/.test(t)), 'the person is told');
    assert.deepEqual(o.roster.dispatch.unsettled(floor.id).map((x) => x.id), [r.id], 'on the Needs you card');
  } finally {
    done();
  }
});

test('an answer owed to an agent that is asleep wakes it with the answer; a wake that fails is said once', async () => {
  const floor = new FakeFloor();
  const { o, done } = rig(floor);
  try {
    // A question is up in its terminal: the answer is owed, typed once its turn is over.
    const { ada, answer } = await answered(floor, o, 'needs_input');
    assert.ok((await answer()).ok);
    assert.equal(floor.prompts.length, 0, 'not typed into the dialog');
    // The office restarts: the agent is asleep. Waking it fails the first time (say its worktree is busy).
    const wake = floor.wake.bind(floor);
    let fail = true;
    floor.wake = (id: string, text?: string, by?: string) => (fail ? 'its folder is locked' : wake(id, text, by));
    Object.assign(floor.worker(ada)!, { status: 'offline' });
    assert.deepEqual(o.roster.delivery.tick(floor), [ada], 'the minute look finds the asleep agent owed an answer');
    o.roster.onWorker(floor, floor.worker(ada)!);
    await until(() => floor.toasts.some((t) => /Couldn't deliver what's waiting for Ada/.test(t)));
    o.roster.onWorker(floor, floor.worker(ada)!);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(floor.toasts.filter((t) => /Couldn't deliver/.test(t)).length, 1, 'said once per reason, not every minute');
    // The next try wakes it with the answer.
    fail = false;
    o.roster.onWorker(floor, floor.worker(ada)!);
    await until(() => floor.prompts.length === 1);
    assert.match(floor.prompts[0].text, /Approve the schema change\?/);
    assert.equal(floor.worker(ada)!.status, 'starting', 'woken with it');
  } finally {
    done();
  }
});

async function until(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

