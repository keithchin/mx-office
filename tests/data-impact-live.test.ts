// The data-impact guard in the live app's update loop (server/liveapp/app.ts, server/data-impact/), against a
// fake mxcli and a made-up MPR v2 app in git: a merge that removes an attribute is held before anything is
// applied (no hot reload even when the classifier would allow one, no restart, ⟳ Restart doesn't apply it
// either), the old build keeps serving and answering with a clear state, the same head isn't tried again
// every poll, an unreadable model holds as unknown, a start over a database an earlier build used is held
// too (nothing built), and after an approval the restart takes the candidate. No GitHub, no real Mendix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DataImpact } from '../src/server/data-impact/index.js';
import { LiveApp } from '../src/server/liveapp/app.js';
import { LIVE_APP_DEFAULTS } from '../src/server/liveapp/config.js';
import { ModelUnits } from '../src/server/model/units.js';
import { stopExecWorker } from '../src/server/offloop/exec.js';
import type { ChangeClass } from '../src/shared/liveapp/speed.js';
import type { LiveAppState } from '../src/shared/protocol.js';
import { removeDir } from './support/cleanup.js';
import { guid, hasSqlite, project, type MadeUnit } from './support/mendix.js';

test.after(() => stopExecWorker());

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();

/** `mxcli run --local …` stand-in: serves version.txt on --app-port; with --watch it applies a change to it in place. */
const FAKE_MXCLI = `const fs = require('fs');
const port = Number(process.argv[process.argv.indexOf('--app-port') + 1]);
const watch = process.argv.includes('--watch');
let body = fs.readFileSync('version.txt', 'utf8');
console.log('Starting the Mendix runtime…');
require('http').createServer((q, s) => s.end('fake app ' + body)).listen(port, () => {
  console.log('App is running at http://127.0.0.1:' + port + '/');
  if (!watch) return;
  let n = 1;
  setInterval(() => {
    let now; try { now = fs.readFileSync('version.txt', 'utf8'); } catch { return; }
    if (now === body) return;
    n++; console.log('Change detected, rebuilding (build #' + n + ')...'); body = now;
    console.log('  build #' + n + ' applied via reload in 0.1s, client re-bundled (gen ' + n + ') -> x');
  }, 100);
});`;

const unitsOf = (attrs: string[]): MadeUnit[] => [
  { n: 1, container: 1, hash: 'p', doc: { $Type: 'Projects$Project' } },
  { n: 2, container: 1, hash: 'm', doc: { $Type: 'Projects$ModuleImpl', Name: 'Sales' } },
  {
    n: 3,
    container: 2,
    hash: 'dm',
    doc: {
      $Type: 'DomainModels$DomainModel',
      Entities: [3, { $ID: 'e-order', $Type: 'DomainModels$EntityImpl', Name: 'Order', MaybeGeneralization: { $Type: 'DomainModels$NoGeneralization', Persistable: true }, Attributes: [3, ...attrs.map((a) => ({ $ID: `a-${a}`, $Type: 'DomainModels$Attribute', Name: a, NewType: { $Type: 'DomainModels$StringAttributeType', Length: 200 }, Value: { $Type: 'DomainModels$StoredValue' } }))] }],
    },
  },
];

const get = (port: number) =>
  new Promise<string>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });

