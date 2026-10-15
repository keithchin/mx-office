// Slice 1B-1 (server/dispatch/): what counts as evidence that an answer was typed (only the typed user
// message, in the recorded session, from the recorded offset), proposal issues made at most once with an
// unclear outcome left to a person, the rollback guard, the routes' permissions, and the cost of it all.
// The guarantee: durable intent plus reconciliation, and no automatic replay of an ambiguous attempt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { answerMarker, withMarker, type DispatchRecord } from '../src/shared/dispatch.js';
import { Dispatcher } from '../src/server/dispatch/service.js';
import { reconcileOne } from '../src/server/dispatch/reconcile.js';
import { isTypedEvidence } from '../src/server/dispatch/evidence.js';
import { dispatchCommand, rollbackRefusal } from '../src/server/dispatch/guard.js';
import { dispatchRoutes, dispatchView } from '../src/server/http/routes/dispatch.js';
import { rosterFor } from '../src/server/roster/index.js';
import { personAct } from '../src/server/roster/dispatch-person.js';
import { reviveHeld } from '../src/server/roster/held.js';
import type { Proposal } from '../src/shared/roster/types.js';
import { FakeFloor, ask, assistantEntry, clock, crashAndRestart, failWritesFrom, office, records, toolResultEntry, userEntry } from './dispatch-helpers.js';

const ID = 'dsp_01JB0000000000000000000000';

/** A record a crashed office left in flight, pointing at `file` from `offset`. */
function leftInFlight(file: string, offset: number, sessionId = 'sess-A'): DispatchRecord {
  const marker = answerMarker(ID, 'esc:abc123', 1);
  return { id: ID, decision: 'esc:abc123', answerRev: 1, workerId: 'w1', workerName: 'Linus', sessionId, transcriptPath: file, transcriptOffset: offset, payload: withMarker('The Project Manager (Keith) answered your escalation “X”: APPROVED.', marker), marker, channel: 'type', state: 'in-flight', dispatchedAt: 1, createdAt: 1, updatedAt: 1, history: [{ state: 'prepared', at: 1 }, { state: 'in-flight', at: 1 }] };
}

async function judge(lines: string[], opts: { sessionId?: string; otherFile?: string[] } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dd-ev-'));
  const file = path.join(dir, 'sess-A.jsonl');
  const before = `${assistantEntry('sess-A', 'earlier')}\n`;
  writeFileSync(file, before);
  const r = leftInFlight(file, Buffer.byteLength(before), opts.sessionId);
  appendFileSync(file, lines.map((l) => l.replaceAll('<PAYLOAD>', JSON.stringify(r.payload).slice(1, -1))).join('\n') + '\n');
  const d = new Dispatcher({ dataDir: dir, now: () => 2 });
  await d.store.put('f1', r);
  const fresh = new Dispatcher({ dataDir: dir, now: () => 3 });
  await fresh.ready('f1');
  const out = await reconcileOne(fresh, 'f1', fresh.store.get('f1', ID)!, { stillHeld: () => false });
  return { state: out?.state, r };
}

test('dispatch-marker-quoted-in-output: the marker in an assistant message, a tool result, a subagent or quoted text is not evidence', async () => {
  const quoted = await judge([
    assistantEntry('sess-A', 'I received:\n<PAYLOAD>'),
    toolResultEntry('sess-A', 'cat said: <PAYLOAD>'),
    userEntry('sess-A', '<PAYLOAD>', { isSidechain: true }),
    userEntry('sess-A', 'Remember the earlier note> <PAYLOAD> (quoted inline)'),
  ]);
  assert.equal(quoted.state, 'outcome-unknown');
  // The typed message itself is: the payload as whole lines, the marker its last line.
  const real = await judge([assistantEntry('sess-A', 'thinking'), userEntry('sess-A', 'Note from the office: the project was resumed at 9:00.\n\n<PAYLOAD>')]);
  assert.equal(real.state, 'submitted');
  // Text blocks are a typed message too; a tool_result array is not.
  const r = leftInFlight('x', 0);
  assert.equal(isTypedEvidence(userEntry('sess-A', [{ type: 'text', text: r.payload }]), r), true);
  assert.equal(isTypedEvidence(userEntry('sess-A', [{ type: 'tool_result', tool_use_id: 't', content: r.payload }]), r), false);
  assert.equal(isTypedEvidence(userEntry('sess-A', r.payload.replace(r.marker, 'nothing')), r), false, 'the marker must be there');
  assert.equal(isTypedEvidence(userEntry('sess-A', `${r.payload} and more on the same line`), r), false, 'the marker must end its line');
});

