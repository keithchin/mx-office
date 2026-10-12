// Testing release 2 (docs/site/using-the-office/testing.md, "Verification policy and waivers"): the
// verification policy, required-check states on a revision, integrated-revision verification of merged
// tasks (V5, V6, T6), per-task policy overrides, waivers (named, with a reason, audited), the main-branch
// check fetch (test mode, cadence), the test-first Needs you item, "Covers:" links and the acceptance
// record's Testing summary. Fakes only: no gh, no GitHub, no agents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GhPull, WorkerInfo } from '../src/shared/protocol.js';
import type { AuditEvent } from '../src/shared/audit.js';
import { DEFAULT_POLICY, evaluatePolicy, LINKED, waiverProblem, type VerificationPolicy, type Waiver } from '../src/shared/testing/policy.js';
import { verifyIntegrated } from '../src/shared/testing/verify.js';
import { coversLinks } from '../src/shared/testing/links.js';
import { IMPORTER_VERSION, type TestRunDraft, type TestRunRecord } from '../src/shared/testing/record.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { reviveAssignment } from '../src/server/roster/resume.js';
import { countsAsDelivered, taskStateOf } from '../src/server/roster/task-verify.js';
import { testingStore } from '../src/server/testing/index.js';
import { draftFromPull } from '../src/server/testing/import-pr.js';
import { draftFromCheckRuns, draftFromMainRun, MainChecks, officeRunner } from '../src/server/testing/main-checks.js';
import { setProjectPolicy, setTaskPolicy, stageLookOf, testFirst, verificationView, verifyTasks, waive } from '../src/server/testing/verify.js';
import { AuditLog, useAudit } from '../src/server/audit/index.js';

const HEAD = 'a'.repeat(40);
const MERGE = 'b'.repeat(40);

let n = 0;
function rec(rev: string, results: { name: string; status: 'passed' | 'failed' | 'skipped'; links?: string[] }[], extra: Partial<TestRunRecord> = {}): TestRunRecord {
  n++;
  return {
    schemaVersion: 1,
    id: `tr_${String(n).padStart(4, '0')}`,
    source: 'pr-checks',
    sourceKey: `k${n}`,
    suite: 'pr-checks',
    testedRevision: rev,
    definitionRevision: rev,
    evidence: { kind: 'ci-run', revision: `run ${n}`, locator: 'x' },
    results: results.map((r) => ({ name: r.name, status: r.status, links: (r.links ?? []).map((t) => ({ target: t, basis: 'recorded' as const, via: 'test' })) })),
    links: [],
    actor: { kind: 'ci', name: 'pr-checks' },
    importer: IMPORTER_VERSION,
    ingestedAt: n,
    ...extra,
  };
}
const draft = (r: TestRunRecord): TestRunDraft => {
  const { id: _i, ingestedAt: _a, schemaVersion: _s, ...d } = r;
  return d;
};

// ---- Policy and required-check states, pure ---------------------------------------------------------

test('the default policy requires the pr-checks conclusion; the linked-criteria rule only with linked criteria', () => {
  assert.deepEqual(DEFAULT_POLICY, { v: 1, required: ['pr-checks'], linkedCriteria: true });
  const records = [rec(MERGE, [{ name: 'pr-checks', status: 'passed' }])];
  const plain = evaluatePolicy(DEFAULT_POLICY, records, MERGE);
  assert.deepEqual(plain.checks.map((c) => [c.key, c.state]), [['pr-checks', 'passed']]);
  assert.equal(plain.verified, true);
  const linked = evaluatePolicy(DEFAULT_POLICY, records, MERGE, { criteria: [{ id: 'AC-04', journeys: ['J-02'] }] });
  assert.deepEqual(linked.checks.map((c) => [c.key, c.state]), [['pr-checks', 'passed'], [LINKED, 'missing']]);
  assert.equal(linked.verified, false, 'a criterion with no result on the revision is missing');
  // A test result naming the journey (not a run-wide link) proves the criterion.
  const withJourney = [...records, rec(MERGE, [{ name: 'J-02 submit request', status: 'passed', links: ['J-02'] }], { source: 'report-file', suite: 'e2e' })];
  assert.equal(evaluatePolicy(DEFAULT_POLICY, withJourney, MERGE, { criteria: [{ id: 'AC-04', journeys: ['J-02'] }] }).verified, true);
  const runWide = [rec(MERGE, [{ name: 'pr-checks', status: 'passed' }], { links: [{ target: 'AC-04', basis: 'recorded', via: 'PR' }] })];
  assert.equal(evaluatePolicy(DEFAULT_POLICY, runWide, MERGE, { criteria: [{ id: 'AC-04' }] }).checks[1].state, 'missing', 'a run-wide link proves nothing about a journey');
});

