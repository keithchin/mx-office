// The office-run app instance (src/server/app-instance/): the office's own copy of a project's app at one
// commit, with a stand-in for `mxcli run --local` (node runs the commit's `run` file, which prints mxcli's boot
// phases, serves --app-port and answers with what it was given) and a stand-in for psql (nothing reaches a real
// PostgreSQL). Each run gets a fresh database name, never the live app's; what earlier runs left is dropped
// first; the password reaches mxcli as the live app gives it (an argument and PGPASSWORD) but never the log;
// the workspace is in the office's work folder, never the project's, and is kept between runs (updated in
// place to a new commit) so mxcli's build and bundle stay warm; stop() ends the process, drops the database
// and frees the ports. A start waits while a live app builds, tries once more after a transient failure (the
// runtime's port taken, a bundle past mxcli's limit) and never after any other, and says its phases and timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BootPhase } from '../src/shared/app-instance.js';
import { durationWords, goDurationMs } from '../src/shared/app-instance.js';
import { instanceDir, instancePorts, startAppInstance, type InstanceSpec } from '../src/server/app-instance/index.js';
import { phaseOfLine, transientOfLine } from '../src/server/app-instance/boot.js';
import { instanceDbName, type Psql } from '../src/server/app-instance/db.js';
import { markWorkspace, sweepWorkspaces } from '../src/server/app-instance/workspace.js';
import { LIVE_APP_DEFAULTS, databaseName } from '../src/server/liveapp/config.js';
import { portFree } from '../src/server/liveapp/ports.js';
import { removeDir } from './support/cleanup.js';

const PASSWORD = 'Sample-db-pw-42';
// The stand-in for `mxcli run --local`. Control files in the commit: fail.txt (a build error), bundle-once.txt /
// bundle-always.txt (mxcli's bundle limit), jetty-once.txt / jetty-always.txt (the runtime's port taken). It
// counts its starts in .mxcli/tries, which isn't tracked: a kept workspace keeps it.
const FAKE_MXCLI = `const fs = require('fs');
const a = process.argv.slice(2);
const at = (k) => a[a.indexOf(k) + 1];
fs.mkdirSync('.mxcli', { recursive: true });
const tries = (fs.existsSync('.mxcli/tries') ? Number(fs.readFileSync('.mxcli/tries', 'utf8')) : 0) + 1;
fs.writeFileSync('.mxcli/tries', String(tries));
const once = (name, tag) => fs.existsSync(name) && !fs.existsSync('.mxcli/' + tag) && (fs.writeFileSync('.mxcli/' + tag, 'x'), true);
const fail = (...lines) => { for (const l of lines) console.log(l); process.exitCode = 1; };
console.log('connecting to postgres as ' + at('--db-user') + ' with ' + at('--db-password'));
console.log('Ensuring database...');
setTimeout(() => {
  if (fs.existsSync('fail.txt')) return fail('Starting mxbuild --serve...', 'Error: the build failed (sample)');
  console.log('Starting mxbuild --serve...');
  console.log('Building (first build is cold, ~10-15s)...');
  setTimeout(() => {
    console.log('Bundling web client...');
    if (fs.existsSync('bundle-always.txt') || once('bundle-once.txt', 'bundle-tried')) return fail('Error: bundling web client: web client build timed out after 5m0s');
    setTimeout(() => {
      console.log('  Web client bundled in 1.5s');
      if (fs.existsSync('jetty-always.txt') || once('jetty-once.txt', 'jetty-tried')) return fail("Caused by: com.mendix.m2ee.appcontainer.util.AdminRuntimeException: Runtime port '" + at('--app-port') + "' is already in use", 'com.mendix.m2ee.api.internal.AdminException: No Runtime Jetty server available. Please call update_appcontainer_configuration firstly.');
      require('http').createServer((q, s) => s.end(JSON.stringify({ args: a, pg: process.env.PGPASSWORD === at('--db-password'), cwd: process.cwd(), tries }))).listen(Number(at('--app-port')), () => console.log('Runtime started; app serving at http://127.0.0.1:' + at('--app-port') + '/'));
    }, 150);
  }, 80);
}, 80);`;

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
const get = (port: number) =>
  new Promise<string>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });
