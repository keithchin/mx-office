// The live app's served revision (CF0): the commit actually running and answering (`served`) is kept apart
// from the one it's getting, building or starting (`target`), so nothing names a version that isn't
// serving. Through a start, an update that builds, an update whose build fails, a start that never answers,
// an update that fails before the running build is stopped (it keeps serving), an office restart (nothing
// runs, only `lastServed`), readiness judged against the served commit only, Design captures stamped with
// it (refused mid-update), and the words on the page. Synthetic repos and a fake mxcli; no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LiveApp } from '../src/server/liveapp/app.js';
import { LIVE_APP_DEFAULTS } from '../src/server/liveapp/config.js';
import { LiveApps } from '../src/server/liveapp/index.js';
import { readLastServed, writeServed } from '../src/server/liveapp/served.js';
import { DesignService, type DesignDeps } from '../src/server/design/service.js';
import { liveNeeds, liveStatus, revisionLine } from '../src/shared/liveapp/status.js';
import { liveWord } from '../src/shared/start.js';
import type { LiveAppState } from '../src/shared/protocol.js';
import type { Floor } from '../src/server/floor.js';
import { PLAN } from './fixtures/liveapp/plan.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'liveapp-s-'));
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
const short = (sha: string) => sha.slice(0, 7);

/**
 * Stands in for `mxcli run --local …`: says it builds, then that the runtime starts, then serves --app-port
 * with version.txt. fail.txt: the build fails (every time); hang.txt: the runtime never answers; slow.txt:
 * the build takes 1.5 s.
 */
const FAKE_MXCLI = `const fs = require('fs');
const port = Number(process.argv[process.argv.indexOf('--app-port') + 1]);
console.log('Building the project…');
if (fs.existsSync('fail.txt')) { console.log('Error: the build failed (fail.txt)'); process.exit(1); }
const later = fs.existsSync('slow.txt') ? 1500 : 0;
setTimeout(() => {
  console.log('Starting the Mendix runtime…');
  if (fs.existsSync('hang.txt')) return setInterval(() => {}, 1000);
  require('http').createServer((q, s) => s.end('fake app ' + fs.readFileSync('version.txt', 'utf8'))).listen(port, () => console.log('Runtime started'));
}, later);`;

async function until(what: string, fn: () => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const get = (port: number) =>
  new Promise<string>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });

function repos(dir: string) {
  const origin = path.join(dir, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(origin, 'App.mpr'), '');
  writeFileSync(path.join(origin, 'run'), FAKE_MXCLI);
  writeFileSync(path.join(origin, 'version.txt'), 'one');
  git(origin, 'add', '.');
  git(origin, 'commit', '-q', '-m', 'Starter app');
  const floorDir = path.join(dir, 'floor');
  git(dir, 'clone', '-q', origin, floorDir);
  return { origin, floorDir };
}

/** A commit on origin, pulled into the floor's folder; its sha. */
function land(origin: string, floorDir: string, files: Record<string, string | null>, msg: string): string {
  for (const [f, text] of Object.entries(files)) {
    const p = path.join(origin, f);
    if (text === null) rmSync(p, { force: true });
    else {
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    }
  }
  git(origin, 'add', '-A');
  git(origin, 'commit', '-q', '-m', msg);
  git(floorDir, 'pull', '-q');
  return git(origin, 'rev-parse', 'HEAD');
}

function liveApp(dir: string, floorDir: string, ports: { from: number; to: number }, states: LiveAppState[], readyTimeoutMs = 30_000) {
  return new LiveApp({ cfg: { ...LIVE_APP_DEFAULTS, ports, readyTimeoutMs }, mxcli: process.execPath, floorId: 'demo', floorDir, liveDir: path.join(dir, 'live'), taken: () => new Set(), changed: (s) => states.push(s) });
}

/** No state ever calls a commit served that isn't the one answering: served only once it came up, never the target. */
function honest(states: LiveAppState[]) {
  for (const s of states) {
    if (s.served && s.target) assert.notEqual(s.served.sha, s.target.sha, 'served and target are never the same commit while on the way');
    if (s.status === 'failed' || s.status === 'stopped') assert.equal(s.served, undefined, `nothing serves when ${s.status}`);
  }
}

