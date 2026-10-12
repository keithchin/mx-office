// Testing release 1 end to end over a real (temporary) git repository: the report files' evidence
// revision from git, ingestion that never duplicates, a new run on an unchanged commit showing at once
// (V4), the empty state (T1), the light list at page start and nothing on the main thread (T11), and
// no GitHub or agent calls anywhere in the feature (T12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestPrChecks, testingStore, testingView, testPlanText } from '../src/server/testing/index.js';
import { buildTestingView } from '../src/shared/testing/view.js';
import { IMPORTER_VERSION, UNKNOWN, type TestRunRecord } from '../src/shared/testing/record.js';
import { routes } from '../src/server/http/routes/index.js';
import { officeFiles } from '../src/server/project-delete/data.js';

const g = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' }).toString().trim();

function put(dir: string, file: string, text: string) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
}

const BRD = { id: 'F001', title: 'Travel requests', useCases: [{ id: 'UC001', title: 'Submit', rules: ['BR001'] }, { id: 'UC002', title: 'Approve' }], businessRules: [{ id: 'BR001', title: 'Escalate', appliesTo: ['UC001'] }] };
const AC = '| # | Criterion | Proof |\n|---|---|---|\n| AC-01 | Submit (UC001) | J-01 |\n| AC-02 | Approve (UC002) | J-02 |\n| AC-03 | Export (UC002) | none yet |\n';
const GATES = '<table><tr><td>6</td><td>Test</td><td>PENDING</td><td>no test surface yet</td></tr></table>';

function project(withFiles = true) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'testing-view-'));
  const dir = path.join(root, 'repo');
  mkdirSync(dir);
  g(dir, 'init', '-q', '-b', 'main');
  if (withFiles) {
    put(dir, 'analysis/knowledge-base/brd/F001-travel.brd.json', JSON.stringify(BRD));
    put(dir, 'architecture/acceptance-criteria.md', AC);
    put(dir, 'tests/e2e/J-01.journey.json', JSON.stringify({ id: 'J-01', requirement: 'F001#/useCases/0' }));
    put(dir, 'tests/e2e/J-02.journey.json', JSON.stringify({ id: 'J-02', covers: ['UC002'] }));
    put(dir, 'tests/test-plan.md', '# Test plan\n\nStatus: Draft\n\n| Journey | Proves |\n|---|---|\n| J-01 | UC001 |\n');
    put(dir, 'index.html', GATES);
  } else put(dir, 'README.md', '# nothing yet\n');
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'first');
  return { root, dir, floor: { id: `t${Math.random().toString(36).slice(2, 8)}`, dir, def: { repo: 'o/r' }, github: { pulls: { items: [] as never[] } } } };
}

