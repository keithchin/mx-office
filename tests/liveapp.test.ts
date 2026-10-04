import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { databaseName, LIVE_APP_DEFAULTS, liveAppConfig, parseRange, splitHost } from '../src/server/liveapp/config.js';
import { isUp, nextStatus } from '../src/server/liveapp/machine.js';
import { pickPorts, portFree } from '../src/server/liveapp/ports.js';
import { LiveApp } from '../src/server/liveapp/app.js';
import type { LiveAppState } from '../src/shared/protocol.js';
import { BUILD_LEFTOVERS, cleanBuild, findMpr } from '../src/server/liveapp/checkout.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'liveapp-'));

test('port picker: lowest free ports in the range, skipping taken and busy ones', async () => {
  const busy = new Set([8111, 8113]);
  const ports = await pickPorts(3, { from: 8110, to: 8199 }, new Set([8110]), async (p) => !busy.has(p));
  assert.deepEqual(ports, [8112, 8114, 8115]);
});

test('port picker: undefined when the range runs out', async () => {
  assert.equal(await pickPorts(3, { from: 8110, to: 8112 }, new Set([8111]), async () => true), undefined);
});

test('portFree sees a port something listens on', async () => {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as net.AddressInfo).port;
  assert.equal(await portFree(port), false);
  await new Promise<void>((r) => srv.close(() => r()));
  assert.equal(await portFree(port), true);
});

test('state machine: start once, stop wins, update only when running', () => {
  assert.equal(nextStatus('stopped', 'start'), 'starting');
  assert.equal(nextStatus('starting', 'start'), undefined, 'a second ▶ does nothing');
  assert.equal(nextStatus('starting', 'stop'), 'stopping');
  assert.equal(nextStatus('starting', 'ready'), 'running');
  assert.equal(nextStatus('updating', 'ready'), 'running');
  assert.equal(nextStatus('running', 'update'), 'updating');
  assert.equal(nextStatus('stopped', 'update'), undefined, 'main moving starts nothing');
  assert.equal(nextStatus('starting', 'update'), undefined);
  assert.equal(nextStatus('running', 'crash'), 'failed');
  assert.equal(nextStatus('stopping', 'crash'), 'stopped', 'dying while stopping is just stopped');
  assert.equal(nextStatus('stopping', 'start'), undefined);
  assert.equal(nextStatus('failed', 'start'), 'starting');
  assert.equal(nextStatus('failed', 'stop'), 'stopped');
  assert.equal(nextStatus('running', 'restart'), 'starting');
  assert.equal(nextStatus('stopped', 'ready'), undefined, 'a late answer from a stopped app is ignored');
  assert.deepEqual(['stopped', 'starting', 'running', 'updating', 'stopping', 'failed'].filter((s) => isUp(s as never)), ['starting', 'running', 'updating']);
});

