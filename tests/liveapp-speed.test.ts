// Preview speed (server/liveapp/classify.ts, hot.ts, app.ts, shared/liveapp/speed.ts): an update is classified
// before it touches the running app (no app files: taken over without a restart; pages and logic: hot reload
// with mxcli's --watch; anything structural: a restart), a hot reload that doesn't confirm falls back to a
// restart with the served revision honest throughout, merges that land meanwhile go in as one update, and
// each update's phases are timed and said ("Updated in 9 s (hot reload)"). Synthetic repos, a made-up MPR
// and a fake mxcli; no GitHub, no real Mendix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LiveApp } from '../src/server/liveapp/app.js';
import { classifyUpdate } from '../src/server/liveapp/classify.js';
import { LIVE_APP_DEFAULTS } from '../src/server/liveapp/config.js';
import { watchLine } from '../src/server/liveapp/hot.js';
import { readPrefs, writePrefs } from '../src/server/liveapp/prefs.js';
import { warmFits, WARM_FREE_BYTES } from '../src/server/liveapp/warm.js';
import { ModelUnits } from '../src/server/model/units.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';
import { classifyChange, pathKind, phaseLine, updateLine, type ChangeClass } from '../src/shared/liveapp/speed.js';
import type { LiveAppPrefs, LiveAppState, LiveUpdate } from '../src/shared/protocol.js';
import { removeDir } from './support/cleanup.js';
import { hasSqlite, project, type MadeUnit } from './support/mendix.js';

test.after(() => stopExecWorker());

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
const short = (sha: string) => sha.slice(0, 7);

// ---- Classification ---------------------------------------------------------------------------------

test('classify: pages and logic are hot, a domain model or enumeration restarts, docs alone need nothing', () => {
  const mpr = ['mprcontents/ea/51/ea51.mxunit', 'App.mpr'];
  const page = classifyChange({ paths: mpr, prefix: '', units: [{ type: 'Forms$Page', name: 'Home', change: '~' }] });
  assert.equal(page.kind, 'hot');
  assert.equal(page.reason, 'page and logic changes');
  assert.deepEqual(page.touched, ['page Home']);
  assert.equal(classifyChange({ paths: mpr, prefix: '', units: [{ type: 'Microflows$Microflow', name: 'ACT_Save', change: '+' }] }).kind, 'hot');
  assert.equal(classifyChange({ paths: mpr, prefix: '', units: [{ type: 'Microflows$Nanoflow', name: 'NF_Go', change: '-' }, { type: 'Projects$Folder', name: 'New', change: '+' }] }).kind, 'hot');
  const entity = classifyChange({ paths: mpr, prefix: '', units: [{ type: 'Forms$Page', name: 'Home', change: '~' }, { type: 'DomainModels$DomainModel', name: '', change: '~' }, { type: 'Projects$Folder', name: 'QB', change: '+' }] });
  assert.deepEqual([entity.kind, entity.reason], ['restart', 'domain model changed']);
  assert.deepEqual(classifyChange({ paths: mpr, prefix: '', units: [{ type: 'Enumerations$Enumeration', name: 'Priority', change: '~' }] }).reason, 'enumeration changed');
  assert.deepEqual(classifyChange({ paths: mpr, prefix: '', units: [{ type: 'Security$ProjectSecurity', name: '', change: '~' }] }).reason, 'security changed');
  assert.deepEqual(classifyChange({ paths: mpr, prefix: '', units: [{ type: 'Constants$Constant', name: 'ApiUrl', change: '~' }, { type: 'DomainModels$DomainModel', name: '', change: '~' }] }).reason, 'domain model changed', 'the most telling reason first');
  assert.equal(classifyChange({ paths: mpr, prefix: '', units: [{ type: 'Some$NewKind', name: 'X', change: '~' }] }).kind, 'restart', 'a unit it does not know restarts');
  const docs = classifyChange({ paths: ['README.md', 'docs/plan.md', '.claude/journal/2026-10-22.md', 'evidence/run.json'], prefix: '', units: [] });
  assert.deepEqual([docs.kind, docs.reason], ['none', 'no app files changed']);
  assert.equal(classifyChange({ paths: ['theme/web/main.scss'], prefix: '', units: [] }).kind, 'hot');
  assert.deepEqual(classifyChange({ paths: ['javasource/shop/actions/Go.java'], prefix: '', units: [] }).reason, 'Java code changed');
  assert.deepEqual(classifyChange({ paths: ['widgets/Chart.mpk'], prefix: '', units: [] }).reason, 'widgets changed');
  assert.equal(classifyChange({ paths: ['notes.txt'], prefix: '', units: [] }).kind, 'restart', 'a file it does not know restarts');
  assert.deepEqual(classifyChange({ paths: mpr, prefix: '', units: null }).reason, "the model couldn't be read");
  assert.deepEqual(classifyChange({ paths: ['App.mpr'], prefix: '', units: [] }).reason, 'project file changed');
  // An app one folder down: what's beside it isn't the app.
  assert.equal(pathKind('README.md', 'App/').kind, 'none');
  assert.equal(pathKind('docs/x.md', 'App/').kind, 'none');
  assert.equal(pathKind('App/mprcontents/aa/bb/x.mxunit', 'App/').kind, 'model');
  assert.equal(pathKind('App/themesource/m/web/x.scss', 'App/').kind, 'hot');
  assert.equal(pathKind('App/resources/docs/help.md', 'App/').kind, 'restart', 'resources are packaged with the app, docs or not');
  assert.equal(pathKind('scripts/build.sh', 'App/').kind, 'restart');
});