test('report files: evidence is the commit that changed the file; declared revisions are used, else unknown; reading again adds nothing', async () => {
  const { root, dir, floor } = project();
  const data = path.join(root, 'data');
  try {
    const first = g(dir, 'rev-parse', 'HEAD');
    put(dir, 'reports/testing/approve-checks.json', JSON.stringify({ capturedAt: '2026-10-11T08:00:00Z', appRevision: first.slice(0, 8), results: [{ name: 'J-02 manager approves', ok: true }] }));
    put(dir, 'reports/testing/final-approver-checks.json', JSON.stringify({ capturedAt: '2026-10-11T09:00:00Z', run: 14, results: [{ name: 'grid A', ok: false }] }));
    g(dir, 'add', '-A');
    g(dir, 'commit', '-q', '-m', 'reports');
    const second = g(dir, 'rev-parse', 'HEAD');
    const v = await testingView(data, floor);
    assert.equal(v.main?.sha, second);
    const approve = v.runs.find((r) => r.suite === 'approve-checks')!;
    assert.equal(approve.tested, first, 'the declared short sha, resolved to the full commit');
    assert.equal(approve.definition, UNKNOWN);
    assert.equal(approve.evidence.revision, second, 'committed in the second commit');
    assert.equal(approve.freshness, 'stale');
    const bare = v.runs.find((r) => r.suite === 'final-approver-checks')!;
    assert.equal(bare.tested, UNKNOWN);
    assert.equal(bare.freshness, 'unknown');
    assert.equal(v.gate6?.status, 'PENDING');
    assert.match(v.gate6!.from, /index\.html as committed/);
    assert.equal(v.plan?.path, 'tests/test-plan.md');
    assert.equal(v.plan?.status, 'Draft');
    // Coverage per criterion: AC-03 has none.
    assert.deepEqual(v.counts.coverage, { linked: 2, inferred: 0, none: 1 });
    // Read again: the same records, no duplicates.
    const again = await testingView(data, floor);
    assert.equal(again.totalRuns, v.totalRuns);
    assert.equal((await testingStore(data, floor.id).all()).length, 2);
    // A changed report at a new commit is a new run, with its own evidence revision.
    put(dir, 'reports/testing/final-approver-checks.json', JSON.stringify({ capturedAt: '2026-10-12T09:00:00Z', run: 15, results: [{ name: 'grid A', ok: true }] }));
    g(dir, 'commit', '-q', '-am', 'run 15');
    const third = g(dir, 'rev-parse', 'HEAD');
    const v3 = await testingView(data, floor);
    assert.equal(v3.totalRuns, 3);
    assert.equal(v3.runs.filter((r) => r.suite === 'final-approver-checks').map((r) => r.evidence.revision).sort().join(), [second, third].sort().join());
    const plan = await testPlanText(floor);
    assert.match(plan!.markdown, /# Test plan/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('V4: a new run on an unchanged commit invalidates the cache and shows without a new commit; the gate render is a run', async () => {
  const { root, dir, floor } = project();
  const data = path.join(root, 'data');
  try {
    const sha = g(dir, 'rev-parse', 'HEAD');
    const v1 = await testingView(data, floor);
    assert.equal(v1.totalRuns, 0);
    const uc1 = () => v1.features[0].rows[0];
    assert.equal(uc1().result, 'none');
    await ingestPrChecks(data, floor, { pr: 3, rows: [{ icon: '❌', check: 'J-01 submit', result: '1 failed' }], shots: [], run: { id: 41, status: 'completed', conclusion: 'failure', sha, url: 'https://ci/41', createdAt: '2026-10-12T10:00:00Z' } }, 'main');
    const v2 = await testingView(data, floor);
    assert.notEqual(v2.cacheKey, v1.cacheKey);
    assert.equal(v2.totalRuns, 1);
    assert.equal(v2.runs[0].branch, 'main');
    assert.equal(v2.features[0].rows[0].result, 'failed');
    assert.equal(v2.features[0].rows[0].freshness, 'current');
    assert.deepEqual(v2.checksOnMain.map((c) => [c.suite, c.result]), [['pr-checks', 'failed']]);
    // Same again: the same cached view.
    assert.equal(await testingView(data, floor), v2);
    // The office's own gate-check render of main.
    const v3 = await testingView(data, floor, { renderedGates: (d, s) => (s === sha ? { html: GATES.replace('PENDING', 'PASS'), at: Date.UTC(2026, 9, 12) } : undefined) });
    assert.equal(v3.totalRuns, 2);
    assert.equal(v3.gate6?.status, 'PASS');
    assert.match(v3.gate6!.from, /rendered by the office/);
    assert.equal(v3.runs.find((r) => r.source === 'gate-check')!.evidence.kind, 'office');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('T1: a project with no test plan, BRD or criteria shows the empty state; nothing crashes', async () => {
  const { root, floor } = project(false);
  const data = path.join(root, 'data');
  try {
    const v = await testingView(data, floor);
    assert.equal(v.plan, undefined);
    assert.deepEqual(v.features, []);
    assert.deepEqual(v.runs, []);
    assert.ok(v.notes.some((n) => /No BRD/.test(n)));
    assert.equal(await testPlanText(floor), undefined);
    // No commits at all.
    const bare = path.join(root, 'bare');
    mkdirSync(bare);
    g(bare, 'init', '-q');
    const none = await testingView(data, { ...floor, id: `${floor.id}x`, dir: bare });
    assert.equal(none.main, undefined);
    assert.ok(none.notes.some((n) => /no commits/.test(n)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('T11: the view over thousands of records is built quickly and the runs list stays short', () => {
  const recs: TestRunRecord[] = [];
  for (let i = 0; i < 5000; i++)
    recs.push({ schemaVersion: 1, id: `tr_${String(i).padStart(6, '0')}`, source: 'pr-checks', sourceKey: `k${i}`, suite: 'e2e', testedRevision: (i % 50).toString(16).padStart(40, '0'), definitionRevision: UNKNOWN, evidence: { kind: 'ci-run', revision: `run ${i}`, locator: '' }, results: Array.from({ length: 10 }, (_, j) => ({ name: `J-0${j % 3} t${j}`, status: j % 4 ? 'passed' : 'failed', links: [{ target: `J-0${j % 3}`, basis: 'recorded' as const, via: 'x' }] })), links: [], actor: { kind: 'ci', name: 'ci' }, importer: IMPORTER_VERSION, ingestedAt: i });
  const brds = [{ id: 'F001', title: 'F', file: 'f', useCases: Array.from({ length: 40 }, (_, i) => ({ id: `UC${String(i).padStart(3, '0')}`, title: 'u', rules: [] })), rules: [] }];
  const acs = Array.from({ length: 80 }, (_, i) => ({ id: `AC-${i}`, text: `UC${String(i % 40).padStart(3, '0')}`, proof: 'J-01', journeys: [`J-0${i % 3}`], names: [`UC${String(i % 40).padStart(3, '0')}`] }));
  const t0 = performance.now();
  const v = buildTestingView('big', { main: { branch: 'main', sha: '1'.padStart(40, '0') }, brds, acs, tests: [], notes: [] }, recs);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `built in ${ms.toFixed(0)} ms`);
  assert.equal(v.runs.length, 60);
  assert.ok(JSON.stringify(v).length < 2_000_000, 'the page gets a light list, not every record');
});

test('T11/T12: the feature does its file and git work asynchronously, and never calls GitHub or an agent', () => {
  const dir = path.join(process.cwd(), 'src', 'server', 'testing');
  for (const f of readdirSync(dir)) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /\b(readFileSync|writeFileSync|appendFileSync|statSync|existsSync|execFileSync|spawnSync|execSync)\b/, `${f} works off the main thread`);
    assert.doesNotMatch(src, /from '\.\.\/github\.js'|'gh'|providers\/|claude/i, `${f} asks GitHub or an agent nothing`);
  }
  assert.ok(routes.some((r) => 'path' in r && r.path === '/api/testing' && r.auth === 'session'));
  assert.ok(officeFiles('shop').includes('testing/shop.jsonl'), 'a deleted project takes its records to the archive');
});
