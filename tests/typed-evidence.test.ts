// Typed is not delivered (dispatch/typed-watch.ts, after Sophie's answers of 16 Oct sat unsent in her input box
// while the office said "submitted"): a dispatch typed into an agent's terminal is submitted only once the
// agent's own session shows a type:user message carrying its marker. Until then it is "typed, not received
// yet"; with nothing after the grace, one Enter when the input box still holds the text, else outcome-unknown
// said to the person, never typed again. A fake floor (Claude Code-shaped transcripts, a fake screen and Enter)
// and a hand-driven clock: no real agent, no real timers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { stateWords, unknownLine, type DispatchRecord } from '../src/shared/dispatch.js';
import { sentWords } from '../src/shared/followthrough.js';
import { typedWatchOf } from '../src/server/roster/dispatch-hooks.js';
import { GRACE_MS, QUEUED_MAX_MS } from '../src/server/dispatch/typed-watch.js';
import { inputBoxHolds, inputBoxText } from '../src/server/dispatch/input-box.js';
import { isTypedEnqueue, isTypedEvidence } from '../src/server/dispatch/evidence.js';
import { FakeFloor, ask, clock, crashAndRestart, office, records, settle, userEntry } from './dispatch-helpers.js';

/** A fake floor whose agents' terminals have a screen (an input box) and an Enter key. */
class ScreenFloor extends FakeFloor {
  /** What the input box shows, by worker. */
  box = new Map<string, string>();
  enters: string[] = [];
  /** What an Enter does: by default nothing reaches the session (the text stays put). */
  onEnter: (id: string) => void = () => {};
  screen = (id: string) => {
    const b = this.box.get(id);
    return b === undefined ? undefined : `● Done.\n\n${'─'.repeat(40)}\n> ${b}\n${'─'.repeat(40)}\n  ? for shortcuts`;
  };
  enter = (id: string) => {
    this.enters.push(id);
    this.onEnter(id);
    return undefined;
  };
  /** The typed message lands in the session now (Claude Code wrote it). */
  land(id: string, text: string) {
    appendFileSync(this.files.get(id)!, `${userEntry(`sess-${id}-0001`, text)}\n`);
  }
  /** Typed mid-turn, Claude Code queued it with its text and handed it to the model inside the turn (absorbed_mid_turn). */
  absorb(id: string, text: string) {
    const sessionId = `sess-${id}-0001`;
    const at = new Date(clock.now).toISOString();
    const lines = [{ type: 'queue-operation', operation: 'enqueue', timestamp: at, sessionId, content: text }, { type: 'attachment', isSidechain: false, sessionId, attachment: { type: 'queued_command', prompt: text }, timestamp: at }];
    appendFileSync(this.files.get(id)!, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  }
  /** Claude Code queued typed input (no text: older versions write none for typed input). */
  queue(id: string, at = clock.now) {
    appendFileSync(this.files.get(id)!, `${JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date(at).toISOString(), sessionId: `sess-${id}-0001` })}\n`);
  }
}

/** The watch on a hand-driven clock: `tick(ms)` moves time on and runs what fell due. */
function rig(floor: ScreenFloor) {
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
  return { o, tick, done: () => void (clock.now = start), pending: () => due.length };
}

async function raisedAndAnswered(floor: ScreenFloor, o: ReturnType<typeof office>) {
  const ada = floor.add('a1', 'Ada');
  const e = o.roster.escalations.raise(floor, floor.worker(ada)!, ask('Approve the schema change?'));
  o.roster.flush();
  floor.unrecorded = true; // typing reaches the terminal, the session doesn't show it
  const r = await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: 'Go ahead.', by: 'Keith', expectedRev: 0 });
  assert.ok(r.ok);
  floor.unrecorded = false;
  const esc = () => o.roster.data(floor.id).escalations.find((x) => x.id === e.id)!;
  return { ada, e, esc, rec: () => records(o, floor)[0] };
}

