// The office-run app instance (src/server/app-instance/): the office's own throwaway copy of a project's app at
// one commit, with a stand-in for `mxcli run --local` (node runs the commit's `run` file, which serves
// --app-port and answers with what it was given) and a stand-in for psql (nothing reaches a real PostgreSQL).
// Each run gets a fresh database name, never the live app's; what earlier runs left is dropped first; the
// password reaches mxcli as the live app gives it (an argument and PGPASSWORD) but never the log; the copy
// is in the office's work folder, never the project's; stop() ends the process, drops the database, wipes
// the folder and frees the ports; a start that fails cleans up the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { instanceDir, instancePorts, startAppInstance } from '../src/server/app-instance/index.js';
import { instanceDbName, type Psql } from '../src/server/app-instance/db.js';
import { LIVE_APP_DEFAULTS, databaseName } from '../src/server/liveapp/config.js';
import { portFree } from '../src/server/liveapp/ports.js';
import { removeDir } from './support/cleanup.js';

const PASSWORD = 'Sample-db-pw-42';
const FAKE_MXCLI = `const a = process.argv.slice(2);
const at = (k) => a[a.indexOf(k) + 1];
if (require('fs').existsSync('fail.txt')) { console.log('Error: the build failed (sample)'); process.exit(1); }
console.log('connecting to postgres as ' + at('--db-user') + ' with ' + at('--db-password'));
require('http').createServer((q, s) => s.end(JSON.stringify({ args: a, pg: process.env.PGPASSWORD === at('--db-password'), cwd: process.cwd() }))).listen(Number(at('--app-port')));`;

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
const get = (port: number) =>
  new Promise<string>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });

function project(fail = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'app-inst-'));
  const repo = path.join(root, 'project');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'Sample.mpr'), '');
  writeFileSync(path.join(repo, 'run'), FAKE_MXCLI);
  if (fail) writeFileSync(path.join(repo, 'fail.txt'), 'x');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'sample');
  return { root, repo, sha: git(repo, 'rev-parse', 'HEAD'), data: path.join(root, 'data') };
}

function fakePsql(existing: string[] = []) {
  const sql: string[] = [];
  const psql: Psql = async (q, db) => {
    assert.equal(db.password, PASSWORD, 'psql gets the password (as PGPASSWORD, in the real one)');
    sql.push(q);
    return /^SELECT/.test(q) ? existing.join('\n') : '';
  };
  return { sql, psql };
}

const cfg = { ...LIVE_APP_DEFAULTS, ports: { from: 8300, to: 8349 }, readyTimeoutMs: 30_000, db: { host: '127.0.0.1', port: 5432, user: 'mendix', password: PASSWORD } };
const mxbuild = { pick: () => ({ skipped: [] }), supportsFlag: async () => false };

test('database names: a fresh one per run, of the project and purpose, never the live app’s', () => {
  const a = instanceDbName('Sample-App', 'rec');
  const b = instanceDbName('Sample-App', 'rec');
  assert.match(a, /^sample_app_rec_[a-z0-9]{6}$/);
  assert.notEqual(a, b);
  assert.notEqual(a, databaseName('Sample-App'));
  assert.equal(databaseName('Sample-App'), 'sample_app_live');
  assert.ok(instanceDbName('x'.repeat(80), 'rec').length <= 63);
});

