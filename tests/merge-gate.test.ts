// The merge gate (server/merge-gate/, shared/merge-gate.ts; architecture assessment F1, F2, F11): a review
// counts only for the head commit it reviewed, with its verdict, by someone who didn't author the PR's
// commits; a new commit makes it stale; the office's Merge refuses a head without a counting approval
// unless an admin overrides it (audited); the Project Manager records a review in the office with a fresh
// sign-in; the office posts mx-office/review on the head and reads (never writes) branch protection; and
// the "unreviewed" mark is cleared once a counting review of the merged head exists. Neutral fixtures, a
// fake gh only (injected, or a fake gh.exe first on PATH): no real GitHub, no token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { BINDING_SINCE, bindingOf, gateDecision, headReview, OVERRIDE_MS, statusOf, type PrCommit, type ReviewRecord } from '../src/shared/merge-gate.js';
import { factsOf } from '../src/server/merge-gate/collect.js';
import { MergeGate, SWEEP_MAX, type GateFloor } from '../src/server/merge-gate/service.js';
import { checkMerge, gateAsks, settleMarks, useMergeGate } from '../src/server/merge-gate/index.js';
import { mergeGateRoutes } from '../src/server/http/routes/merge-gate.js';
import { reauthOf } from '../src/server/mobile/reauth.js';
import { AuditLog, auditLog, useAudit } from '../src/server/audit/index.js';
import { judgePull, markTasks } from '../src/server/review-gate/judge.js';
import { gh as realGh } from '../src/server/github.js';
import type { GhPull } from '../src/shared/protocol.js';
import type { Assignment } from '../src/server/roster/resume.js';

const hex = (d: string, fill: string) => `${d.repeat(7)}${fill.repeat(33)}`;
const SHA1 = hex('1', 'a');
const SHA2 = hex('2', 'b');
const SHA3 = hex('3', 'c');
const T = (h: number) => `2026-10-23T${String(h).padStart(2, '0')}:00:00Z`;
const AGENTS = ['Katherine', 'Sophie', 'Alex'];
const KATHERINE = 'Katherine (Mx Office Lead Developer)';

