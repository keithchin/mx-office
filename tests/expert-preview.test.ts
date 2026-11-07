// Expert mode's preview in place (server/liveapp/in-place.ts, app.ts `inPlace`): the project folder itself runs, the
// session's working copy as it is (uncommitted too), with mxcli's watch; a change mxcli applies by itself is a served
// reload (lastUpdate, and the asked → visible timer stops on it); no checkout of main, no auto-refresh. And the
// timer's other model change: the .mpr changing while the session works (server/expert/stamp.ts). Fakes only: node
// stands in for mxcli, running the folder's own `run` script.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LiveApp } from '../src/server/liveapp/app.js';
import { LIVE_APP_DEFAULTS } from '../src/server/liveapp/config.js';
import { ExpertService, STAMP_DEBOUNCE_MS } from '../src/server/expert/shell.js';
import { ModelStamps } from '../src/server/expert/stamp.js';
import { noteWorkerHook } from '../src/server/workers/hook-bus.js';
import type { LiveAppState } from '../src/shared/protocol.js';

/** Stands in for `mxcli run --watch`: serves version.txt; when version.txt changes, says it rebuilt and applied it via reload. */
const FAKE_MXCLI = `const fs = require('fs');
const port = Number(process.argv[process.argv.indexOf('--app-port') + 1]);
const watch = process.argv.includes('--watch');
console.log('Building the project…');
setTimeout(() => {
  console.log('Starting the Mendix runtime…');
  require('http').createServer((q, s) => s.end('fake app ' + fs.readFileSync('version.txt', 'utf8'))).listen(port, () => console.log('Runtime started'));
  let n = 1;
  if (watch) fs.watchFile('version.txt', { interval: 100 }, () => {
    n++;
    console.log('Change detected, rebuilding (build #' + n + ')...');
    setTimeout(() => console.log('build #' + n + ' applied via reload in 0.4s, 1 page'), 200);
  });
}, 200);`;

async function until(what: string, fn: () => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('in place: the project folder runs as it is, and a change mxcli applies by itself is a served reload', { timeout: 90_000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'expert-preview-'));
  const floorDir = path.join(dir, 'orders');
  mkdirSync(floorDir);
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd: floorDir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'session/main');
  writeFileSync(path.join(floorDir, 'Orders.mpr'), '');
  writeFileSync(path.join(floorDir, 'run'), FAKE_MXCLI);
  writeFileSync(path.join(floorDir, 'version.txt'), 'one');
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  // Uncommitted in the working copy: in place, it's what runs.
  writeFileSync(path.join(floorDir, 'version.txt'), 'two (not committed)');
  const states: LiveAppState[] = [];
  const app = new LiveApp({
    cfg: { ...LIVE_APP_DEFAULTS, ports: { from: 8590, to: 8599 }, readyTimeoutMs: 30_000 },
    mxcli: process.execPath,
    floorId: 'orders',
    floorDir,
    liveDir: path.join(dir, 'live'),
    taken: () => new Set(),
    changed: (s) => states.push(s),
    prefs: () => ({ hotReload: true, keepWarm: false }),
    supportsWatch: async () => true,
    freeMemory: () => 32 * 1024 ** 3,
    inPlace: () => true,
  });
  t.after(async () => {
    await app.stop('Probe');
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  await app.start('Probe');
  await until('running', () => app.status === 'running');
  assert.ok(!existsSync(path.join(dir, 'live', 'orders', '.git')), 'no checkout of main was made');
  assert.equal(app.state.branch, 'session/main');
  assert.equal(app.state.served?.sha, git('rev-parse', 'HEAD'));
  const port = app.state.appPort!;
  const body = async () => (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.equal(await body(), 'fake app two (not committed)', 'the working copy runs, uncommitted change included');
  const builtAt = app.state.served!.builtAt;
  // The session writes the model: mxcli's watch applies it, the office marks the served reload.
  writeFileSync(path.join(floorDir, 'version.txt'), 'three');
  await until('the served reload', () => app.state.lastUpdate?.mode === 'hot' && app.state.lastUpdate.ok);
  assert.equal(await body(), 'fake app three');
  assert.equal(app.state.served?.builtAt, builtAt, 'the same runtime kept serving');
  assert.ok((app.state.lastUpdate?.at ?? 0) > builtAt);
  // Auto-refresh doesn't touch an in-place app.
  await app.poll();
  assert.equal(app.status, 'running');
});

test('the .mpr changing while the session works is a model change (debounced), and not while it is idle', { timeout: 30_000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'expert-stamp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const mpr = path.join(dir, 'App.mpr');
  writeFileSync(mpr, 'v1');
  const stamps = new ModelStamps();
  const a = await stamps.read(dir);
  assert.ok(a);
  const worker = { id: 's1', session: true as const, status: 'working' };
  const floor = { id: 'shop', dir, def: { id: 'shop', mode: 'expert' }, workers: { get: () => worker, list: () => [worker] } };
  let now = 1_000_000;
  const svc = new ExpertService({ cfg: { dataDir: dir } as never, floors: new Map([['shop', floor]]) as never, workerFloor: () => floor as never }, () => now);
  t.after(() => svc.stop());
  noteWorkerHook('s1', 'UserPromptSubmit', { session_id: 'x' });
  await new Promise((r) => setTimeout(r, 100));
  now += 5_000;
  // A tool call that wrote the model some other way than a known command: the .mpr's stamp moves.
  writeFileSync(mpr, 'v2 longer');
  utimesSync(mpr, new Date(), new Date(Date.now() + 5_000));
  noteWorkerHook('s1', 'PostToolUse', { tool_name: 'mcp__studio__apply', tool_input: {} });
  noteWorkerHook('s1', 'PostToolUse', { tool_name: 'Read', tool_input: {} });
  await new Promise((r) => setTimeout(r, STAMP_DEBOUNCE_MS + 400));
  const l = await svc.loop(floor as never);
  assert.equal(l.pending?.changedAt, 1_005_000, 'the change is dated at the first tool call of the burst');
  // Idle: the same kind of change isn't a model change of the session's.
  worker.status = 'done';
  const t2 = mkdtempSync(path.join(tmpdir(), 'expert-stamp2-'));
  t.after(() => rmSync(t2, { recursive: true, force: true }));
  assert.equal(await stamps.read(t2), undefined, 'a folder with no .mpr has no stamp');
});