test('dispatch-wrong-session: the typed message in another session (or its file) proves nothing; a missing or rotated file is unknown', async () => {
  const other = await judge([userEntry('sess-B', '<PAYLOAD>')]);
  assert.equal(other.state, 'outcome-unknown', 'a different session id in the recorded file');
  // The marker in another session's file: never read.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dd-ev-'));
  const a = path.join(dir, 'sess-A.jsonl');
  const b = path.join(dir, 'sess-B.jsonl');
  writeFileSync(a, `${assistantEntry('sess-A', 'hi')}\n`);
  const r = leftInFlight(a, 0);
  writeFileSync(b, `${userEntry('sess-B', r.payload)}\n${userEntry('sess-A', r.payload)}\n`);
  const d = new Dispatcher({ dataDir: dir, now: () => 2 });
  assert.equal((await reconcileOne(d, 'f1', r, { stillHeld: () => false }))?.state, 'outcome-unknown');
  // Rotated (shorter than the recorded offset) or gone: unknown, never inferred.
  const rotated = await reconcileOne(d, 'f1', { ...r, transcriptOffset: 10_000 }, { stillHeld: () => false });
  assert.equal(rotated?.state, 'outcome-unknown');
  assert.match(rotated!.history.at(-1)!.note!, /shorter/);
  const gone = await reconcileOne(d, 'f1', { ...r, transcriptPath: path.join(dir, 'nope.jsonl') }, { stillHeld: () => false });
  assert.match(gone!.history.at(-1)!.note!, /gone/);
  const none = await reconcileOne(d, 'f1', { ...r, transcriptPath: undefined }, { stillHeld: () => false });
  assert.equal(none?.state, 'outcome-unknown');
});

/** A floor with a pending proposal on disk. */
function proposed() {
  const floor = new FakeFloor();
  const o = office(floor);
  const p: Proposal = { id: 'p-csv', standup: '2026-10-15', role: 'lead-developer', team: 'dev' as Proposal['team'], by: 'Ada', kind: 'task', title: 'Add CSV export', detail: 'Users want it.', status: 'pending' };
  o.roster.data(floor.id).proposals.push(p);
  o.roster.flush();
  return { floor, o };
}
const prop = (o: ReturnType<typeof office>, floor: FakeFloor) => o.roster.data(floor.id).proposals[0];

