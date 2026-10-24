// Increment B, the change lifecycle (docs/site/architecture/revisions-and-changes.md), with fakes only (no agents,
// no GitHub, no git):
//   - the four facts stay apart: implemented ≠ accepted or available; no checks or no CI = incomplete; held shown
//   - active cancellation stops (or isolates) the worker before the slot frees; a late candidate or PR is shown as
//     "after cancellation: not counted" and never settles the change or moves the queue; who may; audited
//   - settlement: a PR closed unmerged with a completed task is abandoned and the queue moves; a correction marks
//     its parent superseded, explicitly, by a person
//   - needs attention (the worker gone, no PR) with Retry, which hands it over again from the front
//   - the dependency note, and the policy that makes it wait; corrections first (and the policy that turns it off)
//   - a merged change held by the data-impact guard keeps the slot until the hold is gone
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changeState, DEFAULT_CHANGE_POLICY, type ChangeFacts, type DevChangePolicy, type QueueWhy, type StopResult } from '../src/shared/dev-changes.js';
import { ChangeStore } from '../src/server/dev-changes/store.js';
import { DevChanges, type Activated, type ChangeDeps } from '../src/server/dev-changes/service.js';
import { changeViews, type ViewInputs } from '../src/server/dev-changes/view.js';
import { dependsOn } from '../src/server/dev-changes/related.js';
import type { AuditInput } from '../src/shared/audit.js';
import { removeDir } from './support/cleanup.js';

const MAIN = 'a'.repeat(40);
const C1 = 'c1'.padEnd(40, '1');
const C2 = 'c2'.padEnd(40, '2');
const M = 'f0'.padEnd(40, '0');
const S = 'e0'.padEnd(40, 'e');
const ALEX = { name: 'Alex Lee', id: 'acc_1', admin: false };
const SAM = { name: 'Sam', id: 'acc_2', admin: false };
const ADMIN = { name: 'Admin', id: 'acc_9', admin: true };

function harness() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-lcb-'));
  const log: string[] = [];
  const state = {
    blocked: undefined as Exclude<QueueWhy, 'behind' | 'refused' | 'held' | 'depends'> | undefined,
    facts: new Map<string, Partial<ChangeFacts>>(),
    stop: { how: 'slept', worker: 'Ada' } as StopResult | string,
    held: false,
    deps: new Map<string, { id: string; docs: string[] }[]>(),
    policy: { ...DEFAULT_CHANGE_POLICY } as DevChangePolicy,
  };
  const handed: string[] = [];
  const audits: AuditInput[] = [];
  let n = 0;
  let t = 0;
  const store = new ChangeStore(path.join(dir, 'dev-changes'));
  const deps: ChangeDeps = {
    store,
    now: () => Date.UTC(2026, 9, 24, 10) + n++ * 1000,
    blocked: () => state.blocked,
    mainHead: async () => MAIN,
    recheck: async () => undefined,
    async hand(_f, c): Promise<Activated | string> {
      handed.push(c.id);
      log.push(`hand ${c.id}`);
      return { requestId: `CR-${handed.length}`, taskId: `tsk_${String(++t).padStart(26, '0')}`, member: 'Ada', role: 'pm', workerId: 'w-ada', delivery: 'sent' };
    },
    facts: async (_f, c) => {
      const f: ChangeFacts = { queue: c.queue, ...(state.facts.get(c.id) ?? {}) };
      if (f.pr?.state === 'MERGED' && f.pr.mergeCommit && !f.merged) f.merged = { sha: f.pr.mergeCommit, via: 'pr' };
      return f;
    },
    record: (e) => (audits.push(e), log.push(`audit ${e.action}`)),
    policy: () => state.policy,
    async stop(_f, c) {
      // The slot must still be taken while the worker is being stopped.
      log.push(`stop ${c.id} (${(await store.get('shop', c.id))?.queue})`);
      return state.stop;
    },
    endTask: (_f, taskId, how) => void log.push(`task ${taskId.slice(-2)} ${how}`),
    flagPr: async (_f, pr) => void log.push(`flag #${pr}`),
    held: async () => state.held,
    depends: async (_f, c) => state.deps.get(c.id) ?? [],
  };
  const svc = new DevChanges(deps);
  const inputs = (over: Partial<ViewInputs> = {}): ViewInputs => ({ task: () => undefined, assignments: [], pulls: [], preview: { running: false }, contains: async () => undefined, why: undefined, mayCancel: (c) => c.owner === 'acc_1', ...over });
  return { dir, store, svc, state, handed, audits, log, inputs, done: () => removeDir(dir) };
}

