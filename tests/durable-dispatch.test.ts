// Slice 1B-1, durable answers and dispatch (server/answers/, server/dispatch/, roster/escalation-answer.ts):
// what the person decided is on disk before anything is typed, every attempt is a dispatch record whose
// intent is written first, and a restart reconciles what was left: from the agent's own transcript (only
// the typed user message in the recorded session counts), never by typing it again. The guarantee is
// durable intent plus reconciliation, and no automatic replay of an ambiguous attempt; never exactly-once.
// Crashes are simulated by dropping the office between steps and making a new one from disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AuditLog, readAudit, useAudit } from '../src/server/audit/index.js';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import { stateWords } from '../src/shared/dispatch.js';
import { answerGroup } from '../src/server/roster/escalation-answer.js';
import { personAct } from '../src/server/roster/dispatch-person.js';
import { AnswerStore } from '../src/server/answers/store.js';
import { FakeFloor, ask, crashAndRestart, failWritesFrom, office, records, settle } from './dispatch-helpers.js';
import { until } from './wait.js';

const MARKER = /\[office answer dsp_[0-9A-Z]{26} · ESC-[0-9a-f]+ rev (\d+)\]/;

function raised(title = 'Approve the schema change?') {
  const floor = new FakeFloor();
  const o = office(floor);
  const ada = floor.add('a1', 'Ada');
  const e = o.roster.escalations.raise(floor, floor.worker(ada)!, ask(title));
  // What the office saved before: the escalation is on disk.
  o.roster.flush();
  return { floor, o, ada, e };
}

const esc = (o: ReturnType<typeof office>, floor: FakeFloor, id: string) => o.roster.data(floor.id).escalations.find((x) => x.id === id)!;

test('an answer: the revision, then the intent, then typing with the marker as its last line, then the escalation', async () => {
  const { floor, o, e } = raised();
  const r = await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: 'Go ahead.', by: 'Keith', expectedRev: 0 });
  assert.ok(r.ok);
  assert.equal(floor.prompts.length, 1);
  const typed = floor.prompts[0].text;
  assert.match(typed.split('\n').at(-1)!, MARKER, 'the marker is the typed message’s own last line');
  const [rec] = records(o, floor);
  assert.equal(rec.state, 'submitted');
  assert.equal(rec.confirmedBy, 'system');
  assert.ok(typed.includes(rec.payload), 'the payload recorded before typing is exactly what was typed');
  assert.deepEqual(rec.history.map((h) => h.state), ['prepared', 'in-flight', 'submitted']);
  assert.equal(rec.sessionId, 'sess-a1-0001');
  assert.ok(rec.transcriptPath && rec.transcriptOffset! > 0, 'where to look, captured before typing');
  const x = esc(o, floor, e.id);
  assert.equal(x.status, 'resolved');
  assert.deepEqual([x.resolution!.answerRev, x.resolution!.dispatchId, x.resolution!.delivered], [1, rec.id, true]);
  const [line] = await o.roster.dispatch.answers.history(floor.id, `esc:${e.id}`);
  assert.deepEqual([line.kind, line.text, line.by, line.rev], ['approve', 'Go ahead.', 'Keith', 1]);
});

test('dispatch-crash-before-type: the intent saved, the office stops before marking it in flight: not sent, nothing typed, answer again', async () => {
  const { floor, o, e } = raised();
  failWritesFrom(o, 2);
  const r = await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: 'Go ahead.', by: 'Keith', expectedRev: 0 });
  assert.ok(!r.ok && r.status === 500 && /nothing was sent/.test(r.error));
  assert.equal(floor.prompts.length, 0);
  const o2 = crashAndRestart(floor, o);
  const done = await o2.roster.reconcile();
  assert.deepEqual(done.map((x) => [x.from, x.to]), [['prepared', 'not-sent']]);
  assert.equal(floor.prompts.length, 0, 'never typed by the restart');
  assert.equal(esc(o2, floor, e.id).status, 'open', 'release 47 would see it open: safe to answer');
  // The person answers again: a new revision, typed once.
  const again = await o2.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: 'Go ahead.', by: 'Keith', expectedRev: 0 });
  assert.ok(again.ok);
  assert.equal(floor.prompts.length, 1);
  assert.equal(MARKER.exec(floor.prompts[0].text)![1], '2');
  assert.equal((await o2.roster.dispatch.answers.history(floor.id, `esc:${e.id}`)).length, 2, 'both revisions kept');
});