test('proposal-issue-delayed-visibility: a crash after makeIssue, GitHub search empty (index lag) → unknown, no second issue; found later → linked', async () => {
  const { floor, o } = proposed();
  failWritesFrom(o, 3);
  const err = await o.roster.standups.decide(floor, 'p-csv', 'approve', 'Keith');
  assert.match(String(err), /Couldn't confirm the issue was made/);
  assert.equal(o.issues.length, 1);
  // Slice 1B-4: the proposal's task id just above the marker, which stays the last line.
  assert.match(o.issues[0].draft.body, /\n---\nTask: tsk_[0-9A-Z]{26}\noffice-proposal: p-csv rev 1$/);
  // Approved, no issue, on disk before makeIssue ran: release 47 never offers it again.
  const saved = JSON.parse(readFileSync(path.join(o.dataDir, 'roster', `${floor.id}.json`), 'utf8'));
  assert.equal(saved.proposals[0].status, 'approved');
  assert.equal(saved.proposals[0].issue, undefined);
  const o2 = crashAndRestart(floor, o);
  o2.find.result = null;
  await o2.roster.reconcile();
  const [rec] = records(o2, floor);
  assert.equal(rec.state, 'outcome-unknown');
  assert.match(rec.history.at(-1)!.note!, /not conclusive/);
  assert.equal(o2.issues.length, 1, 'never recreated because a search came back empty');
  assert.equal(o2.roster.approvals(floor, o2.roster.data(floor.id), undefined).filter((a) => a.kind === 'proposal').length, 0, 'not offered for approval again');
  assert.match(String(await o2.roster.standups.decide(floor, 'p-csv', 'approve', 'Keith')), /Already approved/);
  // Check GitHub: nothing yet, nothing changes; then the index catches up.
  assert.match(String((await personAct(o2.roster, floor, rec.id, 'check', 'Keith')).note), /can lag/);
  o2.find.result = { number: 7, url: 'https://github.com/o/r/issues/7' };
  assert.equal((await personAct(o2.roster, floor, rec.id, 'check', 'Keith')).note, 'Found issue #7');
  assert.equal(records(o2, floor)[0].state, 'submitted');
  assert.equal(prop(o2, floor).issue?.number, 7);
  assert.equal(o2.issues.length, 1);
});

test('proposal-issue-search-unavailable: gh can’t search → unknown; It exists links the issue as a person’s word; Create it makes one new attempt', async () => {
  const { floor, o } = proposed();
  failWritesFrom(o, 3);
  await o.roster.standups.decide(floor, 'p-csv', 'approve', 'Keith');
  const o2 = crashAndRestart(floor, o);
  o2.find.result = undefined;
  await o2.roster.reconcile();
  const [rec] = records(o2, floor);
  assert.equal(rec.state, 'outcome-unknown');
  assert.match(rec.history.at(-1)!.note!, /couldn't be searched/);
  assert.equal(o2.issues.length, 1);
  // A gh error from makeIssue is unclear too: never retried by itself.
  const fail = proposed();
  fail.o.roster.deps.makeIssue = async () => ({ error: 'HTTP 502' });
  assert.match(String(await fail.o.roster.standups.decide(fail.floor, 'p-csv', 'approve', 'Keith')), /Couldn't confirm the issue/);
  const [unk] = records(fail.o, fail.floor);
  assert.equal(unk.state, 'outcome-unknown');
  assert.match(String((await personAct(fail.o.roster, fail.floor, unk.id, 'link-issue', 'Keith')).error), /Which issue number/);
  assert.deepEqual(await personAct(fail.o.roster, fail.floor, unk.id, 'link-issue', 'Keith', { issue: 12 }), {});
  const linked = records(fail.o, fail.floor)[0];
  assert.deepEqual([linked.state, linked.confirmedBy, linked.issue?.number], ['person-confirmed-sent', 'person', 12]);
  assert.equal(prop(fail.o, fail.floor).issue?.number, 12);
  // Create it on the other: a new dispatch that supersedes the unknown one.
  assert.deepEqual(await personAct(o2.roster, floor, rec.id, 'create-issue', 'Keith'), {});
  assert.equal(o2.issues.length, 2);
  const all = records(o2, floor);
  assert.equal(all.find((x) => x.id === rec.id)!.state, 'person-chose-resend');
  assert.equal(all.find((x) => x.id !== rec.id)!.supersedes, rec.id);
});

test('rollback-with-unresolved-operation: the guard refuses with an in-flight answer and an issue intent, allows once settled; release 47 stores stay valid', async () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'dd-rb-'));
  const dataDir = path.join(parent, '.agent-office');
  mkdirSync(dataDir);
  const floor = new FakeFloor();
  const o = office(floor, dataDir);
  const ada = floor.add('a1', 'Ada');
  const e = o.roster.escalations.raise(floor, floor.worker(ada)!, ask('Ship it?'));
  o.roster.data(floor.id).proposals.push({ id: 'p-1', standup: '2026-10-15', role: 'lead-developer', team: 'dev' as Proposal['team'], by: 'Ada', kind: 'task', title: 'Docs', detail: '', status: 'pending' });
  o.roster.flush();
  floor.unrecorded = true;
  const restore = failWritesFrom(o, 3);
  await o.roster.escalations.answer(floor, e.id, { verdict: 'approve', raw: '', by: 'Keith' });
  restore();
  failWritesFrom(o, 3);
  await o.roster.standups.decide(floor, 'p-1', 'approve', 'Keith');
  const out: string[] = [];
  assert.equal(dispatchCommand(['status', parent], (s) => out.push(s)), 1);
  assert.match(out.join('\n'), /2 unsettled answer dispatches/);
  assert.match(out.join('\n'), /in-flight \(issue intent\)/);
  assert.ok(rollbackRefusal(dataDir, undefined), 'a release 47 build (no dispatch schema) is refused');
  assert.equal(rollbackRefusal(dataDir, 1), undefined, 'a build that knows the schema may run');
  // Release 47's view of the stores meanwhile: the escalation open (never delivered:false), the proposal approved without an issue.
  const saved = JSON.parse(readFileSync(path.join(dataDir, 'roster', `${floor.id}.json`), 'utf8'));
  assert.equal(saved.escalations[0].status, 'open');
  assert.equal(saved.escalations[0].resolution, undefined);
  assert.equal(saved.proposals[0].status, 'approved');
  // Settle each: reconcile leaves both unknown; a person settles them.
  const o2 = crashAndRestart(floor, o);
  await o2.roster.reconcile();
  assert.equal(dispatchCommand(['status', parent], () => {}), 1, 'unknown is still unsettled');
  for (const r of records(o2, floor)) await personAct(o2.roster, floor, r.id, r.channel === 'github-issue' ? 'abandon' : 'went-through', 'Keith');
  const done: string[] = [];
  assert.equal(dispatchCommand(['status', parent], (s) => done.push(s)), 0);
  assert.match(done[0], /No unsettled/);
  assert.equal(rollbackRefusal(dataDir, undefined), undefined);
  // A held answer survives the rollback in release 47's format and goes in once there.
  const held = reviveHeld([{ id: ID, workerId: 'a1', origin: 'person', by: 'Keith', text: 'x\n\n[office answer]', createdAt: 1, expiresAt: clock.now + 1e9, dispatchId: ID }]);
  const { dispatchId: _d, ...r47 } = held[0];
  assert.deepEqual(reviveHeld([r47]), [r47], 'without the extra field it is a release 47 held prompt');
});