const ask = (text: string, extra: Record<string, unknown> = {}) => ({ text, by: 'Alex Lee', owner: 'acc_1', ...extra });
const ok = <T>(r: T | string): T => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};
const queues = async (x: ReturnType<typeof harness>) => (await x.store.all('shop')).map((c) => `${c.id}:${c.queue}`);

test('the four facts stay apart: implemented is never accepted or available; no checks or no CI is incomplete; a hold shows', async () => {
  const x = harness();
  try {
    ok(await x.svc.intake('shop', ask('Show the host on the badge')));
    await x.store.event('shop', 'DC-1', { type: 'candidate', at: 1, candidate: { sha: C1, via: 'branch', branch: 'dev/DC-1', seenAt: 1 } });
    const pulls = [{ number: 5, title: 'Badge', state: 'MERGED', headRefName: 'dev/DC-1', headRefOid: C1, mergeCommit: M }];
    // Merged, nothing known of the preview, no CI.
    let [v] = await changeViews(await x.store.all('shop'), x.inputs({ pulls }));
    assert.equal(v.state, 'implemented');
    assert.deepEqual([v.facts.execution.words, v.facts.verification.status, v.facts.preview.status, v.facts.review.status], ['Implemented @f000000', 'incomplete', 'off', 'none']);
    assert.equal((await changeViews(await x.store.all('shop'), x.inputs({ pulls, preview: { running: true, served: S } })))[0].facts.preview.status, 'unknown', 'running, containment not told: unknown, never available');
    assert.match(v.facts.verification.words, /no CI/);
    assert.doesNotMatch(JSON.stringify(v.facts), /accepted|ready to try|available/i);
    // CI exists but nothing reported at M (a result on the candidate C1 doesn't count for M): incomplete.
    [v] = await changeViews(await x.store.all('shop'), x.inputs({ pulls, hasCI: true, checks: [{ revision: C1, name: 'ci', verdict: 'passed' }] }));
    assert.equal(v.facts.verification.status, 'incomplete');
    [v] = await changeViews(await x.store.all('shop'), x.inputs({ pulls, hasCI: true, checks: [{ revision: M, name: 'ci', verdict: 'passed' }] }));
    assert.deepEqual([v.facts.verification.status, v.facts.verification.revision], ['passed', M]);
    [v] = await changeViews(await x.store.all('shop'), x.inputs({ pulls, hasCI: true, checks: [{ revision: M, name: 'ci', verdict: 'passed' }, { revision: M, name: 'e2e', verdict: 'skipped' }] }));
    assert.equal(v.facts.verification.status, 'incomplete', 'a check without a verdict: incomplete');
    // In the preview, held, and reviewed: each its own fact, the execution unchanged.
    [v] = await changeViews(await x.store.all('shop'), x.inputs({ pulls, preview: { running: true, served: S }, contains: async () => true }));
    assert.deepEqual([v.state, v.facts.preview.status], ['implemented', 'in']);
    [v] = await changeViews(await x.store.all('shop'), x.inputs({ pulls, preview: { running: true, served: S }, contains: async () => true, held: () => ({ env: 'candidate:DC-1', reason: 'Held: possible data impact', findings: 3 }) }));
    assert.deepEqual([v.state, v.facts.preview.status, v.facts.preview.held?.findings], ['implemented', 'held', 3], 'held: in the preview’s place, never folded into implemented');
    [v] = await changeViews(await x.store.all('shop'), x.inputs({ pulls, reviews: new Map([['DC-1', [{ id: 'GV-1', verdict: 'works' as const, revision: S, by: 'Alex', at: 1 }]]]) }));
    assert.deepEqual([v.state, v.facts.review.words], ['implemented', 'Looks right for @e0eeeee (Alex)']);
    // An unmerged candidate: the preview runs main, never this.
    [v] = await changeViews(await x.store.all('shop'), x.inputs({ pulls: [{ ...pulls[0], state: 'OPEN', mergeCommit: undefined }] }));
    assert.deepEqual([v.state, v.facts.preview.status], ['candidate', 'main']);
    // No PR at all (a project without GitHub): main having the candidate is the merge, found by git.
    [v] = await changeViews(await x.store.all('shop'), x.inputs({ mergedAt: async (sha) => (sha === C1 ? M : undefined) }));
    assert.deepEqual([v.state, v.revision, v.detail.includes('by git')], ['implemented', M, true]);
  } finally {
    x.done();
  }
});