test('dispatch-crash-after-type: typed, the outcome not saved: the restart finds it in the agent’s session, settles it, never types it again', async () => {
  const { floor, o, e } = raised();
  failWritesFrom(o, 3);
  const r = await o.roster.escalations.answer(floor, e.id, { verdict: 'reply', raw: 'Use matrix B.', by: 'Keith' });
  assert.ok(r.ok && r.results[0].pending, 'step 8 waits: the outcome is not on disk');
  assert.equal(esc(o, floor, e.id).status, 'open', 'the escalation is updated only after settle');
  assert.equal(floor.prompts.length, 1);
  const o2 = crashAndRestart(floor, o);
  await o2.roster.reconcile();
  const [rec] = records(o2, floor);
  assert.equal(rec.state, 'submitted');
  assert.equal(rec.confirmedBy, 'system');
  const x = esc(o2, floor, e.id);
  assert.equal(x.status, 'resolved');
  assert.equal(x.resolution!.delivered, true);
  assert.equal(x.resolution!.text, 'Use matrix B.');
  assert.equal(floor.prompts.length, 1, 'typed once');
});

test('dispatch-unknown: no evidence after a crash → outcome-unknown, nothing re-sent; Send again is a new dispatch that supersedes it', async () => {
  const { floor, o, e } = raised();
  floor.unrecorded = true;
  failWritesFrom(o, 3);
  await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: 'Yes.', by: 'Keith' });
  floor.unrecorded = false;
  const o2 = crashAndRestart(floor, o);
  await o2.roster.reconcile();
  const [old] = records(o2, floor);
  assert.equal(old.state, 'outcome-unknown');
  assert.equal(floor.prompts.length, 1, 'not replayed');
  assert.equal(esc(o2, floor, e.id).status, 'open', 'never delivered:false for an unclear attempt');
  assert.deepEqual(o2.roster.dispatch.unsettled(floor.id).map((x) => x.id), [old.id]);
  const out = await personAct(o2.roster, floor, old.id, 'send-again', 'Keith');
  assert.deepEqual(out, {});
  assert.equal(floor.prompts.length, 2);
  const now = records(o2, floor);
  const next = now.find((x) => x.id !== old.id)!;
  const was = now.find((x) => x.id === old.id)!;
  assert.equal(was.state, 'person-chose-resend');
  assert.equal(was.supersededBy, next.id);
  assert.equal(next.supersedes, old.id);
  assert.equal(next.answerRev, 1, 'the same revision, a new attempt');
  assert.ok(floor.prompts[1].text.includes(next.marker) && !floor.prompts[1].text.includes(old.marker));
  assert.equal(esc(o2, floor, e.id).resolution?.dispatchId, next.id);
});

test('dispatch-held-survives-restart: held on disk at once (critical flush), typed once after the restart with the same dispatch id', async () => {
  const floor = new FakeFloor();
  const o = office(floor);
  const pm = floor.add('p1', 'Niklaus', 'working');
  // The lead-panel tell, after its turn: held.
  const d = o.roster.data(floor.id);
  d.members.pm = { ...d.members.pm, phase: 'active', workerId: pm };
  assert.equal(await o.roster.interrupts.tell(floor, "What's blocking the team?", 'Keith', 'after'), undefined);
  assert.equal(floor.prompts.length, 0);
  const [rec] = records(o, floor);
  assert.equal(rec.state, 'held');
  // On disk without any flush or save timer (the critical flush), in release 47's held format plus dispatchId.
  const saved = JSON.parse(readFileSync(path.join(o.dataDir, 'roster', `${floor.id}.json`), 'utf8'));
  assert.equal(saved.held.length, 1);
  assert.equal(saved.held[0].id, rec.id);
  assert.equal(saved.held[0].dispatchId, rec.id);
  for (const k of ['workerId', 'origin', 'text', 'createdAt', 'expiresAt']) assert.ok(k in saved.held[0], k);
  assert.ok(saved.held[0].text.endsWith(rec.marker));
  const o2 = crashAndRestart(floor, o);
  await o2.roster.reconcile();
  assert.equal(records(o2, floor)[0].state, 'held', 'still in the held list: left held');
  floor.set(pm, 'idle');
  // Marked in flight on disk, typed, then received (its session shows it): wait for that, not a sleep.
  await until(() => records(o2, floor)[0].state === 'submitted', 'the held tell typed and received after the restart');
  await settle();
  assert.equal(floor.prompts.length, 1);
  assert.ok(floor.prompts[0].text.includes(rec.payload));
  const after = records(o2, floor)[0];
  assert.equal(after.state, 'submitted');
  assert.equal(after.id, rec.id, 'the same dispatch id');
  assert.ok(after.history.some((h) => h.state === 'in-flight'), 'marked in flight before it was typed');
  floor.set(pm, 'working');
  floor.set(pm, 'idle');
  await settle();
  assert.equal(floor.prompts.length, 1, 'once');
});