const seenBy = async (port: number) => JSON.parse(await get(port)) as { args: string[]; pg: boolean; cwd: string; tries: number };

function project(control: string[] = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'app-inst-'));
  const repo = path.join(root, 'project');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'Sample.mpr'), '');
  writeFileSync(path.join(repo, 'run'), FAKE_MXCLI);
  writeFileSync(path.join(repo, 'page.txt'), 'first');
  writeFileSync(path.join(repo, 'old.txt'), 'dropped later');
  for (const c of control) writeFileSync(path.join(repo, c), 'x');
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
const base = (p: ReturnType<typeof project>, psql: Psql, more: Partial<InstanceSpec> = {}): InstanceSpec => ({ floorId: 'demo', floorDir: p.repo, commit: p.sha, purpose: 'rec', dataDir: p.data, cfg, mxcli: process.execPath, psql, mxbuild, webClientTimeout: async () => false, ...more });

test('database names: a fresh one per run, of the project and purpose, never the live app’s', () => {
  const a = instanceDbName('Sample-App', 'rec');
  const b = instanceDbName('Sample-App', 'rec');
  assert.match(a, /^sample_app_rec_[a-z0-9]{6}$/);
  assert.notEqual(a, b);
  assert.notEqual(a, databaseName('Sample-App'));
  assert.equal(databaseName('Sample-App'), 'sample_app_live');
  assert.ok(instanceDbName('x'.repeat(80), 'rec').length <= 63);
});

test('mxcli’s words: its boot phases, its durations, and which failures are transient', () => {
  assert.equal(phaseOfLine('Ensuring database...'), 'database');
  assert.equal(phaseOfLine('Starting mxbuild --serve...'), 'building');
  assert.equal(phaseOfLine('Bundling web client...'), 'bundling');
  assert.equal(phaseOfLine('  Web client bundled in 9.05s'), 'runtime');
  assert.equal(phaseOfLine('App is running at http://127.0.0.1:8110/'), undefined);
  assert.equal(goDurationMs('1m38.933s'), 98_933);
  assert.equal(goDurationMs('9.05s'), 9050);
  assert.equal(goDurationMs('250ms'), 250);
  assert.equal(goDurationMs('nonsense'), undefined);
  assert.equal(durationWords(125_000), '2 min 5 s');
  assert.deepEqual(transientOfLine("Caused by: x.AdminRuntimeException: Runtime port '8110' is already in use"), { kind: 'port', port: 8110, words: 'port 8110 was taken by something else on this machine when the runtime started' });
  assert.equal(transientOfLine('com.mendix.m2ee.api.internal.AdminException: No Runtime Jetty server available. Please call update_appcontainer_configuration firstly.')?.kind, 'port');
  assert.equal(transientOfLine('Error: bundling web client: web client build timed out after 5m0s')?.kind, 'bundle');
  assert.equal(transientOfLine('Error: initial build failed: CE1613 the selected attribute no longer exists'), undefined);
});