test('served vs target: a start, an update that builds, and the served file for after a restart', { timeout: 120_000 }, async () => {
  const dir = tmp();
  const { origin, floorDir } = repos(dir);
  const states: LiveAppState[] = [];
  const app = liveApp(dir, floorDir, { from: 8400, to: 8414 }, states);
  try {
    const first = git(origin, 'rev-parse', 'HEAD');
    await app.start('Probe');
    await until('running', () => app.status === 'running');
    const building = states.filter((s) => s.status === 'starting');
    assert.ok(building.length && building.every((s) => !s.served), 'nothing is called running while it builds');
    assert.ok(building.some((s) => s.target?.sha === first && s.phase === 'building'), 'building the target');
    assert.ok(building.some((s) => s.phase === 'starting'), 'mxcli said the runtime starts: phase starting');
    assert.equal(app.state.served?.sha, first);
    assert.equal(app.state.target, undefined);
    assert.equal(app.state.phase, 'running');
    assert.equal(revisionLine(app.state), `Running ${short(first)}`);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'live', 'demo.served.json'), 'utf8')).sha, first);

    // Main moves (a slow build, so every step is seen): the old build keeps serving until it has to stop.
    const second = land(origin, floorDir, { 'version.txt': 'two', 'slow.txt': 'x' }, 'Merge pull request #2');
    states.length = 0;
    await app.follow(second);
    await until('running the second', () => app.status === 'running' && app.state.served?.sha === second);
    const updating = states.filter((s) => s.status === 'updating');
    assert.ok(updating.length, 'it updated');
    assert.ok(updating.some((s) => s.served?.sha === first && s.target?.sha === second), 'first: running the old one, updating to the new one');
    assert.ok(updating.some((s) => !s.served && s.lastServed?.sha === first && s.target?.from === first), 'then: the old one stopped for the build, said as nothing running');
    assert.ok(!updating.some((s) => s.served?.sha === second), 'the new commit is never served before it answers');
    assert.equal(revisionLine(updating.find((s) => s.served)!), `Running ${short(first)} · updating to ${short(second)}…`);
    assert.equal(revisionLine(updating.find((s) => !s.served && s.target)!), `Updating to ${short(second)}… · nothing running (${short(first)} stopped for the build)`);
    assert.equal(await get(app.state.appPort!), 'fake app two');
    assert.equal(app.state.lastServed, undefined, 'serving again: no "last served"');
    honest(states);
  } finally {
    await app.stop('Probe');
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('served vs target: an update whose build fails says nothing runs; a start that never answers names its target', { timeout: 120_000 }, async () => {
  const dir = tmp();
  const { origin, floorDir } = repos(dir);
  const states: LiveAppState[] = [];
  const app = liveApp(dir, floorDir, { from: 8415, to: 8429 }, states, 4_000);
  try {
    const first = git(origin, 'rev-parse', 'HEAD');
    await app.start('Probe');
    await until('running', () => app.status === 'running');
    const broken = land(origin, floorDir, { 'fail.txt': 'x' }, 'A change that does not build');
    await app.follow(broken);
    await until('failed', () => app.status === 'failed');
    const f = app.state.failure!;
    assert.equal(f.kind, 'build');
    assert.equal(f.sha, broken, 'the failure names the commit that failed');
    assert.equal(app.state.served, undefined, 'the old build was stopped for the build: nothing serves');
    assert.equal(app.state.lastServed?.sha, first, 'what ran last is still named');
    assert.equal(app.state.target?.sha, broken);
    assert.equal(revisionLine(app.state), `Update to ${short(broken)} failed · nothing running`);
    assert.match(liveNeeds(app.state, 'demo')[0].text, new RegExp(`Update to ${short(broken)} failed · nothing running$`));
    honest(states);

    // A start whose runtime never answers: given up on, naming the commit it was starting.
    const hung = land(origin, floorDir, { 'fail.txt': null, 'hang.txt': 'x' }, 'A runtime that never answers');
    await app.restart('Probe');
    await until('gave up', () => app.status === 'failed' && app.state.failure?.kind === 'timeout', 30_000);
    assert.equal(app.state.failure!.sha, hung);
    assert.equal(app.state.served, undefined);
    assert.equal(revisionLine(app.state), `Build of ${short(hung)} failed · nothing running`);
    assert.match(liveStatus(app.state).word, /^didn't come up/);
    honest(states);
  } finally {
    await app.stop('Probe');
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('an update that fails before the running build is stopped: it keeps serving, said as "still running", not retried every minute', { timeout: 120_000 }, async () => {
  const dir = tmp();
  const { origin, floorDir } = repos(dir);
  const states: LiveAppState[] = [];
  const app = liveApp(dir, floorDir, { from: 8430, to: 8444 }, states);
  try {
    const first = git(origin, 'rev-parse', 'HEAD');
    await app.start('Probe');
    await until('running', () => app.status === 'running');
    const port = app.state.appPort!;
    // The project's folder loses its main: the fetch fails, before anything was stopped.
    git(floorDir, 'checkout', '-q', '--detach');
    git(floorDir, 'update-ref', '-d', 'refs/remotes/origin/main');
    git(floorDir, 'update-ref', '-d', 'refs/heads/main');
    const head = 'abcdef0123456789abcdef0123456789abcdef01';
    await app.follow(head);
    await until('back to running', () => app.status === 'running' && app.state.failure?.kind === 'update');
    assert.equal(app.state.served?.sha, first, 'the old build still serves');
    assert.equal(app.state.failure!.sha, head);
    assert.match(app.state.failure!.why, /has no main branch/);
    assert.equal(await get(port), 'fake app one', 'and it still answers');
    assert.equal(revisionLine(app.state), `Update to ${short(head)} failed · still running ${short(first)}`);
    assert.equal(liveStatus(app.state).word, 'running · update failed');
    const rows = liveNeeds(app.state, 'demo');
    assert.equal(rows[0].key, `live-update@${app.state.failure!.at}`);
    assert.match(rows[0].text, new RegExp(`Still running main @${short(first)}`));
    const before = states.length;
    await app.follow(head);
    assert.equal(states.length, before, 'the same failed update is not tried again by itself');
    honest(states);
  } finally {
    await app.stop('Probe');
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('office restart: nothing is served until started, what ran last is only "last served"; a record without an end claims only its start', { timeout: 120_000 }, async () => {
  const dir = tmp();
  const { origin, floorDir } = repos(dir);
  const app = liveApp(dir, floorDir, { from: 8445, to: 8449 }, []);
  const first = git(origin, 'rev-parse', 'HEAD');
  try {
    await app.start('Probe');
    await until('running', () => app.status === 'running');
    await app.shutdown();
    const again = liveApp(dir, floorDir, { from: 8445, to: 8449 }, []);
    const s = again.state;
    assert.equal(s.status, 'stopped');
    assert.equal(s.served, undefined, 'never served from before the restart');
    assert.equal(s.lastServed?.sha, first);
    assert.ok(s.lastServed!.until >= s.lastServed!.builtAt);
    assert.match(revisionLine(s), new RegExp(`^Nothing running · last ran ${short(first)} until \\d`));
    assert.equal(liveStatus(s).word, 'not started');
    // The office ended without its shutdown: the record has no end, so it says only when it came up.
    writeServed(path.join(dir, 'live'), 'demo', { sha: first, builtAt: 1000 });
    assert.deepEqual(readLastServed(path.join(dir, 'live'), 'demo'), { sha: first, builtAt: 1000, until: 1000 });
    writeFileSync(path.join(dir, 'live', 'demo.served.json'), '{"sha":"not a sha","builtAt":1}');
    assert.equal(readLastServed(path.join(dir, 'live'), 'demo'), undefined, 'junk is nothing');
  } finally {
    await app.stop('Probe');
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('readiness is judged against the served commit only, never the one being built', { timeout: 120_000 }, async () => {
  const dir = tmp();
  const { origin, floorDir } = repos(dir);
  const dataDir = path.join(dir, 'data');
  mkdirSync(dataDir);
  writeFileSync(path.join(dataDir, 'live-app.json'), JSON.stringify({ mxcli: process.execPath, ports: '8450-8469' }));
  land(origin, floorDir, { 'architecture/build-plan.md': PLAN }, 'Stage 4: build plan');
  const floor = { id: 'demo', dir: floorDir, github: { pulls: { items: [] } } } as unknown as Floor;
  const sent: LiveAppState[] = [];
  const ctx = { cfg: { dataDir }, floors: new Map([['demo', floor]]), toFloor: (_f: Floor, m: { t: string; state: LiveAppState }) => sent.push(m.state) };
  const apps = new LiveApps(ctx as never);
  const app = apps.of(floor);
  try {
    // Before anything ran, the tab shows what served before a restart (none here) and is not running.
    assert.equal(apps.stateOf(floor).served, undefined);
    await app.start('Probe');
    await until('running', () => app.status === 'running');
    const first = app.state.served!.sha;
    await until('read', () => apps.peek('demo')?.readiness?.sha === first);
    const second = land(origin, floorDir, { 'version.txt': 'two', 'slow.txt': 'x' }, 'Merge pull request #3');
    sent.length = 0;
    await app.follow(second);
    await until('running the second', () => app.status === 'running' && app.state.served?.sha === second);
    await until('read the second', () => apps.peek('demo')?.readiness?.sha === second);
    for (const s of sent) {
      if (s.readiness?.sha === second) assert.equal(s.served?.sha, second, 'readiness names the new commit only once it serves');
      if (!s.served && s.readiness) assert.notEqual(s.readiness.sha, second);
    }
    assert.ok(sent.some((s) => s.status === 'updating' && !s.served && s.readiness && !s.readiness.sha), 'while nothing serves, readiness judges no commit');
  } finally {
    await apps.shutdown();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('Design captures: stamped with the served revision, refused while it updates, a shot taken as an update starts is thrown away', async (t) => {
  const root = tmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const A = 'aaaaaaa1111111111111111111111111111111111';
  let live: ReturnType<DesignDeps['live']> = { running: false, status: 'updating', updating: true };
  let shots = 0;
  let flipAt = 0;
  const deps: DesignDeps = {
    dataDir: path.join(root, 'data'),
    floors: () => [{ id: 'f1', name: 'p', dir: root }],
    clientOf: () => undefined,
    clientLabel: () => undefined,
    mxcli: () => 'mxcli',
    live: () => live,
    audit: () => undefined,
    now: () => 1_000 + shots,
    shooter: async () => {
      shots++;
      if (shots === flipAt) live = { running: false, status: 'updating', updating: true };
      return Buffer.from('png');
    },
  };
  const s = new DesignService(deps);
  assert.match(String(await s.capture('f1', 'Ada')), /^The live app is updating: try again in a moment/);
  assert.equal(shots, 0, 'nothing shot mid-update');
  live = { running: true, status: 'running', url: 'http://127.0.0.1:1/', sha: A };
  assert.equal(await s.capture('f1', 'Ada'), 2);
  let list = await s.captures.list('f1');
  assert.deepEqual(list.map((c) => c.appSha), [A, A]);
  // An update starts during the second shot: that one is never written.
  flipAt = shots + 2;
  assert.match(String(await s.capture('f1', 'Ada')), new RegExp(`^The live app started updating during the capture: kept 1 screenshot taken at ${short(A)}`));
  list = await s.captures.list('f1');
  assert.equal(list.length, 3);
  assert.ok(list.every((c) => c.appSha === A));
  assert.ok(existsSync(path.join(root, 'data')));
});

test('the words: running against updating, failed with or without the old build, Home', () => {
  const base: LiveAppState = { floor: 'f1', status: 'running', log: [], available: true, branch: 'main' };
  const a = 'abc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const d = 'def5678ddddddddddddddddddddddddddddddddd';
  const served = { sha: a, builtAt: 1 };
  assert.equal(revisionLine({ ...base, served }), 'Running abc1234');
  assert.equal(revisionLine({ ...base, status: 'updating', phase: 'building', served, target: { sha: d, from: a } }), 'Running abc1234 · updating to def5678…');
  assert.equal(revisionLine({ ...base, status: 'updating', phase: 'building', target: { sha: d, from: a } }), 'Updating to def5678… · nothing running (abc1234 stopped for the build)');
  assert.equal(revisionLine({ ...base, status: 'starting', phase: 'building', target: { sha: d } }), 'Building def5678… · nothing running');
  assert.equal(revisionLine({ ...base, status: 'starting', phase: 'starting', target: { sha: d } }), 'Starting def5678… · nothing running');
  assert.equal(revisionLine({ ...base, status: 'starting', phase: 'building', served, target: { sha: a, from: a } }), 'Running abc1234 · restarting abc1234…');
  assert.equal(revisionLine({ ...base, served, failure: { kind: 'update', at: 1, why: 'x', lines: [], sha: d } }), 'Update to def5678 failed · still running abc1234');
  assert.equal(revisionLine({ ...base, status: 'failed', target: { sha: d, from: a }, failure: { kind: 'build', at: 1, why: 'x', lines: [], sha: d } }), 'Update to def5678 failed · nothing running');
  assert.equal(revisionLine({ ...base, status: 'failed', failure: { kind: 'crash', at: 1, why: 'x', lines: [], sha: a } }), 'abc1234 stopped by itself · nothing running');
  assert.equal(revisionLine({ ...base, status: 'stopped' }), '');
  assert.equal(liveStatus({ ...base, status: 'starting', phase: 'building' }).word, 'building…');
  assert.equal(liveStatus({ ...base, status: 'starting', phase: 'starting' }).word, 'starting…');
  assert.equal(liveStatus({ ...base, status: 'updating', target: { sha: d } }).word, 'updating to def5678…');
  assert.deepEqual(liveWord({ status: 'running', viewPort: 9, served: 'abc1234' }), { text: 'Live app running abc1234', ready: true, tone: 'good' });
  assert.equal(liveWord({ status: 'running', viewPort: 9, served: 'abc1234', updateFailed: true }).text, 'Live app running abc1234 · update failed');
  assert.equal(liveWord({ status: 'updating', target: 'def5678' }).text, 'Live app updating to def5678… · nothing running');
  assert.equal(liveWord({ status: 'starting', target: 'def5678' }).text, 'Live app starting def5678… · nothing running');
  assert.equal(liveWord({ status: 'failed', target: 'def5678' }).text, 'Live app failed (def5678) · nothing running');
});