test('an owed answer (a dialog up) keeps its dispatch id and is marked in flight before it goes in', async () => {
  const { floor, o, ada, e } = raised();
  floor.set(ada, 'needs_input');
  await o.roster.escalations.resolve(floor, e.id, 'approve', 'Yes.', 'Keith');
  const [rec] = records(o, floor);
  assert.deepEqual([rec.channel, rec.state], ['hold', 'held']);
  assert.equal(esc(o, floor, e.id).resolution?.delivered, false, 'owed: truly not typed yet');
  floor.set(ada, 'done');
  await until(() => records(o, floor)[0].state === 'submitted', 'the owed answer typed and received');
  await settle();
  assert.equal(floor.prompts.length, 1);
  assert.ok(floor.prompts[0].text.includes(rec.payload));
  assert.equal(records(o, floor)[0].state, 'submitted');
  assert.equal(records(o, floor).length, 1, 'no new dispatch minted for the owed answer');
});

test('dispatch-grouped-card: one card answering two escalations: one group id, a dispatch per member, each its own revision', async () => {
  const floor = new FakeFloor();
  const o = office(floor);
  const ada = floor.add('a1', 'Ada');
  const bob = floor.add('b1', 'Bob');
  const e1 = o.roster.escalations.raise(floor, floor.worker(ada)!, ask('Which matrix?'));
  const e2 = o.roster.escalations.raise(floor, floor.worker(bob)!, ask('Matrix for approvals?'));
  const r = await answerGroup(o.roster, floor, { id: e1.id, verdict: 'reply', raw: 'Matrix B.', by: 'Keith', expectedRev: 0 }, [{ id: e2.id, verdict: 'reply', raw: 'Matrix B.', by: 'Keith' }]);
  assert.ok(r.ok);
  const rs = records(o, floor);
  assert.equal(rs.length, 2);
  assert.ok(rs[0].groupId && rs[0].groupId === rs[1].groupId);
  assert.deepEqual(rs.map((x) => x.decision).sort(), [`esc:${e1.id}`, `esc:${e2.id}`].sort());
  assert.deepEqual(rs.map((x) => x.answerRev), [1, 1]);
  assert.deepEqual([esc(o, floor, e1.id).status, esc(o, floor, e2.id).status], ['resolved', 'resolved']);
  assert.equal(floor.prompts.length, 2);
});

test('answer-stale-409: a stale expectedRev is a 409 with the current state, nothing written or typed; two at once: one wins', async () => {
  const { floor, o, e } = raised();
  const stale = await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: '', by: 'Keith', expectedRev: 1 });
  assert.ok(!stale.ok);
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.current, { decision: `esc:${e.id}`, rev: 0, state: 'open' });
  assert.equal(o.roster.dispatch.answers.rev(floor.id, `esc:${e.id}`), 0, 'no revision written');
  assert.equal(records(o, floor).length, 0, 'no dispatch written');
  assert.equal(floor.prompts.length, 0, 'nothing typed');
  const [a, b] = await Promise.all([o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: '', by: 'Keith', expectedRev: 0 }), o.roster.escalations.answer(floor, e.id, { verdict: 'reject', raw: 'No.', by: 'Sam', expectedRev: 0 })]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  const lost = a.ok ? b : a;
  assert.ok(!lost.ok && lost.status === 409);
  assert.equal(floor.prompts.length, 1);
  assert.equal(o.roster.dispatch.answers.rev(floor.id, `esc:${e.id}`), 1);
  // Answered now: the page's rev 0 is stale.
  const late = await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: '', by: 'Keith', expectedRev: 0 });
  assert.ok(!late.ok && late.status === 409 && late.current?.state === 'answered by Keith');
});

