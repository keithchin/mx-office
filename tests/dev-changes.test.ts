// Developer changes (the Developer view's first useful release, part 1): the record, the durable queue, the
// derived states, the revision strip and the check binding. Fakes only: no agents, no GitHub, no git.
//   - the record is append only and hash-chained; replay gives back the same changes; an edited line shows
//   - the state table, each state from its facts; missing facts never move a change forward
//   - queue instead of refuse: no lead at work, paused, spend cap, lead asleep, another change active
//   - one active change; the next starts when the active one is merged, cancelled or set aside
//   - the context recheck at main's head: a gone page or widget is flagged for clarification, never started
//   - restart: the queue is read back and moves on; a retry with the same key never makes a second change
//   - cancel: who may, and only before it starts; audited
//   - candidate not found; candidates appended, never rewritten; the strip; checks bound to the exact candidate
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { candidateChecks, changeState, CHANGE_WORDS, settledWhy, stripChips, type ChangeFacts, type ChangeState, type DevChange, type QueueWhy } from '../src/shared/dev-changes.js';
import { requestTaskText } from '../src/shared/change-requests.js';
import { ChangeStore } from '../src/server/dev-changes/store.js';
import { DevChanges, type Activated, type ChangeDeps } from '../src/server/dev-changes/service.js';
import { newCandidates, pullFor } from '../src/server/dev-changes/observe.js';
import { changeViews, stripFacts } from '../src/server/dev-changes/view.js';
import { findWidget, refGone } from '../src/server/dev-changes/recheck.js';
import type { AuditInput } from '../src/shared/audit.js';
import { removeDir } from './support/cleanup.js';

const MAIN = 'a'.repeat(40);
const C1 = 'c1'.padEnd(40, '1');
const C2 = 'c2'.padEnd(40, '2');
const M = 'f0'.padEnd(40, '0');
const S = 'e0'.padEnd(40, 'e');
const TASK = 'tsk_01JABCDEFGHJKMNPQRSTVWXYZ0';

/** A queue with fakes for the team's conditions, main's head, the recheck, the hand-over and the facts. */
function harness(dir = mkdtempSync(path.join(tmpdir(), 'ao-dc-'))) {
  const state = {
    blocked: undefined as Exclude<QueueWhy, 'behind' | 'refused'> | undefined,
    gone: undefined as string | undefined,
    refuse: undefined as string | undefined,
    facts: new Map<string, Partial<ChangeFacts>>(),
  };
  const handed: { id: string; text: string }[] = [];
  const audits: AuditInput[] = [];
  let n = 0;
  const store = new ChangeStore(path.join(dir, 'dev-changes'));
  const deps: ChangeDeps = {
    store,
    now: () => Date.UTC(2026, 9, 24, 10) + n++ * 1000,
    blocked: () => state.blocked,
    mainHead: async () => MAIN,
    recheck: async () => state.gone,
    async hand(_f, c): Promise<Activated | string> {
      if (state.refuse) return state.refuse;
      handed.push({ id: c.id, text: requestTaskText({ id: `CR-${handed.length + 1}`, text: c.text, by: c.by, change: c }) });
      return { requestId: `CR-${handed.length}`, taskId: TASK, member: 'Ada', role: 'pm', workerId: 'w-ada', delivery: 'held' };
    },
    facts: async (_f, c) => ({ queue: c.queue, ...(state.facts.get(c.id) ?? {}) }),
    record: (e) => audits.push(e),
  };
  return { dir, store, svc: new DevChanges(deps), deps, state, handed, audits, done: () => removeDir(dir) };
}

const ask = (text: string, extra: Record<string, unknown> = {}) => ({ text, by: 'Alex Lee', owner: 'acc_1', ...extra });
const ok = <T>(r: T | string): T => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