test('typed with no user line in the session: not submitted, typed-not-received, then outcome-unknown said to the person; never typed again', async () => {
  const floor = new ScreenFloor();
  const { o, tick, done } = rig(floor);
  try {
    const { esc, rec } = await raisedAndAnswered(floor, o);
    assert.equal(floor.prompts.length, 1);
    let r = rec();
    assert.equal(r.state, 'in-flight', 'typed is not submitted');
    assert.ok(r.typedAt !== undefined);
    assert.equal(r.confirmedBy, undefined, 'nobody confirmed anything');
    assert.equal(stateWords(r), 'Typed, not received yet');
    assert.equal(sentWords({ state: r.state, typedAt: r.typedAt }), 'Typed, not received yet', 'never called sent');
    // Step 8 ran (the escalation is answered, never owed again), flagged as typed, not received.
    assert.deepEqual([esc().status, esc().resolution?.delivered, esc().resolution?.typed], ['resolved', true, true]);
    await tick(GRACE_MS - 5_000);
    assert.equal(rec().state, 'in-flight', 'still within the grace');
    await tick(10_000);
    r = rec();
    assert.equal(r.state, 'outcome-unknown');
    assert.match(r.history.at(-1)!.note!, /typed into Ada's terminal but not received/);
    assert.equal(unknownLine(r), "Typed into Ada's terminal but not received: check Ada's terminal, or Send again.");
    assert.ok(floor.toasts.some((t) => /Typed into Ada's terminal but not received/.test(t)), 'the person is told');
    assert.deepEqual(o.roster.dispatch.unsettled(floor.id).map((x) => x.id), [r.id], 'on the Needs you card');
    assert.equal(floor.enters.length, 0, 'no input box seen: nothing pressed');
    assert.equal(floor.prompts.length, 1, 'never typed again by the office');
  } finally {
    done();
  }
});

test('typed, then the user line with its marker lands: submitted, confirmed by the system, once', async () => {
  const floor = new ScreenFloor();
  const { o, tick, done } = rig(floor);
  try {
    const { ada, esc, rec } = await raisedAndAnswered(floor, o);
    await tick(4_000);
    assert.equal(rec().state, 'in-flight');
    floor.land(ada, floor.prompts[0].text);
    await tick(2_000);
    const r = rec();
    assert.deepEqual([r.state, r.confirmedBy], ['submitted', 'system']);
    assert.match(r.history.at(-1)!.note!, /seen in the agent’s session/);
    assert.equal(esc().resolution?.typed, undefined, 'no longer "typed, not received yet"');
    assert.equal(stateWords(r), 'Received (the office saw it arrive)');
    await tick(GRACE_MS * 3);
    assert.equal(rec().state, 'submitted', 'settled once');
    assert.equal(rec().history.filter((h) => h.state === 'submitted').length, 1);
  } finally {
    done();
  }
});

test('queued while the agent is mid-turn (enqueue, then the user line later): waits past the grace, submitted when it lands', async () => {
  const floor = new ScreenFloor();
  const { o, tick, done } = rig(floor);
  try {
    const { ada, rec } = await raisedAndAnswered(floor, o);
    floor.queue(ada);
    await tick(GRACE_MS * 4);
    assert.equal(rec().state, 'in-flight', 'queued: not lost, not received');
    assert.equal(floor.enters.length, 0, 'never pressed while queued');
    floor.land(ada, floor.prompts[0].text);
    await tick(10_000);
    assert.deepEqual([rec().state, rec().confirmedBy], ['submitted', 'system']);
  } finally {
    done();
  }
});

test('queued for too long: outcome-unknown, never typed again', async () => {
  const floor = new ScreenFloor();
  const { o, tick, done } = rig(floor);
  try {
    const { ada, rec } = await raisedAndAnswered(floor, o);
    floor.queue(ada);
    await tick(QUEUED_MAX_MS + 10_000);
    assert.equal(rec().state, 'outcome-unknown');
    assert.match(rec().history.at(-1)!.note!, /queued, still not received/);
    assert.equal(floor.prompts.length, 1);
  } finally {
    done();
  }
});

test('still in the input box after the grace: one Enter, and submitted once the session shows it', async () => {
  const floor = new ScreenFloor();
  const { o, tick, done } = rig(floor);
  try {
    const { ada, rec } = await raisedAndAnswered(floor, o);
    const r0 = rec();
    floor.box.set(ada, `[Pasted text #1 +${r0.payload.split('\n').length + 1} lines]`);
    floor.onEnter = (id) => {
      floor.box.set(id, '');
      floor.land(id, floor.prompts[0].text);
    };
    await tick(GRACE_MS + 2_000);
    assert.deepEqual(floor.enters, [ada], 'one Enter');
    assert.ok(rec().enterAt !== undefined, 'recorded, so never pressed again');
    await tick(4_000);
    assert.deepEqual([rec().state, rec().confirmedBy], ['submitted', 'system']);
    await tick(GRACE_MS * 3);
    assert.deepEqual(floor.enters, [ada], 'never a second Enter');
    assert.equal(floor.prompts.length, 1);
  } finally {
    done();
  }
});

test('Enter pressed once and still nothing: outcome-unknown after another grace, never a second Enter or a re-type', async () => {
  const floor = new ScreenFloor();
  const { o, tick, done } = rig(floor);
  try {
    const { ada, rec } = await raisedAndAnswered(floor, o);
    floor.box.set(ada, rec().payload.split('\n').at(-1)!); // the marker line still showing
    await tick(GRACE_MS + 2_000);
    assert.deepEqual(floor.enters, [ada]);
    await tick(GRACE_MS + 2_000);
    assert.equal(rec().state, 'outcome-unknown');
    assert.match(rec().history.at(-1)!.note!, /Enter pressed once/);
    await tick(GRACE_MS * 4);
    assert.deepEqual(floor.enters, [ada], 'one Enter in all');
    assert.equal(floor.prompts.length, 1);
    // It turns up after all (someone pressed Enter in the terminal): submitted then, nothing typed.
    floor.land(ada, floor.prompts[0].text);
    await tick(60_000);
    assert.deepEqual([rec().state, rec().confirmedBy], ['submitted', 'system']);
    assert.match(rec().history.at(-1)!.note!, /after all/);
    assert.equal(floor.prompts.length, 1);
  } finally {
    done();
  }
});

test('a dialog up when the grace runs out: no Enter (it would pick an option), outcome-unknown', async () => {
  const floor = new ScreenFloor();
  const { o, tick, done } = rig(floor);
  try {
    const { ada, rec } = await raisedAndAnswered(floor, o);
    floor.box.set(ada, rec().marker);
    Object.assign(floor.worker(ada)!, { status: 'needs_input' });
    await tick(GRACE_MS + 2_000);
    assert.equal(floor.enters.length, 0);
    assert.equal(rec().state, 'outcome-unknown');
  } finally {
    done();
  }
});

test('an answer that arrives at once (Claude Code wrote it before the office looked): submitted straight away', async () => {
  const floor = new ScreenFloor();
  const { o, done } = rig(floor);
  try {
    const ada = floor.add('a1', 'Ada');
    const e = o.roster.escalations.raise(floor, floor.worker(ada)!, ask('Approve?'));
    await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: 'Yes.', by: 'Keith', expectedRev: 0 });
    const [r] = records(o, floor);
    assert.deepEqual([r.state, r.confirmedBy, r.typedAt], ['submitted', 'system', undefined]);
  } finally {
    done();
  }
});

test('an agent with no transcript: submitted with no confirmation, and it reads so', async () => {
  const floor = new ScreenFloor();
  const { o, done } = rig(floor);
  try {
    const ada = floor.add('a1', 'Ada');
    floor.transcript = () => undefined;
    const e = o.roster.escalations.raise(floor, floor.worker(ada)!, ask('Approve?'));
    await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: 'Yes.', by: 'Keith', expectedRev: 0 });
    const [r] = records(o, floor);
    assert.deepEqual([r.state, r.confirmedBy], ['submitted', undefined]);
    assert.equal(stateWords(r), 'Typed (this agent keeps no transcript to confirm it)');
  } finally {
    done();
  }
});