test('person-confirmed-distinct: It went through is stored and shown as a person’s confirmation, never as the system’s', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dd-audit-'));
  useAudit(new AuditLog(dir));
  const { floor, o, e } = raised();
  floor.unrecorded = true;
  failWritesFrom(o, 3);
  await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: 'Yes.', by: 'Keith' });
  const o2 = crashAndRestart(floor, o);
  await o2.roster.reconcile();
  const [rec] = records(o2, floor);
  assert.equal(rec.state, 'outcome-unknown');
  assert.deepEqual(await personAct(o2.roster, floor, rec.id, 'went-through', 'Keith'), {});
  const now = records(o2, floor)[0];
  assert.equal(now.state, 'person-confirmed-sent');
  assert.equal(now.confirmedBy, 'person');
  assert.notEqual(now.state, 'submitted');
  assert.match(stateWords(now), /a person’s confirmation, not the office’s/);
  assert.doesNotMatch(stateWords(now), /office saw it/);
  const ev = readAudit({ floor: floor.id, limit: 200 }).events.find((x) => x.action === 'dispatch.person-confirmed')!;
  assert.equal(ev.actor.kind, 'human');
  assert.match(ev.summary, /a person said it went through; not seen by the office/);
  assert.deepEqual(ev.ids, { dispatchId: rec.id, decision: `esc:${e.id}`, answerRev: 1 });
  assert.equal(esc(o2, floor, e.id).status, 'resolved');
  assert.equal(floor.prompts.length, 1, 'nothing typed by confirming');
  useAudit(undefined);
});

test('answer-store-complete-history: every revision’s full text is in the answer store, chained, after the audit truncated it', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dd-answers-'));
  const s = new AnswerStore(dir);
  const texts = ['a', 'b', 'c'].map((ch) => ch.repeat(15_000));
  for (const [i, t] of texts.entries()) await s.append('f1', { decision: 'q:brd.json#OQ-1', kind: i ? 'correction' : 'answer', text: t, by: 'Keith', at: i, ...(i ? { supersedes: i } : {}) });
  const fresh = new AnswerStore(dir);
  const h = await fresh.history('f1', 'q:brd.json#OQ-1');
  assert.deepEqual(h.map((l) => [l.rev, l.text.length, l.text[0]]), [[1, 15_000, 'a'], [2, 15_000, 'b'], [3, 15_000, 'c']]);
  assert.deepEqual(await fresh.verify('f1'), { ok: true });
  // The audit keeps only lengths of an escalation's reply; the store has the text.
  const adir = mkdtempSync(path.join(os.tmpdir(), 'dd-audit-'));
  useAudit(new AuditLog(adir));
  const { floor, o, e } = raised();
  const long = `Use matrix B. ${'x'.repeat(3_900)}`.slice(0, 4000);
  await o.roster.escalations.answer(floor, e.id, { verdict: 'reply', raw: long, by: 'Keith' });
  const audit = readAudit({ floor: floor.id, limit: 200 }).events;
  assert.ok(!JSON.stringify(audit).includes(long), 'the audit never holds the whole text');
  assert.equal((await o.roster.dispatch.answers.history(floor.id, `esc:${e.id}`))[0].text, long);
  useAudit(undefined);
  // An edited line shows.
  const file = s.file('f1');
  const raw = readFileSync(file, 'utf8').replace('"by":"Keith"', '"by":"Mallory"');
  (await import('node:fs')).writeFileSync(file, raw);
  assert.equal((await new AnswerStore(dir).verify('f1')).ok, false);
});

test('a held answer typed just before a crash that lost the roster’s note of it is let go after the restart, never typed again', async () => {
  const floor = new FakeFloor();
  const o = office(floor);
  const pm = floor.add('p1', 'Niklaus', 'working');
  const d = o.roster.data(floor.id);
  d.members.pm = { ...d.members.pm, phase: 'active', workerId: pm };
  await o.roster.interrupts.tell(floor, 'Status?', 'Keith', 'after');
  floor.set(pm, 'idle');
  await until(() => records(o, floor)[0].state === 'submitted', 'the held tell typed and received');
  await settle();
  assert.equal(floor.prompts.length, 1);
  assert.equal(records(o, floor)[0].state, 'submitted');
  // The roster's save of the dropped held prompt never happened: on disk it is still held.
  const o2 = crashAndRestart(floor, o);
  assert.equal(o2.roster.data(floor.id).held.length, 1);
  await o2.roster.reconcile();
  floor.set(pm, 'working');
  floor.set(pm, 'idle');
  await until(() => o2.roster.data(floor.id).held.length === 0, 'the settled held tell let go');
  await settle();
  assert.equal(floor.prompts.length, 1, 'not typed again');
  assert.equal(o2.roster.data(floor.id).held.length, 0, 'let go');
});