test('an instance: the commit in the office’s workspace, a fresh database, the password kept out of the log; stop drops the database and frees the ports, the workspace stays', { timeout: 90_000 }, async () => {
  const p = project();
  const { sql, psql } = fakePsql(['demo_rec_old111', 'demo_live', 'demo_rec_toolongname', 'other_rec_abc123']);
  try {
    const lines: string[] = [];
    const phases: BootPhase[] = [];
    const one = await startAppInstance(base(p, psql, { taken: () => [8300], progress: (l) => lines.push(l), onPhase: (ph) => phases.push(ph) }));
    try {
      assert.match(one.dbName, /^demo_rec_[a-z0-9]{6}$/);
      assert.notEqual(one.dbName, databaseName('demo'));
      assert.notEqual(one.appPort, 8300, 'a port something else holds is left alone');
      assert.ok(instancePorts().has(one.appPort));
      assert.equal(one.url, `http://127.0.0.1:${one.appPort}/`);
      assert.equal(one.alive(), true);
      const seen = await seenBy(one.appPort);
      assert.equal(seen.args[seen.args.indexOf('--db-name') + 1], one.dbName);
      assert.ok(seen.args.includes('--ensure-db'));
      assert.ok(!seen.args.includes('--web-client-timeout'), 'an mxcli that can’t be told the bundle limit isn’t');
      assert.equal(seen.pg, true, 'PGPASSWORD is set for psql under mxcli');
      assert.ok(path.resolve(seen.cwd).startsWith(path.resolve(instanceDir(p.data, 'demo', 'rec'))), 'it runs in the office’s work folder');
      assert.equal(git(p.repo, 'status', '--porcelain'), '', 'nothing changed in the project’s folder');
      assert.deepEqual(sql.filter((q) => q.startsWith('DROP')), ['DROP DATABASE IF EXISTS "demo_rec_old111" WITH (FORCE)'], 'only what an earlier run of this purpose left, never the live app’s');
      // Its phases, in order, and its timing.
      assert.deepEqual(phases, ['workspace', 'database', 'building', 'bundling', 'runtime']);
      assert.equal(one.timing.workspace, 'fresh');
      assert.equal(one.timing.bundleMs, 1500, 'what mxcli said the bundle took');
      for (const ph of ['workspace', 'database', 'building', 'bundling', 'runtime'] as const) assert.ok((one.timing.phases[ph] ?? -1) >= 0, `a time for ${ph}`);
      assert.ok((one.timing.phases.bundling ?? 0) >= 100, 'the bundle’s time is counted');
      assert.ok(one.timing.ms >= (one.timing.phases.bundling ?? 0));
      assert.equal(one.timing.retried, undefined);
      const log = readFileSync(one.logFile, 'utf8');
      assert.match(log, /--db-password \*\*\*/);
      assert.match(log, /connecting to postgres as mendix with \*\*\*/, 'a line that echoes it is masked too');
      assert.match(log, /workspace: a first copy/);
      assert.ok(!log.includes(PASSWORD), 'the password is never in the log');
      assert.ok(!lines.join('\n').includes(PASSWORD));
      await assert.rejects(startAppInstance(base(p, psql)), /running already/, 'one start per workspace at a time');
    } finally {
      await one.stop();
    }
    assert.equal(one.alive(), false);
    assert.equal(await portFree(one.appPort), true);
    assert.ok(!instancePorts().has(one.appPort));
    assert.ok(sql.includes(`DROP DATABASE IF EXISTS "${one.dbName}" WITH (FORCE)`), 'its database is dropped');
    assert.equal(existsSync(path.join(instanceDir(p.data, 'demo', 'rec'), 'Sample.mpr')), true, 'the workspace stays for the next run');
    // The next run gets a database of its own.
    const two = await startAppInstance(base(p, psql));
    assert.notEqual(two.dbName, one.dbName);
    await two.stop();
  } finally {
    removeDir(p.root);
  }
});

