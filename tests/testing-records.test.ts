// Testing release 1: revision-bound test-run records (the store, the importers, the links) and the pure
// view over them: coverage, result and freshness kept apart (T2, T3), flaky tests (T4), recorded vs
// inferred links (T5), declared vs unknown tested revisions (V1), definition vs app revision (V2) and
// idempotent ingestion (V3). Fake runs and reports only: nothing here calls GitHub (T12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { idsIn, inferredLinks, journeysIn, parseAcTable, parseBrd, recordedLinks, resolvePointer } from '../src/shared/testing/links.js';
import { IMPORTER_VERSION, sameRevision, statusOf, UNKNOWN, type TestRunDraft, type TestRunRecord } from '../src/shared/testing/record.js';
import { buildTestingView, flakyTests, freshnessOf, type TestingFacts } from '../src/shared/testing/view.js';
import { TestRunStore } from '../src/server/testing/store.js';
import { draftFromPrChecks, draftFromPull } from '../src/server/testing/import-pr.js';
import { draftFromReport, parseReport } from '../src/server/testing/import-reports.js';
import { draftFromGates } from '../src/server/testing/import-gates.js';
import { planStatus } from '../src/server/testing/facts.js';
import type { GhPull } from '../src/shared/protocol.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

const BRD = JSON.stringify({
  id: 'F001',
  title: 'Travel requests',
  useCases: [
    { id: 'UC001', title: 'Submit a request', rules: ['BR001'] },
    { id: 'UC002', title: 'Approve a request', rules: [] },
    { id: 'UC003', title: 'Export for Finance' },
  ],
  businessRules: [
    { id: 'BR001', title: 'Escalate abroad', appliesTo: ['UC001'] },
    { id: 'BR002', title: 'Domestic stops at manager', appliesTo: ['UC002'] },
  ],
});
const brd = parseBrd(BRD, 'F001.brd.json')!;

const AC_MD = ['| # | Criterion | Proof |', '|---|---|---|', '| AC-01 | A requester submits (UC001) | J-01 |', '| AC-02 | The manager approves (UC002) | J-02 |', '| AC-03 | Finance exports everything (UC003) | export audit |', '| AC-04 | Events logged | data assertions in J-01 to J-02 |'].join('\n');

/** The view's criteria: AC-04's journey range would put both journeys under both use cases. */
const AC_VIEW = AC_MD.split('\n').slice(0, 5).join('\n');

function rec(over: Partial<TestRunRecord> & { id: string }): TestRunRecord {
  return {
    schemaVersion: 1,
    source: 'pr-checks',
    sourceKey: over.id,
    suite: 'e2e',
    testedRevision: A,
    definitionRevision: A,
    evidence: { kind: 'ci-run', revision: 'run 1', locator: 'https://ci/1' },
    results: [],
    links: [],
    actor: { kind: 'ci', name: 'ci' },
    importer: IMPORTER_VERSION,
    ingestedAt: 1000,
    ...over,
  };
}

const res = (name: string, status: 'passed' | 'failed' | 'skipped', targets: string[] = [], basis: 'recorded' | 'inferred' = 'recorded') => ({ name, status, links: targets.map((target) => ({ target, basis, via: 'test', ...(basis === 'inferred' ? { rule: 'id in the test name' } : {}) })) });

function facts(main = A): TestingFacts {
  return {
    main: { branch: 'main', sha: main },
    brds: [brd],
    acs: parseAcTable(AC_VIEW),
    tests: [
      { path: 'tests/e2e/J-01.journey.json', journey: 'J-01', kind: 'journey', links: [{ target: 'UC001', basis: 'recorded', via: 'tests/e2e/J-01.journey.json' }] },
      { path: 'tests/e2e/J-02.journey.json', journey: 'J-02', kind: 'journey', links: [{ target: 'UC002', basis: 'recorded', via: 'tests/e2e/J-02.journey.json' }] },
    ],
    notes: [],
  };
}