function tmp(t: { after(fn: () => void): void }, name = 'merge-gate-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), name));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const review = (who: string, extra = 'Head: 1111111\nVerdict: approve') => `Review: ${who} (Lead Developer)\n${extra}\nChecks:\n- npm test → 42 passed\nFiles read:\n- src/app.ts`;

/** PR #12 as gh pr view gives it, opened by Katherine with one commit (SHA1). */
function pull(over: Record<string, unknown> = {}) {
  return {
    number: 12,
    state: 'OPEN',
    isDraft: false,
    author: { login: 'office-bot' },
    body: 'Opened by Katherine (Lead Developer) via Mx Office\n\nAdds the order form.',
    headRefName: 'office/katherine-12',
    headRefOid: SHA1,
    baseRefName: 'main',
    commits: [{ oid: SHA1, committedDate: T(9), authors: [{ name: KATHERINE }] }],
    comments: [] as unknown[],
    reviews: [] as unknown[],
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ...over,
  };
}

/** A new commit on the branch: SHA2 is the head now. */
const pushed = (p: ReturnType<typeof pull>) => ({ ...p, headRefOid: SHA2, commits: [...p.commits, { oid: SHA2, committedDate: T(11), authors: [{ name: KATHERINE }] }] });

interface FakeState {
  pulls: Record<number, ReturnType<typeof pull>>;
  statuses: Record<string, string>[];
  branch?: unknown;
  branchError?: string;
  rules?: unknown;
  statusError?: string;
}

function fakeGh(state: FakeState) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      const p = state.pulls[Number(args[2])];
      if (!p) throw new Error('no pull requests found');
      return JSON.stringify(p);
    }
    if (args[0] === 'api' && args[1] === '--method' && args[2] === 'POST' && /\/statuses\//.test(args[3])) {
      if (state.statusError) throw new Error(state.statusError);
      const fields = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === '-f' ? [[a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]] : [])));
      state.statuses.push({ sha: args[3].split('/').pop()!, ...fields });
      return '{}';
    }
    if (args[0] === 'api' && /\/rules\/branches\//.test(args[1])) return JSON.stringify(state.rules ?? []);
    if (args[0] === 'api' && /\/branches\//.test(args[1])) {
      if (state.branchError) throw new Error(state.branchError);
      return JSON.stringify(state.branch ?? { name: 'main', protected: false });
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { calls, run };
}

function rig(t: { after(fn: () => void): void }, over: Partial<FakeState> = {}, opts: { personReviews?: boolean } = {}) {
  const dir = tmp(t);
  const state: FakeState = { pulls: { 12: pull() }, statuses: [], ...over };
  const fake = fakeGh(state);
  let now = Date.parse(T(12));
  const gate = new MergeGate(dir, fake.run, () => now);
  const floor: GateFloor = { id: 'shop', dir, look: { agents: AGENTS }, personReviews: opts.personReviews ?? false };
  return { dir, state, fake, gate, floor, tick: (ms: number) => (now += ms), now: () => now };
}

// ---- The pure rules ----------------------------------------------------------------------------------

const commits: PrCommit[] = [
  { oid: SHA1, at: Date.parse(T(9)), authors: [KATHERINE] },
  { oid: SHA2, at: Date.parse(T(11)), authors: [KATHERINE] },
  { oid: SHA3, at: Date.parse(T(12)), authors: [KATHERINE] },
];
const rec = (over: Partial<ReviewRecord>): ReviewRecord => ({ id: `c:${Math.random()}`, pr: 12, sha: SHA1, shaFrom: 'stated', verdict: 'approve', reviewer: { kind: 'agent', name: 'Sophie', role: 'Lead Developer' }, at: Date.parse(T(10)), source: 'agent-comment', ...over });

test('a review counts only for the exact head it reviewed; each new commit makes it stale', () => {
  const at1 = headReview({ head: SHA1, commits: commits.slice(0, 1), records: [rec({})], authors: ['Katherine'] });
  assert.equal(at1.state, 'reviewed');
  assert.match(at1.text, /^Reviewed ✓ by Sophie \(Lead Developer\) at 1111111$/);
  const later = headReview({ head: SHA3, commits, records: [rec({})], authors: ['Katherine'] });
  assert.equal(later.state, 'stale');
  assert.equal(later.since, 2);
  assert.match(later.text, /changed since review: 2 commits/);
  const forced = headReview({ head: SHA3, commits: commits.slice(2), records: [rec({})], authors: ['Katherine'] });
  assert.equal(forced.state, 'stale');
  assert.match(forced.text, /no longer on the branch/);
  assert.equal(headReview({ head: SHA1, commits, records: [], authors: [] }).state, 'none');
});

test('the verdict counts: changes requested blocks, a comment doesn’t approve, the reviewer’s last word on the head wins', () => {
  const changes = headReview({ head: SHA1, commits, records: [rec({ verdict: 'changes' }), rec({ reviewer: { kind: 'agent', name: 'Alex' }, at: Date.parse(T(10)) + 1 })], authors: ['Katherine'] });
  assert.equal(changes.state, 'changes', 'Alex’s approval doesn’t outvote Sophie’s request for changes');
  assert.equal(gateDecision(changes, 'pass').allowed, false);
  const after = headReview({ head: SHA1, commits, records: [rec({ verdict: 'changes' }), rec({ at: Date.parse(T(11)) })], authors: ['Katherine'] });
  assert.equal(after.state, 'reviewed', 'Sophie approved after asking for changes');
  const comment = headReview({ head: SHA1, commits, records: [rec({ verdict: 'comment' })], authors: ['Katherine'] });
  assert.equal(comment.state, 'none');
  assert.match(comment.refused[0].why, /no approving verdict/);
  assert.deepEqual(statusOf(changes).state, 'failure');
  assert.deepEqual(statusOf(after).state, 'success');
  assert.deepEqual(statusOf(comment).state, 'pending');
});

test('independence: an author of the PR’s commits can’t review it, agent or person', () => {
  const self = headReview({ head: SHA1, commits, records: [rec({ reviewer: { kind: 'agent', name: 'Katherine' } })], authors: ['Katherine'] });
  assert.equal(self.state, 'none');
  assert.match(self.refused[0].why, /authored commits/);
  const person = headReview({ head: SHA1, commits, records: [rec({ reviewer: { kind: 'person', name: 'Keith Chin' } })], authors: ['Katherine', 'Keith Chin'] });
  assert.equal(person.state, 'none');
});

test('a Review comment is bound to its Head: line, else to the head when it was posted; a GitHub review to its own commit', () => {
  assert.deepEqual(bindingOf('Review: Sophie\n**Head:** `1111111`\nVerdict: Changes requested'), { head: '1111111', verdict: 'changes' });
  const p = pull({
    headRefOid: SHA2,
    commits: [
      { oid: SHA1, committedDate: T(9), authors: [{ name: KATHERINE }] },
      { oid: SHA2, committedDate: T(11), authors: [{ name: KATHERINE }] },
    ],
    comments: [
      { id: 'IC_1', author: { login: 'office-bot' }, createdAt: T(10), body: review('Sophie') },
      { id: 'IC_2', author: { login: 'office-bot' }, createdAt: T(10), body: review('Alex', 'Verdict: approve') },
      { id: 'IC_3', author: { login: 'office-bot' }, createdAt: T(10), body: review('Mallory') },
      { id: 'IC_4', author: { login: 'office-bot' }, createdAt: T(10), body: 'Review: Sophie\nLooks fine.' },
      { id: 'IC_5', author: { login: 'office-bot' }, createdAt: T(12), body: review('Sophie', 'Head: 2222222') },
    ],
    reviews: [{ id: 'PRR_1', author: { login: 'a-person' }, state: 'APPROVED', body: '', submittedAt: T(12), commit: { oid: SHA2 } }],
  });
  const f = factsOf(p, { agents: AGENTS });
  const byId = Object.fromEntries(f.records.map((r) => [r.id, r]));
  assert.equal(byId['c:IC_1'].sha, SHA1, 'the short Head: is the full SHA on the branch');
  assert.equal(byId['c:IC_1'].shaFrom, 'stated');
  assert.equal(byId['c:IC_2'].sha, SHA1, 'no Head: line: the head when it was posted');
  assert.equal(byId['c:IC_2'].shaFrom, 'inferred');
  assert.equal(byId['c:IC_5'].verdict, 'comment', 'after the cut-off, no Verdict: line is no approval');
  assert.equal(byId['r:PRR_1'].sha, SHA2);
  assert.equal(byId['r:PRR_1'].reviewer.kind, 'github');
  assert.equal(f.records.length, 4);
  assert.equal(f.ignored.length, 2, 'a stranger’s name and a skim');
  assert.equal(f.opener, 'Katherine');
  // Before the cut-off, a complete Review comment without a verdict is still an approval (the old rule).
  const old = factsOf(pull({ commits: [{ oid: SHA1, committedDate: '2026-10-01T09:00:00Z', authors: [] }], comments: [{ id: 'IC_9', author: { login: 'office-bot' }, createdAt: '2026-10-01T10:00:00Z', body: review('Sophie', 'Head: 1111111') }] }), { agents: AGENTS });
  assert.ok(Date.parse('2026-10-01T10:00:00Z') < BINDING_SINCE);
  assert.equal(old.records[0].verdict, 'approve');
});

test('the office’s own mx-office/review status isn’t one of the PR’s checks', () => {
  const f = factsOf(pull({ statusCheckRollup: [{ __typename: 'StatusContext', context: 'mx-office/review', state: 'PENDING' }, { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }] }), { agents: AGENTS });
  assert.equal(f.checks, 'pass');
});

// ---- The service ------------------------------------------------------------------------------------

test('merge refused without a review, allowed once another agent approved this head, refused again after a new commit', async (t) => {
  const r = rig(t);
  let d = await r.gate.check(r.floor, 12);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /^Not merged: No review counts for the head 1111111/);
  r.state.pulls[12] = pull({ comments: [{ id: 'IC_1', author: { login: 'office-bot' }, createdAt: T(10), body: review('Sophie') }] });
  d = await r.gate.check(r.floor, 12);
  assert.equal(d.allowed, true, d.reason);
  r.state.pulls[12] = pushed(r.state.pulls[12]);
  const v = await r.gate.evaluate(r.floor, 12);
  assert.equal(v.review.state, 'stale');
  assert.equal(v.review.since, 1);
  assert.equal(v.decision.allowed, false);
  assert.match(v.decision.reason, /changed since review: 1 commit\. The new head 2222222 needs its own review/);
  // Each record was kept once, bound to SHA1.
  const lines = readFileSync(path.join(r.dir, 'merge-gate', 'shop.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.t, l.id, l.sha]), [['review', 'c:IC_1', SHA1]]);
});

test('the author reviewing its own PR doesn’t count; failing checks hold a reviewed head back; running checks only without auto-merge', async (t) => {
  const r = rig(t);
  r.state.pulls[12] = pull({ comments: [{ id: 'IC_1', author: { login: 'office-bot' }, createdAt: T(10), body: review('Katherine') }] });
  const self = await r.gate.evaluate(r.floor, 12);
  assert.equal(self.review.state, 'none');
  assert.match(self.review.refused[0].why, /authored commits/);
  r.state.pulls[12] = pull({ comments: [{ id: 'IC_2', author: { login: 'office-bot' }, createdAt: T(10), body: review('Alex') }], statusCheckRollup: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' }] });
  assert.match((await r.gate.check(r.floor, 12)).reason, /Checks are failing/);
  r.state.pulls[12] = { ...r.state.pulls[12], statusCheckRollup: [{ __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: '' }] };
  assert.equal((await r.gate.check(r.floor, 12)).allowed, false);
  assert.equal((await r.gate.check(r.floor, 12, { auto: true })).allowed, true);
});

test('the PM’s review in the office: bound to the head they saw, refused once it moved on, posted as mx-office/review', async (t) => {
  const r = rig(t, {}, { personReviews: true });
  await r.gate.evaluate(r.floor, 12);
  assert.deepEqual(r.state.statuses.at(-1), { sha: SHA1, state: 'pending', context: 'mx-office/review', description: 'Waiting for an independent review of 1111111 recorded in Mx Office' });
  const moved = await r.gate.recordReview(r.floor, 12, { sha: '0000000', verdict: 'approve', by: { kind: 'person', name: 'Keith Chin' } });
  assert.match(moved.error ?? '', /moved on: you reviewed 0000000, its head is now 1111111/);
  const ok = await r.gate.recordReview(r.floor, 12, { sha: SHA1, verdict: 'approve', by: { kind: 'person', name: 'Keith Chin', id: 'acct-1' }, note: 'Ran it locally' });
  assert.equal(ok.record?.source, 'office');
  assert.equal(ok.view?.review.state, 'reviewed');
  assert.equal(ok.view?.decision.allowed, true);
  assert.deepEqual(r.state.statuses.at(-1), { sha: SHA1, state: 'success', context: 'mx-office/review', description: 'Reviewed ✓ by Keith Chin at 1111111' });
  // A person who authored commits on it can't approve it.
  r.state.pulls[13] = pull({ number: 13, commits: [{ oid: SHA1, committedDate: T(9), authors: [{ name: 'Keith Chin' }] }] });
  assert.match((await r.gate.recordReview(r.floor, 13, { sha: SHA1, verdict: 'approve', by: { kind: 'person', name: 'Keith Chin' } })).error ?? '', /authored commits on PR #13/);
  // Requesting changes blocks, and is posted as a failure.
  r.state.pulls[12] = pushed(r.state.pulls[12]);
  await r.gate.recordReview(r.floor, 12, { sha: SHA2, verdict: 'changes', by: { kind: 'person', name: 'Keith Chin' }, note: 'Wrong field' });
  const v = await r.gate.evaluate(r.floor, 12);
  assert.equal(v.review.state, 'changes');
  assert.equal(r.state.statuses.at(-1)?.state, 'failure');
  assert.equal(v.history.length, 2, 'both reviews stay in the history');
});

test('an admin’s override lets the office’s Merge through for that head only, for 30 minutes', async (t) => {
  const r = rig(t);
  assert.match((await r.gate.override(r.floor, 12, { sha: SHA1, reason: 'urgent', by: { name: 'Ada' } })).error ?? '', /at least 10 characters/);
  assert.match((await r.gate.override(r.floor, 12, { sha: '0000000', reason: 'Hotfix for the outage, reviewed on a call', by: { name: 'Ada' } })).error ?? '', /moved on/);
  const o = await r.gate.override(r.floor, 12, { sha: SHA1, reason: 'Hotfix for the outage, reviewed on a call', by: { name: 'Ada' } });
  assert.ok(o.override);
  const d = await r.gate.check(r.floor, 12);
  assert.equal(d.allowed, true);
  assert.match(d.reason, /^Overridden by Ada: “Hotfix for the outage, reviewed on a call”\. Without it: No review counts/);
  assert.equal(r.state.statuses.at(-1)?.state, 'pending', 'the status on GitHub stays honest');
  r.tick(OVERRIDE_MS + 1);
  assert.equal((await r.gate.check(r.floor, 12)).allowed, false, 'expired');
  r.tick(-OVERRIDE_MS);
  r.state.pulls[12] = pushed(r.state.pulls[12]);
  assert.equal((await r.gate.check(r.floor, 12)).allowed, false, 'a new head isn’t covered');
});

test('branch protection is read, never written: unprotected, protected without the status, requiring it, unreadable', async (t) => {
  const cases: [Partial<FakeState>, string][] = [
    [{ branch: { name: 'main', protected: false } }, 'unprotected'],
    [{ branch: { name: 'main', protected: true, protection: { required_status_checks: { contexts: ['build'] } } } }, 'protected'],
    [{ branch: { name: 'main', protected: true, protection: { required_status_checks: { contexts: [], checks: [{ context: 'mx-office/review' }] } } } }, 'requires-gate'],
    [{ branch: { name: 'main', protected: false }, rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'mx-office/review' }] } }] }, 'requires-gate'],
    [{ branchError: 'gh: Resource not accessible (HTTP 403)' }, 'unknown'],
  ];
  for (const [over, want] of cases) {
    const r = rig(t, over);
    const v = await r.gate.evaluate(r.floor, 12);
    assert.equal(v.protection?.state, want, JSON.stringify(over));
    assert.ok(!r.fake.calls.some((a) => a.includes('PUT') || a.some((x) => /protection$/.test(x) && a.includes('--method'))), 'no write to protection');
  }
  const r = rig(t);
  await r.gate.evaluate(r.floor, 12);
  await r.gate.evaluate(r.floor, 12);
  assert.equal(r.fake.calls.filter((a) => a[0] === 'api' && a[1] === 'repos/{owner}/{repo}/branches/main').length, 1, 'read once per 10 minutes');
});