test('V6: a missing or skipped required check blocks verified; scorecard rows are their own checks', () => {
  const policy: VerificationPolicy = { v: 1, required: ['pr-checks', 'lint', 'e2e-tests'], linkedCriteria: false };
  const r = [rec(MERGE, [{ name: 'Studio Pro mx check', status: 'passed' }, { name: 'Lint', status: 'passed' }, { name: 'E2E tests (Playwright)', status: 'skipped' }], { conclusion: 'passed' })];
  const e = evaluatePolicy(policy, r, MERGE);
  assert.deepEqual(e.checks.map((c) => [c.key, c.state]), [['pr-checks', 'passed'], ['lint', 'passed'], ['e2e-tests', 'skipped']]);
  assert.equal(e.verified, false, 'skipped never counts as passed');
  const missing = evaluatePolicy({ ...policy, required: ['pr-checks', 'unit-tests'] }, r, MERGE);
  assert.deepEqual(missing.checks.map((c) => c.state), ['passed', 'missing']);
  assert.equal(missing.verified, false, 'missing never counts as passed');
  // On another revision nothing ran: every check missing.
  const other = evaluatePolicy(policy, r, 'c'.repeat(40));
  assert.equal(other.nothingRan, true);
  assert.equal(evaluatePolicy(policy, r, undefined).checks.every((c) => c.state === 'missing'), true, 'no merge commit known: missing');
});

test('V6: a waiver needs a named person and a reason, is for one check on one revision, and then counts', () => {
  assert.match(waiverProblem({ by: '', reason: 'flaky runner, passed locally', check: 'pr-checks', revision: MERGE })!, /name of the person/);
  assert.match(waiverProblem({ by: 'Ann', reason: 'ok', check: 'pr-checks', revision: MERGE })!, /reason/);
  assert.match(waiverProblem({ by: 'Ann', reason: 'flaky runner, passed locally', check: 'nope', revision: MERGE })!, /which required check/);
  assert.equal(waiverProblem({ by: 'Ann', reason: 'flaky runner, passed locally', check: 'pr-checks', revision: MERGE }), undefined);
  const w: Waiver = { check: 'pr-checks', revision: MERGE, by: 'Ann', reason: 'flaky runner, passed locally', at: 1 };
  const failed = [rec(MERGE, [{ name: 'pr-checks', status: 'failed' }])];
  const e = evaluatePolicy(DEFAULT_POLICY, failed, MERGE, { waivers: [w] });
  assert.equal(e.checks[0].state, 'waived');
  assert.equal(e.checks[0].waiver?.by, 'Ann', 'shown with who and why');
  assert.equal(e.verified, true);
  assert.equal(evaluatePolicy(DEFAULT_POLICY, failed, 'c'.repeat(40), { waivers: [w] }).checks[0].state, 'missing', 'a waiver is for its revision only');
});