test('links: ids, journey ranges, the AC table, BRD pointers, recorded vs inferred (T5)', () => {
  assert.deepEqual(idsIn('covers UC-001, BR012 and AC-04'), ['UC001', 'BR012', 'AC-04']);
  assert.deepEqual(journeysIn('data assertions in J-01 to J-03, and J-08'), ['J-01', 'J-02', 'J-03', 'J-08']);
  const rows = parseAcTable(AC_MD);
  assert.deepEqual(
    rows.map((r) => [r.id, r.journeys, r.names]),
    [
      ['AC-01', ['J-01'], ['UC001']],
      ['AC-02', ['J-02'], ['UC002']],
      ['AC-03', [], ['UC003']],
      ['AC-04', ['J-01', 'J-02'], []],
    ],
  );
  assert.deepEqual(brd.useCases.map((u) => [u.id, u.rules]), [
    ['UC001', ['BR001']],
    ['UC002', ['BR002']],
    ['UC003', []],
  ]);
  assert.equal(resolvePointer('F001#/useCases/1', [brd]), 'UC002');
  assert.equal(resolvePointer('F001#/businessRules/0', [brd]), 'BR001');
  assert.equal(resolvePointer('F009#/useCases/0', [brd]), undefined);
  const rec = recordedLinks('"requirement": "F001#/useCases/0" and AC-02', 'tests/e2e/J-01.journey.json', [brd]);
  assert.deepEqual(rec.map((l) => [l.target, l.basis]).sort(), [
    ['AC-02', 'recorded'],
    ['UC001', 'recorded'],
  ]);
  const inf = inferredLinks('Fix BR002 for J-02', 'PR title', 'PR #4 title');
  assert.deepEqual(
    inf.map((l) => [l.target, l.basis, l.rule]),
    [
      ['BR002', 'inferred', 'business rule id in the PR title'],
      ['J-02', 'inferred', 'journey id in the PR title'],
    ],
  );
});

