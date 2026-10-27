// Release 79's agent-run checks (the real rebuild test's P1s): the project's own test users for smoke runs and
// journeys (not the toolkit template's), a refused sign-in said with what to do and raised for the Project
// Manager, the projects' .journey.js scripts played on the instance in the office's limits, agent-run checks
// (instance starts, checks the agent reports) recorded at the commit, and a run that couldn't complete shown
// as a failed check, never "skipped". Fakes and small node scripts only: no mxcli, no database, no browser.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { personasIn, projectIdentities, seedPasswordIn, signInHelp, templateOnly } from '../src/shared/agent-app-identity.js';
import { checkName, checkVerdict } from '../src/shared/testing/record.js';
import { runJourney, runSmoke } from '../src/server/agent-app/journey.js';
import { jsJourneyId, readFindings, runJsJourney } from '../src/server/agent-app/journey-js.js';
import { recordAgentCheck } from '../src/server/agent-app/checks.js';
import { identitiesFor } from '../src/server/agent-app/identity.js';
import { testingStore } from '../src/server/testing/index.js';
import { parseApp, APP_TOOL_NAMES } from '../bin/office-app.js';
import { MCP_ALLOWED } from '../src/server/office-workers.js';

const TEMPLATE = { user: 'demo_test_user', pass: 'template-pass', roles: [{ key: 'requester', user: 'erika.engineer', pass: 'x' }, { key: 'approver', user: 'paul.planner', pass: 'x' }] };

test('test identities: the toolkit template is never the project; the journeys name the personas and the seed constant gives the password', () => {
  assert.equal(templateOnly(TEMPLATE), true);
  assert.equal(templateOnly({ user: 'ana.requester', pass: 'p', roles: [] }), false);
  const js = "// Persona: ana.requester (Requester)\nconst rec = makeRecorder('J-01', { persona: 'ana.requester' });\nawait J.login(page, 'ben.approver');";
  assert.deepEqual(personasIn(js), ['ana.requester', 'ben.approver']);
  assert.deepEqual(personasIn(JSON.stringify({ id: 'J-02', persona: 'erika.engineer', as: 'admin' })), [], 'template names and admins are never taken');
  const seed = seedPasswordIn({ bootConfig: { MicroflowConstants: { 'Core.ApiUrl': 'http://x', 'Core.SeedUserPassword': 'Seed-Pass-123' } } });
  assert.deepEqual(seed, { constant: 'Core.SeedUserPassword', value: 'Seed-Pass-123' });
  const ids = projectIdentities(TEMPLATE, ['ana.requester', 'ben.approver'], seed);
  assert.equal(ids.cfg?.user, 'ana.requester');
  assert.equal(ids.cfg?.pass, 'Seed-Pass-123');
  assert.deepEqual(ids.cfg?.roles.map((r) => [r.user, r.pass]), [['ana.requester', 'Seed-Pass-123'], ['ben.approver', 'Seed-Pass-123']]);
  assert.ok(!ids.users.some((u) => u.user === 'demo_test_user'), 'the template accounts are not offered');
  assert.match(ids.passwords, /seed password constant Core\.SeedUserPassword/);
  assert.doesNotMatch(ids.passwords, /Seed-Pass-123/, 'words never carry a password');
  // A real project config wins, and a persona it doesn't list gets the seed password.
  const own = projectIdentities({ user: 'cara.clerk', pass: 'own', roles: [] }, ['ana.requester'], seed);
  assert.equal(own.cfg?.user, 'cara.clerk');
  assert.equal(own.cfg?.pass, 'own');
  assert.equal(own.cfg?.roles.find((r) => r.user === 'ana.requester')?.pass, 'Seed-Pass-123');
  assert.match(signInHelp('ana.requester', 'the project’s test users', ids), /name the right ones in tests\/e2e\/project\.config\.js .*--as <user> \(other known users: ben\.approver\).*raised to the Project Manager/);
});