test('active cancellation: the worker is stopped before the slot frees, the task cancelled, the PR flagged; late results are not counted', async () => {
  const x = harness();
  try {
    ok(await x.svc.intake('shop', ask('First change to the badge')));
    ok(await x.svc.intake('shop', ask('Second change to the list')));
    x.state.facts.set('DC-1', { pr: { number: 7, state: 'OPEN' }, candidate: { sha: C1, via: 'branch', branch: 'dev/DC-1', seenAt: 1 } });
    assert.match(String(await x.svc.cancel('shop', 'DC-1', SAM)), /^Only whoever asked/, 'another member: refused');
    // The worker can't be stopped: nothing changes.
    x.state.stop = 'The office couldn’t stop Ada: no terminal';
    assert.match(String(await x.svc.cancel('shop', 'DC-1', ALEX)), /couldn’t stop Ada.*Nothing was changed: DC-1 is still with the team/);
    assert.deepEqual(await queues(x), ['DC-1:active', 'DC-2:queued']);
    x.state.stop = { how: 'slept', worker: 'Ada', dropped: 1 };
    x.log.length = 0;
    const c = ok(await x.svc.cancel('shop', 'DC-1', ALEX));
    assert.equal(c.queue, 'cancelled');
    assert.deepEqual(c.cancelled?.stop, { how: 'slept', worker: 'Ada', dropped: 1 });
    // Order: stop (slot still taken) → task cancelled → PR flagged → audited → only then the next change.
    assert.deepEqual(x.log.slice(0, 5), ['stop DC-1 (active)', 'task 01 cancelled', 'flag #7', 'audit dev-change.cancelled', 'hand DC-2']);
    assert.deepEqual(await queues(x), ['DC-1:cancelled', 'DC-2:active']);
    const a = x.audits.find((e) => e.action === 'dev-change.cancelled')!;
    assert.match(a.summary, /while Ada had it: worker slept, PR #7 flagged; the slot is free/);
    assert.equal((a.details as { was: string }).was, 'active');
    // A late candidate and a merged PR afterwards: shown as not counted, never settling DC-1 or moving DC-2.
    await x.store.event('shop', 'DC-1', { type: 'candidate', at: 9, candidate: { sha: C2, via: 'pr', branch: 'dev/DC-1', pr: 7, seenAt: 9 } });
    const late = (await x.store.get('shop', 'DC-1'))!;
    assert.equal(late.candidates.find((k) => k.sha === C2)?.late, true);
    const pulls = [{ number: 7, title: 'Badge', state: 'MERGED', headRefName: 'dev/DC-1', headRefOid: C2, mergeCommit: M }];
    const views = await changeViews(await x.store.all('shop'), x.inputs({ pulls }));
    const v1 = views.find((v) => v.id === 'DC-1')!;
    assert.equal(v1.state, 'cancelled');
    assert.match(v1.late ?? '', /^After cancellation: candidate @c222222 on dev\/DC-1 \(PR #7\), PR #7 merged: not counted\. It never settles this change or moves the queue\.$/);
    assert.equal(v1.facts.preview.status, 'none');
    await x.svc.advance('shop');
    assert.deepEqual(await queues(x), ['DC-1:cancelled', 'DC-2:active'], 'the queue didn’t move for it');
    assert.match(String(await x.svc.cancel('shop', 'DC-1', ALEX)), /cancelled already/);
    // A merged change can't be cancelled (ask for a correction).
    x.state.facts.set('DC-2', { pr: { number: 8, state: 'MERGED', mergeCommit: M } });
    x.state.held = true;
    await x.svc.advance('shop');
    assert.match(String(await x.svc.cancel('shop', 'DC-2', ADMIN)), /merged into main @f000000 already/);
  } finally {
    x.done();
  }
});

test('settlement: a PR closed unmerged with the task completed is abandoned and the queue moves', async () => {
  const x = harness();
  try {
    ok(await x.svc.intake('shop', ask('First change to the badge')));
    ok(await x.svc.intake('shop', ask('Second change to the list')));
    x.state.facts.set('DC-1', { candidate: { sha: C1, via: 'branch', branch: 'dev/DC-1', seenAt: 1 }, pr: { number: 3, state: 'CLOSED' } });
    await x.svc.advance('shop');
    assert.deepEqual(await queues(x), ['DC-1:active', 'DC-2:queued'], 'closed, task still open: not yet');
    x.state.facts.set('DC-1', { candidate: { sha: C1, via: 'branch', branch: 'dev/DC-1', seenAt: 1 }, pr: { number: 3, state: 'CLOSED' }, ended: 'completed' });
    await x.svc.advance('shop');
    assert.deepEqual(await queues(x), ['DC-1:settled', 'DC-2:active']);
    assert.equal((await x.store.get('shop', 'DC-1'))?.settled?.why, 'abandoned');
    assert.equal(changeState({ queue: 'settled', settled: 'abandoned', pr: { number: 3, state: 'CLOSED' } }).state, 'abandoned');
  } finally {
    x.done();
  }
});

test('superseded: a correction marks its parent superseded, by a person; an active parent’s worker is stopped first', async () => {
  const x = harness();
  try {
    ok(await x.svc.intake('shop', ask('First change to the badge')));
    ok(await x.svc.intake('shop', ask('Put the badge right again', { of: 'DC-1', owner: 'acc_2', by: 'Sam' })));
    ok(await x.svc.intake('shop', ask('Third, unrelated')));
    assert.match(String(await x.svc.supersede('shop', 'DC-3', ALEX)), /isn’t a correction/);
    assert.match(String(await x.svc.supersede('shop', 'DC-2', { name: 'Kim', id: 'acc_5', admin: false })), /^Only whoever asked for either change/);
    x.log.length = 0;
    const p = ok(await x.svc.supersede('shop', 'DC-2', SAM));
    assert.equal(p.queue, 'superseded');
    assert.deepEqual([p.superseded?.follow, p.superseded?.by, p.superseded?.was], ['DC-2', 'Sam', 'active']);
    assert.deepEqual(x.log.slice(0, 4), ['stop DC-1 (active)', 'task 01 superseded', 'audit dev-change.superseded', 'hand DC-2'], 'stopped first; the correction goes next');
    const views = await changeViews(await x.store.all('shop'), x.inputs());
    assert.match(views.find((v) => v.id === 'DC-1')!.detail, /^Superseded by DC-2, marked by Sam\./);
    assert.match(String(await x.svc.supersede('shop', 'DC-2', SAM)), /superseded already/);
  } finally {
    x.done();
  }
});

test('needs attention: the worker gone and no PR; Retry hands it over again from the front, the old task set aside', async () => {
  const x = harness();
  try {
    ok(await x.svc.intake('shop', ask('First change to the badge')));
    ok(await x.svc.intake('shop', ask('Second change to the list')));
    assert.match(String(await x.svc.retry('shop', 'DC-1', ALEX)), /doesn’t need attention/);
    x.state.facts.set('DC-1', { workerGone: true });
    let views = await changeViews(await x.store.all('shop'), x.inputs({ workerGone: () => true }));
    const v = views.find((y) => y.id === 'DC-1')!;
    assert.deepEqual([v.state, v.mayRetry, v.mayCancel], ['attention', true, true]);
    assert.match(v.detail, /left the project and there’s no PR: cancel it, or Retry/);
    assert.match(String(await x.svc.retry('shop', 'DC-1', SAM)), /^Only whoever asked/);
    x.log.length = 0;
    ok(await x.svc.retry('shop', 'DC-1', ALEX));
    x.state.facts.delete('DC-1');
    assert.deepEqual(x.log.slice(0, 3), ['task 01 superseded', 'audit dev-change.retry', 'hand DC-1'], 'DC-1 again before DC-2');
    const c = (await x.store.get('shop', 'DC-1'))!;
    assert.deepEqual([c.queue, c.previous?.length, c.activated?.requestId], ['active', 1, 'CR-2']);
    // With a PR it isn't "needs attention": the PR still settles it.
    views = await changeViews(await x.store.all('shop'), x.inputs({ workerGone: () => true, pulls: [{ number: 4, title: 't', state: 'OPEN', headRefName: 'dev/DC-1' }] }));
    assert.notEqual(views.find((y) => y.id === 'DC-1')!.state, 'attention');
  } finally {
    x.done();
  }
});

test('the dependency note: proceeds by default; the project’s policy makes it wait for the review', async () => {
  const docs = new Map([[`${MAIN}|${C1}`, ['page:Shop.Order_Edit', 'microflow:Shop.ACT_Save']]]);
  const d = { docs: async (a: string, b: string) => docs.get(`${a}|${b}`) ?? [], triedOk: (id: string) => id === 'DC-9' };
  const one = { id: 'DC-1', text: 't', by: 'a', at: 1, source: { sha: MAIN, kind: 'main' as const }, queue: 'active' as const, candidates: [{ sha: C1, via: 'branch' as const, branch: 'dev/DC-1', seenAt: 1 }] };
  const two = { id: 'DC-2', text: 't', by: 'a', at: 2, source: { sha: MAIN, kind: 'main' as const }, queue: 'queued' as const, candidates: [], ref: { docType: 'page' as const, docQn: 'Shop.Order_Edit', widgetName: 'btnSave' } };
  const far = { ...two, id: 'DC-3', ref: { docType: 'page' as const, docQn: 'Shop.Other' } };
  assert.deepEqual(await dependsOn(two, [one, two, far], d), [{ id: 'DC-1', docs: ['page:Shop.Order_Edit'] }]);
  assert.deepEqual(await dependsOn(far, [one, two, far], d), [], 'no overlap, no note');
  assert.deepEqual(await dependsOn(two, [{ ...one, id: 'DC-9' }, { ...two }], d), [], 'tried ("Looks right"): no note');
  assert.deepEqual(await dependsOn(two, [{ ...one, queue: 'cancelled' }, two], d), [], 'cancelled work isn’t depended on');
  const x = harness();
  try {
    ok(await x.svc.intake('shop', ask('First change to the badge')));
    ok(await x.svc.intake('shop', ask('Second change, same page')));
    x.state.deps.set('DC-2', [{ id: 'DC-1', docs: ['page:Shop.Order_Edit'] }]);
    x.state.facts.set('DC-1', { pr: { number: 1, state: 'MERGED', mergeCommit: M } });
    // Policy wait: DC-1 is implemented (slot free) but untried, so DC-2 waits, saying why.
    x.state.policy = { ...DEFAULT_CHANGE_POLICY, waitForReview: true };
    await x.svc.advance('shop');
    assert.deepEqual(await queues(x), ['DC-1:settled', 'DC-2:queued']);
    assert.deepEqual(x.svc.whyQueued('shop', await x.store.all('shop')), { why: 'depends', ahead: 'DC-1' });
    const [v] = await changeViews(await x.store.all('shop'), x.inputs({ why: x.svc.whyQueued('shop', await x.store.all('shop')), depends: async (c) => x.state.deps.get(c.id) ?? [] }));
    assert.match(v.detail, /overlaps DC-1, which nobody has tried yet, and this project’s policy waits/);
    assert.deepEqual(v.depends, [{ id: 'DC-1', docs: ['page:Shop.Order_Edit'] }]);
    // Default: proceeds with the note.
    x.state.policy = { ...DEFAULT_CHANGE_POLICY };
    await x.svc.advance('shop');
    assert.deepEqual(await queues(x), ['DC-1:settled', 'DC-2:active']);
  } finally {
    x.done();
  }
});

test('corrections go to the front of the queue by default (and in order when the policy says so); never refused for want of a lead', async () => {
  for (const first of [true, false]) {
    const x = harness();
    try {
      x.state.policy = { ...DEFAULT_CHANGE_POLICY, correctionsFirst: first };
      ok(await x.svc.intake('shop', ask('First change to the badge')));
      ok(await x.svc.intake('shop', ask('Second change to the list')));
      x.state.blocked = 'no-lead';
      const corr = ok(await x.svc.intake('shop', ask('The badge is cut off', { of: 'DC-1', via: 'try' })));
      assert.equal(corr.change.queue, 'queued', 'queued, not refused, with no lead at work');
      x.state.blocked = undefined;
      x.state.facts.set('DC-1', { pr: { number: 1, state: 'MERGED', mergeCommit: M } });
      await x.svc.advance('shop');
      assert.deepEqual(await queues(x), first ? ['DC-1:settled', 'DC-2:queued', 'DC-3:active'] : ['DC-1:settled', 'DC-2:active', 'DC-3:queued']);
      const views = await changeViews(await x.store.all('shop'), x.inputs({ policy: x.state.policy }));
      if (first) assert.equal(views.find((v) => v.id === 'DC-2')!.position, 1);
    } finally {
      x.done();
    }
  }
});

test('a merged change held for possible data impact keeps the slot until the hold is gone', async () => {
  const x = harness();
  try {
    ok(await x.svc.intake('shop', ask('Drop the notes attribute')));
    ok(await x.svc.intake('shop', ask('Second change to the list')));
    x.state.facts.set('DC-1', { pr: { number: 1, state: 'MERGED', mergeCommit: M } });
    x.state.held = true;
    await x.svc.advance('shop');
    assert.deepEqual(await queues(x), ['DC-1:active', 'DC-2:queued']);
    assert.deepEqual(x.svc.whyQueued('shop', await x.store.all('shop')), { why: 'held', ahead: 'DC-1' });
    const views = await changeViews(await x.store.all('shop'), x.inputs({ why: x.svc.whyQueued('shop', await x.store.all('shop')), pulls: [{ number: 1, title: 't', state: 'MERGED', headRefName: 'dev/DC-1', mergeCommit: M }], held: (c) => (c.id === 'DC-1' ? { env: 'candidate:DC-1', reason: 'r', findings: 1 } : undefined) }));
    assert.match(views.find((v) => v.id === 'DC-2')!.detail, /DC-1 is merged but held for possible data impact/);
    assert.deepEqual([views.find((v) => v.id === 'DC-1')!.state, views.find((v) => v.id === 'DC-1')!.facts.preview.status], ['implemented', 'held']);
    x.state.held = false;
    await x.svc.advance('shop');
    assert.deepEqual(await queues(x), ['DC-1:settled', 'DC-2:active']);
  } finally {
    x.done();
  }
});
