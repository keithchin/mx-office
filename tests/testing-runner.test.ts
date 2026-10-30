// The microflow test runner's release 82 fixes (docs/site/using-the-office/testing.md, "Microflow tests"): a run
// answers when mxcli ends even though a runtime it left holds its output, and soon after mxcli wrote its results
// even when mxcli itself never ends; a run stopped at its time limit keeps what passed or failed and lists the
// tests that never ran, saying the phase it was in; the limit is the project's own or sized to the suite; a run
// can be a subset of the test files (named, or by @tag); progress is read off mxcli's own (verbose) output.
// A fake mxcli only (an .exe shim on Windows, never .cmd): no Mendix runtime, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liveCounts, newProgress, progressWords, readLine, stoppedWhile } from '../src/shared/testing/run-progress.js';
import { autoLimitMinutes, cleanLimit, cleanSubset, partialResults, pickFiles, readTestFile, subsetWords } from '../src/shared/testing/test-files.js';
import { runMicroflowTests } from '../src/server/testing/mxcli-run.js';
import { runMxOwned } from '../src/server/testing/run-guard.js';
import { startMicroflowTests, testRunOf } from '../src/server/testing/mxcli-office.js';
import { setTestLimit, testLimitOf, limitFor } from '../src/server/testing/runner-settings.js';
import { testFilesAt } from '../src/server/testing/workfolder.js';
import { testingStore } from '../src/server/testing/index.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';
import { closeConnections } from '../src/server/connections/store.js';
import { runnable } from './support/winshim.js';
// @ts-expect-error plain JS
import { appMain, parseApp } from '../bin/office-app.js';

// mxcli v0.27.0's own words on a real run (--verbose), cut down.
const REAL = `Configuration "Default" sets no constant values; using each constant's default.
Parsing test files...
  Found 3 test(s) in 2 file(s)
Generating test endpoint and test microflows...
Injecting test endpoint into project...
Connected to: C:\\work\\App.mpr (Mendix 11.12.4)
Created module: MxTest
Created java action: MxTest.RegisterTestEndpoint
Created microflow: MxTest.RegisterEndpoint
Connected to: C:\\work\\App.mpr (Mendix 11.12.4)
Module 'MxTest' already exists
Created microflow: MxTest.Test_test_1
Created microflow: MxTest.Test_test_2
Created microflow: MxTest.Test_test_3
  After-startup set to MxTest.RegisterEndpoint (registers the endpoint; runs no tests)
Starting local runtime (no Docker)...
Building project (mxbuild --serve)...
Runtime started; app serving at http://127.0.0.1:19081/
Running 3 test(s) over the test endpoint...
  PASS Adds two numbers (12ms)
  FAIL A sum (with brackets) that is wrong (5ms)
  ERROR Asset tag of only spaces is refused (46ms)
Cleaning up...
  project restored
Test Results: tests
  PASS  Adds two numbers (12ms, 1 assertion)
JUnit XML written to: C:/data/mt_1.junit.xml`;