test('the record: append only, hash-chained, replayed to the same changes; an edited line shows', async () => {
  const x = harness();
  try {
    const a = ok(await x.svc.intake('shop', ask('Show the host on the badge', { key: 'draft-0001', ref: { docType: 'page', docQn: 'Visitors.Badge', widgetName: 'HostText', id: 'abc=', label: 'Host' } })));
    assert.equal(a.change.id, 'DC-1');
    assert.equal(a.change.queue, 'active');
    assert.deepEqual(a.change.source, { sha: MAIN, kind: 'main' }, 'source = main’s head at request time');
    assert.deepEqual(a.change.ref, { docType: 'page', docQn: 'Visitors.Badge', widgetName: 'HostText', id: 'abc=', label: 'Host' });
    await x.store.event('shop', 'DC-1', { type: 'candidate', at: 1, candidate: { sha: C1, via: 'branch', branch: 'dev/DC-1', seenAt: 1 } });
    const file = x.store.file('shop');
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.op + (l.event ? `:${l.event.type}` : '')), ['create', 'event:activated', 'event:candidate']);
    assert.equal(lines[0].prev, '');
    assert.deepEqual(await x.store.verify('shop'), { ok: true, lines: 3 });
    // Replay: a fresh store reads the same changes.
    const again = new ChangeStore(x.store.dir);
    const back = await again.get('shop', 'DC-1');
    assert.equal(back?.queue, 'active');
    assert.equal(back?.activated?.requestId, 'CR-1');
    assert.deepEqual(back?.candidates.map((c) => c.sha), [C1]);
    assert.equal(await again.nextId('shop'), 'DC-2');
    // Only what nothing else knows is stored: no state words, no derived fields.
    assert.doesNotMatch(readFileSync(file, 'utf8'), /"state"|"words"|"detail"/);
    // An edited line breaks the chain.
    writeFileSync(file, readFileSync(file, 'utf8').replace('Show the host', 'Show the guest'));
    assert.equal((await new ChangeStore(x.store.dir).verify('shop')).brokenAt, 1);
  } finally {
    x.done();
  }
});

test('the task asks the lead to work on dev/DC-n and keep the Task: line, with the source and the element', async () => {
  const x = harness();
  try {
    ok(await x.svc.intake('shop', ask('Show the host on the badge', { ref: { docQn: 'Visitors.Badge', widgetName: 'HostText', label: 'Host' } })));
    const t = x.handed[0].text;
    assert.match(t, /change: DC-1\nbranch: dev\/DC-1\nsource: main @a{40}\nelement: Host \(HostText\) on page Visitors\.Badge/);
    assert.match(t, /own branch `dev\/DC-1`/);
    assert.match(t, /Keep the `Task:` line and name DC-1/);
  } finally {
    x.done();
  }
});

test('queue instead of refuse: each condition keeps the request as Queued, saying what it waits for', async () => {
  for (const why of ['no-lead', 'paused', 'cap', 'asleep'] as const) {
    const x = harness();
    try {
      x.state.blocked = why;
      const r = ok(await x.svc.intake('shop', ask('Print the host on the badge')));
      assert.equal(r.change.queue, 'queued', why);
      assert.equal(x.handed.length, 0, `${why}: nothing handed over`);
      const views = await changeViews(await x.store.all('shop'), { task: () => undefined, assignments: [], pulls: [], preview: { running: false }, contains: async () => undefined, why: x.svc.whyQueued('shop', await x.store.all('shop')), mayCancel: () => true });
      assert.equal(views[0].state, 'queued');
      const words = { 'no-lead': /No team lead is at work/, paused: /project is paused/, cap: /spend cap/, asleep: /lead is asleep/ }[why];
      assert.match(views[0].detail, words, why);
      // The condition lifts: the queue moves on the next event.
      x.state.blocked = undefined;
      await x.svc.advance('shop');
      assert.equal((await x.store.get('shop', 'DC-1'))?.queue, 'active', `${why}: starts once it lifts`);
      assert.equal(x.handed.length, 1);
    } finally {
      x.done();
    }
  }
});