test('V5: passed on the PR head, nothing on the merge commit: "passed on PR head, integrated revision not checked", not verified', () => {
  const records = [rec(HEAD, [{ name: 'All checks on the PR head', status: 'passed' }], { suite: 'PR checks (all checks on the head)' })];
  const r = verifyIntegrated({ policy: DEFAULT_POLICY, records, head: HEAD, merge: MERGE });
  assert.equal(r.state, 'head-only');
  assert.equal(r.merge.verified, false);
  assert.equal(verifyIntegrated({ policy: DEFAULT_POLICY, records, head: HEAD }).state, 'head-only', 'merge commit not known yet: still not checked');
  // A failed head with nothing on the merge commit isn't "passed on head".
  assert.equal(verifyIntegrated({ policy: DEFAULT_POLICY, records: [rec(HEAD, [{ name: 'x', status: 'failed' }])], head: HEAD, merge: MERGE }).state, 'not-verified');
  // Once the merge commit has its own run, that decides.
  assert.equal(verifyIntegrated({ policy: DEFAULT_POLICY, records: [...records, rec(MERGE, [{ name: 'pr-checks', status: 'passed' }])], head: HEAD, merge: MERGE }).state, 'verified');
  assert.equal(verifyIntegrated({ policy: DEFAULT_POLICY, records: [...records, rec(MERGE, [{ name: 'pr-checks', status: 'failed' }])], head: HEAD, merge: MERGE }).state, 'not-verified');
});

test('"Covers:" in a PR description is a recorded link, read from the body the PR list already has', () => {
  assert.deepEqual(coversLinks('Adds the approval step.\n\nCovers: AC-04, BR012, J-02\n', 'PR #3').map((l) => [l.target, l.basis]).sort(), [['AC-04', 'recorded'], ['BR012', 'recorded'], ['J-02', 'recorded']]);
  assert.deepEqual(coversLinks('**Covers:** AC-1', 'PR #3').map((l) => l.target), ['AC-1']);
  assert.deepEqual(coversLinks('No covers line, though AC-04 is mentioned', 'PR #3'), []);
  const d = draftFromPull('o/r', { number: 7, title: 'BR013 tweak', body: 'Covers: AC-04', headRefOid: HEAD, checks: 'pass', url: 'u', headRefName: 'feat/x', updatedAt: '2026-10-12T00:00:00Z' } as GhPull)!;
  assert.deepEqual(d.links.map((l) => [l.target, l.basis]), [['AC-04', 'recorded'], ['BR013', 'inferred']]);
});

// ---- On a fake team floor: T6, overrides, legacy ----------------------------------------------------

class FakeFloor implements TeamFloor {
  id = `verify-${Math.random().toString(36).slice(2, 8)}`;
  name = 'verify-test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'verify-floor-'));
  map = new Map<string, WorkerInfo>();
  typed: { id: string; text: string }[] = [];
  activities: string[] = [];
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo> {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', deskId: 'd', name: ask.name, color: '#fff', status: 'idle', acked: true, createdBy: ask.by, createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [], worktree: { path: `wt/${id}`, branch: 'feat/orders', base: 'main' } } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(path.join(this.dir, 'wt', id), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.map.delete(id);
  }
  prompt(id: string, text: string) {
    this.typed.push({ id, text });
    return undefined;
  }
  wake(id: string, text?: string) {
    if (text) this.typed.push({ id, text });
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  pulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = (text: string) => void this.activities.push(text);
}

async function office() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'verify-data-'));
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({ number: 2 }), analysis: () => '', now: () => Date.UTC(2026, 9, 12, 8) }, 0);
  floor.roster = roster;
  assert.equal(await roster.members.hire(floor, 'lead-developer', 'Keith', undefined, 'build the Orders module (issue #5)'), undefined);
  const t = () => roster.data(floor.id).members['lead-developer'].task!;
  // Merged: the office settled it as integrated (step 2).
  Object.assign(t(), { doneAt: 1, doneWhy: 'PR #21 merged', outcome: 'integrated', pr: 21, v: 2 });
  floor.typed.length = 0;
  const pull = { number: 21, state: 'MERGED', title: 'Orders', url: 'https://github.com/o/r/pull/21', body: '', headRefOid: HEAD, mergeCommit: MERGE, headRefName: 'feat/orders', updatedAt: '2026-10-12T07:00:00Z' } as GhPull;
  const pulls = { id: floor.id, github: { pulls: { items: [pull] } } };
  const ingest = (...rs: TestRunRecord[]) => testingStore(dataDir, floor.id).ingest(rs.map(draft));
  return { dataDir, floor, roster, t, pull, pulls, ingest };
}