test('statuses: posted once per head and state, and a refusal backs off', async (t) => {
  const r = rig(t, { statusError: 'gh: Resource not accessible by integration (HTTP 403)' });
  const v = await r.gate.evaluate(r.floor, 12);
  assert.equal(v.posted?.error?.includes('403'), true);
  r.state.statusError = undefined;
  await r.gate.evaluate(r.floor, 12);
  assert.equal(r.state.statuses.length, 0, 'backed off');
  r.tick(61 * 60_000);
  await r.gate.evaluate(r.floor, 12);
  await r.gate.evaluate(r.floor, 12);
  assert.equal(r.state.statuses.length, 1);
});

test('the sweep: only open PRs that moved, a few per look', async (t) => {
  const r = rig(t);
  const listed = [];
  for (let n = 20; n < 30; n++) {
    r.state.pulls[n] = pull({ number: n });
    listed.push({ number: n, state: 'OPEN', headRefOid: SHA1, updatedAt: T(9) });
  }
  listed.push({ number: 40, state: 'OPEN', isDraft: true, headRefOid: SHA1, updatedAt: T(9) }, { number: 41, state: 'MERGED', headRefOid: SHA1, updatedAt: T(9) });
  assert.equal(await r.gate.sweep(r.floor, listed), SWEEP_MAX);
  assert.equal(await r.gate.sweep(r.floor, listed), SWEEP_MAX);
  assert.equal(await r.gate.sweep(r.floor, listed), 10 - 2 * SWEEP_MAX);
  assert.equal(await r.gate.sweep(r.floor, listed), 0, 'nothing moved');
  listed[0] = { ...listed[0], updatedAt: T(10) };
  assert.equal(await r.gate.sweep(r.floor, listed), 1);
  assert.ok(!r.fake.calls.some((a) => a[1] === 'view' && (a[2] === '40' || a[2] === '41')), 'not drafts, not merged PRs without a mark');
});