test('dispatch-perms: only an admin can settle a dispatch; a viewer sees the cards without the answer’s text', async () => {
  for (const action of ['send-again', 'went-through', 'abandon', 'create-issue', 'link-issue', 'check']) {
    let status = 0;
    let body = '';
    const res = { writeHead: (s: number) => (status = s), end: (b: string) => (body = b) } as never;
    const req = { headers: { 'content-type': 'application/json' } } as never;
    const ctx = { cfg: {}, meOf: () => ({ admin: false }), floors: new Map() } as never;
    await dispatchRoutes.act.handle(ctx, { req, res, session: { account: { id: 'u1', name: 'Guest' } }, body: { action } } as never);
    assert.equal(status, 403, action);
    assert.match(body, /Only the Project Manager \(an admin\)/);
  }
  // The cards: an admin sees the answer's text, a viewer doesn't.
  const floor = new FakeFloor();
  const o = office(floor);
  const cfg = {};
  rosterFor(cfg, () => o.roster);
  await o.roster.dispatch.store.put(floor.id, { ...leftInFlight('x', 0), state: 'outcome-unknown' });
  const ctx = { cfg } as never;
  assert.ok((await dispatchView(ctx, floor.id, true)).unsettled[0].payload.length > 0);
  const viewer = await dispatchView(ctx, floor.id, false);
  assert.equal(viewer.unsettled.length, 1);
  assert.equal(viewer.unsettled[0].payload, '');
});

test('dispatch-perf: an answer costs a few small fsync’d writes; reconcile reads bounded transcripts without holding the event loop', async () => {
  const floor = new FakeFloor();
  const o = office(floor);
  const ada = floor.add('a1', 'Ada');
  const N = 30;
  const ids = Array.from({ length: N }, (_, i) => o.roster.escalations.raise(floor, floor.worker(ada)!, ask(`Question ${i}?`)).id);
  const t0 = performance.now();
  for (const id of ids) assert.ok((await o.roster.escalations.answer(floor, id, { verdict: 'approve', raw: '', by: 'Keith' })).ok);
  const per = (performance.now() - t0) / N;
  assert.ok(per < 250, `an answer took ${per.toFixed(1)} ms on average`);
  // Reconcile: 40 in-flight records over a 3 MB transcript, the loop never held long.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dd-perf-'));
  const file = path.join(dir, 'sess-A.jsonl');
  writeFileSync(file, `${assistantEntry('sess-A', 'x'.repeat(1000))}\n`.repeat(3000));
  const d = new Dispatcher({ dataDir: dir, now: () => 2 });
  for (let i = 0; i < 40; i++) await d.store.put('f1', { ...leftInFlight(file, 0), id: `dsp_01JB${String(i).padStart(22, '0')}` });
  const fresh = new Dispatcher({ dataDir: dir, now: () => 3 });
  let last = performance.now();
  let worst = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
  }, 5);
  const t1 = performance.now();
  const { reconcileFloor } = await import('../src/server/dispatch/reconcile.js');
  const done = await reconcileFloor(fresh, 'f1', { stillHeld: () => false });
  clearInterval(tick);
  assert.equal(done.length, 40);
  assert.ok(performance.now() - t1 < 20_000, 'bounded');
  assert.ok(worst < 400, `the event loop was held ${worst.toFixed(0)} ms`);
});
