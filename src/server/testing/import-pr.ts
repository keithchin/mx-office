// pr-checks runs as test-run records. Nothing is fetched here: the board's poll already brings each
// pull request's check rollup on its head commit (github.ts), and the board's hover asks pr-checks for
// the newest run and its scorecard (prshots/). The run's head commit is both the tested app revision and
// the test-definition revision (the CI system checked that commit out and ran its tests); the evidence
// is the CI run itself. A run still going is not a result and isn't taken in.

import type { PrChecks } from '../../shared/prshots.js';
import type { GhPull } from '../../shared/protocol.js';
import { coversLinks, inferredLinks, mergeLinks } from '../../shared/testing/links.js';
import { IMPORTER_VERSION, statusOf, type ResultStatus, type TestRunDraft } from '../../shared/testing/record.js';
import { ciResultStatus } from '../../shared/ci-conclusion.js';

const SHA = /^[0-9a-f]{7,64}$/i;

/** A pull request's check rollup on its head commit, once it's decided (pass or fail). */
export function draftFromPull(repo: string, p: GhPull): TestRunDraft | undefined {
  if (!p.headRefOid || !SHA.test(p.headRefOid) || (p.checks !== 'pass' && p.checks !== 'fail')) return undefined;
  const sha = p.headRefOid;
  const status: ResultStatus = p.checks === 'pass' ? 'passed' : 'failed';
  const via = `PR #${p.number} title`;
  return {
    source: 'pr-checks',
    // The same head can pass, then fail on a re-run: each outcome is a run of its own.
    sourceKey: `pr-rollup:${repo}#${p.number}@${sha}:${p.checks}`,
    suite: 'PR checks (all checks on the head)',
    testedRevision: sha,
    definitionRevision: sha,
    evidence: { kind: 'ci-run', revision: `checks@${sha.slice(0, 12)}`, locator: `${p.url}/checks` },
    branch: p.headRefName,
    pr: p.number,
    finishedAt: p.updatedAt,
    results: [{ name: 'All checks on the PR head', status, links: [] }],
    // The description's "Covers: AC-04, BR012" line is a recorded link (the developers' Playbook asks for it).
    links: mergeLinks(coversLinks(p.body, `PR #${p.number} description`), inferredLinks(p.title, 'PR title', via)),
    actor: { kind: 'ci', name: 'GitHub checks' },
    importer: IMPORTER_VERSION,
  };
}

/** The scorecard's icon as a status. */
function rowStatus(icon: string, result: string): ResultStatus {
  return statusOf(icon) ?? statusOf(result) ?? (/\b0 (error|fail)/i.test(result) ? 'passed' : 'skipped');
}

/** The newest pr-checks run of a PR (or of a branch, main included), as prshots/ read it. */
export function draftFromPrChecks(repo: string, c: PrChecks, opts: { branch?: string; title?: string; body?: string } = {}): TestRunDraft | undefined {
  const run = c.run;
  if (!run || String(run.status).toLowerCase() !== 'completed' || !SHA.test(run.sha ?? '')) return undefined;
  // A cancelled, timed-out or stale run did not pass (shared/ci-conclusion.ts), whatever its rows say.
  const runStatus = ciResultStatus(run.conclusion) ?? statusOf(run.conclusion);
  const results = c.rows.map((row) => ({ name: row.check, status: rowStatus(row.icon, row.result), detail: row.result || undefined, links: inferredLinks(row.check, 'test name', `pr-checks run ${run.id}`) }));
  if (!results.length) {
    const s = runStatus;
    if (!s) return undefined;
    results.push({ name: 'pr-checks', status: s, detail: run.conclusion || undefined, links: [] });
  }
  return {
    source: 'pr-checks',
    sourceKey: `pr-checks-run:${repo}:${run.id}:${run.conclusion}`,
    suite: 'pr-checks',
    testedRevision: run.sha,
    definitionRevision: run.sha,
    evidence: { kind: 'ci-run', revision: `run ${run.id}`, locator: run.url },
    ...(opts.branch ? { branch: opts.branch } : {}),
    ...(c.pr ? { pr: c.pr } : {}),
    startedAt: run.createdAt,
    results,
    ...(runStatus ? { conclusion: runStatus } : {}),
    links: mergeLinks(coversLinks(opts.body, `PR #${c.pr} description`), opts.title ? inferredLinks(opts.title, 'PR title', `PR #${c.pr} title`) : []),
    actor: { kind: 'ci', name: 'pr-checks' },
    importer: IMPORTER_VERSION,
  };
}
