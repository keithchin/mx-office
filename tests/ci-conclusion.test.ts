// CI conclusions (shared/ci-conclusion.ts): a run that was cancelled, timed out, failed to start, waits
// for an approval (action_required) or went stale did not pass. It is a failure everywhere checks are
// summed up: a PR card's rollup and rows, and the test-run records from the default branch's runs, where
// it used to read as skipped (so a cancelled check beside a passing one made main read as passed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ciCheckState, ciResultStatus, ciRollup } from '../src/shared/ci-conclusion.js';
import { draftFromCheckRuns, draftFromMainRun } from '../src/server/testing/main-checks.js';
import { draftFromPrChecks } from '../src/server/testing/import-pr.js';

const SHA = 'c'.repeat(40);
const NOT_PASSED = ['cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale', 'failure'];

test('every conclusion that is not a pass reads as failed, skipped and neutral as skipped', () => {
  for (const c of NOT_PASSED) assert.equal(ciResultStatus(c), 'failed', c);
  assert.equal(ciResultStatus('success'), 'passed');
  assert.equal(ciResultStatus('skipped'), 'skipped');
  assert.equal(ciResultStatus('neutral'), 'skipped');
  assert.equal(ciResultStatus(null), undefined);
  assert.equal(ciResultStatus(''), undefined);
});

test('the PR card: a rollup with a cancelled, startup-failed or stale check fails, its row says fail', () => {
  const ok = { status: 'COMPLETED', conclusion: 'SUCCESS' };
  for (const c of ['CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']) {
    assert.equal(ciRollup([ok, { status: 'COMPLETED', conclusion: c }]), 'fail', c);
    assert.equal(ciCheckState({ status: 'COMPLETED', conclusion: c }), 'fail', c);
  }
  assert.equal(ciRollup([ok, { status: 'COMPLETED', conclusion: 'SKIPPED' }]), 'pass', 'a skipped check does not fail the PR');
  assert.equal(ciCheckState({ status: 'COMPLETED', conclusion: 'NEUTRAL' }), 'skip');
  assert.equal(ciRollup([ok, { status: 'IN_PROGRESS', conclusion: null }]), 'pending');
  assert.equal(ciRollup([{ state: 'PENDING' }]), 'pending', 'a status context');
  assert.equal(ciRollup([{ state: 'ERROR' }]), 'fail');
  assert.equal(ciRollup([]), 'none');
  assert.equal(ciCheckState({ status: 'QUEUED' }), 'pending');
});

test('main: a cancelled check run beside a passing one is a failed record, not a pass', () => {
  const runs = (c: string) => [
    { name: 'build', status: 'completed', conclusion: 'success', head_sha: SHA },
    { name: 'tests', status: 'completed', conclusion: c, head_sha: SHA },
  ];
  for (const c of NOT_PASSED) {
    const d = draftFromCheckRuns('o/r', 'main', runs(c))!;
    assert.equal(d.conclusion, 'failed', c);
    assert.deepEqual(d.results.map((r) => [r.name, r.status, r.detail]), [['build', 'passed', 'success'], ['tests', 'failed', c]], 'the conclusion is said as the detail');
  }
  assert.equal(draftFromCheckRuns('o/r', 'main', runs('skipped'))!.conclusion, 'passed', 'a skipped run beside a pass');
  assert.equal(draftFromCheckRuns('o/r', 'main', runs('neutral'))!.results[1].status, 'skipped');
});

test('main: a pr-checks run that was cancelled or timed out is a failed record, not left out', () => {
  for (const c of ['cancelled', 'timed_out', 'startup_failure']) {
    const d = draftFromMainRun('o/r', 'main', { databaseId: 7, status: 'completed', conclusion: c, headSha: SHA, url: 'https://x/7', createdAt: '2026-10-20T08:00:00Z' })!;
    assert.equal(d.conclusion, 'failed', c);
    assert.equal(d.results[0].detail, c);
  }
});

test('a PR’s pr-checks run that was cancelled fails, even when its scorecard rows read as passed', () => {
  const run = { id: 3, status: 'completed', conclusion: 'cancelled', sha: SHA, url: 'https://x/3', createdAt: '2026-10-20T08:00:00Z' };
  const withRows = draftFromPrChecks('o/r', { run, rows: [{ check: 'lint', icon: '✅', result: '0 errors' }], pr: 4 } as never)!;
  assert.equal(withRows.conclusion, 'failed');
  const bare = draftFromPrChecks('o/r', { run, rows: [], pr: 4 } as never)!;
  assert.deepEqual(bare.results.map((r) => [r.status, r.detail]), [['failed', 'cancelled']]);
});