const open = (roster: Roster, floor: TeamFloor) => roster.data(floor.id).escalations.filter((e) => e.status === 'open');

test('T6: merged without the required passing checks is "Merged, not verified": one Needs you item, not delivered, no nudge loop', async () => {
  const { dataDir, floor, roster, t, pulls, ingest } = await office();
  await ingest(rec(HEAD, [{ name: 'pr-checks', status: 'passed' }]), rec(MERGE, [{ name: 'pr-checks', status: 'failed' }]));
  assert.equal(await verifyTasks(dataDir, roster, floor, pulls), 1);
  assert.equal(taskStateOf(t()), 'not-verified');
  assert.equal(countsAsDelivered(t()), false, 'not delivered');
  const asks = open(roster, floor);
  assert.equal(asks.length, 1);
  assert.match(asks[0].title, /PR #21 merged, not verified/);
  assert.deepEqual(asks[0].options, ['Re-run checks', 'Waive (with a reason)', 'Send back for rework']);
  assert.match(asks[0].details, /pr-checks run \(its overall conclusion\): failed/);
  assert.equal(asks[0].fyi, false, 'in Needs you');
  assert.equal(t().verify?.escalationId, asks[0].id);
  // Looked at again (every poll): no second item, no prompt typed to the agent.
  for (let i = 0; i < 3; i++) await verifyTasks(dataDir, roster, floor, pulls);
  assert.equal(roster.data(floor.id).escalations.length, 1, 'raised once per task revision');
  assert.deepEqual(floor.typed, [], 'nothing nudges the agent');
  assert.equal(roster.backToWork.check(floor, 'lead-developer'), false, 'a merged task gets no back-to-work nudge');
  // A waiver for the failing check, by a named person with a reason: audited, then verified.
  const events: AuditEvent[] = [];
  useAudit(new AuditLog(mkdtempSync(path.join(os.tmpdir(), 'verify-audit-'))), (e) => events.push(e));
  try {
    assert.match(String(await waive(dataDir, floor.id, { check: 'pr-checks', revision: MERGE, reason: 'too short' }, { name: '' })), /name of the person/);
    assert.match(String(await waive(dataDir, floor.id, { check: 'pr-checks', revision: MERGE, reason: 'meh' }, { name: 'Ann' })), /reason/);
    const w = await waive(dataDir, floor.id, { check: 'pr-checks', revision: MERGE, reason: 'runner outage; re-run on the PR head passed', task: 'PR #21' }, { name: 'Ann', accountId: 'acc1' });
    assert.notEqual(typeof w, 'string');
    assert.equal(events.filter((e) => e.action === 'testing.waive').length, 1, 'audited');
    assert.match(events.find((e) => e.action === 'testing.waive')!.summary, /Waived the required check pr-checks on bbbbbbb \(PR #21\): runner outage/);
  } finally {
    useAudit(undefined);
  }
  await verifyTasks(dataDir, roster, floor, pulls);
  assert.equal(taskStateOf(t()), 'verified');
  assert.equal(countsAsDelivered(t()), true, 'Done (verified) is delivered');
  assert.equal(t().verify?.checks[0].waivedBy, 'Ann');
  assert.equal(roster.data(floor.id).escalations.length, 1, 'still the one item');
  const view = await verificationView(dataDir, roster, pulls);
  assert.equal(view.newest?.eval.checks[0].state, 'waived');
  assert.equal(view.waivers[0].by, 'Ann');
  roster.stop();
});

test('V5 on a task: head passed, merge commit with no results: not verified, not delivered, no Needs you item', async () => {
  const { dataDir, floor, roster, t, pulls, ingest } = await office();
  await ingest(rec(HEAD, [{ name: 'All checks on the PR head', status: 'passed' }], { suite: 'PR checks (all checks on the head)' }));
  await verifyTasks(dataDir, roster, floor, pulls);
  assert.equal(taskStateOf(t()), 'head-only');
  assert.equal(countsAsDelivered(t()), false);
  assert.equal(open(roster, floor).length, 0, 'not checked yet is not a failure');
  const view = await verificationView(dataDir, roster, pulls);
  assert.deepEqual(view.tasks.map((x) => [x.pr, x.state, x.url]), [[21, 'head-only', 'https://github.com/o/r/pull/21']]);
  // The merge commit's run lands (the main-branch fetch): verified.
  await ingest(rec(MERGE, [{ name: 'pr-checks', status: 'passed' }]));
  await verifyTasks(dataDir, roster, floor, pulls);
  assert.equal(taskStateOf(t()), 'verified');
  roster.stop();
});

test('a task’s own policy beats the project’s; each change is audited; legacy tasks are untouched', async () => {
  const { dataDir, floor, roster, t, pulls, ingest } = await office();
  const events: AuditEvent[] = [];
  useAudit(new AuditLog(mkdtempSync(path.join(os.tmpdir(), 'verify-audit-'))), (e) => events.push(e));
  try {
    await ingest(rec(MERGE, [{ name: 'Lint', status: 'failed' }], { conclusion: 'passed' }));
    // The project requires lint too: not verified.
    assert.notEqual(typeof (await setProjectPolicy(dataDir, floor.id, { required: ['pr-checks', 'lint'], linkedCriteria: true }, { name: 'Ann' })), 'string');
    await verifyTasks(dataDir, roster, floor, pulls);
    assert.equal(taskStateOf(t()), 'not-verified');
    // This task's own policy needs only the conclusion: verified.
    assert.deepEqual(setTaskPolicy(roster, floor, 'lead-developer', { required: ['pr-checks'], linkedCriteria: false }, { name: 'Ann' }), { v: 1, required: ['pr-checks'], linkedCriteria: false });
    await verifyTasks(dataDir, roster, floor, pulls);
    assert.equal(taskStateOf(t()), 'verified');
    assert.deepEqual(events.filter((e) => e.action === 'testing.policy').map((e) => (e.details as { scope: string }).scope), ['project', 'task']);
    // It survives a save and load, versioned.
    assert.deepEqual(reviveAssignment(JSON.parse(JSON.stringify(t())))?.policy, { v: 1, required: ['pr-checks'], linkedCriteria: false });
    assert.equal(reviveAssignment(JSON.parse(JSON.stringify(t())))?.verify?.state, 'verified');
  } finally {
    useAudit(undefined);
  }
  // A legacy record (a doneAt, no outcome) is left exactly as it was.
  const legacy = { text: 'issue #1', at: 1, by: 'K', issue: 1, doneAt: 2, doneWhy: 'PR #9 is no longer open' };
  roster.data(floor.id).members['lead-developer'].task = reviveAssignment(legacy);
  assert.equal(await verifyTasks(dataDir, roster, floor, pulls), 0);
  assert.deepEqual(roster.data(floor.id).members['lead-developer'].task, legacy);
  assert.equal(taskStateOf(roster.data(floor.id).members['lead-developer'].task!), 'legacy');
  roster.stop();
});

// ---- The main-branch fetch -------------------------------------------------------------------------

test('the main-branch check fetch: fakes only in test mode, never faster than the PR poll, bounded', async () => {
  const was = process.env.AGENT_OFFICE_TEST_MODE;
  process.env.AGENT_OFFICE_TEST_MODE = '1';
  try {
    assert.equal(officeRunner(os.tmpdir()), undefined, 'test mode: the office never starts its own gh for it');
  } finally {
    if (was === undefined) delete process.env.AGENT_OFFICE_TEST_MODE;
    else process.env.AGENT_OFFICE_TEST_MODE = was;
  }
  const calls: string[][] = [];
  const clock = { now: 1_000_000 };
  const fake = async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'run') return JSON.stringify([{ databaseId: 9, status: 'completed', conclusion: 'success', headSha: MERGE, url: 'https://x/9', createdAt: '2026-10-12T08:00:00Z' }, { databaseId: 10, status: 'in_progress', conclusion: '', headSha: MERGE, url: 'u', createdAt: '' }]);
    return JSON.stringify([{ name: 'build', status: 'completed', conclusion: 'success', head_sha: MERGE }]);
  };
  const mc = new MainChecks(() => fake, { workflow: 'pr-checks.yml', minMs: 90_000, now: () => clock.now });
  const look = { floorId: 'f1', dir: os.tmpdir(), repo: 'o/r', branch: 'main', pullsAt: 1, loading: false };
  const drafts = await mc.poll(look);
  assert.equal(calls.length, 2, 'two gh calls');
  assert.deepEqual(calls[0].slice(0, 6), ['run', 'list', '-R', 'o/r', '--branch', 'main']);
  assert.ok(calls[0].includes('--limit') && Number(calls[0][calls[0].indexOf('--limit') + 1]) <= 10, 'bounded');
  assert.deepEqual(drafts.map((d) => [d.suite, d.testedRevision, d.conclusion]), [['pr-checks', MERGE, 'passed'], ['Checks on main (all check runs)', MERGE, 'passed']], 'a run still going is not a result');
  assert.deepEqual(await mc.poll(look), [], 'the same PR list: no second look');
  clock.now += 30_000;
  assert.deepEqual(await mc.poll({ ...look, pullsAt: 2 }), [], 'a new PR list within the poll interval: still waits');
  assert.equal(await mc.poll({ ...look, pullsAt: 2, loading: true }).then((x) => x.length), 0, 'not while the PR list is loading');
  clock.now += 90_000;
  assert.equal((await mc.poll({ ...look, pullsAt: 3 })).length, 2, 'after the interval and a new PR list: looks again');
  assert.equal(calls.length, 4);
  assert.deepEqual(await new MainChecks(() => undefined).poll(look), [], 'no runner (test mode): nothing at all');
  assert.equal(draftFromMainRun('o/r', 'main', { databaseId: 1, status: 'completed', conclusion: 'failure', headSha: 'short', url: '', createdAt: '' }), undefined, 'not a full sha: not a record');
  assert.equal(draftFromCheckRuns('o/r', 'main', [{ name: 'a', status: 'in_progress', conclusion: null, head_sha: MERGE }]), undefined, 'checks still running: not a record');
});

// ---- The test-first prompt -------------------------------------------------------------------------

test('test first: "N acceptance criteria have no linked test" is raised once (Stage 4 passed, Stage 5 not confirmed), then updated', async () => {
  const { dataDir, floor, roster } = await office();
  assert.equal(await testFirst(dataDir, roster, floor, { stage4: false, stage5: false }, 3), 'none', 'before Stage 4: nothing');
  assert.equal(await testFirst(dataDir, roster, floor, { stage4: true, stage5: true }, 3), 'none', 'Stage 5 confirmed: nothing');
  assert.equal(await testFirst(dataDir, roster, floor, { stage4: true, stage5: false }, 3), 'raised');
  assert.equal(await testFirst(dataDir, roster, floor, { stage4: true, stage5: false }, 3), 'none');
  const asks = roster.data(floor.id).escalations;
  assert.equal(asks.length, 1, 'raised once');
  assert.equal(asks[0].title, '3 acceptance criteria have no linked test');
  assert.equal(asks[0].fyi, false, 'shown in Needs you');
  assert.equal(await testFirst(dataDir, roster, floor, { stage4: true, stage5: false }, 1), 'updated');
  assert.equal(roster.data(floor.id).escalations.length, 1, 'updated, not raised again');
  assert.equal(roster.data(floor.id).escalations[0].title, '1 acceptance criterion has no linked test');
  roster.escalations.resolve(floor, asks[0].id, 'dismiss', '', 'Ann');
  assert.equal(await testFirst(dataDir, roster, floor, { stage4: true, stage5: false }, 4), 'none', 'answered: never raised again');
  assert.deepEqual(floor.typed, [], 'nobody is prompted');
  assert.deepEqual(stageLookOf({ toolkit: true, show: false, stages: [{ id: '4' }], verdicts: [{ id: '5', status: 'PENDING' }], decisions: [] }), { stage4: true, stage5: false });
  assert.deepEqual(stageLookOf({ toolkit: true, show: false, stages: [{ id: '4' }], decisions: [{ stage: '5', status: 'Confirmed 2026-10-12' }] }), { stage4: true, stage5: true });
  assert.equal(stageLookOf({ show: false, stages: [] }), undefined, 'not a toolkit project');
  roster.stop();
});

// ---- The acceptance record --------------------------------------------------------------------------

test('an acceptance records the Testing summary at the accepted commit; existing records are never rewritten', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { accept, acceptanceDraft, acceptanceStore, reopen } = await import('../src/server/acceptance/index.js');
  const { budgetOf } = await import('../src/server/budget/index.js');
  const { rosterOf } = await import('../src/server/roster/adapter.js');
  const { removeDir } = await import('./support/cleanup.js');
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-accept-'));
  const dir = path.join(root, 'repo');
  mkdirSync(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  mkdirSync(path.join(dir, 'architecture'));
  writeFileSync(path.join(dir, 'architecture', 'acceptance-criteria.md'), '| AC | Criterion | Proof |\n|---|---|---|\n| AC-01 | A request can be submitted | J-01 |\n| AC-02 | A manager approves | (none yet) |\n');
  writeFileSync(path.join(dir, 'PROJECT.md'), '# Project\n');
  git('add', '-A');
  git('commit', '-m', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  const floor = { id: path.basename(root).replace(/[^A-Za-z0-9_-]/g, '_'), dir, def: { name: 'Shop', projectId: 'prj_fixture' }, workers: { list: () => [] }, github: { pulls: { items: [] } } } as never as import('../src/server/floor.js').Floor;
  const ctx = { cfg: { dataDir: path.join(root, 'data'), trustProxy: false }, floors: new Map([[floor.id, floor]]), meOf: () => ({ admin: true }), workerFloor: () => undefined } as never as import('../src/server/office/context.js').Ctx;
  const b = budgetOf(ctx);
  b.file({ id: floor.id, name: 'Shop', dir }).plan = { edited: true, start: '2026-10-10', lines: [] } as never;
  b.store.office().fx = { currency: 'USD', mode: 'manual' };
  t.after(async () => {
    await rosterOf(ctx).file(floor.id).flushSoon();
    b.flush();
    removeDir(root);
  });
  const store = acceptanceStore(ctx.cfg.dataDir, floor.id);
  // A record from before release 2: no testing field.
  store.append({ op: 'accept', record: { schemaVersion: 1, id: 'acc_old', floorId: floor.id, version: 'v1', cycle: 1, acceptedAt: 1, acceptedBy: { name: 'Pat' }, scope: { agreed: [], delivered: [] }, source: { branch: 'main', commit: sha, gaps: [] }, tests: [], docs: [], exceptions: [], cost: { at: 1, spent: 3, estimated: 0, unmeteredCalls: 0, byStage: [] }, refs: [] } as never });
  const before = readFileSync(store.file, 'utf8');
  assert.notEqual(typeof reopen(ctx, floor, { scopeNote: 'More' }, { name: 'Pat' }), 'string');
  await testingStore(ctx.cfg.dataDir, floor.id).ingest([draft(rec(sha, [{ name: 'pr-checks', status: 'passed' }]))]);
  const d = await acceptanceDraft(ctx, floor, true);
  const r = await accept(ctx, floor, { reviewToken: d.reviewToken }, { name: 'Pat' });
  assert.notEqual(typeof r, 'string', String(r));
  if (typeof r === 'string') return;
  assert.ok(r.testing, 'the new record has the Testing summary');
  assert.equal(r.testing!.commit, sha);
  assert.deepEqual(r.testing!.counts.coverage, { linked: 0, inferred: 0, none: 2 }, 'coverage counted per criterion');
  assert.equal(r.testing!.policyFrom, 'default');
  assert.deepEqual(r.testing!.evaluation.checks.map((c) => [c.key, c.state]), [['pr-checks', 'passed']]);
  assert.equal(r.testing!.evaluation.verified, true);
  assert.ok(readFileSync(store.file, 'utf8').startsWith(before), 'the earlier lines are byte for byte as they were');
  assert.equal(store.all()[0].op === 'accept' && (store.all()[0] as { record: { testing?: unknown } }).record.testing, undefined, 'the old record gained nothing');
  assert.equal(store.verify().ok, true);
});