test('the workspace is kept between runs: the same commit reused, a new one updated in place, the caches kept, each run’s files cleared', { timeout: 90_000 }, async () => {
  const p = project();
  const { psql } = fakePsql();
  const ws = instanceDir(p.data, 'demo', 'rec');
  try {
    const one = await startAppInstance(base(p, psql));
    assert.equal((await seenBy(one.appPort)).tries, 1);
    await one.stop();
    // What a run leaves: a build, uploaded files of its (dropped) database, a tracked file it changed.
    mkdirSync(path.join(ws, 'deployment', 'build'), { recursive: true });
    writeFileSync(path.join(ws, 'deployment', 'build', 'out.txt'), 'built');
    mkdirSync(path.join(ws, 'deployment', 'data', 'files'), { recursive: true });
    writeFileSync(path.join(ws, 'deployment', 'data', 'files', 'upload.bin'), 'x');
    writeFileSync(path.join(ws, 'page.txt'), 'changed by a run');
    const two = await startAppInstance(base(p, psql));
    try {
      assert.equal(two.timing.workspace, 'reused');
      assert.equal((await seenBy(two.appPort)).tries, 2, 'mxcli’s own folder survived: the build and bundle stay warm');
      assert.equal(readFileSync(path.join(ws, 'page.txt'), 'utf8'), 'first', 'a tracked file a run changed is put back');
      assert.equal(existsSync(path.join(ws, 'deployment', 'build', 'out.txt')), true, 'the build is kept for the same commit');
      assert.equal(existsSync(path.join(ws, 'deployment', 'data', 'files', 'upload.bin')), false, 'the files of a dropped database go');
      assert.match(readFileSync(two.logFile, 'utf8'), /workspace: kept as it was/);
    } finally {
      await two.stop();
    }
    // A new commit: a file changed, one dropped, one added.
    writeFileSync(path.join(p.repo, 'page.txt'), 'second');
    rmSync(path.join(p.repo, 'old.txt'));
    writeFileSync(path.join(p.repo, 'new.txt'), 'added');
    git(p.repo, 'add', '-A');
    git(p.repo, 'commit', '-q', '-m', 'next');
    const next = git(p.repo, 'rev-parse', 'HEAD');
    const three = await startAppInstance(base(p, psql, { commit: next }));
    try {
      assert.equal(three.timing.workspace, 'updated');
      assert.equal(three.commit, next);
      assert.equal((await seenBy(three.appPort)).tries, 3, 'the same folder, updated in place');
      assert.equal(readFileSync(path.join(ws, 'page.txt'), 'utf8'), 'second');
      assert.equal(existsSync(path.join(ws, 'old.txt')), false, 'a file the commit dropped is removed');
      assert.equal(readFileSync(path.join(ws, 'new.txt'), 'utf8'), 'added');
      assert.equal(existsSync(path.join(ws, 'deployment', 'build', 'out.txt')), false, 'a new commit clears the last build’s leftovers');
      assert.match(readFileSync(three.logFile, 'utf8'), /workspace: updated in place/);
      assert.equal(git(p.repo, 'status', '--porcelain'), '', 'nothing changed in the project’s folder');
    } finally {
      await three.stop();
    }
  } finally {
    removeDir(p.root);
  }
});

test('one more try after the runtime’s port was taken: other ports, a fresh database, said in the timing; never more than one', { timeout: 90_000 }, async () => {
  const p = project(['jetty-once.txt']);
  const { sql, psql } = fakePsql();
  try {
    const lines: string[] = [];
    const one = await startAppInstance(base(p, psql, { progress: (l) => lines.push(l) }));
    try {
      const seen = await seenBy(one.appPort);
      assert.equal(seen.tries, 2);
      assert.match(one.timing.retried ?? '', /^port \d+ was taken by something else on this machine/);
      const firstPort = Number(/port (\d+)/.exec(one.timing.retried ?? '')?.[1]);
      assert.notEqual(one.appPort, firstPort, 'the second try is on other ports');
      assert.equal(sql.filter((q) => q.startsWith('DROP')).length, 1, 'the first try’s database is dropped');
      assert.equal(seen.args[seen.args.indexOf('--db-name') + 1], one.dbName, 'and the second runs on a new one');
      assert.match(lines.join('\n'), /failed to start once \(port \d+ was taken.*\); trying once more/);
      assert.match(readFileSync(one.logFile, 'utf8'), /the app failed to start once \(port \d+ was taken[^)]*\); trying once more on other ports/);
    } finally {
      await one.stop();
    }
  } finally {
    removeDir(p.root);
  }
  const q = project(['jetty-always.txt']);
  const f = fakePsql();
  try {
    await assert.rejects(startAppInstance(base(q, f.psql)), (err: Error) => {
      assert.match(err.message, /^starting the Mendix runtime failed after \d+ s: port \d+ was taken/);
      assert.match(err.message, /It had failed once before \(port \d+ was taken[^)]*\) and was tried again\./);
      assert.match(err.message, /record again \(the office picks other ports\)/);
      return true;
    });
    assert.equal(readFileSync(path.join(instanceDir(q.data, 'demo', 'rec'), '.mxcli', 'tries'), 'utf8'), '2', 'tried twice, never in a loop');
    assert.equal(instancePorts().size, 0);
  } finally {
    removeDir(q.root);
  }
});

