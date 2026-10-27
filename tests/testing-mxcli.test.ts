// Testing release 1b (docs/site/using-the-office/testing.md, "Microflow tests" and "Quality"): mxcli
// test's JUnit read inside an Office run envelope (failure → failed, error → harness error, skipped →
// skipped; ids are file + @test name; no JUnit is a harness error), both revisions = the work folder's
// commit, a JUnit file in the repo never imported by itself, report / lint records bound to commit +
// mxcli version and kept once, stale when main moves, and every catalog run in the office's own work
// folder: the floor checkout stays untouched. A fake mxcli only (an .exe shim on Windows, never .cmd):
// no Mendix runtime, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { draftFromMxcliRun, parseJUnit, relFile, type MxcliRunEnvelope } from '../src/shared/testing/junit.js';
import { buildQualityView, parseLintJson, parseReportJson, qualityKey, ruleFailuresOf, type QualityRecord } from '../src/shared/testing/quality.js';
import { buildTestingView } from '../src/shared/testing/view.js';
import { evaluatePolicy } from '../src/shared/testing/policy.js';
import type { TestRunRecord } from '../src/shared/testing/record.js';
import { testFlagsIn } from '../src/server/testing/test-flags.js';
import { runMicroflowTests, runQuality, NoTestsError } from '../src/server/testing/mxcli-run.js';
import { QualityStore } from '../src/server/testing/quality-store.js';
import { assertOfficeFolder, mprIn, testPathsIn, workDirOf } from '../src/server/testing/workfolder.js';
import { qualityOnMain, qualityPart, qualityStore, startMicroflowTests, startQuality } from '../src/server/testing/mxcli-office.js';
import { setTestingSwitches, testingSwitches } from '../src/server/testing/switches.js';
import { closeConnections } from '../src/server/connections/store.js';
import { testingStore, testingView } from '../src/server/testing/index.js';
import { versionOf } from '../src/server/testing/mxcli-tool.js';
import { runnable } from './support/winshim.js';

const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="tests" tests="4" failures="1" errors="1" skipped="1" time="1.204">
    <testcase name="Request number: origin letters + YY (BR012)" classname="tests.core" file="C:\\office\\data\\testing\\work\\f1\\tests\\tests\\core.test.mdl" time="0.101">
      <properties><property name="assertions" value="3"></property></properties>
    </testcase>
    <testcase name="Derive: abroad escalates" classname="tests.core" file="tests/core.test.mdl" time="0.050">
      <properties><property name="assertions" value="2"></property></properties>
      <failure message="expected $Abroad/IsEscalated = true, got false">expected $Abroad/IsEscalated = true, got false</failure>
    </testcase>
    <testcase name="Seed &amp; roles" classname="tests.seed" file="tests/seed.test.mdl" time="0.010">
      <properties><property name="assertions" value="0"></property></properties>
      <error message="test asserts nothing (--require-assertions)">test asserts nothing (--require-assertions)</error>
    </testcase>
    <testcase name="Workflow later" classname="tests.workflow" file="tests/workflow.test.mdl" time="0">
      <properties><property name="assertions" value="1"></property></properties>
      <skipped message="needs the workflow engine"></skipped>
    </testcase>
  </testsuite>
