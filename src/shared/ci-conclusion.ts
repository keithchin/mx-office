// What a CI conclusion means, in one place for every summary of checks: a PR card's rollup and its check
// rows (server/github.ts), the project analysis (server/analysis/collect.ts) and the test-run records made
// from runs on the default branch (server/testing/main-checks.ts). A run that was cancelled, timed out,
// failed to start, waits for someone to approve it (action_required) or was given up on by GitHub (stale)
// did not pass: it is a failure with its conclusion said, never a skip or a pass. Only skipped and neutral
// are skips. Pure.

import type { ResultStatus } from './testing/record.js';

/** GitHub's conclusions (CheckRun) and states (StatusContext), upper case, that mean "this did not pass". */
export const CI_FAILED: readonly string[] = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'];
const SKIPPED = ['SKIPPED', 'NEUTRAL'];

const upper = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** One check of a rollup (a CheckRun: status + conclusion; a StatusContext: state). */
export function ciCheckState(c: { conclusion?: unknown; state?: unknown; status?: unknown }): 'pass' | 'fail' | 'pending' | 'skip' {
  const concl = upper(c.conclusion || c.state);
  const status = upper(c.status);
  if (CI_FAILED.includes(concl)) return 'fail';
  if ((status && status !== 'COMPLETED') || !concl || concl === 'PENDING' || concl === 'EXPECTED') return 'pending';
  if (SKIPPED.includes(concl)) return 'skip';
  return 'pass';
}

/** A whole rollup: failed when any check didn't pass, pending while any is still going, else passed. */
export function ciRollup(rollup: readonly { conclusion?: unknown; state?: unknown; status?: unknown }[] | undefined): 'pass' | 'fail' | 'pending' | 'none' {
  if (!Array.isArray(rollup) || !rollup.length) return 'none';
  let pending = false;
  for (const c of rollup) {
    const concl = upper(c?.conclusion || c?.state);
    const status = upper(c?.status);
    if (CI_FAILED.includes(concl)) return 'fail';
    if ((status && status !== 'COMPLETED') || concl === 'PENDING' || concl === 'EXPECTED' || concl === 'IN_PROGRESS' || concl === 'QUEUED') pending = true;
  }
  return pending ? 'pending' : 'pass';
}

/** A finished run's or check run's conclusion as a test result; undefined when there is none to read. */
export function ciResultStatus(conclusion: unknown): ResultStatus | undefined {
  const c = upper(conclusion);
  if (!c) return undefined;
  if (c === 'SUCCESS') return 'passed';
  if (CI_FAILED.includes(c)) return 'failed';
  if (SKIPPED.includes(c)) return 'skipped';
  return undefined;
}