async function until(what: string, fn: () => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const SKIP = !(await hasSqlite()) && 'no node:sqlite';

test('a merge that removes an attribute is held: no hot apply, no restart, the old build serves on; approval applies it', { skip: SKIP, timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-di-live-'));
  const origin = path.join(dir, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  const land = async (attrs: string[] | null, version: string, msg: string, corrupt = false) => {
    if (attrs) {
      rmSync(path.join(origin, 'mprcontents'), { recursive: true, force: true });
      await project(origin, unitsOf(attrs));
      if (corrupt) {
        const id = guid(3);
        writeFileSync(path.join(origin, 'mprcontents', id.slice(0, 2), id.slice(2, 4), `${id}.mxunit`), 'xx');
      }
    }
    writeFileSync(path.join(origin, 'version.txt'), version);
    writeFileSync(path.join(origin, 'run'), FAKE_MXCLI);
    git(origin, 'add', '-A');
    git(origin, 'commit', '-qm', msg);
    if (floorDir) git(floorDir, 'pull', '-q');
    return git(origin, 'rev-parse', 'HEAD');
  };
  let floorDir = '';
  const base = await land(['Notes', 'Code'], 'one', 'Starter app');
  floorDir = path.join(dir, 'floor');
  git(dir, 'clone', '-q', origin, floorDir);
  const units = new ModelUnits(path.join(dir, 'units'));
  const accounts = [{ id: 'u-admin', name: 'Ada', role: 'admin' }];
  const di = new DataImpact({ cfg: { dataDir: path.join(dir, 'data') }, accounts: { state: () => ({ accounts, invites: [], sharedPassword: false }) }, meOf: (id: string | undefined) => ({ admin: id === 'u-admin' }) } as unknown as ConstructorParameters<typeof DataImpact>[0], { pg: () => undefined });
  const states: LiveAppState[] = [];
  const classified: string[] = [];
  const app = new LiveApp({
    cfg: { ...LIVE_APP_DEFAULTS, ports: { from: 8560, to: 8569 }, readyTimeoutMs: 30_000 },
    mxcli: process.execPath,
    floorId: 'demo',
    floorDir,
    liveDir: path.join(dir, 'live'),
    taken: () => new Set(),
    changed: (s) => states.push(s),
    prefs: () => ({ hotReload: true, keepWarm: false }),
    supportsWatch: async () => true,
    // The classifier would hot reload anything: the guard must stop it first.
    classify: async (_d, _f, to): Promise<ChangeClass> => (classified.push(to), { kind: 'hot', reason: 'page and logic changes', touched: ['page Home'] }),
    guard: (d, from, to) => di.guard.check({ floorId: 'demo', dir: d, base: from, target: to, units }),
  });
  t.after(async () => {
    await app.stop('Probe');
    units.close();
    removeDir(dir);
  });
  const starts = () => readFileSync(path.join(dir, 'live', 'demo.log'), 'utf8').split('\n').filter((l) => l.startsWith('$ mxcli run')).length;
  await app.start('Probe');
  await until('running', () => app.status === 'running' && app.state.served?.sha === base);
  // An additive change goes through (hot, as the classifier says).
  const added = await land(['Notes', 'Code', 'Due'], 'two', 'add Due');
  await app.follow(added);
  await until('hot applied', () => app.state.served?.sha === added);
  assert.equal(await get(app.state.appPort!), 'fake app two');
  // Removing an attribute: held before anything is applied.
  const drop = await land(['Code', 'Due'], 'three', 'drop Notes');
  states.length = 0;
  await app.follow(drop);
  await until('held', () => app.state.failure?.kind === 'held');
  const s = app.state;
  assert.equal(s.status, 'running');
  assert.equal(s.served?.sha, added, 'the old build is still the served one');
  assert.equal(s.failure?.sha, drop);
  assert.equal(s.failure?.why, `Update held: possible data impact at ${drop.slice(0, 7)}; needs data-impact approval`);
  assert.ok(!classified.includes(drop), 'never classified, so never hot applied');
  assert.equal(await get(s.appPort!), 'fake app two', 'it keeps answering with the old build');
  assert.equal(starts(), 1, 'no restart');
  assert.ok(states.every((x) => x.served?.sha !== drop), 'never claimed to serve the held commit');
  // The same head is not tried again on every poll; ⟳ Restart doesn't apply it either.
  await app.follow(drop);
  await app.restart('Probe');
  await until('held again after restart', () => app.status === 'running' && app.state.failure?.kind === 'held');
  assert.equal(app.state.served?.sha, added);
  assert.equal(starts(), 1, 'a restart onto the held commit is refused; the old build still runs');
  assert.equal(await get(app.state.appPort!), 'fake app two');
  // What the card reads: the hold as its own fact.
  const v = di.view('demo', 'u-admin');
  assert.deepEqual([v.held?.env, v.held?.base, v.held?.target], ['live-preview', added, drop]);
  assert.equal(v.assessment?.findings.map((f) => f.risk).join(), 'may drop data in Sales.Order.Notes');
  // Approved ("no data to keep"): the restart the route asks for takes it.
  const ok = await di.approve('demo', { name: 'Ada', id: 'u-admin' }, 'u-admin', { base: added, target: drop, reason: 'test data only', noData: true });
  assert.ok(!Array.isArray(ok));
  await app.restart('Ada (data-impact approval)');
  await until('applied', () => app.status === 'running' && app.state.served?.sha === drop, 60_000);
  assert.equal(app.state.failure, undefined);
  assert.equal(await get(app.state.appPort!), 'fake app three');
  assert.equal(starts(), 2);
  // An unreadable model holds as unknown.
  const broken = await land(['Code', 'Due'], 'four', 'a broken unit', true);
  await app.follow(broken);
  await until('held unknown', () => app.state.failure?.kind === 'held' && app.state.failure.sha === broken);
  assert.match(app.state.failure!.why, /^Update held: data impact unknown at [0-9a-f]{7} \(the model couldn't be read: .*\); needs data-impact approval$/);
  assert.equal(app.state.served?.sha, drop);
  // Stopped, then ▶ Start over the database the last build used: held, nothing built.
  await app.stop('Probe');
  await until('stopped', () => app.status === 'stopped');
  await app.start('Probe');
  await until('start held', () => app.status === 'failed' && app.state.failure?.kind === 'held');
  assert.equal(app.state.served, undefined);
  assert.equal(starts(), 2, 'nothing was built');
});