</testsuites>
`;

const SHA = 'c'.repeat(40);
const env = (over: Partial<MxcliRunEnvelope> = {}): MxcliRunEnvelope => ({
  runId: 'mt_1',
  floor: 'f1',
  commit: SHA,
  branch: 'main',
  paths: ['tests/core.test.mdl'],
  environment: { runner: 'mxcli test (office)', mxcliVersion: 'nightly-x', runtime: 'local', mendixVersion: '11.12.2', workFolder: 'C:\\office\\data\\testing\\work\\f1\\tests' },
  startedAt: '2026-10-12T10:00:00.000Z',
  finishedAt: '2026-10-12T10:01:00.000Z',
  exitCode: 1,
  junitLocator: 'testing/evidence/f1/mt_1.junit.xml',
  actor: 'Ann',
  ...over,
});

test('JUnit: failure is failed, error a harness error, skipped skipped; ids are file + @test name, never test_N', () => {
  const run = parseJUnit(JUNIT, 'C:\\office\\data\\testing\\work\\f1\\tests')!;
  assert.equal(run.cases.length, 4);
  assert.deepEqual(
    run.cases.map((c) => [c.id, c.status]),
    [
      ['tests/core.test.mdl#Request number: origin letters + YY (BR012)', 'passed'],
      ['tests/core.test.mdl#Derive: abroad escalates', 'failed'],
      ['tests/seed.test.mdl#Seed & roles', 'error'],
      ['tests/workflow.test.mdl#Workflow later', 'skipped'],
    ],
  );
  assert.equal(run.cases[0].assertions, 3);
  assert.ok(run.cases.every((c) => !/test_\d/.test(c.id)));
  assert.equal(run.suites[0].errors, 1);
  assert.equal(relFile('.\\tests\\a.test.mdl'), 'tests/a.test.mdl');
  assert.equal(parseJUnit('not xml'), undefined);
});

test('the run record: both revisions are the work folder commit; an error never counts as passed or as a business failure', () => {
  const d = draftFromMxcliRun(env(), JUNIT);
  assert.equal(d.source, 'mxcli-test');
  assert.equal(d.testedRevision, SHA);
  assert.equal(d.definitionRevision, SHA);
  assert.equal(d.evidence.kind, 'office');
  assert.equal(d.evidence.locator, 'office:testing/evidence/f1/mt_1.junit.xml');
  assert.deepEqual(d.environment, env().environment);
  assert.equal(d.startedAt, '2026-10-12T10:00:00.000Z');
  assert.equal(d.harnessError, undefined, 'exit 1 with JUnit content is decided by the content');
  const harness = d.results.find((r) => r.harness)!;
  assert.equal(harness.status, 'skipped');
  assert.match(harness.detail!, /harness error/);
  assert.equal(d.results.find((r) => r.name.endsWith('#Derive: abroad escalates'))!.status, 'failed');
  // An id in a name is an inferred link, with its rule.
  assert.deepEqual(d.results[0].links.map((l) => [l.target, l.basis]), [['BR012', 'inferred']]);

  const rec = { ...d, schemaVersion: 1, id: 'tr_x', ingestedAt: 1 } as TestRunRecord;
  const view = buildTestingView('f1', { main: { branch: 'main', sha: SHA }, brds: [], acs: [], tests: [], notes: [] }, [rec]);
  assert.deepEqual(view.runs[0].counts, { passed: 1, failed: 1, skipped: 1 });
  assert.equal(view.runs[0].harness, 1);
  assert.equal(view.runs[0].environment?.mendixVersion, '11.12.2');
  assert.equal(view.runs[0].tests?.[0].status, 'failed', 'failures first');
  // A criterion decided only by a harness error is never met.
  const onlyHarness = { ...rec, results: [{ name: 'tests/seed.test.mdl#Seed AC-04', status: 'skipped' as const, harness: true as const, links: [{ target: 'AC-04', basis: 'inferred' as const, via: 'x' }] }] };
  const ev = evaluatePolicy({ v: 1, required: [], linkedCriteria: true }, [onlyHarness], SHA, { criteria: [{ id: 'AC-04' }] });
  assert.equal(ev.verified, false);
  assert.equal(ev.checks[0].state, 'skipped');
});

test('no JUnit file, or one with no cases, is a harness error, never failed tests', () => {
  const none = draftFromMxcliRun(env({ junitLocator: undefined, tail: 'Error: could not start the runtime' }), undefined);
  assert.match(none.harnessError!, /no JUnit file \(exit 1\).*could not start the runtime/);
  assert.equal(none.results.length, 0);
  const empty = draftFromMxcliRun(env(), '<testsuites><testsuite name="t" tests="0"></testsuite></testsuites>');
  assert.match(empty.harnessError!, /no test cases/);
  const timedOut = draftFromMxcliRun(env({ failure: 'Timed out after 16 min with no result' }), undefined);
  assert.equal(timedOut.harnessError, 'Timed out after 16 min with no result');
  const rec = { ...none, schemaVersion: 1, id: 'tr_y', ingestedAt: 1 } as TestRunRecord;
  const view = buildTestingView('f1', { main: { branch: 'main', sha: SHA }, brds: [], acs: [], tests: [], notes: [] }, [rec]);
  assert.equal(view.checksOnMain[0].harness, true);
  assert.notEqual(view.checksOnMain[0].result, 'failed');
  assert.notEqual(view.checksOnMain[0].result, 'passed');
});

// ---- The runner, with a fake mxcli and a real (temporary) git repo ----

const FAKE = `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const mode = process.env.FAKE_MXCLI_MODE || '';
const pollute = () => { fs.mkdirSync('.ai-context/skills/widgets', { recursive: true }); fs.writeFileSync('.ai-context/skills/widgets/a.md', 'rewritten\\r\\n'); fs.mkdirSync('.claude/skills/widgets', { recursive: true }); fs.writeFileSync('.claude/skills/widgets/b.md', 'x'); fs.mkdirSync('.mxcli', { recursive: true }); fs.writeFileSync('.mxcli/catalog.db', 'db'); };
if (a[0] === '--version') { console.log('mxcli version nightly-fake-1 (2026-10-03)'); process.exit(0); }
fs.appendFileSync(process.env.FAKE_MXCLI_LOG, JSON.stringify({ cwd: process.cwd(), args: a, pg: process.env.PGPASSWORD ? 'set' : '' }) + '\\n');
console.error('WARNING: This is a vibe-coded PoC, alpha quality, use with caution.');
if (a[0] === 'test' && a.includes('--help')) { console.log('Flags:'); process.exit(0); }
if (a[0] === 'test') {
  console.log('Connected to: project.mpr (Mendix 11.12.2)');
  fs.writeFileSync('MxTest-injected.txt', 'x');
  if (mode === 'no-runtime') { console.error('Error: could not start the local runtime: no JDK'); process.exit(1); }
  const out = a[a.indexOf('--junit') + 1];
  const files = a.slice(1, a.indexOf('-p'));
  const cases = files.map((f) => '<testcase name="t in ' + f + '" classname="x" file="' + path.join(process.cwd(), f) + '" time="0.1"><properties><property name="assertions" value="1"></property></properties>' + (f.includes('seed') ? '<failure message="boom">boom</failure>' : '') + '</testcase>').join('');
  fs.writeFileSync(out, '<?xml version="1.0"?><testsuites><testsuite name="tests" tests="' + files.length + '">' + cases + '</testsuite></testsuites>');
  process.exit(files.some((f) => f.includes('seed')) ? 1 : 0);
}
if (a[0] === 'report') {
  pollute();
  console.log('Connected to: project.mpr (Mendix 11.12.2)');
  const out = a[a.indexOf('-o') + 1];
  fs.writeFileSync(out, JSON.stringify({ projectName: 'project', overallScore: 63.2, summary: { total: 3, errors: 0, warnings: 2, infos: 1 }, categories: [{ name: 'Security', score: 67, total: 21, errors: 0, warnings: 6, infos: 15, topActions: ['Add an XPath'] }, { name: 'Quality', score: 54 }, { name: 'Architecture', score: 0 }, { name: 'Performance', score: 99 }, { name: 'Naming', score: 69 }, { name: 'Design', score: 94 }, { name: 'Other', score: 89 }], violations: [] }));
  process.exit(0);
}
if (a[0] === 'lint') {
  pollute();
  console.log(JSON.stringify({ violations: [{ ruleId: 'MPR002', severity: 'warning', message: 'empty' }, { ruleId: 'MPR002', severity: 'warning', message: 'empty 2' }, { ruleId: 'SEC001', severity: 'error', message: 'no access' }], summary: { total: 3, errors: 1, warnings: 2, infos: 0, hints: 0 } }));
  console.error('Error: lint could not read the catalog for microflows: no such table');
  process.exit(1);
}
if (a.includes('-c')) { console.log('Found 2 result(s)'); console.log(JSON.stringify([{ Key: 'mendix_version', Value: '11.12.2' }, { Key: 'schema_version', Value: '15' }])); process.exit(0); }
process.exit(2);
`;

function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mx-office-mxcli-'));
  const floorDir = path.join(root, 'floor');
  const dataDir = path.join(root, 'data');
  mkdirSync(path.join(floorDir, 'tests'), { recursive: true });
  mkdirSync(path.join(floorDir, '.ai-context', 'skills', 'widgets'), { recursive: true });
  mkdirSync(path.join(floorDir, 'reports', 'testing'), { recursive: true });
  writeFileSync(path.join(floorDir, 'project.mpr'), 'mpr');
  writeFileSync(path.join(floorDir, 'tests', 'core.test.mdl'), '/** @test a */');
  writeFileSync(path.join(floorDir, 'tests', 'seed.test.mdl'), '/** @test b */');
  writeFileSync(path.join(floorDir, '.ai-context', 'skills', 'widgets', 'a.md'), 'original\n');
  // A JUnit file committed in the repo: never evidence of anything by itself.
  writeFileSync(path.join(floorDir, 'reports', 'testing', 'results.junit.xml'), JUNIT);
  const g = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd: floorDir, stdio: 'pipe' }).toString().trim();
  g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('commit', '-q', '-m', 'first');
  const bin = path.join(root, 'fake-mxcli');
  writeFileSync(bin, FAKE);
  runnable(bin);
  const exe = process.platform === 'win32' ? `${bin}.exe` : bin;
  const log = path.join(root, 'mxcli.log');
  writeFileSync(log, '');
  process.env.FAKE_MXCLI_LOG = log;
  const calls = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { cwd: string; args: string[]; pg?: string });
  return { root, floorDir, dataDir, exe, g, calls, sha: g('rev-parse', 'HEAD') };
}

/** A path with its links resolved as far as it still exists: a process's own cwd is (on macOS the temporary folder /var/… is /private/var/…). */
const real = (p: string): string => {
  try {
    return realpathSync.native(p);
  } catch {
    return path.dirname(p) === p ? p : path.join(real(path.dirname(p)), path.basename(p));
  }
};

/** The floor checkout is exactly as committed: no catalog or widget-doc writes, no test module, nothing new. */
function untouched(s: ReturnType<typeof setup>) {
  assert.equal(s.g('status', '--porcelain', '--untracked-files=all', '--ignored'), '');
  assert.equal(readFileSync(path.join(s.floorDir, '.ai-context', 'skills', 'widgets', 'a.md'), 'utf8'), 'original\n');
  assert.ok(!existsSync(path.join(s.floorDir, '.claude')));
  assert.ok(!existsSync(path.join(s.floorDir, '.mxcli')));
  assert.equal(s.g('worktree', 'list').split('\n').length, 1, 'no worktree added to the floor');
}

test('the runner: mxcli test runs in the office work folder at the commit; the record carries both revisions = that commit; the floor is untouched', async () => {
  const s = setup();
  try {
    process.env.FAKE_MXCLI_MODE = '';
    const { draft, junit } = await runMicroflowTests({ dataDir: s.dataDir, floorId: 'f1', floorDir: s.floorDir, bin: s.exe, mxcliVersion: 'nightly-fake-1', sha: s.sha, branch: 'main', actor: 'Ann', timeoutMs: 60_000 });
    const call = s.calls().find((c) => c.args[0] === 'test')!;
    assert.equal(real(call.cwd), real(workDirOf(s.dataDir, 'f1', 'tests')), 'ran in the office work folder');
    assert.deepEqual(call.args.slice(1, 3), ['tests/core.test.mdl', 'tests/seed.test.mdl']);
    for (const f of ['--local', '--require-assertions', '--junit']) assert.ok(call.args.includes(f), f);
    assert.equal(draft.testedRevision, s.sha);
    assert.equal(draft.definitionRevision, s.sha);
    assert.equal(draft.environment?.mxcliVersion, 'nightly-fake-1');
    assert.equal(draft.environment?.mendixVersion, '11.12.2');
    assert.equal(draft.environment?.runtime, 'local');
    assert.equal(draft.exitCode, 1);
    assert.equal(draft.harnessError, undefined);
    assert.deepEqual(draft.results.map((r) => [r.name, r.status]), [
      ['tests/core.test.mdl#t in tests/core.test.mdl', 'passed'],
      ['tests/seed.test.mdl#t in tests/seed.test.mdl', 'failed'],
    ]);
    assert.ok(junit && existsSync(junit) && junit.startsWith(path.join(s.dataDir, 'testing', 'evidence')), 'the JUnit file is kept in the office data folder');
    assert.equal(draft.evidence.locator, `office:${path.relative(s.dataDir, junit!).replace(/\\/g, '/')}`);
    assert.ok(!existsSync(workDirOf(s.dataDir, 'f1', 'tests')), 'the work folder is wiped after');
    untouched(s);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("mxcli v0.27+: the run boots on the built-in database (--db-type hsqldb) on ports the office holds, with no database prep and no PostgreSQL password; an older one gets the office user's password only for its own psql", async () => {
  const s = setup();
  try {
    process.env.FAKE_MXCLI_MODE = '';
    let prepared = 0;
    let released = 0;
    const prepare = async () => (prepared++, { db: 'project_test', notes: [] });
    const ports = async () => ({ ports: [8401, 8402, 8403], release: () => void released++ });
    const flags = testFlagsIn('Flags:\n      --db-type string   ...\n      --app-port int\n      --admin-port int\n      --serve-port int\n      --mxbuild-path string');
    assert.deepEqual(flags, { dbType: true, ports: true, mxbuildPath: true });
    const { draft } = await runMicroflowTests({ dataDir: s.dataDir, floorId: 'f1', floorDir: s.floorDir, bin: s.exe, mxcliVersion: 'v0.27.0', sha: s.sha, actor: 'Ann', timeoutMs: 60_000, prepare, ports, flags, pgEnv: { PGPASSWORD: 'pw' } });
    const call = s.calls().find((c) => c.args[0] === 'test')!;
    const at = (f: string) => call.args[call.args.indexOf(f) + 1];
    assert.equal(at('--db-type'), 'hsqldb');
    assert.deepEqual([at('--app-port'), at('--admin-port'), at('--serve-port')], ['8401', '8402', '8403']);
    assert.equal(prepared, 0, 'no PostgreSQL database is made for it');
    assert.equal(released, 1, 'the ports are given back');
    assert.equal(call.pg, '', 'no PostgreSQL password goes to it');
    assert.equal(draft.results.length, 2);
    // An older mxcli (no --db-type): the database prep as before, and the office user's password for its psql.
    const old = await runMicroflowTests({ dataDir: s.dataDir, floorId: 'f1', floorDir: s.floorDir, bin: s.exe, mxcliVersion: 'nightly-x', sha: s.sha, actor: 'Ann', timeoutMs: 60_000, prepare, ports, flags: testFlagsIn('Flags:\n      --local'), pgEnv: { PGPASSWORD: 'pw' } });
    const second = s.calls().filter((c) => c.args[0] === 'test')[1];
    assert.ok(!second.args.includes('--db-type') && !second.args.includes('--app-port'));
    assert.equal(prepared, 1);
    assert.equal(second.pg, 'set');
    assert.equal(old.draft.results.length, 2);
    untouched(s);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('a run that cannot start the runtime is a harness error, and the JUnit file in the repo is never imported by itself', async () => {
  const s = setup();
  try {
    process.env.FAKE_MXCLI_MODE = 'no-runtime';
    const { draft, junit } = await runMicroflowTests({ dataDir: s.dataDir, floorId: 'f1', floorDir: s.floorDir, bin: s.exe, mxcliVersion: 'nightly-fake-1', sha: s.sha, actor: 'Ann', timeoutMs: 60_000 });
    assert.equal(junit, undefined);
    assert.match(draft.harnessError!, /stopped before any result \(exit 1\): could not start the local runtime: no JDK/, 'mxcli’s own Error line, never "no JUnit file" alone');
    assert.equal(draft.results.length, 0, 'the committed reports/testing/results.junit.xml was not read');
    // Nor does the Testing view's own import of the repo's report files take it.
    const floor = { id: 'f1', dir: s.floorDir, def: { repo: undefined }, github: { pulls: { items: [] } } };
    await testingView(s.dataDir, floor as never);
    const recs = await testingStore(s.dataDir, 'f1').all();
    assert.ok(!recs.some((r) => /\.xml/.test(r.evidence.locator) || r.source === 'mxcli-test'), 'no record from a bare JUnit file');
    untouched(s);
    // A bad mxcli path never starts: a harness error too.
    const gone = await runMicroflowTests({ dataDir: s.dataDir, floorId: 'f1', floorDir: s.floorDir, bin: path.join(s.root, 'no-such-mxcli.exe'), mxcliVersion: 'x', sha: s.sha, actor: 'Ann', timeoutMs: 60_000 });
    assert.match(gone.draft.harnessError!, /mxcli could not start/);
  } finally {
    process.env.FAKE_MXCLI_MODE = '';
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('no test files at the commit: nothing runs and nothing is recorded', async () => {
  const s = setup();
  try {
    s.g('rm', '-q', 'tests/core.test.mdl', 'tests/seed.test.mdl');
    s.g('commit', '-q', '-m', 'no tests');
    await assert.rejects(runMicroflowTests({ dataDir: s.dataDir, floorId: 'f1', floorDir: s.floorDir, bin: s.exe, mxcliVersion: 'x', sha: s.g('rev-parse', 'HEAD'), actor: 'Ann', timeoutMs: 60_000 }), NoTestsError);
    assert.ok(!s.calls().some((c) => c.args[0] === 'test'));
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('quality: report + lint in the office work folder, bound to commit, mxcli version and catalog schema; the floor stays untouched', async () => {
  const s = setup();
  try {
    const d = await runQuality({ dataDir: s.dataDir, floorId: 'f1', floorDir: s.floorDir, bin: s.exe, mxcliVersion: 'nightly-fake-1', sha: s.sha, branch: 'main', trigger: 'auto' });
    for (const c of s.calls()) assert.equal(real(c.cwd), real(workDirOf(s.dataDir, 'f1', 'quality')), `${c.args[0]} ran in the office work folder`);
    assert.equal(d.commit, s.sha);
    assert.equal(d.sourceKey, qualityKey(s.sha, 'nightly-fake-1'));
    assert.equal(d.catalogSchema, '15');
    assert.equal(d.mendixVersion, '11.12.2');
    assert.equal(d.report?.overall, 63.2);
    assert.deepEqual(d.lint?.bySeverity, { errors: 1, warnings: 2, infos: 0, hints: 0 });
    assert.deepEqual(d.lint?.topRules.map((r) => [r.ruleId, r.count]), [['MPR002', 2], ['SEC001', 1]]);
    assert.deepEqual(d.ruleFailures, [{ rule: 'catalog: microflows', why: 'no such table', from: 'lint' }], 'lint exit 1 with JSON: decided by the JSON, the unreadable catalog shown');
    assert.deepEqual(d.errors, []);
    for (const k of ['checkout', 'report', 'lint', 'catalog', 'total']) assert.equal(typeof d.timings[k], 'number', k);
    assert.ok(existsSync(path.join(s.dataDir, d.evidence.report!)) && existsSync(path.join(s.dataDir, d.evidence.lint!)));
    assert.ok(!existsSync(workDirOf(s.dataDir, 'f1', 'quality')), 'the work folder is wiped after');
    untouched(s);

    // Kept once per commit + mxcli version.
    const store = new QualityStore(path.join(s.dataDir, 'q'), 'f1');
    assert.ok(await store.ingest(d));
    assert.equal(await store.ingest(d), undefined);
    assert.equal((await store.all()).length, 1);
    assert.ok(await store.ingest({ ...d, sourceKey: qualityKey(s.sha, 'nightly-fake-2'), mxcliVersion: 'nightly-fake-2' }), 'another mxcli version is another record');
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('the quality view: newest scores with commit and version, a trend per commit, stale when main moves', () => {
  const mk = (commit: string, overall: number, at: number, sec = 60): QualityRecord => ({
    schemaVersion: 1,
    id: `qr_${at}`,
    sourceKey: qualityKey(commit, 'v1'),
    commit,
    mxcliVersion: 'v1',
    catalogSchema: '15',
    startedAt: new Date(at).toISOString(),
    finishedAt: new Date(at + 1000).toISOString(),
    timings: { total: 16000 },
    report: { overall, categories: [{ name: 'Security', score: sec }, { name: 'Naming', score: 70 }] },
    lint: parseLintJson(JSON.stringify({ violations: [], summary: { total: 0, errors: 0, warnings: 0, infos: 0, hints: 0 } })),
    ruleFailures: [],
    errors: [],
    evidence: {},
    trigger: 'auto',
    workFolder: 'w',
    ingestedAt: at,
  });
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const rs = [mk(A, 50, 1000, 40), mk(B, 63.2, 2000, 67)];
  const v = buildQualityView(rs, B);
  assert.equal(v.latest?.commit, B);
  assert.equal(v.latest?.overall, 63.2);
  assert.equal(v.latest?.mxcliVersion, 'v1');
  assert.deepEqual(v.latest?.scores.map((c) => c.name), ['Security', 'Quality', 'Architecture', 'Performance', 'Naming', 'Design']);
  assert.equal(v.latest?.scores[0].score, 67);
  assert.equal(v.latest?.scores[1].score, undefined, 'a category the report did not give is shown as missing, not 0');
  assert.deepEqual(v.latest?.scores[0].trend.map((p) => p.score), [40, 67]);
  assert.deepEqual(v.latest?.overallTrend.map((p) => p.commit), [A, B]);
  assert.equal(v.stale, undefined);
  assert.equal(v.mainScored, true);
  const moved = buildQualityView(rs, 'd'.repeat(40));
  assert.deepEqual(moved.stale, { main: 'd'.repeat(40), scored: B });
  assert.equal(moved.mainScored, false);
  assert.equal(buildQualityView([], A).latest, undefined);
});

test('report / lint parsing and rules that could not run', () => {
  assert.equal(parseReportJson('{"nope":1}'), undefined);
  assert.equal(parseLintJson('[]'), undefined);
  const f = ruleFailuresOf('lint', JSON.stringify({ violations: [], ruleFailures: [{ ruleId: 'QUAL004', error: 'starlark: boom' }] }), "Warning: some rules need 'full' catalog data that is unavailable; their results may be incomplete\nResults are INCOMPLETE (1 failed query).");
  assert.deepEqual(f.map((x) => x.rule), ['QUAL004', 'rules needing full catalog data', 'lint run']);
  assert.equal(versionOf('mxcli version nightly-20261003-14a0a7c0c (2026-10-03T08:29:41Z)'), 'nightly-20261003-14a0a7c0c');
});

test('work folders: only under the office data folder, never in the checkout; the .mpr and the test files found', () => {
  const data = path.join(os.tmpdir(), 'd');
  assert.throws(() => assertOfficeFolder(path.join(os.tmpdir(), 'floor', 'x'), data, path.join(os.tmpdir(), 'floor')));
  assert.throws(() => assertOfficeFolder(path.join(data, 'testing', 'work', 'f'), data, path.join(data, 'testing', 'work')));
  assert.doesNotThrow(() => assertOfficeFolder(path.join(data, 'testing', 'work', 'f1', 'tests'), data, path.join(os.tmpdir(), 'floor')));
  assert.equal(mprIn(['a/b/x.mpr', 'App.mpr', 'README.md']), 'App.mpr');
  assert.deepEqual(testPathsIn(['tests/b.test.mdl', 'tests/a.test.md', 'tests/e2e/x.js', 'node_modules/p/z.test.mdl']), ['tests/a.test.md', 'tests/b.test.mdl']);
});

test('the office wiring: automatic scoring is off by default; on, a new main commit is scored once per mxcli version, never while agents work; one test run at a time', async () => {
  const s = setup();
  try {
    const tool = async () => ({ bin: s.exe, version: 'nightly-fake-1' });
    let working = true;
    const floor = { id: 'f2', dir: s.floorDir, workers: { list: () => [{ status: working ? 'working' : 'idle' }] as never } };
    const main = { sha: s.sha, branch: 'main' };
    let t = 1_000_000;
    // The test database step stands in (test-db.ts has its own tests): nothing touches a real PostgreSQL.
    const deps = { tool, now: () => t, prepare: async () => ({ db: 'app_test', notes: [] }) };
    // The default (nothing saved): no automatic run from either trigger, even with the floor idle.
    working = false;
    assert.equal(testingSwitches().autoScore, false);
    assert.equal(await qualityOnMain(s.dataDir, floor, main, deps), undefined, 'off by default: nothing runs');
    const part = await qualityPart(s.dataDir, floor, true, deps);
    assert.equal(part.auto, false, 'the card says automatic scoring is off');
    assert.equal(part.runs.quality.running, false);
    assert.equal((await qualityStore(s.dataDir, 'f2').all()).length, 0);
    // Turned on (audited elsewhere): as before, but never while an agent works.
    assert.ok(typeof setTestingSwitches({ autoScore: true }, { name: 'Ann' }) !== 'string');
    working = true;
    assert.equal(await qualityOnMain(s.dataDir, floor, main, deps), undefined, 'deferred while the agents work');
    working = false;
    const run = await qualityOnMain(s.dataDir, floor, main, deps);
    assert.ok(run, 'scored once the agents are idle');
    await run.done;
    assert.equal((await qualityStore(s.dataDir, 'f2').all()).length, 1);
    assert.equal(await qualityOnMain(s.dataDir, floor, main, deps), undefined, 'the same commit and version: not again');
    // Busy for however long: it never goes ahead while an agent works, and runs at the first idle look.
    s.g('commit', '-q', '--allow-empty', '-m', 'second');
    const next = { sha: s.g('rev-parse', 'HEAD'), branch: 'main' };
    working = true;
    assert.equal(await qualityOnMain(s.dataDir, floor, next, deps), undefined);
    t += 3 * 60 * 60_000;
    assert.equal(await qualityOnMain(s.dataDir, floor, next, deps), undefined, 'hours later, still busy: still waiting');
    assert.match(String((await qualityPart(s.dataDir, floor, true, deps)).runs.quality.deferred), /Waiting for the agents/);
    working = false;
    const late = await qualityOnMain(s.dataDir, floor, next, deps);
    assert.ok(late, 'idle: it runs');
    await late.done;
    assert.equal((await qualityStore(s.dataDir, 'f2').all()).length, 2);
    untouched(s);

    // Microflow tests: one at a time per project.
    const first = await startMicroflowTests(s.dataDir, floor, { name: 'Ann' }, deps);
    assert.ok(typeof first !== 'string');
    assert.match(String(await startMicroflowTests(s.dataDir, floor, { name: 'Ann' }, deps)), /already under way/);
    await first.done;
    const recs = await testingStore(s.dataDir, 'f2').all();
    assert.equal(recs.length, 1);
    assert.equal(recs[0].testedRevision, next.sha);
    assert.equal(recs[0].actor.name, 'Ann');
    untouched(s);
    // An agent's run (office-app test) on its own commit, an older one here: the JUnit result is recorded at exactly that commit.
    const mine = await startMicroflowTests(s.dataDir, floor, { name: 'Rhea', agentId: 'w-rhea', commit: main.sha.slice(0, 10) }, deps);
    assert.ok(typeof mine !== 'string', String(mine));
    assert.equal(mine.commit, main.sha);
    await mine.done;
    const agentRec = (await testingStore(s.dataDir, 'f2').all()).at(-1)!;
    assert.equal(agentRec.testedRevision, main.sha);
    assert.equal(agentRec.actor.name, 'Rhea');
    assert.ok(agentRec.results.length > 0 && !agentRec.harnessError, 'JUnit results, not a harness error');
    assert.match(String(await startMicroflowTests(s.dataDir, floor, { name: 'Rhea', agentId: 'w-rhea', commit: 'f'.repeat(40) }, deps)), /has no commit f{40}: commit your work first/);
    untouched(s);

    // Off again: an admin's "Score main now" still works.
    assert.ok(typeof setTestingSwitches({ autoScore: false }, { name: 'Ann' }) !== 'string');
    s.g('commit', '-q', '--allow-empty', '-m', 'third');
    const third = { sha: s.g('rev-parse', 'HEAD'), branch: 'main' };
    assert.equal(await qualityOnMain(s.dataDir, floor, third, deps), undefined, 'off: no automatic run');
    const asked = await startQuality(s.dataDir, floor, { name: 'Ann' }, deps);
    assert.ok(typeof asked !== 'string', String(asked));
    await asked.done;
    assert.equal((await qualityStore(s.dataDir, 'f2').all()).length, 3, 'the manual run scored main');
    untouched(s);
  } finally {
    closeConnections();
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('a deleted project takes its quality records and JUnit evidence to the archive; its work folders are only removed', async () => {
  const { officeFiles, derivedFiles } = await import('../src/server/project-delete/data.js');
  assert.ok(officeFiles('shop').includes('testing/quality/shop.jsonl'));
  assert.ok(officeFiles('shop').includes('testing/evidence/shop'));
  assert.ok(derivedFiles('shop').includes('testing/work/shop'));
});