/** A floor repo at a commit with a JSON journey and a JS journey script, an instance on it, and its runtime log. */
function rig() {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-checks-'));
  const repo = path.join(root, 'repo');
  mkdirSync(path.join(repo, 'tests', 'e2e'), { recursive: true });
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: repo, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'tests', 'e2e', 'project.config.js'), "const DEFAULT_USER = 'demo_test_user';\nconst DEFAULT_PASS = 'template-pass';\nmodule.exports = { credentials: () => ({ user: DEFAULT_USER, pass: DEFAULT_PASS }), roles: {} };\n");
  writeFileSync(path.join(repo, 'tests', 'e2e', 'J-16.journey.js'), "// Persona: ana.requester\nconst rec = makeRecorder('J-16', { persona: 'ana.requester' });\n");
  g('add', '-A');
  g('commit', '-qm', 'journeys');
  const sha = g('rev-parse', 'HEAD');
  const mx = path.join(root, 'ws', '.mxcli');
  mkdirSync(mx, { recursive: true });
  const log = path.join(mx, 'runtime.log');
  writeFileSync(log, '2026-10-26 10:00:00.000 INFO - Core: started\n');
  writeFileSync(path.join(mx, 'run-local.json'), JSON.stringify({ bootConfig: { MicroflowConstants: { 'Core.SeedUserPassword': 'Seed-Pass-123' } } }));
  const e = { floorId: 'shop', workerId: 'w1', worker: 'Rhea', commit: sha, purpose: 'ag111111', workspace: path.join(root, 'ws'), state: 'ready' as const, startedAt: 0, lastUsed: 0, abort: new AbortController(), started: Promise.resolve(), instance: { url: 'http://127.0.0.1:8301/', runtimeLog: log } };
  return { root, repo, sha, e };
}