test('one active change; the next starts when the active one is merged, cancelled or set aside', async () => {
  const x = harness();
  try {
    for (const t of ['First change to the badge', 'Second change to the list', 'Third change to the menu', 'Fourth change to the footer']) ok(await x.svc.intake('shop', ask(t)));
    let all = await x.store.all('shop');
    assert.deepEqual(all.map((c) => c.queue), ['active', 'queued', 'queued', 'queued']);
    assert.equal(x.handed.length, 1, 'only one handed over');
    const views = await changeViews(all, { task: () => undefined, assignments: [], pulls: [], preview: { running: false }, contains: async () => undefined, why: x.svc.whyQueued('shop', all), mayCancel: () => true });
    const dc2 = views.find((v) => v.id === 'DC-2')!;
    assert.match(dc2.detail, /DC-1 is with the team/);
    assert.equal(views.find((v) => v.id === 'DC-3')!.position, 2);
    assert.match(views.find((v) => v.id === 'DC-3')!.detail, /Number 2 in the queue. DC-1 is with the team/);
    // Still working: nothing moves.
    await x.svc.advance('shop');
    assert.equal(x.handed.length, 1);
    // DC-1 merged → DC-2 starts.
    x.state.facts.set('DC-1', { pr: { number: 7, state: 'MERGED', mergeCommit: M }, candidate: { sha: C1, via: 'branch', branch: 'dev/DC-1', seenAt: 1 } });
    await x.svc.advance('shop');
    all = await x.store.all('shop');
    assert.equal(all[0].settled?.why, 'merged');
    assert.equal(all[1].queue, 'active');
    // DC-2's task cancelled by the team → DC-3 starts.
    x.state.facts.set('DC-2', { ended: 'cancelled' });
    await x.svc.advance('shop');
    assert.equal((await x.store.get('shop', 'DC-2'))?.settled?.why, 'cancelled');
    assert.equal((await x.store.get('shop', 'DC-3'))?.queue, 'active');
    // DC-3 set aside (superseded) → DC-4 starts.
    x.state.facts.set('DC-3', { ended: 'superseded' });
    await x.svc.advance('shop');
    assert.equal((await x.store.get('shop', 'DC-3'))?.settled?.why, 'set-aside');
    assert.equal((await x.store.get('shop', 'DC-4'))?.queue, 'active');
    assert.deepEqual(x.handed.map((h) => h.id), ['DC-1', 'DC-2', 'DC-3', 'DC-4']);
    assert.deepEqual(x.audits.map((a) => a.action).filter((a) => a !== 'dev-change.queued'), ['dev-change.started', 'dev-change.settled', 'dev-change.started', 'dev-change.settled', 'dev-change.started', 'dev-change.settled', 'dev-change.started']);
  } finally {
    x.done();
  }
});

test('a refused hand-over keeps the change queued, said as such, and tries again on the next move', async () => {
  const x = harness();
  try {
    x.state.refuse = 'The office couldn’t save the task’s record';
    const r = ok(await x.svc.intake('shop', ask('Show the host on the badge')));
    assert.equal(r.change.queue, 'queued');
    assert.deepEqual(x.svc.whyQueued('shop', await x.store.all('shop')), { why: 'refused' });
    x.state.refuse = undefined;
    await x.svc.advance('shop');
    assert.equal((await x.store.get('shop', 'DC-1'))?.queue, 'active');
  } finally {
    x.done();
  }
});

test('the context is checked again when a change starts: a gone page or widget is flagged, never started, and the next one goes', async () => {
  const x = harness();
  try {
    x.state.blocked = 'paused';
    ok(await x.svc.intake('shop', ask('Rename the submit button', { ref: { docQn: 'Orders.Order_Edit', widgetName: 'SubmitBtn' } })));
    ok(await x.svc.intake('shop', ask('Another change, no element')));
    x.state.blocked = undefined;
    x.state.gone = 'SubmitBtn isn’t on Orders.Order_Edit at main @aaaaaaa any more';
    await x.svc.advance('shop');
    const dc1 = (await x.store.get('shop', 'DC-1'))!;
    assert.equal(dc1.queue, 'clarify');
    assert.equal(dc1.clarify?.main, MAIN);
    assert.equal((await x.store.get('shop', 'DC-2'))?.queue, 'active', 'a change without a reference isn’t held by it');
    assert.deepEqual(x.handed.map((h) => h.id), ['DC-2']);
    assert.equal(changeState({ queue: 'clarify', clarify: dc1.clarify!.why }).state, 'clarify');
    assert.ok(x.audits.some((a) => a.action === 'dev-change.clarify'));
  } finally {
    x.done();
  }
});