test('progress: the phases, the test microflows added and each test as mxcli says it (verbose), never the summary twice', () => {
  const p = newProgress(0);
  const seen: string[] = [];
  let t = 0;
  for (const l of REAL.split('\n')) {
    readLine(p, l, (t += 1000));
    seen.push(p.phase);
  }
  assert.equal(p.total, 3);
  assert.equal(p.injected, 3);
  assert.deepEqual(p.results, [
    { name: 'Adds two numbers', status: 'PASS' },
    { name: 'A sum (with brackets) that is wrong', status: 'FAIL' },
    { name: 'Asset tag of only spaces is refused', status: 'ERROR' },
  ]);
  assert.equal(p.junitWritten, true);
  assert.deepEqual([...new Set(seen)], ['preparing', 'injecting', 'building', 'starting', 'running', 'cleaning', 'reporting']);
  assert.deepEqual(liveCounts(p), { finished: 3, passed: 1, failed: 1, errors: 1, skipped: 0 });
  // Mid-run words: tests started and finished.
  const mid = newProgress(0);
  for (const l of REAL.split('\n').slice(0, 20)) readLine(mid, l, 5000);
  assert.match(progressWords(mid, 65_000), /^Running the tests: 2 of 3 started, 1 finished \(1 passed, 0 failed\)/);
  assert.match(stoppedWhile(mid, 65_000), /while the tests ran: 1 of 3 had finished/);
  // The live office's stall: the generated test microflows checked, none added.
  const stall = newProgress(0);
  for (const l of REAL.split('\n').slice(0, 10)) readLine(stall, l, 1000);
  assert.equal(stall.phase, 'injecting');
  assert.match(stoppedWhile(stall, 16 * 60_000), /checking the generated test microflows, before adding any \(no test microflow was created in 16 min/);
  assert.match(progressWords(stall, 61_000), /^Checking the generated test microflows/);
});

test('test files: @test names and @tag tags; a subset by path, file name or tag; limits; partial results', () => {
  const a = readTestFile('tests/loans.test.mdl', '/**\n * @tag smoke, Loans\n */\n/**\n * @test Lend one\n * @expect $r = 1\n */\n$r = 1;\n/\n/** @test Lend two */');
  assert.deepEqual(a, { file: 'tests/loans.test.mdl', tests: ['Lend one', 'Lend two'], tags: ['smoke', 'loans'] });
  const b = readTestFile('tests/sub/stock.test.md', '```mdl-test\n/**\n * @test Stock\n * @tags nightly\n */\n```');
  const c = readTestFile('other/stock.test.md', '/** @test Other stock */');
  const all = [a, b, c];
  assert.deepEqual(pickFiles(all, undefined), { files: all });
  assert.deepEqual(pickFiles(all, { files: ['loans.test.mdl'] }), { files: [a] });
  assert.deepEqual(pickFiles(all, { files: ['tests/sub/stock.test.md'], tags: ['smoke'] }), { files: [a, b] });
  assert.match((pickFiles(all, { files: ['stock.test.md'] }) as { why: string }).why, /matches tests\/sub\/stock\.test\.md and other\/stock\.test\.md: give its path/);
  assert.match((pickFiles(all, { files: ['nope.test.mdl'], tags: ['ghost'] }) as { why: string }).why, /no test file nope\.test\.mdl; no test file has @tag ghost\. The test files at this commit: tests\/loans/);
  assert.deepEqual(cleanSubset('a.test.mdl, b.test.mdl', ['@Smoke']), { files: ['a.test.mdl', 'b.test.mdl'], tags: ['smoke'] });
  assert.match(String(cleanSubset(['../x.test.mdl'], undefined)), /without \.\./);
  assert.equal(subsetWords({ files: ['a.test.mdl'], tags: ['smoke'] }), 'file a.test.mdl; tag smoke');
  assert.equal(subsetWords(undefined), 'all test files');
  assert.deepEqual([autoLimitMinutes(0), autoLimitMinutes(20), autoLimitMinutes(123), autoLimitMinutes(1000)], [15, 15, 41, 45]);
  assert.equal(cleanLimit(''), undefined);
  assert.equal(cleanLimit('30'), 30);
  assert.match(String(cleanLimit(2)), /5 to 180/);
  assert.match(String(cleanLimit(30.5)), /whole minutes/);
  // A run stopped mid-way: the live verdicts by name in order, the rest never ran (skipped, never a pass or a failure).
  const parts = partialResults([a, b], { results: [{ name: 'Lend one', status: 'PASS' }, { name: 'Lend two', status: 'FAIL' }] }, 'stopped at the limit');
  assert.deepEqual(parts.map((r) => [r.name, r.status, !!r.harness]), [
    ['tests/loans.test.mdl#Lend one', 'passed', false],
    ['tests/loans.test.mdl#Lend two', 'failed', false],
    ['tests/sub/stock.test.md#Stock', 'skipped', false],
  ]);
  assert.match(parts[2].detail!, /^never ran: stopped at the limit/);
});

// ---- The runner with a fake mxcli that behaves like v0.27 (verbose) and misbehaves on purpose ----

const FAKE = `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const a = process.argv.slice(2);
const mode = process.env.FAKE_MXCLI_MODE || '';
fs.appendFileSync(process.env.FAKE_MXCLI_LOG, JSON.stringify({ args: a }) + '\\n');
const forever = () => setInterval(() => {}, 1e9);
if (a[0] !== 'test') process.exit(2);
const files = a.slice(1, a.indexOf('-p'));
const tests = [];
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/@test\\s+([^\\n*]+?)\\s*(\\*\\/|\\n)/g)) tests.push({ f, name: m[1] });
const out = a[a.indexOf('--junit') + 1];
const verbose = a.includes('--verbose');
const say = (s) => process.stdout.write(s + '\\n');
say('Parsing test files...');
say('  Found ' + tests.length + ' test(s) in ' + files.length + ' file(s)');
say('Injecting test endpoint into project...');
say('Connected to: project.mpr (Mendix 11.12.2)');
say('Created microflow: MxTest.RegisterEndpoint');
if (mode === 'stall-inject') return forever();
tests.forEach((t, i) => say('Created microflow: MxTest.Test_test_' + (i + 1)));
say('Starting local runtime (no Docker)...');
say('Building project (mxbuild --serve)...');
say('Runtime started; app serving at http://127.0.0.1:1/');
say('Running ' + tests.length + ' test(s) over the test endpoint...');
const verdict = (t) => (/bad/.test(t.name) ? 'FAIL' : 'PASS');
for (const [i, t] of tests.entries()) {
  if (mode === 'stall-running' && i === Math.min(2, tests.length - 1)) return forever();
  if (verbose) say('  ' + verdict(t) + ' ' + t.name + ' (3ms)');
}
say('Cleaning up...');
say('  project restored');
fs.writeFileSync(out, '<?xml version="1.0"?><testsuites><testsuite name="tests" tests="' + tests.length + '">' + tests.map((t) => '<testcase name="' + t.name + '" classname="x" file="' + t.f + '" time="0.003">' + (verdict(t) === 'FAIL' ? '<failure message="no">no</failure>' : '') + '</testcase>').join('') + '</testsuite></testsuites>');
say('JUnit XML written to: ' + out);
if (mode === 'hang-after-junit') return forever();
if (mode === 'grandchild') {
  // A runtime left behind, holding this mxcli's output open.
  const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
  fs.writeFileSync(process.env.FAKE_MXCLI_LOG + '.child', String(c.pid));
  c.unref();
}
process.exit(tests.some((t) => verdict(t) === 'FAIL') ? 1 : 0);
`;

function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mx-office-runner-'));
  const floorDir = path.join(root, 'floor');
  const dataDir = path.join(root, 'data');
  mkdirSync(path.join(floorDir, 'tests'), { recursive: true });
  writeFileSync(path.join(floorDir, 'project.mpr'), 'mpr');
  writeFileSync(path.join(floorDir, 'tests', 'loans.test.mdl'), '/** @tag smoke */\n/** @test Lend one */\n/** @test Lend bad */\n');
  writeFileSync(path.join(floorDir, 'tests', 'stock.test.mdl'), '/** @test Stock count */\n/** @test Stock move */\n');
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
      .map((l) => JSON.parse(l) as { args: string[] });
  return { root, floorDir, dataDir, exe, g, log, calls, sha: g('rev-parse', 'HEAD') };
}