test('a held answer typed at the turn’s end: typed-not-received until the session shows it, never typed twice', async () => {
  const floor = new ScreenFloor();
  const { o, tick, done } = rig(floor);
  try {
    const pm = floor.add('p1', 'Niklaus', 'working');
    const d = o.roster.data(floor.id);
    d.members.pm = { ...d.members.pm, phase: 'active', workerId: pm };
    assert.equal(await o.roster.interrupts.tell(floor, "What's blocking the team?", 'Keith', 'after'), undefined);
    assert.equal(records(o, floor)[0].state, 'held');
    floor.unrecorded = true;
    floor.set(pm, 'idle');
    await settle();
    floor.unrecorded = false;
    assert.equal(floor.prompts.length, 1);
    assert.equal(records(o, floor)[0].state, 'in-flight');
    assert.ok(records(o, floor)[0].typedAt !== undefined);
    floor.set(pm, 'working');
    floor.set(pm, 'idle');
    await settle();
    assert.equal(floor.prompts.length, 1, 'never typed twice');
    floor.land(pm, floor.prompts[0].text);
    await tick(3_000);
    assert.deepEqual([records(o, floor)[0].state, records(o, floor)[0].confirmedBy], ['submitted', 'system']);
  } finally {
    done();
  }
});

test('a restart while typed-not-received: the watch takes it on again (no premature outcome-unknown), submitted when it lands', async () => {
  const floor = new ScreenFloor();
  const { o, done } = rig(floor);
  try {
    const { ada, rec } = await raisedAndAnswered(floor, o);
    assert.equal(rec().state, 'in-flight');
    const o2 = crashAndRestart(floor, o);
    const due: (() => Promise<void>)[] = [];
    typedWatchOf(o2.roster)!.configure({ schedule: (fn) => void due.push(fn) });
    await o2.roster.reconcile();
    const [r] = records(o2, floor);
    assert.equal(r.state, 'in-flight', 'handed back to the watch, not outcome-unknown');
    assert.ok(typedWatchOf(o2.roster)!.watching(floor.id, r.id));
    floor.land(ada, floor.prompts[0].text);
    await due.shift()!();
    assert.equal(records(o2, floor)[0].state, 'submitted');
    assert.equal(floor.prompts.length, 1);
  } finally {
    done();
  }
});

