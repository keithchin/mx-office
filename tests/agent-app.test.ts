// Agents' app instances (src/server/agent-app/, P0-1 of the real rebuild test): the lifecycle (start, reuse,
// replace, one per agent, the office-wide limit, the memory refusal, idle and hard limits, stop and leftover
// processes, crash recovery), journeys bound to the instance's commit with runtime errors and the session cap,
// the whole-path matcher, the CLI and MCP tools, the Playbook rule and the change's Checks words. Fakes only:
// no mxcli, no database, no browser.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { AgentApps, purposeOf, type Booted, type BootSpec } from '../src/server/agent-app/service.js';
import { killLeftovers, namesDir } from '../src/server/agent-app/leftovers.js';
import { runJourney, runSmoke } from '../src/server/agent-app/journey.js';
import { runtimeLines, RUNTIME_HEADING } from '../src/server/agent-app/playbook.js';
import { memoryWords, outcomeWords, runtimeErrorsIn, runtimeErrorWords, viewLine } from '../src/shared/agent-app.js';
import { testingStore } from '../src/server/testing/index.js';
import { journeyResults } from '../src/server/liveapp/readiness.js';
import { verificationFact } from '../src/shared/dev-change-facts.js';
import { parseApp, revOf, APP_TOOL_NAMES } from '../bin/office-app.js';
import { TOOLS } from '../bin/office-workers.js';
import { MCP_ALLOWED } from '../src/server/office-workers.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function fakeBoot(over: { fail?: string; hold?: Promise<void> } = {}) {
  const booted: { spec: BootSpec; stopped: boolean }[] = [];
  const boot = async (spec: BootSpec): Promise<Booted> => {
    const rec = { spec, stopped: false };
    booted.push(rec);
    spec.onPhase('building');
    if (over.hold) await over.hold;
    if (over.fail) throw new Error(over.fail);
    return {
      url: 'http://127.0.0.1:8301/',
      appPort: 8301,
      pid: 4242,
      commit: spec.commit,
      dbName: `fx_${spec.purpose}_abc123`,
      logFile: 'x.log',
      runtimeLog: 'runtime.log',
      timing: { ms: 1, phases: {} },
      alive: () => !rec.stopped,
      freshDatabase: async () => undefined,
      stop: async () => void (rec.stopped = true),
      workspace: path.join('data', 'testing', 'work', spec.floorId, `instance-${spec.purpose}`),
    };
  };
  return { booted, boot };
}

function service(root: string, over: Partial<ConstructorParameters<typeof AgentApps>[0]> = {}) {
  const fb = fakeBoot();
  const killed: number[] = [];
  let free = 8 * 1024 ** 3;
  let now = 1_000_000;
  const apps = new AgentApps({
    dataDir: root,
    floorDir: (id) => (id === 'shop' || id === 'crm' ? root : undefined),
    boot: fb.boot,
    users: async () => [{ user: 'demo_clerk', role: 'default' }],
    freeMemory: async () => free,
    now: () => now,
    leftovers: { list: async () => [], kill: (p) => void killed.push(p) },
    ...over,
  });
  return { apps, fb, killed, setFree: (n: number) => (free = n), tick: (ms: number) => (now += ms) };
}