const verbose = { dbType: true, ports: false, mxbuildPath: false, constant: true, verbose: true };
const base = (s: ReturnType<typeof setup>) => ({ dataDir: s.dataDir, floorId: 'f1', floorDir: s.floorDir, bin: s.exe, mxcliVersion: 'v0.27.0', sha: s.sha, actor: 'Ann', timeoutMs: 60_000, flags: verbose, graceMs: 500, drainMs: 500 });

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('a runtime left behind holding mxcli’s output: the run answers once mxcli ends (not at the time limit), and the leftover is stopped', { timeout: 90_000 }, async () => {
  const s = setup();
  try {
    process.env.FAKE_MXCLI_MODE = 'grandchild';
    const t0 = Date.now();
    const { draft } = await runMicroflowTests({ ...base(s), limit: () => ({ ms: 60_000, auto: false }) });
    assert.ok(Date.now() - t0 < 40_000, `answered in ${Date.now() - t0} ms, not at the limit`);
    assert.equal(draft.harnessError, undefined);
    assert.deepEqual(draft.results.map((r) => r.status), ['passed', 'failed', 'passed', 'passed']);
    const child = Number(readFileSync(`${s.log}.child`, 'utf8'));
    for (let i = 0; i < 50 && alive(child); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(child), false, 'the process it left behind was stopped');
  } finally {
    process.env.FAKE_MXCLI_MODE = '';
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('mxcli wrote its JUnit file but never ends: the results are read within the grace, mxcli is stopped', { timeout: 90_000 }, async () => {
  const s = setup();
  try {
    process.env.FAKE_MXCLI_MODE = 'hang-after-junit';
    const seen: string[] = [];
    const t0 = Date.now();
    const { draft, junit } = await runMicroflowTests({ ...base(s), limit: () => ({ ms: 60_000, auto: true }), onProgress: (p) => seen.push(p.phase) });
    assert.ok(Date.now() - t0 < 40_000, `answered in ${Date.now() - t0} ms`);
    assert.ok(junit && existsSync(junit));
    assert.equal(draft.harnessError, undefined);
    assert.equal(draft.results.length, 4);
    assert.deepEqual(draft.limit, { minutes: 1, auto: true });
    assert.ok(seen.includes('running') && seen.includes('reporting'));
    // mxcli's whole output is kept beside the JUnit file.
    assert.match(draft.log!, /^office:testing\/evidence\/f1\/mt_.*\.log$/);
    assert.match(readFileSync(path.join(s.dataDir, draft.log!.slice('office:'.length)), 'utf8'), /Running 4 test\(s\)/);
    const call = s.calls().at(-1)!;
    assert.ok(call.args.includes('--verbose'), 'verbose: a line per test');
    assert.equal(call.args[call.args.indexOf('--timeout') + 1], '1m');
  } finally {
    process.env.FAKE_MXCLI_MODE = '';
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('stopped at the time limit while the tests ran: what passed or failed is kept, the rest never ran, and the words say where it was', { timeout: 90_000 }, async () => {
  const s = setup();
  try {
    process.env.FAKE_MXCLI_MODE = 'stall-running';
    const { draft } = await runMicroflowTests({ ...base(s), limit: () => ({ ms: 4_000, auto: false }) });
    assert.match(draft.harnessError!, /^Stopped at the time limit \(1 min, the project's own\) while the tests ran: 2 of 4 had finished \(1 passed, 1 failed\); 2 of 4 never ran\. Raise the project's time limit/);
    assert.deepEqual(draft.results.map((r) => [r.name, r.status]), [
      ['tests/loans.test.mdl#Lend one', 'passed'],
      ['tests/loans.test.mdl#Lend bad', 'failed'],
      ['tests/stock.test.mdl#Stock count', 'skipped'],
      ['tests/stock.test.mdl#Stock move', 'skipped'],
    ]);
    assert.match(draft.results[2].detail!, /^never ran: the run was stopped at its 1-min time limit/);
    assert.equal(draft.exitCode === 0, false);
    // Stalled before any test microflow was added (the live office's case): said so, every test never ran.
    process.env.FAKE_MXCLI_MODE = 'stall-inject';
    const st = await runMicroflowTests({ ...base(s), limit: () => ({ ms: 4_000, auto: true }) });
    assert.match(st.draft.harnessError!, /sized to the suite\) while mxcli was checking the generated test microflows, before adding any/);
    assert.ok(!/Cleaning up/.test(st.draft.harnessError!), 'mxcli is stopped first, so it never starts its own clean-up');
    assert.equal(st.draft.results.filter((r) => /^never ran/.test(r.detail ?? '')).length, 4);
  } finally {
    process.env.FAKE_MXCLI_MODE = '';
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('a subset: only the named files, or the tagged ones, go to mxcli; recorded on the run; a name matching nothing is refused before anything starts', { timeout: 90_000 }, async () => {
  const s = setup();
  try {
    process.env.FAKE_MXCLI_MODE = '';
    const named = await runMicroflowTests({ ...base(s), subset: { files: ['stock.test.mdl'] } });
    assert.deepEqual(s.calls().at(-1)!.args.slice(1, 2), ['tests/stock.test.mdl']);
    assert.deepEqual(named.draft.subset, { files: ['stock.test.mdl'], paths: ['tests/stock.test.mdl'] });
    assert.equal(named.draft.results.length, 2);
    const tagged = await runMicroflowTests({ ...base(s), subset: { tags: ['smoke'] } });
    assert.deepEqual(tagged.draft.subset, { tags: ['smoke'], paths: ['tests/loans.test.mdl'] });
    assert.deepEqual(tagged.draft.results.map((r) => r.name), ['tests/loans.test.mdl#Lend one', 'tests/loans.test.mdl#Lend bad']);
    assert.deepEqual((await testFilesAt(s.floorDir, s.sha)).map((f) => [f.file, f.tests.length, f.tags]), [
      ['tests/loans.test.mdl', 2, ['smoke']],
      ['tests/stock.test.mdl', 2, []],
    ]);
    // Through the office: refused before any run, and the run's progress and limit while it runs.
    const calls = s.calls().length;
    const tool = async () => ({ bin: s.exe, version: 'v0.27.0' });
    const floor = { id: 'f1', dir: s.floorDir };
    const deps = { tool, flags: async () => verbose, constants: async () => undefined, limit: () => ({ ms: 60_000, auto: true }) };
    assert.match(String(await startMicroflowTests(s.dataDir, floor, { name: 'Ann', subset: { files: ['ghost.test.mdl'] } }, deps)), /^Nothing to run for file ghost\.test\.mdl at .*no test file ghost\.test\.mdl/);
    assert.equal(s.calls().length, calls);
    process.env.FAKE_MXCLI_MODE = 'stall-running';
    const run = await startMicroflowTests(s.dataDir, floor, { name: 'Rhea', agentId: 'w1', subset: { tags: ['smoke'] } }, { ...deps, limit: () => ({ ms: 6_000, auto: true }) });
    assert.ok(typeof run !== 'string', String(run));
    let words = '';
    for (let i = 0; i < 100 && !/finished/.test(words); i++) {
      await new Promise((r) => setTimeout(r, 100));
      words = testRunOf('f1').progress ?? '';
    }
    assert.match(words, /^Running the tests: 2 of 2 started, 1 finished/);
    assert.equal(testRunOf('f1').limitMinutes, 1);
    await run.done;
    assert.match(testRunOf('f1').last!, /^Harness error: Stopped at the time limit.*\[kept: 1 passed, 0 failed, 0 harness errors, 1 never ran\] \(tag smoke\)$/);
    const rec = (await testingStore(s.dataDir, 'f1').all()).at(-1)!;
    assert.deepEqual(rec.subset, { tags: ['smoke'], paths: ['tests/loans.test.mdl'] });
  } finally {
    process.env.FAKE_MXCLI_MODE = '';
    closeConnections();
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("runMxOwned: lines as they come, and mxcli's end is enough even while a child holds its output", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'run-guard-exit-'));
  try {
    const script = path.join(root, 'fake.js');
    writeFileSync(script, `const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: ['ignore', 'inherit', 'inherit'] }).unref(); console.log('one'); console.log('two'); process.exit(3);`);
    const lines: string[] = [];
    const t0 = Date.now();
    const out = await runMxOwned(path.join(root, 'w'), process.execPath, [script], root, 50_000, {}, {}, { onLine: (l) => lines.push(l), drainMs: 300 });
    assert.ok(Date.now() - t0 < 30_000);
    assert.equal(out.code, 3);
    assert.equal(out.killed, undefined);
    assert.deepEqual(lines, ['one', 'two']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a project's time limit: set, cleared, sized to the suite without one", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'runner-settings-'));
  try {
    assert.equal(await testLimitOf(dataDir, 'p1'), undefined);
    assert.deepEqual((await limitFor(dataDir, 'p1'))(123), { ms: 41 * 60_000, auto: true });
    assert.equal(await setTestLimit(dataDir, 'p1', 90, { name: 'Ann' }), 90);
    assert.deepEqual((await limitFor(dataDir, 'p1'))(123), { ms: 90 * 60_000, auto: false });
    assert.match(String(await setTestLimit(dataDir, 'p1', 500, { name: 'Ann' })), /5 to 180/);
    assert.equal(await setTestLimit(dataDir, 'p1', null, { name: 'Ann' }), null);
    assert.equal(await testLimitOf(dataDir, 'p1'), undefined);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('office-app test --files / --tag: sent to the office, progress said while it waits, never-ran tests listed', async () => {
  assert.deepEqual(parseApp(['test', '--files', 'a.test.mdl,b.test.mdl', '--tag', 'smoke']).files, ['a.test.mdl', 'b.test.mdl']);
  assert.deepEqual(parseApp(['test', '--tag=smoke', '--tag', 'nightly']).tags, ['smoke', 'nightly']);
  assert.throws(() => parseApp(['start', '--files', 'a.test.mdl']), /--files and --tag are for office-app test/);
  const sent: unknown[] = [];
  let polls = 0;
  const fetch = async (url: string, init: { method: string; body?: string }) => {
    if (init.method === 'POST') {
      sent.push(JSON.parse(init.body!));
      return new Response(JSON.stringify({ started: 'c'.repeat(40), line: 'Microflow tests started' }));
    }
    polls++;
    const run = polls < 3 ? { running: true, commit: 'c'.repeat(40), progress: polls === 1 ? 'Building and starting the app (1 min)' : 'Running the tests: 3 of 4 started, 2 finished (2 passed, 0 failed)', limitMinutes: 41 } : { running: false, commit: 'c'.repeat(40), last: 'Harness error: Stopped' };
    const record = { id: 'tr_1', commit: 'c'.repeat(40), harnessError: 'Stopped at the time limit', subset: { files: ['loans.test.mdl'], paths: ['tests/loans.test.mdl'] }, results: [{ name: 'tests/loans.test.mdl#Lend one', status: 'passed' }, { name: 'tests/loans.test.mdl#Lend two', status: 'skipped', detail: 'never ran: stopped' }] };
    return new Response(JSON.stringify({ run, ...(polls >= 3 ? { record } : {}) }));
  };
  const out: string[] = [];
  const err: string[] = [];
  const env = { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1', AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 't' };
  const code = await appMain(['test', '--commit', 'main', '--files', 'loans.test.mdl'], { env, fetch, out: (s: string) => out.push(s), err: (s: string) => err.push(s), pollMs: 5 });
  assert.equal(code, 1);
  assert.deepEqual(sent, [{ commit: 'main', files: ['loans.test.mdl'] }]);
  assert.deepEqual(err.slice(1), ['Building and starting the app (1 min)', 'Running the tests: 3 of 4 started, 2 finished (2 passed, 0 failed)']);
  assert.match(out[0], /subset: tests\/loans\.test\.mdl/);
  assert.match(out[0], /never ran \(1\): tests\/loans\.test\.mdl#Lend two/);
});

test.after(() => stopExecWorker());