test('an instance: the commit copied into the office’s work folder, a fresh database, the password kept out of the log; stop cleans everything up', { timeout: 90_000 }, async () => {
  const p = project();
  const { sql, psql } = fakePsql(['demo_rec_old111', 'demo_live', 'demo_rec_toolongname', 'other_rec_abc123']);
  try {
    const lines: string[] = [];
    const one = await startAppInstance({ floorId: 'demo', floorDir: p.repo, commit: p.sha, purpose: 'rec', dataDir: p.data, cfg, mxcli: process.execPath, taken: () => [8300], psql, mxbuild, progress: (l) => lines.push(l) });
    try {
      assert.match(one.dbName, /^demo_rec_[a-z0-9]{6}$/);
      assert.notEqual(one.dbName, databaseName('demo'));
      assert.notEqual(one.appPort, 8300, 'a port something else holds is left alone');
      assert.ok(instancePorts().has(one.appPort));
      assert.equal(one.url, `http://127.0.0.1:${one.appPort}/`);
      assert.equal(one.alive(), true);
      const seen = JSON.parse(await get(one.appPort)) as { args: string[]; pg: boolean; cwd: string };
      assert.equal(seen.args[seen.args.indexOf('--db-name') + 1], one.dbName);
      assert.ok(seen.args.includes('--ensure-db'));
      assert.equal(seen.pg, true, 'PGPASSWORD is set for psql under mxcli');
      assert.ok(path.resolve(seen.cwd).startsWith(path.resolve(instanceDir(p.data, 'demo', 'rec'))), 'it runs in the office’s work folder');
      assert.equal(git(p.repo, 'status', '--porcelain'), '', 'nothing changed in the project’s folder');
      assert.deepEqual(sql.filter((q) => q.startsWith('DROP')), ['DROP DATABASE IF EXISTS "demo_rec_old111" WITH (FORCE)'], 'only what an earlier run of this purpose left, never the live app’s');
      const log = readFileSync(one.logFile, 'utf8');
      assert.match(log, /--db-password \*\*\*/);
      assert.match(log, /connecting to postgres as mendix with \*\*\*/, 'a line that echoes it is masked too');
      assert.ok(!log.includes(PASSWORD), 'the password is never in the log');
      assert.ok(!lines.join('\n').includes(PASSWORD));
    } finally {
      await one.stop();
    }
    assert.equal(one.alive(), false);
    assert.equal(await portFree(one.appPort), true);
    assert.ok(!instancePorts().has(one.appPort));
    assert.ok(sql.includes(`DROP DATABASE IF EXISTS "${one.dbName}" WITH (FORCE)`), 'its database is dropped');
    assert.equal(existsSync(instanceDir(p.data, 'demo', 'rec')), false, 'the copy is wiped');
    // The next run gets a database of its own.
    const two = await startAppInstance({ floorId: 'demo', floorDir: p.repo, commit: p.sha, purpose: 'rec', dataDir: p.data, cfg, mxcli: process.execPath, psql, mxbuild });
    assert.notEqual(two.dbName, one.dbName);
    await two.stop();
  } finally {
    removeDir(p.root);
  }
});

test('a start that fails says why and leaves nothing behind; no mxcli is said plainly', { timeout: 60_000 }, async () => {
  const p = project(true);
  const { sql, psql } = fakePsql();
  try {
    await assert.rejects(startAppInstance({ floorId: 'demo', floorDir: p.repo, commit: p.sha, purpose: 'rec', dataDir: p.data, cfg, mxcli: process.execPath, psql, mxbuild }), /the app didn't start: the build failed \(sample\)/);
    assert.equal(existsSync(instanceDir(p.data, 'demo', 'rec')), false);
    assert.ok(sql.some((q) => /^DROP DATABASE IF EXISTS "demo_rec_[a-z0-9]{6}"/.test(q)), 'the database it may have made is dropped');
    assert.equal(instancePorts().size, 0);
    await assert.rejects(startAppInstance({ floorId: 'demo', floorDir: p.repo, commit: p.sha, purpose: 'rec', dataDir: p.data, cfg, mxcli: null, psql, mxbuild }), /mxcli isn't installed/);
    const ctl = new AbortController();
    ctl.abort('cancelled');
    await assert.rejects(startAppInstance({ floorId: 'demo', floorDir: p.repo, commit: p.sha, purpose: 'rec', dataDir: p.data, cfg, mxcli: process.execPath, psql, mxbuild, signal: ctl.signal }), /cancelled/);
  } finally {
    removeDir(p.root);
  }
});