test('an agent gets one instance: started, ready with its URL and users, the same commit reused, another commit replaces it', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-app-'));
  try {
    const s = service(root);
    const first = await s.apps.start('shop', { id: 'w1', name: 'Rhea' }, SHA_A);
    assert.ok(typeof first !== 'string');
    assert.equal(first.state, 'starting');
    await s.apps.all()[0].started;
    const v = s.apps.view('shop', 'w1')!;
    assert.equal(v.state, 'ready');
    assert.equal(v.url, 'http://127.0.0.1:8301/');
    assert.deepEqual(v.users, [{ user: 'demo_clerk', role: 'default' }]);
    assert.match(viewLine(v, 1_000_000), /ready at http:\/\/127\.0\.0\.1:8301\/ .*demo_clerk/);
    assert.match(String(v.seed), /after-startup microflow/);
    // The same commit again: the same instance, nothing booted.
    await s.apps.start('shop', { id: 'w1', name: 'Rhea' }, SHA_A);
    assert.equal(s.fb.booted.length, 1);
    // Its own purpose (folder and database names): per agent, never the live app's.
    assert.equal(s.fb.booted[0].spec.purpose, purposeOf('w1'));
    assert.match(purposeOf('w1'), /^ag[0-9a-f]{6}$/);
    // Another commit: the first one is stopped, a new one boots. Never two for one agent.
    await s.apps.start('shop', { id: 'w1', name: 'Rhea' }, SHA_B);
    assert.equal(s.fb.booted[0].stopped, true);
    assert.equal(s.fb.booted.length, 2);
    assert.equal(s.apps.all().filter((e) => e.state === 'starting' || e.state === 'ready').length, 1);
    await s.apps.all()[0].started;
    assert.equal(s.apps.view('shop', 'w1')!.commit, SHA_B);
    // What runs is on disk, for an office that crashes.
    const live = JSON.parse(readFileSync(path.join(root, 'agent-apps', 'live.json'), 'utf8'));
    assert.equal(live.length, 1);
    assert.equal(live[0].pid, 4242);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refused with the reason: not enough memory, and the office-wide limit', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-app-'));
  try {
    const s = service(root, { max: 2 });
    s.setFree(1.2 * 1024 ** 3);
    const r = await s.apps.start('shop', { id: 'w1', name: 'Rhea' }, SHA_A);
    assert.equal(typeof r, 'string');
    assert.match(String(r), /Not enough memory .*1\.2 GB free, and one needs about 2\.5 GB/);
    assert.equal(s.fb.booted.length, 0, 'never started to fail later');
    assert.equal(r, memoryWords(1.2 * 1024 ** 3));
    s.setFree(8 * 1024 ** 3);
    assert.ok(typeof (await s.apps.start('shop', { id: 'w1', name: 'Rhea' }, SHA_A)) !== 'string');
    assert.ok(typeof (await s.apps.start('crm', { id: 'w2', name: 'Maya' }, SHA_A)) !== 'string');
    const third = await s.apps.start('shop', { id: 'w3', name: 'Carl' }, SHA_B);
    assert.match(String(third), /at most 2 agents' app instances at once .*Rhea @aaaaaaa.*Maya @aaaaaaa/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stops by itself when unused or past its limit; stop ends the tree and anything naming its workspace', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-app-'));
  try {
    const listed: string[][] = [];
    const s = service(root, {
      idleMs: 15 * 60_000,
      maxMs: 60 * 60_000,
      leftovers: {
        list: async () => [
          { pid: 777, cmd: `node "${path.join(root, 'data', 'testing', 'work', 'shop', `instance-${purposeOf('w1')}`, 'deployment', 'web', 'rollup-runner.js')}"` },
          { pid: 778, cmd: `node "${path.join(root, 'data', 'testing', 'work', 'shop', `instance-${purposeOf('w1')}9`, 'x.js')}"` },
        ],
        kill: (p) => void listed.push([String(p)]),
      },
    });
    await s.apps.start('shop', { id: 'w1', name: 'Rhea' }, SHA_A);
    const e = s.apps.all()[0];
    await e.started;
    // The workspace the fake names is relative to cwd: point it at root for the matcher.
    e.workspace = path.join(root, 'data', 'testing', 'work', 'shop', `instance-${purposeOf('w1')}`);
    s.tick(10 * 60_000);
    await s.apps.tick();
    assert.equal(s.apps.view('shop', 'w1', false)!.state, 'ready', '10 minutes: still there');
    s.tick(16 * 60_000);
    await s.apps.tick();
    const v = s.apps.view('shop', 'w1')!;
    assert.equal(v.state, 'stopped');
    assert.match(String(v.why), /unused for 15 minutes/);
    assert.equal(s.fb.booted[0].stopped, true, 'its process tree ended (app-instance stop)');
    assert.deepEqual(listed, [['777']], 'the leftover under its workspace is killed; instance-…9 is a different folder');
    assert.match(String(s.apps.ready('shop', 'w1')), /no running app instance .*unused for 15 minutes/);
    // The hard limit, even while used.
    await s.apps.start('shop', { id: 'w1', name: 'Rhea' }, SHA_B);
    await s.apps.all()[0].started;
    for (let i = 0; i < 7; i++) {
      s.tick(10 * 60_000);
      s.apps.view('shop', 'w1');
      await s.apps.tick();
    }
    assert.match(String(s.apps.view('shop', 'w1')!.why), /60-minute limit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a start that fails says why and leaves nothing; a crashed office is cleaned up at the next start', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-app-'));
  try {
    const bad = fakeBoot({ fail: 'Building: mxbuild found 2 errors (see the log)' });
    const s = service(root, { boot: bad.boot });
    await s.apps.start('shop', { id: 'w1', name: 'Rhea' }, SHA_A);
    await s.apps.all()[0].started;
    assert.equal(s.apps.view('shop', 'w1')!.state, 'failed');
    assert.match(viewLine(s.apps.view('shop', 'w1')), /didn't start: Building: mxbuild found 2 errors/);
    // A record an earlier office left: its mxcli tree, what names its workspace, its databases.
    const ws = path.join(root, 'old-ws');
    mkdirSync(path.join(root, 'agent-apps'), { recursive: true });
    writeFileSync(path.join(root, 'agent-apps', 'live.json'), JSON.stringify([{ floorId: 'shop', workerId: 'w9', purpose: 'ag000009', workspace: ws, pid: 5150 }]));
    const killed: number[] = [];
    const dropped: string[] = [];
    const r = new AgentApps({
      dataDir: root,
      floorDir: () => root,
      boot: bad.boot,
      dropDatabases: async (f, p) => void dropped.push(`${f}/${p}`),
      leftovers: { list: async () => [{ pid: 5150, cmd: 'C:\\tools\\mxcli.exe run --local -p App.mpr' }, { pid: 5151, cmd: `java -jar "${ws}/deployment/runtime.jar"` }, { pid: 99, cmd: 'C:\\tools\\mxcli.exe run --local -p Other.mpr' }], kill: (p) => void killed.push(p) },
    });
    const said = await r.recover();
    assert.deepEqual(killed.sort(), [5150, 5151]);
    assert.deepEqual(dropped, ['shop/ag000009']);
    assert.match(said[0], /1 mxcli tree, 1 process naming its workspace/);
    assert.equal(readFileSync(path.join(root, 'agent-apps', 'live.json'), 'utf8').trim(), '[]');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the whole-path matcher: the folder or below it, never a sibling that starts the same', async () => {
  assert.ok(namesDir('node "C:\\data\\work\\shop\\instance-ag1\\deployment\\web\\rollup.js"', 'C:\\data\\work\\shop\\instance-ag1'));
  assert.ok(namesDir('java -cp C:/data/work/shop/instance-ag1 x', 'C:\\data\\work\\shop\\instance-ag1'));
  assert.ok(!namesDir('node C:\\data\\work\\shop\\instance-ag12\\x.js', 'C:\\data\\work\\shop\\instance-ag1'));
  assert.ok(!namesDir('mxcli run --local -p App.mpr', 'C:\\data\\work\\shop\\instance-ag1'));
  const killed: number[] = [];
  const hits = await killLeftovers(['/srv/work/a'], { list: async () => [{ pid: 1, cmd: 'node /srv/work/a/x.js' }, { pid: 2, cmd: 'node /srv/work/ab/x.js' }], kill: (p) => void killed.push(p) });
  assert.deepEqual(killed, [1]);
  assert.equal(hits.length, 1);
});

/** A floor repo with a journey at a commit, an instance on it, and a runtime log the fake recorder writes to. */
function journeyRig() {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-journey-'));
  const repo = path.join(root, 'repo');
  mkdirSync(path.join(repo, 'tests', 'e2e'), { recursive: true });
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: repo, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'tests', 'e2e', 'J-01.journey.json'), JSON.stringify({ id: 'J-01', title: 'Open the amounts', requirement: ['UC001'], steps: [{ name: 'Open amounts', goto: '/p/amount', expectText: ['Total'] }] }));
  g('add', '-A');
  g('commit', '-qm', 'journey');
  const sha = g('rev-parse', 'HEAD');
  const log = path.join(root, 'runtime.log');
  writeFileSync(log, '2026-10-26 10:00:00.000 INFO - Core: started\n');
  const e = {
    floorId: 'shop',
    workerId: 'w1',
    worker: 'Rhea',
    commit: sha,
    purpose: 'ag111111',
    workspace: path.join(root, 'ws'),
    state: 'ready' as const,
    startedAt: 0,
    lastUsed: 0,
    abort: new AbortController(),
    started: Promise.resolve(),
    instance: { url: 'http://127.0.0.1:8301/', runtimeLog: log } as Booted,
  };
  return { root, repo, sha, log, e };
}