test('identities at a commit: the template config is passed over, the JS journey persona and the instance seed password are used', async () => {
  const r = rig();
  try {
    const ids = await identitiesFor(r.repo, r.sha, r.e.instance.runtimeLog, { runnerConfig: async () => TEMPLATE });
    assert.equal(ids.cfg?.user, 'ana.requester');
    assert.equal(ids.cfg?.pass, 'Seed-Pass-123');
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('a smoke run whose sign-in the app refused: signs in as the project persona, says what to do, raises it for the PM, and is a failed check (never skipped)', async () => {
  const r = rig();
  try {
    let tried = '';
    const launch = async () => {
      throw new Error("couldn't sign in as ana.requester: still on the sign-in page (“The username or password you entered is incorrect.”)");
    };
    const raised: string[] = [];
    const o = await runSmoke(r.e as never, { paths: ['/'] }, { dataDir: r.root, floorDir: r.repo, launch: launch as never, runnerConfig: async () => TEMPLATE, onSignInFailed: (_e, words) => (raised.push(words), (tried = words), 'esc-1') });
    assert.equal(o.status, 'error');
    assert.match(String(o.failure), /couldn't sign in as ana\.requester/);
    assert.match(String(o.failure), /The office signed in as ana\.requester .*seed password constant Core\.SeedUserPassword/);
    assert.match(String(o.failure), /\(raised as esc-1\)/);
    assert.equal(raised.length, 1);
    assert.doesNotMatch(tried, /Seed-Pass-123/, 'the password is never in the words');
    const [rec] = await testingStore(r.root, 'shop').all();
    assert.equal(checkVerdict(rec), 'failed', 'a smoke that could not sign in is a failed check');
    assert.equal(checkName(rec), "smoke (couldn't run)");
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('check verdicts: a harness error fails, a conclusion wins, all passed passes, nothing is skipped', () => {
  const p = { name: 'a', status: 'passed' as const, links: [] };
  assert.equal(checkVerdict({ results: [], harnessError: 'x' }), 'failed');
  assert.equal(checkVerdict({ results: [p] }), 'passed');
  assert.equal(checkVerdict({ results: [] }), 'skipped');
  assert.equal(checkVerdict({ results: [p], conclusion: 'skipped' }), 'skipped');
  assert.equal(checkName({ suite: 'smoke' }), 'smoke');
});

test('a .journey.js in the project: found by its id at the commit, played as the persona it names, recorded at the commit', async () => {
  const r = rig();
  try {
    let asked: { file: string; login: { user: string; password: string }; url: string } | undefined;
    const js = async (s: { file: string; login: { user: string; password: string }; url: string }) => ((asked = s), { status: 'passed' as const, steps: [{ n: 1, caption: 'Sign in', status: 'passed' }], exitCode: 0, ms: 5 });
    const o = await runJourney(r.e as never, { journey: 'J-16' }, { dataDir: r.root, floorDir: r.repo, runnerConfig: async () => TEMPLATE, js: js as never });
    assert.equal(o.status, 'passed');
    assert.equal(o.suite, 'journey J-16');
    assert.equal(asked?.file, 'tests/e2e/J-16.journey.js');
    assert.equal(asked?.login.user, 'ana.requester');
    assert.equal(asked?.login.password, 'Seed-Pass-123');
    assert.equal(asked?.url, 'http://127.0.0.1:8301/');
    const [rec] = await testingStore(r.root, 'shop').all();
    assert.equal(rec.testedRevision, r.sha);
    assert.equal(rec.definitionRevision, r.sha);
    assert.equal(rec.results[0].status, 'passed');
    assert.match(String(rec.environment?.runner), /journey script/);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

/** A workspace with the scripts a run plays. */
function scripts() {
  const ws = mkdtempSync(path.join(tmpdir(), 'agent-jsj-'));
  mkdirSync(path.join(ws, 'tests', 'e2e'), { recursive: true });
  const put = (name: string, body: string) => writeFileSync(path.join(ws, 'tests', 'e2e', name), body);
  put('lib.js', "module.exports = { url: () => process.env.APP_URL };\n");
  put('J-01.journey.js', "const L = require('./lib.js'); require('fs').writeFileSync(require('path').join(__dirname, 'env.json'), JSON.stringify({ url: L.url(), user: process.env.TEST_USER, secret: process.env.R79_FAKE_SECRET || null, token: process.env.GH_TOKEN || null }));\n");
  put('J-02.journey.js', "const fs = require('fs'), p = require('path'); fs.mkdirSync(p.join(__dirname, 'artifacts'), { recursive: true }); fs.writeFileSync(p.join(__dirname, 'artifacts', 'J-02.findings.json'), JSON.stringify({ verdict_: 'FAIL', steps: [{ name: 'Open the list', status: 'PASS', checks: [] }, { name: 'Save the form', status: 'FAIL', checks: [{ label: 'saved message shown', ok: false }] }] })); process.exit(1);\n");
  put('J-03.journey.js', 'setTimeout(() => {}, 60000);\n');
  put('J-04.journey.js', "console.log('The username or password you entered is incorrect.'); process.exit(1);\n");
  return ws;
}

test('playing .journey.js scripts: the instance address and account go in, no office secret does; findings decide; a timeout or a refused sign-in is a run that could not complete', async () => {
  const ws = scripts();
  process.env.R79_FAKE_SECRET = 'nope';
  try {
    const base = { workspace: ws, url: 'http://127.0.0.1:8301/', login: { user: 'ana.requester', password: 'pw' }, env: { ...process.env, GH_TOKEN: 'never-passed' } };
    const ok = await runJsJourney({ ...base, file: 'tests/e2e/J-01.journey.js' });
    assert.equal(ok.status, 'passed');
    const seen = JSON.parse(readFileSync(path.join(ws, 'tests', 'e2e', 'env.json'), 'utf8'));
    assert.deepEqual(seen, { url: 'http://127.0.0.1:8301', user: 'ana.requester', secret: null, token: null });
    const bad = await runJsJourney({ ...base, file: 'tests/e2e/J-02.journey.js' });
    assert.equal(bad.status, 'failed');
    assert.equal(bad.steps.length, 2);
    assert.match(String(bad.failure), /step 2 \(Save the form\): check failed: saved message shown/);
    const slow = await runJsJourney({ ...base, file: 'tests/e2e/J-03.journey.js', timeoutMs: 1500 });
    assert.equal(slow.status, 'error');
    assert.match(String(slow.failure), /timed out/);
    const refused = await runJsJourney({ ...base, file: 'tests/e2e/J-04.journey.js' });
    assert.equal(refused.status, 'error');
    assert.equal(refused.signIn, true);
    // A file the agent sends runs beside the committed ones (its requires resolve) and is removed after.
    const sent = await runJsJourney({ ...base, file: 'tests/e2e/mine.journey.js', text: "require('./lib.js'); process.exit(0);\n" });
    assert.equal(sent.status, 'passed');
    assert.ok(!readFileSync(path.join(ws, 'tests', 'e2e', 'lib.js'), 'utf8').includes('office-sent'));
    assert.equal(execFileSync(process.execPath, ['-e', `console.log(require('fs').readdirSync(${JSON.stringify(path.join(ws, 'tests', 'e2e'))}).filter((f) => f.startsWith('.office-sent')).length)`], { encoding: 'utf8' }).trim(), '0');
    assert.equal((await runJsJourney({ ...base, file: '../outside.journey.js' })).status, 'error');
    assert.equal(jsJourneyId('tests/e2e/J-16.journey.js'), 'J-16');
    assert.equal(jsJourneyId('tests/e2e/claim-flow.journey.js', "makeRecorder('J-07', {})"), 'J-07');
    assert.equal(readFindings({ steps: [] }), undefined);
  } finally {
    delete process.env.R79_FAKE_SECRET;
    rmSync(ws, { recursive: true, force: true });
  }
});

test('checks an agent reports and its instance starts are recorded at the commit with pass/fail; only image screenshots are kept', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-reported-'));
  try {
    const shot = path.join(root, 'p3.png');
    writeFileSync(shot, 'png');
    const secret = path.join(root, 'config.json');
    writeFileSync(secret, '{}');
    const sha = 'c'.repeat(40);
    const r = await recordAgentCheck(path.join(root, 'data'), { floorId: 'shop', commit: sha, worker: 'Rhea', suite: 'check: P3 header at 390 px (reported by Rhea)', status: 'passed', detail: 'wraps under the title', shots: [shot, secret, 'relative.png'], reported: true });
    assert.equal(r.kept.length, 1);
    assert.deepEqual(r.skipped, [secret, 'relative.png']);
    assert.ok(existsSync(path.join(root, 'data', r.kept[0])));
    await recordAgentCheck(path.join(root, 'data'), { floorId: 'shop', commit: sha, worker: 'Rhea', suite: 'app start', status: 'error', detail: 'the build failed: CE0117' });
    const recs = await testingStore(path.join(root, 'data'), 'shop').all();
    assert.deepEqual(recs.map((x) => [x.suite, checkVerdict(x)]), [
      ['check: P3 header at 390 px (reported by Rhea)', 'passed'],
      ['app start', 'failed'],
    ]);
    assert.match(String(recs[0].environment?.runner), /reported by Rhea .*not watched by the office/);
    assert.equal(recs[1].harnessError, 'the build failed: CE0117');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('office-app check and the app_check tool', () => {
  assert.deepEqual(parseApp(['check', '--name', 'P3 at 390 px', '--result', 'failed', '--shot', 'a.png', '--detail', 'overflows']), { cmd: 'check', json: false, wait: true, pages: [], name: 'P3 at 390 px', result: 'failed', shots: ['a.png'], detail: 'overflows' });
  assert.throws(() => parseApp(['check', '--name', 'x']), /--result passed\|failed/);
  assert.ok(APP_TOOL_NAMES.includes('app_check'));
  assert.ok(MCP_ALLOWED.some((t: string) => t.endsWith('__app_check')));
});

test('killTreeAsync ends a process tree without holding the event loop', async () => {
  const { killTreeAsync } = await import('../src/server/liveapp/process.js');
  const ch = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: process.platform !== 'win32' });
  await new Promise((r) => ch.once('spawn', r));
  const gone = new Promise((r) => ch.once('exit', r));
  let ticks = 0;
  const t = setInterval(() => ticks++, 5);
  await killTreeAsync(ch.pid!);
  await gone;
  clearInterval(t);
  assert.ok(ch.exitCode !== null || ch.signalCode !== null);
});

test('the log appender writes every line, in order, off the event loop', async () => {
  const { logAppender } = await import('../src/server/liveapp/log-append.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'log-append-'));
  try {
    const f = path.join(dir, 'x.log');
    const log = logAppender(f);
    for (let i = 0; i < 500; i++) log(`line ${i}`);
    await log.flush();
    const lines = readFileSync(f, 'utf8').trim().split('\n');
    assert.equal(lines.length, 500);
    assert.equal(lines[499], 'line 499');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