test('classify: the units an update touched, read straight out of git (a made-up MPR v2 project)', { skip: !(await hasSqlite()) && 'no node:sqlite' }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-speed-units-'));
  const units = new ModelUnits(path.join(dir, '.cache'));
  t.after(() => {
    units.close();
    removeDir(dir);
  });
  const repo = path.join(dir, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  const flow = (caption: string) => ({ $Type: 'Microflows$Microflow', Name: 'ACT_Save', Caption: caption });
  const base = (caption: string, entity: string): MadeUnit[] => [
    { n: 1, container: 1, hash: 'p', doc: { $Type: 'Projects$Project' } },
    { n: 2, container: 1, hash: 'm', doc: { $Type: 'Projects$ModuleImpl', Name: 'Shop' } },
    { n: 4, container: 2, hash: caption, doc: flow(caption) },
    { n: 6, container: 2, hash: entity, doc: { $Type: 'DomainModels$DomainModel', Entities: [3, { $ID: 'e1', $Type: 'DomainModels$EntityImpl', Name: entity }] } },
  ];
  const commit = async (u: MadeUnit[] | null, msg: string, extra?: Record<string, string>) => {
    if (u) {
      rmSync(path.join(repo, 'mprcontents'), { recursive: true, force: true });
      await project(repo, u);
    }
    for (const [f, text] of Object.entries(extra ?? {})) {
      mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
      writeFileSync(path.join(repo, f), text);
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', msg);
    return git(repo, 'rev-parse', 'HEAD');
  };
  const a = await commit(base('Saving', 'Order'), 'v1');
  const b = await commit(base('Saving now', 'Order'), 'a microflow');
  const c = await commit(base('Saving now', 'Invoice'), 'an entity');
  const d = await commit(null, 'a note', { 'docs/notes.md': 'hi' });
  const hot = await classifyUpdate(repo, a, b, 'App.mpr', { units });
  assert.deepEqual([hot.kind, hot.touched], ['hot', ['microflow ACT_Save']]);
  assert.deepEqual(await classifyUpdate(repo, b, c, 'App.mpr', { units }), { kind: 'restart', reason: 'domain model changed', touched: ['DomainModels$DomainModel'] });
  assert.equal((await classifyUpdate(repo, c, d, 'App.mpr', { units })).kind, 'none');
  assert.equal((await classifyUpdate(repo, a, c, 'App.mpr', {})).reason, "the model couldn't be read", 'no model reader: any model change restarts');
  assert.match((await classifyUpdate(repo, a, 'f'.repeat(40), 'App.mpr', { units })).reason, /^couldn't compare the commits/);
});

test("watch lines: mxcli's words for a change detected, applied by reload, and a failed build", () => {
  assert.deepEqual(watchLine('Change detected, rebuilding (build #2)...'), { kind: 'detected', build: 2 });
  assert.deepEqual(watchLine('  build #2 applied via reload in 4.387s, client re-bundled (gen 2) -> http://127.0.0.1:8251/'), { kind: 'applied', how: 'reload', build: 2, secs: 4.387 });
  assert.deepEqual(watchLine("  build failed: The process cannot access the file 'C:\\x\\deployment\\web' because it is being used by another process."), { kind: 'failed', why: "The process cannot access the file 'C:\\x\\deployment\\web' because it is being used by another process." });
  assert.equal(watchLine('Watching model + theme source for changes (serving build #1; Ctrl-C to stop)...'), undefined);
  assert.equal(watchLine('App is running at http://127.0.0.1:8251/'), undefined);
});

test('the timing line: hot reload, restart and why, no restart, a cold start, a fallback, grouped merges', () => {
  const u = (o: Partial<LiveUpdate>): LiveUpdate => ({ mode: 'hot', reason: 'page and logic changes', ok: true, at: 0, totalMs: 9_200, phases: [], ...o });
  assert.equal(updateLine(u({})), 'Updated in 9 s (hot reload)');
  assert.equal(updateLine(u({ mode: 'restart', reason: 'domain model changed', totalMs: 41_000 })), 'Updated in 41 s (restart: domain model changed)');
  assert.equal(updateLine(u({ mode: 'none', reason: 'no app files changed', totalMs: 800 })), 'Updated in 0.8 s (no restart: no app files changed)');
  assert.equal(updateLine(u({ mode: 'cold', reason: 'cold start', totalMs: 62_000 })), 'Started in 62 s (cold start)');
  assert.equal(updateLine(u({ mode: 'restart', reason: 'restart asked for', totalMs: 95_000 })), 'Restarted in 1 min 35 s (restart asked for)');
  assert.equal(updateLine(u({ mode: 'restart', fallback: 'build failed: locked', totalMs: 48_000 })), "Updated in 48 s (restart: hot reload didn't confirm (build failed: locked), so it restarted)");
  assert.equal(updateLine(u({ mode: 'restart', reason: 'domain model changed', ok: false, totalMs: 30_000 })), 'Update failed after 30 s (restart: domain model changed)');
  assert.equal(updateLine(u({ commits: 3 })), 'Updated in 9 s (hot reload) · 3 commits in one go');
  assert.equal(phaseLine(u({ phases: [{ name: 'fetch', ms: 300 }, { name: 'classify', ms: 120 }, { name: 'apply', ms: 7_900 }, { name: 'answer', ms: 200 }] })), 'fetch 0.3 s · classify 0.1 s · apply 8 s · first answer 0.2 s');
  assert.equal(updateLine(undefined), '');
});

test('settings: hot reload follows the office default until the project says; keep warm is off unless asked, and fits memory', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-speed-prefs-'));
  try {
    assert.deepEqual(readPrefs(dir, 'demo', { hotReload: false }), { hotReload: false, keepWarm: false });
    assert.deepEqual(readPrefs(dir, 'demo', { hotReload: true }), { hotReload: true, keepWarm: false });
    assert.deepEqual(writePrefs(dir, 'demo', { keepWarm: true }, { hotReload: true }), { hotReload: true, keepWarm: true });
    assert.deepEqual(writePrefs(dir, 'demo', { hotReload: false }, { hotReload: true }), { hotReload: false, keepWarm: true });
    assert.deepEqual(readPrefs(dir, 'demo', { hotReload: true }), { hotReload: false, keepWarm: true });
    assert.equal(warmFits(WARM_FREE_BYTES, 16 * 1024 ** 3).ok, true);
    const no = warmFits(1024 ** 3, 8 * 1024 ** 3);
    assert.equal(no.ok, false);
    assert.match(no.why!, /1\.0 GB of 8\.0 GB memory free, and a live app needs about 2\.0 GB/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- The update loop, against a fake mxcli ------------------------------------------------------------

/**
 * Stands in for `mxcli run --local …`: builds, says the runtime starts, serves version.txt on --app-port.
 * With --watch it looks at version.txt every 100 ms and, on a change, says "Change detected, rebuilding
 * (build #n)..." then, after 300 ms, "build #n applied via reload in 0.3s" and serves the new text, or, when
 * hotfail.txt is in the checkout, "build failed: … being used by another process." and answers 404 from then
 * on (what QB0 saw on Windows). deaf.txt: the watch never reacts. slow.txt: the start takes 1.5 s.
 */
const FAKE_MXCLI = `const fs = require('fs');
const port = Number(process.argv[process.argv.indexOf('--app-port') + 1]);
const watch = process.argv.includes('--watch');
console.log('Building the project…');
let body = fs.readFileSync('version.txt', 'utf8');
let broken = false;
setTimeout(() => {
  console.log('Starting the Mendix runtime…');
  require('http').createServer((q, s) => { if (broken) { s.statusCode = 404; return s.end('gone'); } s.end('fake app ' + body); }).listen(port, () => {
    console.log('App is running at http://127.0.0.1:' + port + '/');
    if (!watch) return;
    console.log('Watching model + theme source for changes (serving build #1; Ctrl-C to stop)...');
    let seen = body, n = 1;
    setInterval(() => {
      let now;
      try { now = fs.readFileSync('version.txt', 'utf8'); } catch { return; }
      if (now === seen || broken || fs.existsSync('deaf.txt')) return;
      seen = now; n++;
      const b = n;
      console.log('Change detected, rebuilding (build #' + b + ')...');
      setTimeout(() => {
        if (fs.existsSync('hotfail.txt')) { broken = true; return console.log("  build failed: The process cannot access the file 'deployment\\\\web' because it is being used by another process."); }
        body = now;
        console.log('  build #' + b + ' applied via reload in 0.3s, client re-bundled (gen ' + b + ') -> http://127.0.0.1:' + port + '/');
      }, 300);
    }, 100);
  });
}, fs.existsSync('slow.txt') ? 1500 : 0);`;

async function until(what: string, fn: () => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const get = (port: number) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }));
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

function land(origin: string, floorDir: string, files: Record<string, string | null>, msg: string): string {
  for (const [f, text] of Object.entries(files)) {
    const p = path.join(origin, f);
    if (text === null) rmSync(p, { force: true });
    else writeFileSync(p, text);
  }
  git(origin, 'add', '-A');
  git(origin, 'commit', '-q', '-m', msg);
  git(floorDir, 'pull', '-q');
  return git(origin, 'rev-parse', 'HEAD');
}

/** A live app whose classifier says what `kinds` says for each target commit (default: restart). */
function liveApp(dir: string, floorDir: string, ports: { from: number; to: number }, states: LiveAppState[], prefs: LiveAppPrefs, kinds: Map<string, ChangeClass>, detectMs = 5_000) {
  return new LiveApp({
    cfg: { ...LIVE_APP_DEFAULTS, ports, readyTimeoutMs: 30_000 },
    mxcli: process.execPath,
    floorId: 'demo',
    floorDir,
    liveDir: path.join(dir, 'live'),
    taken: () => new Set(),
    changed: (s) => states.push(s),
    prefs: () => prefs,
    classify: async (_dir, _from, to) => kinds.get(to) ?? { kind: 'restart', reason: 'domain model changed', touched: [] },
    supportsWatch: async () => true,
    hotTimes: { detectMs, applyMs: 10_000 },
  });
}

/** How many times mxcli was started (each start logs its command line). */
const starts = (dir: string) => readFileSync(path.join(dir, 'live', 'demo.log'), 'utf8').split('\n').filter((l) => l.startsWith('$ mxcli run')).length;

/** Nothing is ever called served before it answers: never the target, never on a failed or stopped app. */
function honest(states: LiveAppState[]) {
  for (const s of states) {
    if (s.served && s.target) assert.notEqual(s.served.sha, s.target.sha, 'served and target are never the same commit while on the way');
    if (s.status === 'failed' || s.status === 'stopped') assert.equal(s.served, undefined, `nothing serves when ${s.status}`);
  }
}

const HOT: ChangeClass = { kind: 'hot', reason: 'page and logic changes', touched: ['page Home'] };

test('hot path: a page change goes into the running app by hot reload, no restart, served moved only once applied', { timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-speed-hot-'));
  const { origin, floorDir } = repos(dir);
  const states: LiveAppState[] = [];
  const kinds = new Map<string, ChangeClass>();
  const app = liveApp(dir, floorDir, { from: 8470, to: 8479 }, states, { hotReload: true, keepWarm: false }, kinds);
  t.after(async () => {
    await app.stop('Probe');
    removeDir(dir);
  });
  const first = git(origin, 'rev-parse', 'HEAD');
  await app.start('Probe');
  await until('running', () => app.status === 'running');
  assert.equal(app.state.lastUpdate?.mode, 'cold');
  assert.match(updateLine(app.state.lastUpdate), /^Started in .* \(cold start\)$/);
  const second = land(origin, floorDir, { 'version.txt': 'two' }, 'Merge pull request #2: the home page');
  kinds.set(second, HOT);
  states.length = 0;
  await app.follow(second);
  await until('hot reloaded', () => app.status === 'running' && app.state.served?.sha === second);
  assert.equal((await get(app.state.appPort!)).body, 'fake app two');
  assert.equal(starts(dir), 1, 'mxcli started once: no restart');
  const u = app.state.lastUpdate!;
  assert.deepEqual([u.mode, u.ok, u.reason, u.from, u.to], ['hot', true, 'page and logic changes', first, second]);
  assert.deepEqual(u.phases.map((p) => p.name), ['fetch', 'classify', 'apply', 'answer']);
  assert.match(updateLine(u), /^Updated in .* \(hot reload\)$/);
  const updating = states.filter((s) => s.status === 'updating');
  assert.ok(updating.length && updating.every((s) => s.served?.sha === first), 'the old build serves until the hot reload applied');
  honest(states);
});

test('hot path failure: a watch build that fails drops what served, restarts, and serves the target; never claimed early', { timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-speed-fail-'));
  const { origin, floorDir } = repos(dir);
  const states: LiveAppState[] = [];
  const kinds = new Map<string, ChangeClass>();
  const app = liveApp(dir, floorDir, { from: 8480, to: 8489 }, states, { hotReload: true, keepWarm: false }, kinds);
  t.after(async () => {
    await app.stop('Probe');
    removeDir(dir);
  });
  const first = git(origin, 'rev-parse', 'HEAD');
  await app.start('Probe');
  await until('running', () => app.status === 'running');
  const second = land(origin, floorDir, { 'version.txt': 'two', 'hotfail.txt': 'x' }, 'A page change the watch build chokes on');
  kinds.set(second, HOT);
  states.length = 0;
  await app.follow(second);
  await until('restarted on the target', () => app.status === 'running' && app.state.served?.sha === second, 60_000);
  assert.equal((await get(app.state.appPort!)).body, 'fake app two');
  assert.equal(starts(dir), 2, 'the fallback restarted mxcli');
  const u = app.state.lastUpdate!;
  assert.equal(u.mode, 'restart');
  assert.match(u.fallback ?? '', /being used by another process/);
  assert.match(updateLine(u), /^Updated in .* \(restart: hot reload didn't confirm \(The process cannot access/);
  assert.deepEqual(u.phases.map((p) => p.name), ['fetch', 'classify', 'apply', 'stop', 'build', 'start']);
  // The moment the hot reload failed, nothing was claimed: the old build is "last served", the target not yet served.
  const dropped = states.find((s) => s.status === 'updating' && !s.served);
  assert.ok(dropped, 'a state with nothing served while it restarted');
  assert.equal(dropped.lastServed?.sha, first);
  assert.ok(states.some((s) => /hot reload didn't confirm/.test(s.message ?? '')), 'it says the hot reload did not confirm');
  assert.ok(!states.some((s) => s.served?.sha === second && s.status !== 'running'), 'the target is served only once it runs');
  honest(states);
});

test('restart path: a domain model change restarts at once (no hot try); docs alone are taken over without one', { timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-speed-rest-'));
  const { origin, floorDir } = repos(dir);
  const states: LiveAppState[] = [];
  const kinds = new Map<string, ChangeClass>();
  const app = liveApp(dir, floorDir, { from: 8490, to: 8499 }, states, { hotReload: true, keepWarm: false }, kinds);
  t.after(async () => {
    await app.stop('Probe');
    removeDir(dir);
  });
  await app.start('Probe');
  await until('running', () => app.status === 'running');
  const second = land(origin, floorDir, { 'version.txt': 'two' }, 'An entity');
  await app.follow(second);
  await until('restarted', () => app.status === 'running' && app.state.served?.sha === second);
  assert.equal(starts(dir), 2);
  assert.match(updateLine(app.state.lastUpdate), /^Updated in .* \(restart: domain model changed\)$/);
  assert.equal(app.state.lastUpdate?.fallback, undefined, 'no hot reload was tried');
  // A commit with only notes: the running build is that commit's app; it serves on, saying which build it is.
  const builtAt = app.state.served!.builtAt;
  const third = land(origin, floorDir, { 'NOTES.md': 'a journal line' }, 'Journal');
  kinds.set(third, { kind: 'none', reason: 'no app files changed', touched: [] });
  await app.follow(third);
  await until('taken over', () => app.status === 'running' && app.state.served?.sha === third);
  assert.equal(starts(dir), 2, 'no restart');
  assert.equal(app.state.served?.built, second, 'built from the commit before');
  assert.equal(app.state.served?.builtAt, builtAt);
  assert.match(updateLine(app.state.lastUpdate), /\(no restart: no app files changed\)$/);
  honest(states);
});

test('hot reload off: a page change restarts as before, and the reason says hot reload is off', { timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-speed-off-'));
  const { origin, floorDir } = repos(dir);
  const states: LiveAppState[] = [];
  const kinds = new Map<string, ChangeClass>();
  const app = liveApp(dir, floorDir, { from: 8500, to: 8509 }, states, { hotReload: false, keepWarm: false }, kinds);
  t.after(async () => {
    await app.stop('Probe');
    removeDir(dir);
  });
  await app.start('Probe');
  await until('running', () => app.status === 'running');
  assert.ok(!readFileSync(path.join(dir, 'live', 'demo.log'), 'utf8').includes('--watch'), 'no --watch without hot reload');
  const second = land(origin, floorDir, { 'version.txt': 'two' }, 'A page');
  kinds.set(second, HOT);
  await app.follow(second);
  await until('restarted', () => app.status === 'running' && app.state.served?.sha === second);
  assert.equal(starts(dir), 2);
  assert.equal(app.state.lastUpdate?.reason, 'page and logic changes, but hot reload is off');
  honest(states);
});

test('grouping: merges that land during an update go in as one more update to the newest, saying what it brought in', { timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-speed-group-'));
  const { origin, floorDir } = repos(dir);
  const states: LiveAppState[] = [];
  const kinds = new Map<string, ChangeClass>();
  const app = liveApp(dir, floorDir, { from: 8510, to: 8519 }, states, { hotReload: false, keepWarm: false }, kinds);
  t.after(async () => {
    await app.stop('Probe');
    removeDir(dir);
  });
  await app.start('Probe');
  await until('running', () => app.status === 'running');
  const second = land(origin, floorDir, { 'version.txt': 'two', 'slow.txt': 'x' }, 'Merge pull request #2');
  const updating = app.follow(second);
  // Past its fetch (building the second), so what lands now is news for the next update.
  await until('building the second', () => app.status === 'updating' && app.state.target?.sha === second && /building/.test(app.state.message ?? ''));
  const third = land(origin, floorDir, { 'version.txt': 'three' }, 'Merge pull request #3');
  await app.follow(third);
  const fourth = land(origin, floorDir, { 'version.txt': 'four' }, 'Merge pull request #4');
  await app.follow(fourth);
  await updating;
  await until('serving the newest', () => app.status === 'running' && app.state.served?.sha === fourth, 60_000);
  assert.equal(starts(dir), 3, 'the start, the update to #2, and one update for #3 and #4 together (not one each)');
  assert.equal((await get(app.state.appPort!)).body, 'fake app four');
  const u = app.state.lastUpdate!;
  assert.equal(u.commits, 2);
  assert.equal(u.from, second);
  assert.deepEqual(u.included?.map((c) => c.sha), [third]);
  assert.match(updateLine(u), /· 2 commits in one go$/);
  assert.ok(!states.some((s) => s.target?.sha === third), 'the skipped commit was never a target of its own');
  honest(states);
});

test("a watch that never answers: each hot try falls back to a restart, and after two in a row it stops trying until the next start", { timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-speed-deaf-'));
  const { origin, floorDir } = repos(dir);
  const states: LiveAppState[] = [];
  const kinds = new Map<string, ChangeClass>();
  const app = liveApp(dir, floorDir, { from: 8520, to: 8529 }, states, { hotReload: true, keepWarm: false }, kinds, 1_000);
  t.after(async () => {
    await app.stop('Probe');
    removeDir(dir);
  });
  await app.start('Probe');
  await until('running', () => app.status === 'running');
  for (const [i, text] of ['two', 'three'].entries()) {
    const sha = land(origin, floorDir, { 'version.txt': text, 'deaf.txt': 'x' }, `A page ${i}`);
    kinds.set(sha, HOT);
    await app.follow(sha);
    await until(`restarted onto ${text}`, () => app.status === 'running' && app.state.served?.sha === sha);
    assert.match(app.state.lastUpdate?.fallback ?? '', /didn't pick the change up within 1 s/);
  }
  assert.equal(starts(dir), 3);
  const log = () => readFileSync(path.join(dir, 'live', 'demo.log'), 'utf8');
  assert.match(log(), /didn't answer twice in a row/);
  // The restart after the second miss ran without --watch, so the next page change restarts straight away.
  assert.ok(!log().trim().split(/\r?\n/).filter((l) => l.startsWith('$ mxcli run')).pop()!.includes('--watch'));
  const four = land(origin, floorDir, { 'version.txt': 'four' }, 'A page 3');
  kinds.set(four, HOT);
  await app.follow(four);
  await until('restarted onto four', () => app.status === 'running' && app.state.served?.sha === four);
  assert.equal(app.state.lastUpdate?.fallback, undefined, 'no hot try this time');
  assert.equal(app.state.lastUpdate?.reason, "page and logic changes, but hot reload is paused (mxcli's watch didn't answer)");
  honest(states);
});

test('keep warm: only projects that asked, and none that would not fit in memory (said on their tab)', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-speed-warm-'));
  const { LiveApps } = await import('../src/server/liveapp/index.js');
  const { warmUp } = await import('../src/server/liveapp/warm.js');
  const floors = new Map([
    ['warm', { id: 'warm', dir: path.join(dir, 'w') }],
    ['cold', { id: 'cold', dir: path.join(dir, 'c') }],
  ]);
  const ctx = { cfg: { dataDir: dir }, floors, toFloor: () => undefined };
  writePrefs(path.join(dir, 'live'), 'warm', { keepWarm: true }, { hotReload: false });
  t.after(async () => {
    const { stopLiveApps } = await import('../src/server/liveapp/index.js');
    await stopLiveApps(ctx as never);
    removeDir(dir);
  });
  const started = await warmUp(ctx as never, { free: () => 1024 ** 3, total: () => 8 * 1024 ** 3 });
  assert.deepEqual(started, []);
  const { liveAppsOf } = await import('../src/server/liveapp/index.js');
  const apps = liveAppsOf(ctx as never);
  assert.ok(apps instanceof LiveApps);
  assert.match(apps.peek('warm')?.message ?? '', /^Keep warm didn't start it: 1\.0 GB of 8\.0 GB memory free/);
  assert.equal(apps.peek('cold'), undefined, 'a project without keep warm is not touched');
  assert.equal(apps.peek('warm')?.status, 'stopped');
});