test('Needs you: on a team where only the person can review, an unreviewed open PR is theirs; gone once reviewed', async (t) => {
  const r = rig(t, {}, { personReviews: true });
  const ctx = { cfg: { dataDir: r.dir } } as never;
  useMergeGate(ctx, r.gate);
  await r.gate.evaluate(r.floor, 12);
  const items = gateAsks(ctx, 'shop');
  assert.equal(items.length, 1);
  assert.equal(items[0].level, 'warn');
  assert.match(items[0].text, /^PR #12 waits for your review of 1111111$/);
  await r.gate.recordReview(r.floor, 12, { sha: SHA1, verdict: 'approve', by: { kind: 'person', name: 'Keith Chin' } });
  assert.deepEqual(gateAsks(ctx, 'shop'), []);
  // A team with other agents to review: never the person's.
  const r2 = rig(t);
  const ctx2 = { cfg: { dataDir: r2.dir } } as never;
  useMergeGate(ctx2, r2.gate);
  await r2.gate.evaluate(r2.floor, 12);
  assert.deepEqual(gateAsks(ctx2, 'shop'), []);
});

// ---- The office's Merge and the routes ----------------------------------------------------------------

function office(t: { after(fn: () => void): void }, r: ReturnType<typeof rig>) {
  const audit = new AuditLog(path.join(r.dir, 'audit'));
  const was = auditLog();
  useAudit(audit);
  t.after(() => useAudit(was));
  const floor = { id: 'shop', dir: r.dir, workers: { list: () => [] }, github: { pulls: { items: [] } } };
  const toasts: string[] = [];
  const ctx = { cfg: { dataDir: r.dir, trustProxy: false }, meOf: (id?: string) => ({ admin: id === 'adm' }), floors: new Map([['shop', floor]]), toastFloor: (_f: unknown, text: string) => toasts.push(text) };
  useMergeGate(ctx as never, r.gate, () => r.floor);
  const events = () => audit.events('shop').map((e) => [e.action, e.severity]);
  return { ctx, floor, audit, events, toasts };
}

type Handle = (c: unknown, r: unknown) => Promise<void> | void;
function call(ctx: unknown, route: { handle: unknown; path: string }, opts: { body: unknown; account?: { id: string; name: string }; cookie?: string }) {
  const headers: Record<string, string> = { host: 'office.test', origin: 'http://office.test', 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(opts.body))]), { method: 'POST', headers });
  let status = 0;
  let body: any;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = JSON.parse(b)), headersSent: false };
  return Promise.resolve((route.handle as Handle)(ctx, { req, res, url: new URL(`http://office.test${route.path}`), path: route.path, session: { account: opts.account } })).then(() => ({ status, body }));
}