test('one more try after mxcli’s bundle limit (a cold bundle on a busy machine); a longer limit when mxcli takes one', { timeout: 90_000 }, async () => {
  const p = project(['bundle-once.txt']);
  const { psql } = fakePsql();
  try {
    const one = await startAppInstance(base(p, psql, { webClientTimeout: async () => true }));
    try {
      const seen = await seenBy(one.appPort);
      assert.equal(seen.tries, 2);
      assert.equal(one.timing.retried, 'bundling the web client timed out after 5m0s');
      assert.equal(seen.args[seen.args.indexOf('--web-client-timeout') + 1], '15m', 'an mxcli that takes it is given 15 minutes for the bundle');
    } finally {
      await one.stop();
    }
  } finally {
    removeDir(p.root);
  }
  const q = project(['bundle-always.txt']);
  const f = fakePsql();
  try {
    await assert.rejects(startAppInstance(base(q, f.psql)), (err: Error) => {
      assert.match(err.message, /^bundling the web client failed after \d+ s: bundling the web client timed out after 5m0s\. It had failed once before .* the next start reuses the warm workspace/);
      return true;
    });
  } finally {
    removeDir(q.root);
  }
});

test('no second try after any other failure: the phase, why and what to do; the database dropped, the ports freed, the build cleared next time', { timeout: 60_000 }, async () => {
  const p = project(['fail.txt']);
  const { sql, psql } = fakePsql();
  try {
    await assert.rejects(startAppInstance(base(p, psql)), (err: Error) => {
      assert.match(err.message, /^building the app failed after \d+ s: the app didn't start: the build failed \(sample\)/);
      assert.match(err.message, /The instance log \(.*instance-rec\.log\) has mxcli’s whole output/);
      return true;
    });
    const ws = instanceDir(p.data, 'demo', 'rec');
    assert.equal(readFileSync(path.join(ws, '.mxcli', 'tries'), 'utf8'), '1', 'a build error isn’t tried again');
    assert.ok(sql.some((q) => /^DROP DATABASE IF EXISTS "demo_rec_[a-z0-9]{6}"/.test(q)), 'the database it may have made is dropped');
    assert.equal(instancePorts().size, 0);
    assert.equal(JSON.parse(readFileSync(`${ws}.json`, 'utf8')).clean, false, 'the workspace is marked: its build is cleared next time');
    await assert.rejects(startAppInstance(base(p, psql, { mxcli: null })), /mxcli isn't installed/);
    const ctl = new AbortController();
    ctl.abort('cancelled');
    await assert.rejects(startAppInstance(base(p, psql, { signal: ctl.signal })), /cancelled/);
  } finally {
    removeDir(p.root);
  }
});

test('a live app that is building: the start waits for it and says so, then goes on', { timeout: 60_000 }, async () => {
  const p = project();
  const { psql } = fakePsql();
  try {
    let asked = 0;
    const lines: string[] = [];
    const phases: BootPhase[] = [];
    const one = await startAppInstance(base(p, psql, { busy: () => (++asked <= 3 ? 'the project’s live app' : undefined), waitPollMs: 40, progress: (l) => lines.push(l), onPhase: (ph) => phases.push(ph) }));
    try {
      assert.ok(asked >= 4);
      assert.deepEqual(phases.slice(0, 3), ['waiting', 'workspace', 'database'], 'nothing is copied or built while it waits');
      assert.match(lines[0], /^Waiting for the project’s live app to finish building/);
      assert.ok((one.timing.phases.waiting ?? 0) >= 80, `waited ${one.timing.phases.waiting} ms`);
      assert.match(readFileSync(one.logFile, 'utf8'), /waiting for the project’s live app to finish building before starting/);
    } finally {
      await one.stop();
    }
    // It never waits for ever: past the cap it starts anyway.
    const two = await startAppInstance(base(p, psql, { busy: () => 'the project’s live app', waitMs: 100, waitPollMs: 30 }));
    assert.match(readFileSync(two.logFile, 'utf8'), /still building after 0 s: starting anyway/);
    await two.stop();
  } finally {
    removeDir(p.root);
  }
});

test('a fresh database for the same instance: the old one dropped, a new name, the same workspace and port; its own timing', { timeout: 90_000 }, async () => {
  const p = project();
  const { sql, psql } = fakePsql();
  try {
    const one = await startAppInstance(base(p, psql));
    try {
      const first = one.dbName;
      const lines: string[] = [];
      const phases: BootPhase[] = [];
      mkdirSync(path.join(instanceDir(p.data, 'demo', 'rec'), 'deployment', 'data', 'files'), { recursive: true });
      writeFileSync(path.join(instanceDir(p.data, 'demo', 'rec'), 'deployment', 'data', 'files', 'upload.bin'), 'x');
      const t0 = Date.now();
      await one.freshDatabase(new AbortController().signal, (l) => lines.push(l), (ph) => phases.push(ph));
      const ms = Date.now() - t0;
      assert.notEqual(one.dbName, first);
      assert.match(one.dbName, /^demo_rec_[a-z0-9]{6}$/);
      assert.ok(sql.includes(`DROP DATABASE IF EXISTS "${first}" WITH (FORCE)`), 'the first database is dropped');
      assert.equal(existsSync(path.join(instanceDir(p.data, 'demo', 'rec'), 'deployment', 'data', 'files', 'upload.bin')), false, 'its uploaded files go with it');
      const seen = await seenBy(one.appPort);
      assert.equal(seen.args[seen.args.indexOf('--db-name') + 1], one.dbName, 'the runtime runs on the new one');
      assert.ok(path.resolve(seen.cwd).startsWith(path.resolve(instanceDir(p.data, 'demo', 'rec'))));
      assert.equal(one.alive(), true);
      assert.match(lines.join('\n'), /same build again on a fresh database/);
      assert.deepEqual(phases, ['database', 'building', 'bundling', 'runtime']);
      assert.equal(one.timing.workspace, 'reused');
      assert.ok(!readFileSync(one.logFile, 'utf8').includes(PASSWORD));
      assert.ok(ms < 30_000, `a fresh database took ${ms} ms`);
    } finally {
      await one.stop();
    }
    assert.ok(sql.some((q) => q.includes(one.dbName) && q.startsWith('DROP')), 'stop drops the second one');
  } finally {
    removeDir(p.root);
  }
});

test('workspaces nobody used for two weeks are removed; the others stay', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'app-inst-sweep-'));
  try {
    const old = instanceDir(root, 'gone-project', 'rec');
    const recent = instanceDir(root, 'demo', 'rec');
    for (const d of [old, recent]) {
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, 'Sample.mpr'), '');
      await markWorkspace(d, { commit: 'a'.repeat(40), mpr: 'Sample.mpr' }, true);
    }
    const now = Date.now() + 15 * 86_400_000;
    // The recent one was used a day before "now".
    await markWorkspace(recent, { commit: 'a'.repeat(40), mpr: 'Sample.mpr' }, true);
    const marked = JSON.parse(readFileSync(`${recent}.json`, 'utf8')) as { at: number };
    writeFileSync(`${recent}.json`, JSON.stringify({ ...marked, at: now - 86_400_000 }));
    utimesSync(`${old}.json`, new Date(0), new Date(0));
    const gone = await sweepWorkspaces(root, undefined, 14, now);
    assert.deepEqual(gone.map((g) => path.resolve(g)), [path.resolve(old)]);
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(`${old}.json`), false);
    assert.equal(existsSync(recent), true);
  } finally {
    removeDir(root);
  }
});