test('the recheck reads the model: the document by qualified name, the widget by name ($ID a hint only)', async () => {
  const doc = { $Type: 'Forms$Page', Name: 'Order_Edit', $ID: 'p1', FormCall: { Arguments: [{ Widgets: [{ $Type: 'Forms$ActionButton', Name: 'SubmitBtn', $ID: 'new-id' }] }] } };
  const model = { ix: { byName: new Map([['page:Orders.Order_Edit', 'u1']]), read: async () => doc } };
  assert.equal(findWidget(doc, 'SubmitBtn'), 'Forms$ActionButton');
  assert.equal(findWidget(doc, 'Order_Edit'), undefined, 'the document’s own name isn’t a widget');
  assert.equal(await refGone(model, { docType: 'page', docQn: 'Orders.Order_Edit', widgetName: 'SubmitBtn', id: 'old-id' }, 'aaaaaaa'), undefined, 'same name, new $ID: still there');
  assert.match(String(await refGone(model, { docType: 'page', docQn: 'Orders.Order_Edit', widgetName: 'CancelBtn', label: 'Cancel button' }, 'aaaaaaa')), /Cancel button \(CancelBtn\) isn’t on Orders\.Order_Edit at main @aaaaaaa/);
  assert.match(String(await refGone(model, { docType: 'page', docQn: 'Orders.Gone' }, 'aaaaaaa')), /page Orders\.Gone isn’t in the app/);
  assert.equal(await refGone(null, { docType: 'page', docQn: 'Orders.Gone' }, 'aaaaaaa'), undefined, 'the model can’t be read: nothing is claimed');
});

test('restart: the queue is read back from disk and moves on; a retry with the same key never makes a second change', async () => {
  const x = harness();
  try {
    x.state.blocked = 'asleep';
    const a = ok(await x.svc.intake('shop', ask('Show the host on the badge', { key: 'draft-abcdef01' })));
    const b = ok(await x.svc.intake('shop', ask('Show the host on the badge', { key: 'draft-abcdef01' })));
    assert.equal(b.change.id, a.change.id);
    assert.equal(b.again, true);
    ok(await x.svc.intake('shop', ask('Print the visit date too', { key: 'draft-abcdef02' })));
    // Two at once with one key: one change.
    const [p, q] = await Promise.all([x.svc.intake('shop', ask('Same request twice at once', { key: 'draft-twice-01' })), x.svc.intake('shop', ask('Same request twice at once', { key: 'draft-twice-01' }))]);
    assert.equal(ok(p).change.id, ok(q).change.id);
    assert.equal((await x.store.all('shop')).length, 3);
    // The office restarts: a new store and queue over the same folder.
    const y = harness(x.dir);
    const back = await y.store.all('shop');
    assert.deepEqual(back.map((c) => [c.id, c.queue]), [['DC-1', 'queued'], ['DC-2', 'queued'], ['DC-3', 'queued']]);
    const c = ok(await y.svc.intake('shop', ask('Show the host on the badge', { key: 'draft-abcdef01' })));
    assert.equal(c.change.id, 'DC-1', 'the key survives the restart');
    assert.equal(y.handed.length, 1, 'the lead is awake in the new office: the queue moved on the intake');
    assert.equal((await y.store.get('shop', 'DC-1'))?.queue, 'active');
    assert.equal(await y.store.nextId('shop'), 'DC-4');
    assert.equal((await y.store.verify('shop')).ok, true);
  } finally {
    x.done();
  }
});