test('config: defaults, then live-app.json, then the environment', () => {
  const dir = tmp();
  try {
    assert.deepEqual(liveAppConfig(dir, {}), LIVE_APP_DEFAULTS);
    writeFileSync(path.join(dir, 'live-app.json'), JSON.stringify({ ports: '9000-9010', dbUser: 'mendix', pollSeconds: 30, mxcli: 'C:/bin/mxcli.exe' }));
    const fromFile = liveAppConfig(dir, {});
    assert.deepEqual(fromFile.ports, { from: 9000, to: 9010 });
    assert.equal(fromFile.db.user, 'mendix');
    assert.equal(fromFile.pollMs, 30_000);
    assert.equal(fromFile.mxcli, 'C:/bin/mxcli.exe');
    const env = liveAppConfig(dir, { AGENT_OFFICE_LIVE_PORTS: '8200-8299', AGENT_OFFICE_LIVE_DB_HOST: 'db.local:5433', AGENT_OFFICE_LIVE_DB_PASSWORD: 's3cret', AGENT_OFFICE_LIVE_POLL_SECONDS: '0' });
    assert.deepEqual(env.ports, { from: 8200, to: 8299 });
    assert.deepEqual([env.db.host, env.db.port, env.db.user, env.db.password], ['db.local', 5433, 'mendix', 's3cret']);
    assert.equal(env.pollMs, 0, '0 turns auto-refresh off');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config helpers', () => {
  assert.deepEqual(parseRange('8110-8199'), { from: 8110, to: 8199 });
  assert.deepEqual(parseRange('8110'), { from: 8110, to: 8110 });
  assert.equal(parseRange('8199-8110'), undefined);
  assert.equal(parseRange('80-90'), undefined, 'no privileged ports');
  assert.deepEqual(splitHost('[::1]:5432', 1), ['::1', 5432]);
  assert.deepEqual(splitHost('127.0.0.1', 5432), ['127.0.0.1', 5432]);
  assert.equal(databaseName('mx-spike'), 'mx_spike_live');
  assert.equal(databaseName('2048 Game!'), 'f_2048_game_live');
});

test('checkout: finds the .mpr, and clearing a build keeps the database', () => {
  const dir = tmp();
  try {
    mkdirSync(path.join(dir, 'app', 'deployment', 'data'), { recursive: true });
    writeFileSync(path.join(dir, 'app', 'MxSpike.mpr'), '');
    assert.equal(findMpr(dir), path.join(dir, 'app', 'MxSpike.mpr'));
    writeFileSync(path.join(dir, 'Top.mpr'), '');
    assert.equal(findMpr(dir), path.join(dir, 'Top.mpr'), 'one at the top wins');
    const proj = path.join(dir, 'app');
    for (const n of BUILD_LEFTOVERS) {
      if (n.includes('.')) writeFileSync(path.join(proj, 'deployment', n), '');
      else mkdirSync(path.join(proj, 'deployment', n), { recursive: true });
    }
    assert.equal(cleanBuild(proj), true);
    for (const n of BUILD_LEFTOVERS) assert.equal(existsSync(path.join(proj, 'deployment', n)), false, n);
    assert.equal(existsSync(path.join(proj, 'deployment', 'data')), true);
    assert.equal(cleanBuild(proj), false, 'nothing left to clear');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- The whole loop, with git for real and a stand-in for mxcli ---------------------------------

/** Stands in for `mxcli run --local …`: node runs this file (named `run`, the first argument) and serves --app-port. */
const FAKE_MXCLI = `const fs = require('fs');
if (fs.existsSync('deployment/build')) { console.log('Error: initial build failed (Object reference not set to an instance of an object.)'); process.exit(1); }
fs.mkdirSync('deployment/build', { recursive: true });
const port = Number(process.argv[process.argv.indexOf('--app-port') + 1]);
require('http').createServer((q, s) => s.end('fake app ' + require('fs').readFileSync('version.txt', 'utf8'))).listen(port);`;

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
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
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('live app: start, auto-refresh when main moves, stop frees the port', { timeout: 120_000 }, async () => {
  const dir = tmp();
  try {
    const origin = path.join(dir, 'origin');
    mkdirSync(origin);
    git(origin, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(origin, 'App.mpr'), '');
    writeFileSync(path.join(origin, 'run'), FAKE_MXCLI);
    writeFileSync(path.join(origin, 'version.txt'), 'one');
    git(origin, 'add', '.');
    git(origin, 'commit', '-q', '-m', 'first');
    const floorDir = path.join(dir, 'floor');
    git(dir, 'clone', '-q', origin, floorDir);
    const states: LiveAppState[] = [];
    const app = new LiveApp({
      cfg: { ...LIVE_APP_DEFAULTS, ports: { from: 8150, to: 8199 }, readyTimeoutMs: 30_000 },
      mxcli: process.execPath,
      floorId: 'demo',
      floorDir,
      remote: origin,
      liveDir: path.join(dir, 'live'),
      taken: () => new Set(),
      changed: (s) => states.push(s),
    });
    await app.start('Probe');
    await until('running', () => app.status === 'running');
    const port = app.state.appPort!;
    assert.equal(await get(port), 'fake app one');
    assert.equal(app.state.sha, git(origin, 'rev-parse', 'HEAD'));
    assert.equal(app.state.branch, 'main');
    assert.ok(existsSync(path.join(dir, 'live', 'demo.log')));

    // Nothing moved: polling leaves it be.
    await app.poll();
    assert.equal(app.status, 'running');

    // A PR merged: main moves, the app updates itself.
    writeFileSync(path.join(origin, 'version.txt'), 'two');
    git(origin, 'commit', '-q', '-am', 'second');
    const poll = app.poll();
    await until('updating', () => states.some((s) => s.status === 'updating'));
    assert.match(states.find((s) => s.status === 'updating')!.message ?? '', /^Updating to [0-9a-f]{7}/);
    await poll;
    await until('running again', () => app.status === 'running');
    assert.equal(app.state.sha, git(origin, 'rev-parse', 'HEAD'));
    assert.equal(app.state.by, 'auto-refresh');
    assert.equal(await get(app.state.appPort!), 'fake app two');

    // A restart over the last build's leftovers fails once (as mxbuild does), is cleaned, and comes up.
    const logged: string[] = [];
    states.length = 0;
    await app.restart('Probe');
    await until('running after the retry', () => app.status === 'running');
    for (const s of states) logged.push(...s.log);
    assert.ok(logged.some((l) => /clearing the build and trying once more/.test(l)), 'retried after cleaning');
    assert.ok(!states.some((s) => s.status === 'failed'), 'never shown as failed');

    const last = app.state.appPort!;
    await app.stop('Probe');
    assert.equal(app.status, 'stopped');
    assert.equal(await portFree(last), true);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});