test('the store is append only, hash-chained and idempotent by source key (V3)', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'testing-store-'));
  try {
    let t = 10;
    const s = new TestRunStore(dir, 'shop', () => t++);
    const d: TestRunDraft = draftFromPull('o/r', { number: 4, title: 'Add BR001', headRefOid: A, headRefName: 'feat/x', checks: 'pass', url: 'https://github.com/o/r/pull/4', updatedAt: '2026-10-10T10:00:00Z' } as GhPull)!;
    assert.equal((await s.ingest([d])).length, 1);
    assert.equal((await s.ingest([d, d])).length, 0, 'the same run read again adds nothing');
    // A fresh instance reads the file: still one, and the same key still skipped.
    const again = new TestRunStore(dir, 'shop');
    assert.equal((await again.ingest([d])).length, 0);
    assert.equal((await again.all()).length, 1);
    assert.deepEqual(await again.verify(), { ok: true });
    // A second outcome on the same head (a re-run that failed) is a run of its own.
    assert.equal((await again.ingest([draftFromPull('o/r', { number: 4, title: 'Add BR001', headRefOid: A, headRefName: 'feat/x', checks: 'fail', url: 'u', updatedAt: '' } as GhPull)!])).length, 1);
    const file = path.join(dir, 'shop.jsonl');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"passed"', '"failed"'));
    assert.equal((await new TestRunStore(dir, 'shop').verify()).ok, false, 'an edited line breaks the chain');
    assert.throws(() => new TestRunStore(dir, '../x'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pr-checks: the head commit is both the tested and the definition revision; a run still going is skipped', () => {
  const pull = draftFromPull('o/r', { number: 7, title: 'UC002: approve (BR002)', headRefOid: B, headRefName: 'feat/approve', checks: 'fail', url: 'https://github.com/o/r/pull/7', updatedAt: '2026-10-11T09:00:00Z' } as GhPull)!;
  assert.equal(pull.testedRevision, B);
  assert.equal(pull.definitionRevision, B);
  assert.equal(pull.evidence.kind, 'ci-run');
  assert.deepEqual(pull.links.map((l) => [l.target, l.basis]), [
    ['UC002', 'inferred'],
    ['BR002', 'inferred'],
  ]);
  assert.equal(draftFromPull('o/r', { number: 8, title: '', headRefOid: B, checks: 'pending' } as GhPull), undefined);
  const run = draftFromPrChecks('o/r', { pr: 7, rows: [{ icon: '✅', check: 'Studio Pro mx check', result: '0 error(s)' }, { icon: '❌', check: 'Playwright e2e', result: '2 failed' }], shots: [], run: { id: 99, status: 'completed', conclusion: 'failure', sha: B, url: 'https://ci/99', createdAt: '2026-10-11T09:00:00Z' } }, { branch: 'feat/approve', title: 'UC002' })!;
  assert.deepEqual(run.results.map((r) => [r.name, r.status]), [
    ['Studio Pro mx check', 'passed'],
    ['Playwright e2e', 'failed'],
  ]);
  assert.equal(run.sourceKey, 'pr-checks-run:o/r:99:failure');
  assert.equal(draftFromPrChecks('o/r', { pr: 7, rows: [], shots: [], run: { id: 100, status: 'in_progress', conclusion: '', sha: B, url: '', createdAt: '' } }), undefined);
});

test('report files: a declared tested revision is used, else unknown; the evidence is the commit that changed the file (V1)', () => {
  const declared = parseReport('reports/testing/approve-checks.json', JSON.stringify({ capturedAt: '2026-10-11T08:00:00Z', appRevision: A.slice(0, 7), results: [{ name: 'AC-02 manager approves', ok: true }, { name: 'reject needs a reason', ok: false, detail: 'no reason asked' }] }), [brd])!;
  const d1 = draftFromReport('reports/testing/approve-checks.json', declared, { sha: B, at: '2026-10-11T08:05:00Z' }, (r) => (A.startsWith(r) ? A : undefined));
  assert.equal(d1.testedRevision, A, 'committed at B, declares A: evidence for A');
  assert.equal(d1.definitionRevision, UNKNOWN, 'no testRevision declared');
  assert.equal(d1.evidence.revision, B);
  assert.equal(d1.evidence.locator, `git:${B}:reports/testing/approve-checks.json`);
  assert.deepEqual(d1.results[0].links.map((l) => [l.target, l.basis]), [['AC-02', 'inferred']]);
  const bare = parseReport('reports/testing/final-approver-checks.json', JSON.stringify({ capturedAt: 'x', run: 14, results: [{ name: 'grid A', ok: true }] }), [brd])!;
  const d2 = draftFromReport('reports/testing/final-approver-checks.json', bare, { sha: B }, () => undefined);
  assert.equal(d2.testedRevision, UNKNOWN);
  assert.equal(d2.definitionRevision, UNKNOWN);
  // The journey runner's findings: a requirement pointer is a recorded link, the file's journey an inferred one.
  const findings = parseReport('reports/testing/J-01-run3-findings.json', JSON.stringify({ results: [{ name: 'Open My requests: reached', verdict: 'PASS', requirement: 'F001#/useCases/0' }, { name: 'login', verdict: 'FAULT' }] }), [brd])!;
  assert.equal(findings.suite, 'journey J-01');
  assert.deepEqual(findings.results.map((r) => r.status), ['passed', 'skipped']);
  assert.deepEqual(findings.results[0].links.map((l) => [l.target, l.basis]), [['UC001', 'recorded']]);
  assert.deepEqual(findings.links.map((l) => [l.target, l.basis]), [['J-01', 'inferred']]);
  // The toolkit's report.json names the whole repo's commit: both revisions.
  const tk = parseReport('docs/report.json', JSON.stringify({ project: { gitCommit: C }, run: { trigger: 'journey', startedAt: 's', finishedAt: 'f' }, checks: [{ id: 'journey/J-02/step1', title: 'reached', verdict: 'fail', journey: 'J-02' }] }), [brd])!;
  assert.equal(tk.declaredApp, C);
  assert.equal(tk.declaredTests, C);
  assert.deepEqual(tk.results[0].links.map((l) => [l.target, l.basis]), [['J-02', 'recorded']]);
  assert.equal(parseReport('reports/testing/backfill-snapshot.json', JSON.stringify({ requests: [] }), [brd]), undefined, 'not a report of results');
  assert.equal(parseReport('reports/testing/broken.json', '{', [brd]), undefined);
});

test('gate-check: one record per render, the commit gate-check read as both revisions', () => {
  const html = '<table><tr><th>Stage</th><th>Title</th><th>Status</th><th>Detail</th></tr><tr><td>5</td><td>Build</td><td>MANUAL</td><td>fill in</td></tr><tr><td>6</td><td>Test</td><td>FAIL</td><td>no test surface</td></tr></table>';
  const d = draftFromGates(A, html, Date.UTC(2026, 9, 11), 'main')!;
  assert.equal(d.testedRevision, A);
  assert.equal(d.evidence.kind, 'office');
  assert.deepEqual(d.results.map((r) => [r.name, r.status]), [
    ['Stage 5 · Build', 'skipped'],
    ['Stage 6 · Test', 'failed'],
  ]);
  assert.equal(draftFromGates(A, '<p>nothing</p>', 1), undefined);
});

test('statuses, revisions and plan status read plainly', () => {
  assert.equal(statusOf('PASS'), 'passed');
  assert.equal(statusOf(false), 'failed');
  assert.equal(statusOf('fault'), 'skipped');
  assert.equal(statusOf('whatever'), undefined);
  assert.ok(sameRevision(A, A.slice(0, 7)));
  assert.ok(!sameRevision(A, UNKNOWN));
  assert.equal(freshnessOf(UNKNOWN, A), 'unknown');
  assert.equal(planStatus('# Plan\n\n**Status:** Draft for review\n'), 'Draft for review');
  assert.equal(planStatus('# Plan\nno line'), undefined);
});

test('an acceptance criterion with no linked test: coverage none, never result failed (T2)', () => {
  // A failing run whose PR title names AC-03 by inference only: still no linked test definition.
  const runs = [rec({ id: 'tr_1', results: [res('everything', 'failed')], links: [] })];
  const v = buildTestingView('shop', facts(), runs);
  const ac3 = v.features[0].rows.find((r) => r.id === 'UC003')!.acs.find((a) => a.id === 'AC-03')!;
  assert.equal(ac3.coverage, 'none');
  assert.equal(ac3.result, 'none');
  assert.equal(ac3.freshness, 'none');
  const uc3 = v.features[0].rows.find((r) => r.id === 'UC003')!;
  assert.equal(uc3.coverage, 'none');
  assert.equal(uc3.result, 'none');
  assert.equal(v.counts.coverage.none, 1);
});

test('after main moves, a run on the older revision is stale; coverage and result keep their own values (T3)', () => {
  const runs = [rec({ id: 'tr_1', testedRevision: A, results: [res('J-01 submit', 'passed', ['J-01'])] })];
  const before = buildTestingView('shop', facts(A), runs);
  const after = buildTestingView('shop', facts(B), runs);
  const r0 = before.features[0].rows[0];
  const r1 = after.features[0].rows[0];
  assert.equal(r0.freshness, 'current');
  assert.equal(r1.freshness, 'stale');
  assert.equal(r1.coverage, r0.coverage);
  assert.equal(r1.result, 'passed');
  assert.equal(r1.coverage, 'full');
  assert.deepEqual(after.stale, { lastTested: A, runId: 'tr_1' });
  assert.equal(before.stale, undefined);
  assert.deepEqual(before.checksOnMain, [{ suite: 'e2e', source: 'pr-checks', result: 'passed', runId: 'tr_1' }]);
});

test('V1: a report declaring A counts for A only; one declaring nothing shows unknown and counts for no commit', () => {
  const declared = rec({ id: 'tr_1', source: 'report-file', testedRevision: A, evidence: { kind: 'repo-commit', revision: B, locator: `git:${B}:r.json` }, results: [res('J-01', 'passed', ['J-01'])] });
  const unknown = rec({ id: 'tr_2', source: 'report-file', testedRevision: UNKNOWN, definitionRevision: UNKNOWN, ingestedAt: 2000, evidence: { kind: 'repo-commit', revision: B, locator: `git:${B}:s.json` }, results: [res('J-02', 'passed', ['J-02'])] });
  const atB = buildTestingView('shop', facts(B), [declared, unknown]);
  assert.equal(atB.features[0].rows[0].freshness, 'stale', 'committed at B is no evidence for B');
  assert.equal(atB.features[0].rows[1].freshness, 'unknown');
  assert.deepEqual(atB.checksOnMain, [], 'nothing counts for B');
  const atA = buildTestingView('shop', facts(A), [declared, unknown]);
  assert.equal(atA.features[0].rows[0].freshness, 'current');
  assert.equal(atA.runs.find((r) => r.id === 'tr_2')!.tested, UNKNOWN);
});

test('V2: definition and app revisions differ: both shown, freshness follows the tested app revision', () => {
  const r = rec({ id: 'tr_1', testedRevision: A, definitionRevision: C, results: [res('J-01', 'passed', ['J-01'])] });
  const v = buildTestingView('shop', facts(A), [r]);
  assert.equal(v.runs[0].tested, A);
  assert.equal(v.runs[0].definition, C);
  assert.equal(v.runs[0].freshness, 'current');
  assert.equal(buildTestingView('shop', facts(C), [r]).runs[0].freshness, 'stale');
});

test('T4: pass and fail on the same tested revision is flagged flaky; on different revisions it is not', () => {
  const runs = [rec({ id: 'tr_1', results: [res('J-01 submit', 'passed', ['J-01'])] }), rec({ id: 'tr_2', ingestedAt: 2000, results: [res('J-01 submit', 'failed', ['J-01'])] }), rec({ id: 'tr_3', testedRevision: B, results: [res('J-02 approve', 'passed', ['J-02'])] }), rec({ id: 'tr_4', testedRevision: C, results: [res('J-02 approve', 'failed', ['J-02'])] })];
  assert.deepEqual([...flakyTests(runs)], ['e2e::J-01 submit']);
  const v = buildTestingView('shop', facts(), runs);
  assert.deepEqual(v.runs.find((r) => r.id === 'tr_2')!.flaky, ['J-01 submit']);
  assert.equal(v.features[0].rows[0].flaky, true);
  assert.equal(v.features[0].rows[1].flaky, false);
  // Unknown tested revisions are never compared.
  assert.equal(flakyTests([rec({ id: 'x', testedRevision: UNKNOWN, results: [res('t', 'passed')] }), rec({ id: 'y', testedRevision: UNKNOWN, results: [res('t', 'failed')] })]).size, 0);
});

test('T5: inferred links are labelled inferred with their rule; recorded ones recorded', () => {
  const r = rec({ id: 'tr_1', results: [res('approve BR002', 'failed', ['BR002'], 'inferred')] });
  const v = buildTestingView('shop', facts(), [r]);
  const uc2 = v.features[0].rows.find((x) => x.id === 'UC002')!;
  const inferred = uc2.tests.find((t) => t.name === 'approve BR002')!;
  assert.equal(inferred.basis, 'inferred');
  assert.equal(inferred.rule, 'id in the test name');
  const recorded = uc2.tests.find((t) => t.name === 'tests/e2e/J-02.journey.json')!;
  assert.equal(recorded.basis, 'recorded');
});

test('the cache key is main plus the newest record id', () => {
  const v1 = buildTestingView('shop', facts(), [rec({ id: 'tr_1' })]);
  const v2 = buildTestingView('shop', facts(), [rec({ id: 'tr_1' }), rec({ id: 'tr_2' })]);
  assert.equal(v1.cacheKey, `${A}:tr_1`);
  assert.equal(v2.cacheKey, `${A}:tr_2`);
});