const fakeLaunch = async () => ({ newContext: async () => ({}) as never, close: async () => undefined });

test('a journey on the instance: recorded against its commit; a runtime error in the log is a failed check with its line', async () => {
  const r = journeyRig();
  try {
    let signedIn = 0;
    const record = async (i: { url: string; sessions?: { close(): Promise<void> }; login?: { user: string } }) => {
      signedIn++;
      // The page "worked" on screen, but the runtime logged the formatDecimal error while it rendered.
      writeFileSync(r.log, `2026-10-26 10:00:01.000 ERROR - Client: An error occurred while handling the request\ncom.mendix.webui.WebUIException: Operator formatDecimal not supported in expression formatDecimal() (MyFirstModule.Amount_Web.txtTotal)\n\tat x.y(Z.java:1)\n`, { flag: 'a' });
      return { status: 'passed' as const, steps: [{ n: 1, caption: 'Open amounts', status: 'passed' as const }], durationMs: 5 };
    };
    const d = { dataDir: r.root, floorDir: r.repo, mxcliVersion: 'nightly-x', record: record as never, runnerConfig: async () => ({ user: 'demo_clerk', pass: 'x', roles: [] }), launch: fakeLaunch as never };
    const o = await runJourney(r.e as never, { journey: 'J-01' }, d);
    assert.equal(signedIn, 1);
    assert.equal(o.status, 'failed');
    assert.equal(o.suite, 'journey J-01');
    assert.equal(o.signedOut, true, 'signed out after the journey');
    assert.match(o.runtimeErrors![0], /ERROR - Client: An error occurred .* — com\.mendix\.webui\.WebUIException: Operator formatDecimal not supported/);
    assert.match(outcomeWords(o), /FAILED[\s\S]*runtime error \(failed check\): .*formatDecimal/);
    const recs = await testingStore(r.root, 'shop').all();
    assert.equal(recs.length, 1);
    const rec = recs[0];
    assert.equal(rec.source, 'office-journey');
    assert.equal(rec.testedRevision, r.sha, 'bound to the instance commit');
    assert.equal(rec.definitionRevision, r.sha, 'the journey came from that commit');
    assert.equal(rec.results[0].status, 'failed');
    assert.ok(rec.results.some((x) => /formatDecimal/.test(x.detail ?? '')));
    assert.equal(o.record, rec.id);
    // The live app's readiness and walkthroughs read it as J-01 at exactly that commit.
    assert.deepEqual(await journeyResults(r.root, 'shop', r.sha, ['J-01']), [{ journey: 'J-01', status: 'failed' }]);
    // A clean run passes, and the change's Checks say journeys passed at that commit.
    const clean = async () => ({ status: 'passed' as const, steps: [{ n: 1, caption: 'Open amounts', status: 'passed' as const }], durationMs: 5 });
    const ok = await runJourney(r.e as never, { journey: 'J-01' }, { ...d, record: clean as never });
    assert.equal(ok.status, 'passed');
    assert.deepEqual(await journeyResults(r.root, 'shop', r.sha, ['J-01']), [{ journey: 'J-01', status: 'passed' }]);
    const words = verificationFact({ state: 'candidate', revision: r.sha, checks: { candidate: r.sha, on: [{ revision: r.sha, name: 'journey J-01', verdict: 'passed' }], earlier: [], line: '' } }).words;
    assert.match(words, new RegExp(`Passed @${r.sha.slice(0, 7)}: 1 check; journeys passed at @${r.sha.slice(0, 7)} \\(J-01\\)`));
    // A file the agent sends (maybe uncommitted): recorded at the instance commit, its definition unknown.
    const sent = await runJourney(r.e as never, { file: 'tests/e2e/mine.journey.json', text: JSON.stringify({ id: 'J-09', steps: [{ goto: '/' }] }) }, { ...d, record: clean as never });
    assert.equal(sent.suite, 'journey J-09');
    assert.equal((await testingStore(r.root, 'shop').all()).at(-1)!.definitionRevision, 'unknown');
    // An unknown id says what's there.
    assert.match(String((await runJourney(r.e as never, { journey: 'J-77' }, d)).failure), /No journey J-77 at .*1 there/);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('the session cap is said plainly, and the run is a harness error, never a failed journey', async () => {
  const r = journeyRig();
  try {
    const record = async () => {
      writeFileSync(r.log, '2026-10-26 10:00:02.000 WARNING - WebUI: Maximum number of sessions exceeded! (You are currently using a trial license)\n', { flag: 'a' });
      return { status: 'error' as const, failure: { why: 'couldn\'t sign in as demo_clerk: still on the sign-in page' }, steps: [{ n: 1, caption: 'Open amounts', status: 'not-run' as const }], durationMs: 5 };
    };
    const o = await runJourney(r.e as never, { journey: 'J-01' }, { dataDir: r.root, floorDir: r.repo, record: record as never, runnerConfig: async () => undefined, launch: fakeLaunch as never });
    assert.equal(o.status, 'error');
    assert.match(String(o.sessionCap), /refused a new session .*only 6 sessions .*signs out after every journey/);
    const rec = (await testingStore(r.root, 'shop').all())[0];
    assert.equal(rec.results.length, 0);
    assert.match(String(rec.harnessError), /only 6 sessions/);
    assert.deepEqual(await journeyResults(r.root, 'shop', r.sha, ['J-01']), [], 'counts for no journey');
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('a smoke run that cannot sign in is said as such and recorded as not run', async () => {
  const r = journeyRig();
  try {
    const launch = async () => {
      throw new Error('browser: no Chromium here');
    };
    const o = await runSmoke(r.e as never, { paths: ['/p/amount'] }, { dataDir: r.root, floorDir: r.repo, launch: launch as never, runnerConfig: async () => undefined });
    assert.equal(o.status, 'error');
    assert.match(String(o.failure), /no Chromium/);
    assert.equal((await testingStore(r.root, 'shop').all())[0].suite, 'smoke');
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('runtime log parsing: ERROR and CRITICAL with their exception line; warnings and the session cap are not errors', () => {
  const text = [
    '2026-10-26 10:00:00.000 INFO - Core: fine',
    '2026-10-26 10:00:01.000 WARNING - Core: Maximum number of sessions exceeded!',
    '2026-10-26 10:00:02.000 ERROR - Connector: something broke',
    'java.lang.IllegalStateException: Operator not supported',
    '\tat a.b(C.java:1)',
    '2026-10-26 10:00:03.000 CRITICAL - Core: out of memory',
  ].join('\n');
  const errs = runtimeErrorsIn(text);
  assert.equal(errs.length, 2);
  assert.equal(runtimeErrorWords(errs[0]), '2026-10-26 10:00:02.000 ERROR - Connector: something broke — java.lang.IllegalStateException: Operator not supported');
  assert.match(errs[1].line, /CRITICAL/);
  // The shape a failing page data source logs (measured on a sample app, Mendix 11.12.2): the cause chain without frames.
  const ds = [
    "2026-10-26 19:15:05.911 ERROR - Connector: An error has occurred while handling the request.: Exception while retrieving data for 'M.Amount_Web.dvAmount'",
    "com.mendix.webui.WebUIException: Exception while retrieving data for 'M.Amount_Web.dvAmount'",
    '\tat com.mendix.x(Y.java:1)',
    'Caused by: com.mendix.modules.microflowengine.MicroflowException: Failed to evaluate expression, error occurred on line 1, character 1',
    "parseDecimal('12,50 SGD')",
    '^',
    '\t... 41 more',
    'Advanced stacktrace:',
    'Caused by: java.lang.NumberFormatException: Character , is neither a decimal digit number',
  ].join('\n');
  assert.equal(runtimeErrorWords(runtimeErrorsIn(ds)[0]), "2026-10-26 19:15:05.911 ERROR - Connector: An error has occurred while handling the request.: Exception while retrieving data for 'M.Amount_Web.dvAmount' — com.mendix.modules.microflowengine.MicroflowException: Failed to evaluate expression, error occurred on line 1, character 1 — parseDecimal('12,50 SGD') — java.lang.NumberFormatException: Character , is neither a decimal digit number");
});

test('the command and the MCP tools: office-app parses, HEAD is resolved here, the tools are served and allowed without a prompt', () => {
  assert.deepEqual(parseApp(['start', '--commit', 'main']).commit, 'main');
  assert.equal(parseApp(['journey', 'run', 'J-12']).journey, 'J-12', 'office-journey run J-12');
  assert.deepEqual(parseApp(['smoke', '--page', '/p/a', '--page=/p/b', '--as', 'demo_clerk']).pages, ['/p/a', '/p/b']);
  assert.equal(parseApp(['test', '--no-wait']).wait, false);
  assert.throws(() => parseApp(['journey']), /one journey/);
  assert.throws(() => parseApp(['launch']), /Unknown command/);
  const calls: string[][] = [];
  const r = revOf(undefined, '.', (a: string[]) => (calls.push(a), a[0] === 'rev-parse' ? SHA_A : ' M app.mpr'));
  assert.equal(r.commit, SHA_A);
  assert.match(String(r.note), /uncommitted changes: the instance runs the committed aaaaaaa without them/);
  assert.equal(revOf('main', '.').commit, 'main');
  for (const t of APP_TOOL_NAMES) {
    assert.ok(TOOLS.some((x: { name: string }) => x.name === t), `${t} served by office-workers mcp`);
    assert.ok(MCP_ALLOWED.includes(`mcp__agent-office__${t}`), `${t} never asks the Project Manager`);
  }
});

test('the Playbook rule: builders and testers run the app at their candidate before saying done', () => {
  const dev = runtimeLines('lead-developer').join('\n');
  assert.match(dev, new RegExp(RUNTIME_HEADING));
  assert.match(dev, /office-app start --commit HEAD/);
  assert.match(dev, /"Not measured" is no longer acceptable/);
  assert.match(dev, /Never `mxcli run --local` or `mxcli test --local`/);
  assert.ok(runtimeLines('lead-tester').length > 0);
  assert.ok(runtimeLines('solo-lead').length > 0);
  assert.deepEqual(runtimeLines('chief-analyst'), []);
  assert.ok(runtimeLines('pm', ['lead-developer']).length > 0, 'whoever covers Development');
});