test('the input box read off a Claude Code screen: its text, a collapsed paste, the marker wrapped by the terminal', () => {
  const rule = '─'.repeat(30);
  const r = { payload: 'line one\nline two\n\n[office answer dsp_X · ESC-1 rev 1]', marker: '[office answer dsp_X · ESC-1 rev 1]' } as Pick<DispatchRecord, 'payload' | 'marker'>;
  assert.equal(inputBoxText(`hello\n${rule}\n> some text\n${rule}\n  ? for shortcuts`), 'some text');
  assert.equal(inputBoxText(`╭${'─'.repeat(20)}╮\n│ > old box │\n╰${'─'.repeat(20)}╯`), 'old box');
  assert.equal(inputBoxText('no box here'), undefined);
  assert.equal(inputBoxHolds(`${rule}\n> \n${rule}`, r), false, 'an empty box');
  assert.equal(inputBoxHolds(`${rule}\n> [Pasted text #1 +3 lines]\n${rule}`, r), true);
  assert.equal(inputBoxHolds(`${rule}\n> [Pasted text #1 +1 lines]\n${rule}`, r), false, 'a shorter paste is someone else’s');
  assert.equal(inputBoxHolds(`${rule}\n> line two [office answer dsp_X · ES\n  C-1 rev 1]\n${rule}`, r), true, 'wrapped');
  assert.equal(inputBoxHolds(undefined, r), undefined);
});

test('a queue-operation counts as typed input only when it is not one of Claude Code’s own notifications, in the session, after the typing', () => {
  const r = { marker: '[office answer dsp_X · ESC-1 rev 1]', sessionId: 's1', typedAt: Date.parse('2026-10-16T14:16:24Z') };
  const op = (extra: Record<string, unknown>) => JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-16T14:21:41Z', sessionId: 's1', ...extra });
  assert.equal(isTypedEnqueue(op({}), r), true);
  assert.equal(isTypedEnqueue(op({ content: '<task-notification>\n<task-id>b1</task-id>' }), r), false, "Sophie's case: a background task's notice");
  assert.equal(isTypedEnqueue(op({ content: '<agent-message from="a1">' }), r), false);
  assert.equal(isTypedEnqueue(op({ sessionId: 's2' }), r), false);
  assert.equal(isTypedEnqueue(op({ timestamp: '2026-10-16T14:00:00Z' }), r), false, 'before the typing');
  assert.equal(isTypedEnqueue(op({ operation: 'dequeue' }), r), false);
});

test('typed mid-turn and absorbed into the turn (a queued_command attachment, no user entry): received', async () => {
  const floor = new ScreenFloor();
  const { o, tick, done } = rig(floor);
  try {
    const { ada, rec } = await raisedAndAnswered(floor, o);
    floor.absorb(ada, floor.prompts[0].text);
    await tick(3_000);
    assert.deepEqual([rec().state, rec().confirmedBy], ['submitted', 'system']);
  } finally {
    done();
  }
});

test('only the queued_command attachment in the session counts: not a sidechain, not another attachment', () => {
  const marker = '[office answer dsp_X · ESC-1 rev 1]';
  const r = { payload: `Go ahead.\n\n${marker}`, marker, sessionId: 's1' };
  const att = (extra: Record<string, unknown>, a: Record<string, unknown> = {}) => JSON.stringify({ type: 'attachment', sessionId: 's1', attachment: { type: 'queued_command', prompt: `<pasted_content id="1">\n${r.payload}\n</pasted_content id="1">`, ...a }, ...extra });
  assert.equal(isTypedEvidence(att({}), r), true);
  assert.equal(isTypedEvidence(att({ isSidechain: true }), r), false);
  assert.equal(isTypedEvidence(att({ sessionId: 's2' }), r), false);
  assert.equal(isTypedEvidence(att({}, { type: 'todo_reminder' }), r), false);
  assert.equal(isTypedEvidence(att({}, { prompt: 'Go ahead.' }), r), false, 'without its marker');
});