test('cancel: before it starts only, by whoever asked or an admin; audited; the next one goes', async () => {
  const x = harness();
  try {
    ok(await x.svc.intake('shop', ask('First change to the badge')));
    ok(await x.svc.intake('shop', ask('Second change to the list')));
    ok(await x.svc.intake('shop', ask('Third change to the list', { owner: undefined })));
    assert.match(String(await x.svc.cancel('shop', 'DC-1', { name: 'Alex Lee', id: 'acc_1', admin: false })), /has started/);
    assert.match(String(await x.svc.cancel('shop', 'DC-2', { name: 'Sam', id: 'acc_2', admin: false })), /Only whoever asked/);
    assert.match(String(await x.svc.cancel('shop', 'DC-3', { name: 'Sam', id: 'acc_2', admin: false })), /Only whoever asked/, 'no owner: admins only');
    assert.match(String(await x.svc.cancel('shop', 'DC-9', { name: 'Sam', admin: true })), /No such change/);
    const c = ok(await x.svc.cancel('shop', 'DC-2', { name: 'Alex Lee', id: 'acc_1', admin: false }));
    assert.equal(c.queue, 'cancelled');
    assert.match(String(await x.svc.cancel('shop', 'DC-2', { name: 'Alex Lee', id: 'acc_1', admin: false })), /cancelled already/);
    ok(await x.svc.cancel('shop', 'DC-3', { name: 'Admin', id: 'acc_9', admin: true }));
    const audit = x.audits.filter((a) => a.action === 'dev-change.cancelled');
    assert.deepEqual(audit.map((a) => [a.target?.label, a.actor.name]), [['DC-2', 'Alex Lee'], ['DC-3', 'Admin']]);
    assert.equal(changeState({ queue: 'cancelled', cancelledBy: 'Alex Lee' }).words, 'Cancelled');
    // Who may cancel, as the view says per viewer.
    const views = await changeViews(await x.store.all('shop'), { task: () => undefined, assignments: [], pulls: [], preview: { running: false }, contains: async () => undefined, mayCancel: (ch) => ch.owner === 'acc_1' });
    assert.deepEqual(views.map((v) => [v.id, v.mayCancel]), [['DC-3', false], ['DC-2', false], ['DC-1', false]], 'started and cancelled ones can’t be');
    // A cancelled queued change ahead lets the one behind go once the active one is done.
    ok(await x.svc.intake('shop', ask('Fourth change to the footer')));
    x.state.facts.set('DC-1', { pr: { number: 3, state: 'MERGED', mergeCommit: M } });
    await x.svc.advance('shop');
    assert.equal((await x.store.get('shop', 'DC-4'))?.queue, 'active');
  } finally {
    x.done();
  }
});