test('the office’s Merge asks the gate: refused with the reason (audited), allowed under an override (audited as a warning)', async (t) => {
  const r = rig(t);
  const o = office(t, r);
  const why = await checkMerge(o.ctx as never, o.floor as never, 12, { name: 'Keith Chin', id: 'acct-1' }, false);
  assert.match(why ?? '', /^Not merged: No review counts for the head 1111111/);
  await r.gate.override(r.floor, 12, { sha: SHA1, reason: 'Hotfix for the outage, reviewed on a call', by: { name: 'Ada' } });
  assert.equal(await checkMerge(o.ctx as never, o.floor as never, 12, { name: 'Ada', id: 'adm' }, false), undefined);
  assert.deepEqual(o.events(), [
    ['pr.gate.refused', 'info'],
    ['pr.gate.overriddenMerge', 'warning'],
  ]);
  // A PR the office can't read isn't merged blind.
  assert.match((await checkMerge(o.ctx as never, o.floor as never, 99, { name: 'Ada' }, false)) ?? '', /couldn’t read PR #99/);
});

test('recording a review needs a fresh sign-in; an override needs an admin too; both audited', async (t) => {
  const r = rig(t);
  const o = office(t, r);
  const cookie = 'ao_session=fake-session-token';
  const body = { floor: 'shop', pr: 12, sha: SHA1, verdict: 'approve' };
  const stale = await call(o.ctx, mergeGateRoutes.review, { body, account: { id: 'acct-1', name: 'Keith Chin' }, cookie });
  assert.equal(stale.status, 401);
  assert.equal(stale.body.reauth, true);
  reauthOf(o.ctx as never).mark('fake-session-token');
  const fresh = await call(o.ctx, mergeGateRoutes.review, { body, account: { id: 'acct-1', name: 'Keith Chin' }, cookie });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  assert.equal(fresh.body.view.review.state, 'reviewed');
  assert.equal(fresh.body.view.facts, undefined);
  assert.match(o.toasts[0], /Keith Chin: reviewed and approved PR #12 at 1111111/);
  const movedOn = await call(o.ctx, mergeGateRoutes.review, { body: { ...body, sha: SHA2 }, account: { id: 'acct-1', name: 'Keith Chin' }, cookie });
  assert.equal(movedOn.status, 409);

  const ov = { floor: 'shop', pr: 12, sha: SHA1, reason: 'Hotfix for the outage, reviewed on a call' };
  assert.equal((await call(o.ctx, mergeGateRoutes.override, { body: ov, account: { id: 'acct-1', name: 'Keith Chin' }, cookie })).status, 403);
  const admin = await call(o.ctx, mergeGateRoutes.override, { body: ov, account: { id: 'adm', name: 'Ada' }, cookie });
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  assert.deepEqual(o.events(), [
    ['pr.review.record', 'notice'],
    ['pr.gate.override', 'warning'],
  ]);
  assert.match(o.audit.events('shop')[1].summary, /Overrode the merge gate for PR #12 at 1111111: Hotfix/);
});

// ---- The review gate after the merge ------------------------------------------------------------------

/** PR #5 merged, as the office's PR list has it. */
function merged(over: Partial<GhPull> = {}): GhPull {
  return {
    number: 5,
    title: 'Order form',
    state: 'MERGED',
    isDraft: false,
    url: 'https://github.com/example-org/example-app/pull/5',
    author: 'office-bot',
    labels: [],
    reviewDecision: '',
    headRefName: 'office/katherine-5',
    headRefOid: SHA2,
    baseRefName: 'main',
    createdAt: T(8),
    updatedAt: T(12),
    mergedAt: T(12),
    additions: 1,
    deletions: 0,
    checks: 'pass',
    body: 'Opened by Katherine (Lead Developer) via Mx Office',
    closes: [],
    ...over,
  } as GhPull;
}
const note = (body: string, at = T(11)) => ({ kind: 'comment' as const, author: 'office-bot', body, at });

test('after the merge: a review of another revision or without an approving verdict doesn’t count; one the gate counts does', () => {
  const look = { agents: AGENTS };
  const other = judgePull(merged({ reviewNotes: [note(review('Sophie', 'Head: 1111111\nVerdict: approve'))] }), look)!;
  assert.equal(other.unreviewed, true);
  assert.match(other.refused?.[0] ?? '', /reviewed 1111111, not the merged head/);
  const reject = judgePull(merged({ reviewNotes: [note(review('Sophie', 'Head: 2222222\nVerdict: changes requested'))] }), look)!;
  assert.equal(reject.unreviewed, true);
  const good = judgePull(merged({ reviewNotes: [note(review('Sophie', 'Head: 2222222\nVerdict: approve'))] }), look)!;
  assert.equal(good.unreviewed, false);
  const pm = judgePull(merged(), { ...look, counted: () => 'Keith Chin' })!;
  assert.equal(pm.unreviewed, false, 'the PM’s review recorded in the office counts');
  assert.deepEqual(pm.reviewers, ['Keith Chin']);
});

test('the unreviewed mark: cleared once a counting review of the merged head exists or the PR closed, not before; history kept by the caller', () => {
  const task = (pr: number): Assignment => ({ issue: pr, title: `Task ${pr}`, outcome: 'integrated', pr, doneAt: 1, doneWhy: `PR #${pr} merged (unreviewed)` }) as unknown as Assignment;
  const a = task(5);
  const b = task(6);
  const c = task(7);
  const pulls = [merged(), merged({ number: 6, headRefOid: SHA3 }), merged({ number: 7, state: 'CLOSED', mergedAt: undefined })];
  assert.ok(markTasks([a, b], pulls.slice(0, 2).map((pull) => ({ pull, j: { pr: pull.number, flags: ['no-review'], reviewers: [], incomplete: [], unreviewed: true } })), 1));
  c.unreviewed = { pr: 7, why: 'PR #7 merged without a review by another lead', at: 1 };
  assert.ok(a.unreviewed && b.unreviewed);
  const settled = settleMarks([a, b, c], pulls, (p) => (p.number === 5 ? 'Keith Chin' : undefined));
  assert.deepEqual(settled.map((s) => [s.pr, s.why]), [
    [5, `Keith Chin reviewed PR #5 at 2222222, the revision that merged`],
    [7, 'PR #7 was closed without merging'],
  ]);
  assert.equal(a.unreviewed, undefined);
  assert.equal(a.doneWhy, 'PR #5 merged');
  assert.ok(b.unreviewed, 'no counting review: the mark stays');
  assert.equal(settled[0].was.pr, 5, 'what the mark said is handed back for the history');
});

// ---- A fake gh.exe first on PATH, through the office's own gh runner -------------------------------------

test('through the office’s gh runner: the PR read, the status posted and protection read from a fake gh.exe (no token, no network)', async (t) => {
  const { runnable } = await import('./support/winshim.js');
  const bin = tmp(t, 'merge-gate-gh-');
  const work = tmp(t, 'merge-gate-work-');
  const stateFile = path.join(bin, 'state.json');
  const log = path.join(bin, 'calls.log');
  writeFileSync(stateFile, JSON.stringify({ pull: pull({ comments: [{ id: 'IC_1', author: { login: 'office-bot' }, createdAt: T(10), body: review('Sophie') }] }) }));
  writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const st = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) { process.stderr.write('a token leaked into the fake gh'); process.exit(3); }
if (args[0] === 'pr' && args[1] === 'view') process.stdout.write(JSON.stringify(st.pull));
else if (args[0] === 'api' && args.includes('POST')) process.stdout.write('{}');
else if (args[0] === 'api' && /rules\\/branches/.test(args[1])) process.stdout.write('[]');
else if (args[0] === 'api' && /branches\\//.test(args[1])) { process.stderr.write('gh: Branch not found (HTTP 404)'); process.exit(1); }
else { process.stderr.write('unexpected'); process.exit(2); }
`,
  );
  runnable(path.join(bin, 'gh'));
  const PATH = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const before = { path: process.env[PATH], gh: process.env.GH_TOKEN, github: process.env.GITHUB_TOKEN, cfg: process.env.GH_CONFIG_DIR };
  process.env[PATH] = `${bin}${path.delimiter}${before.path}`;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  process.env.GH_CONFIG_DIR = tmp(t, 'merge-gate-ghcfg-');
  try {
    const gate = new MergeGate(work, (args, cwd) => realGh(args, cwd));
    const v = await gate.evaluate({ id: 'shop', dir: work, look: { agents: AGENTS }, personReviews: false }, 12);
    assert.equal(v.review.state, 'reviewed');
    assert.equal(v.decision.allowed, true);
    assert.equal(v.protection?.state, 'unknown', 'a 404 is read as “couldn’t tell”, never as protected');
    const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
    const post = calls.find((a) => a.includes('POST'))!;
    assert.deepEqual(post.slice(0, 4), ['api', '--method', 'POST', `repos/{owner}/{repo}/statuses/${SHA1}`]);
    assert.ok(post.includes('state=success') && post.includes('context=mx-office/review'));
    assert.ok(existsSync(path.join(work, 'merge-gate', 'shop.jsonl')));
  } finally {
    process.env[PATH] = before.path;
    for (const [k, v] of [['GH_TOKEN', before.gh], ['GITHUB_TOKEN', before.github], ['GH_CONFIG_DIR', before.cfg]] as const) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