test('the state table: each state from its facts, in plain words', () => {
  const cand = { sha: C2, via: 'branch' as const, branch: 'dev/DC-5', pr: 9, seenAt: 1 };
  const rows: [ChangeFacts, ChangeState, RegExp][] = [
    [{ queue: 'queued', why: 'behind', ahead: 'DC-4', position: 1 }, 'queued', /DC-4 is with the team/],
    [{ queue: 'queued', why: 'paused' }, 'queued', /paused/],
    [{ queue: 'active' }, 'with-team', /Nothing saved on its branch yet/],
    [{ queue: 'active', outcome: 'decision' }, 'with-team', /decision of yours/],
    [{ queue: 'active', candidate: cand, pr: { number: 9, state: 'OPEN' } }, 'candidate', /Candidate @c222222 on dev\/DC-5 · PR #9\. Not merged/],
    [{ queue: 'active', candidate: cand, pr: { number: 9, state: 'MERGED', mergeCommit: M } }, 'merged', /Merged into main @f000000\. Whether the preview has it couldn’t be told/],
    [{ queue: 'settled', candidate: cand, pr: { number: 9, state: 'MERGED', mergeCommit: M }, preview: { running: true, served: S }, inServed: true }, 'in-preview', /runs @e0eeeee, which contains it/],
    [{ queue: 'settled', pr: { number: 9, state: 'MERGED', mergeCommit: M }, preview: { running: true, served: S }, inServed: false }, 'preview-behind', /still runs @e0eeeee/],
    [{ queue: 'settled', pr: { number: 9, state: 'MERGED', mergeCommit: M }, preview: { running: false } }, 'preview-off', /isn’t running/],
    [{ queue: 'clarify', clarify: 'The page is gone' }, 'clarify', /The page is gone/],
    [{ queue: 'cancelled', cancelledBy: 'Alex' }, 'cancelled', /Cancelled by Alex before it started/],
    [{ queue: 'active', ended: 'cancelled' }, 'cancelled', /team cancelled its task/],
    [{ queue: 'settled', ended: 'completed' }, 'not-found', /nothing was found on its branch/],
    [{ queue: 'active', outcome: 'delivered' }, 'not-found', /Ask the team lead where the work is/],
  ];
  for (const [f, state, detail] of rows) {
    const s = changeState(f);
    assert.equal(s.state, state, JSON.stringify(f));
    assert.equal(s.words, CHANGE_WORDS[state]);
    assert.match(s.detail, detail, state);
  }
  // Missing facts never move it forward: a merge without its commit is still on its candidate.
  assert.equal(changeState({ queue: 'active', candidate: cand, pr: { number: 9, state: 'MERGED' } }).state, 'candidate');
  assert.equal(changeState({ queue: 'active', candidate: cand }).revision, C2);
  // The queue's turn is over only on evidence.
  assert.equal(settledWhy({ queue: 'active', candidate: cand, pr: { number: 9, state: 'OPEN' } }), undefined);
  assert.equal(settledWhy({ queue: 'active', ended: 'completed', candidate: cand }), undefined, 'done with an open candidate: waits for the merge');
  assert.equal(settledWhy({ queue: 'active', ended: 'completed' }), 'not-found');
});

test('candidates: the branch head and PRs carrying the Task line are appended in order, never rewritten; the convention not followed is said', async () => {
  const x = harness();
  try {
    ok(await x.svc.intake('shop', ask('Show the host on the badge')));
    let c = (await x.store.get('shop', 'DC-1'))!;
    assert.deepEqual(newCandidates(c, [], undefined, 5), [], 'nothing on the branch yet');
    const pulls = [
      { number: 4, title: 'Unrelated', state: 'OPEN', headRefName: 'office/ada-other', headRefOid: 'd'.repeat(40), body: '' },
      { number: 5, title: 'Badge host', state: 'OPEN', headRefName: 'dev/DC-1', headRefOid: C1, body: `Task: ${TASK}` },
    ];
    const first = newCandidates(c, pulls, C1, 5);
    assert.deepEqual(first.map((k) => [k.sha, k.via, k.pr]), [[C1, 'branch', 5]]);
    for (const k of first) await x.store.event('shop', 'DC-1', { type: 'candidate', at: 5, candidate: k });
    c = (await x.store.get('shop', 'DC-1'))!;
    assert.deepEqual(newCandidates(c, pulls, C1, 6), [], 'a head seen once isn’t added again');
    // A second PR on another branch carrying the Task line: accepted, as a PR candidate.
    const more = [...pulls, { number: 6, title: 'Badge host, take 2', state: 'OPEN', headRefName: 'office/ada-badge', headRefOid: C2, body: `Task: ${TASK}` }];
    const second = newCandidates(c, more, C1, 7);
    assert.deepEqual(second.map((k) => [k.sha, k.via, k.branch]), [[C2, 'pr', 'office/ada-badge']]);
    for (const k of second) await x.store.event('shop', 'DC-1', { type: 'candidate', at: 7, candidate: k });
    c = (await x.store.get('shop', 'DC-1'))!;
    assert.deepEqual(c.candidates.map((k) => k.sha), [C1, C2], 'C1 stays first, with its own time');
    assert.equal(c.candidates[0].seenAt, 5);
    assert.equal(pullFor(c, more)?.number, 5, 'the PR from dev/DC-1 speaks for it');
    // A change whose team finished with nothing on the branch: candidate not found.
    ok(await x.svc.intake('shop', ask('Another change to the list')));
    const d = (await x.store.get('shop', 'DC-2'))!;
    assert.equal(d.queue, 'queued');
  } finally {
    x.done();
  }
});

test('the revision strip: main @M, the preview @S behind main by N or not running, the active change’s candidate @C', () => {
  const base = { main: M, preview: { status: 'running' as const, served: S }, behind: 3 };
  const chips = stripChips({ ...base, change: { id: 'DC-2', candidate: C1, branch: 'dev/DC-2' } });
  assert.deepEqual(chips.map((c) => c.label), ['main @f000000', 'preview @e0eeeee · behind main by 3', 'DC-2 candidate @c111111']);
  assert.equal(chips[1].tone, 'warn');
  assert.deepEqual(stripChips({ main: M, preview: { status: 'running', served: M } }).map((c) => [c.label, c.tone]), [['main @f000000', 'idle'], ['preview @f000000', 'good']]);
  assert.equal(stripChips({ main: M, preview: { status: 'running', served: S } })[1].label, 'preview @e0eeeee · behind main', 'N unknown: "behind main" only');
  assert.equal(stripChips({ main: M, preview: { status: 'off', lastServed: S } })[1].label, 'preview: not running');
  // Built from work main doesn't have (served ahead of main): said, never shown as level with main.
  const ahead = stripChips({ main: M, preview: { status: 'running', served: S }, behind: 0, ahead: 45 })[1];
  assert.equal(ahead.label, 'preview @e0eeeee · 45 not on main');
  assert.equal(ahead.tone, 'warn');
  assert.match(ahead.title, /45 commits main doesn’t have/);
  assert.equal(stripChips({ main: M, preview: { status: 'running', served: S }, behind: 2, ahead: 1 })[1].label, 'preview @e0eeeee · behind main by 2 · 1 not on main');
  assert.match(stripChips({ main: M, preview: { status: 'off', lastServed: S } })[1].title, /last ran @e0eeeee/);
  assert.equal(stripChips({ preview: { status: 'off' } })[0].label, 'main: not read yet');
  assert.equal(stripChips({ ...base, change: { id: 'DC-2', branch: 'dev/DC-2' } })[2].label, 'DC-2: no candidate yet');
  // From the views: only an active change puts its candidate on the strip.
  const v = (id: string, queue: DevChange['queue'], cands: string[]) => ({ id, queue, branch: `dev/${id}`, candidates: cands.map((sha) => ({ sha, via: 'branch' as const, branch: `dev/${id}`, seenAt: 1 })), state: 'candidate' as const }) as never;
  assert.equal(stripFacts(M, base.preview, { behind: 3 }, [v('DC-1', 'settled', [C1])]).change, undefined);
  assert.deepEqual(stripFacts(M, base.preview, { behind: 3 }, [v('DC-1', 'settled', [C1]), v('DC-2', 'active', [C1, C2])]).change, { id: 'DC-2', branch: 'dev/DC-2', candidate: C2 });
});

test('checks are shown against a candidate only when their revision is that candidate; older ones are labelled; no CI never reads as passed', () => {
  const cands = [{ sha: C1, via: 'branch' as const, branch: 'dev/DC-1', seenAt: 1 }, { sha: C2, via: 'branch' as const, branch: 'dev/DC-1', seenAt: 2 }];
  const r = candidateChecks(cands, [{ revision: C1, name: 'ci', verdict: 'passed' }, { revision: C2.slice(0, 7), name: 'ci', verdict: 'failed' }, { revision: MAIN, name: 'main', verdict: 'passed' }], true)!;
  assert.equal(r.candidate, C2);
  assert.deepEqual(r.on.map((x) => x.verdict), ['failed'], 'a short sha of the same commit counts; main’s result doesn’t');
  assert.deepEqual(r.earlier.map((x) => x.revision), [C1]);
  assert.match(r.line, /1 of 1 checks failed on @c222222 · 1 on an earlier candidate/);
  const old = candidateChecks(cands, [{ revision: C1, name: 'ci', verdict: 'passed' }], true)!;
  assert.equal(old.on.length, 0, 'C1’s pass never moves to C2');
  assert.match(old.line, /No checks have reported on @c222222 yet · 1 on an earlier candidate/);
  assert.equal(candidateChecks(cands, [], false)!.line, 'No checks on this candidate (this project has no CI)');
  assert.doesNotMatch(candidateChecks(cands, [], false)!.line, /passed/);
  assert.equal(candidateChecks([], [], false), undefined);
  assert.equal(candidateChecks(cands, [{ revision: 'unknown', name: 'x', verdict: 'passed' }], true)!.on.length, 0, 'an unknown revision counts for no candidate');
});
