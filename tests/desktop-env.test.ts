// An office started by the desktop app (bin/agent-office.js straight from Electron, none of the
// launcher's variables) must make the same choices as one started by scripts/start-office.ps1: the same
// mxcli for live apps, the Model tab, Testing and the agents' PATH, the same toolkit, home and password.
// And the live app tells mxcli which mxbuild to build with, so a cached Linux download is never used on
// Windows, and says honestly why when it is. Fake paths and fake programs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { officeEnv } from '../desktop/src/core/options.ts';
import { launcherPassword } from '../src/server/config.js';
import { withConnections } from '../src/server/connections/env.js';
import { toolkitDirState } from '../src/server/connections/store.js';
import { LIVE_APP_DEFAULTS, liveAppConfig } from '../src/server/liveapp/config.js';
import { LiveApp } from '../src/server/liveapp/app.js';
import { linuxMxbuildIn, linuxMxbuildMessage, nativePath, pickMxbuild, type MxbuildDeps } from '../src/server/liveapp/mxbuild.js';
import { officeMxcli } from '../src/server/wizard/config.js';
import type { LiveAppState } from '../src/shared/protocol.js';

const WIN = process.platform === 'win32';
const tmp = () => mkdtempSync(path.join(tmpdir(), 'desktop-env-'));
const same = (a: string | undefined, b: string | undefined) => (WIN ? a?.toLowerCase() === b?.toLowerCase() : a === b);

/** Runs `fn` with process.env replaced by `env` (and the home folder `home`), then puts it back. */
function withProcessEnv<T>(env: Record<string, string>, home: string, fn: () => T): T {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, env, { USERPROFILE: home, HOME: home });
  try {
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

/** What the office decides from its environment: everything the launcher's non-secret variables used to pick. */
function decisions(env: Record<string, string>, home: string, dataDir: string) {
  return withProcessEnv(env, home, () => {
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    const workerEnv = withConnections({ [pathKey]: env[pathKey] ?? '' });
    const workerPath = workerEnv[Object.keys(workerEnv).find((k) => k.toUpperCase() === 'PATH')!];
    return {
      liveMxcli: path.resolve(liveAppConfig(dataDir, process.env, home).mxcli),
      officeMxcli: path.resolve(officeMxcli(process.env, home)!.path),
      toolkit: path.resolve(toolkitDirState(process.env).dir),
      // The folder an agent's bare `mxcli` resolves to: the first on its PATH.
      agentsMxcliDir: path.resolve(workerPath.split(path.delimiter)[0]),
      home: path.resolve(process.env.AGENT_OFFICE_HOME ?? ''),
      projects: path.resolve(process.env.AGENT_OFFICE_PROJECTS || process.env.AGENT_OFFICE_HOME || ''),
    };
  });
}

test('desktop-started and launcher-started offices pick the same mxcli, toolkit, home and agents’ PATH', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    const spike = path.join(home, 'agent-spike');
    const exe = WIN ? 'mxcli.exe' : 'mxcli';
    const mxcliDir = path.join(spike, 'tools', 'mxcli');
    mkdirSync(mxcliDir, { recursive: true });
    writeFileSync(path.join(mxcliDir, exe), 'fake mxcli');
    mkdirSync(path.join(spike, 'mendix-toolkit'), { recursive: true });
    // An older mxcli elsewhere on PATH (the trap the desktop app's office fell into).
    const oldDir = path.join(home, '.local', 'bin');
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(path.join(oldDir, exe), 'older fake mxcli');
    const officeHome = path.join(home, 'agent-office');
    const dataDir = path.join(officeHome, '.agent-office');
    mkdirSync(dataDir, { recursive: true });
    const basePath = [oldDir, path.join(root, 'sys')].join(path.delimiter);

    // scripts/start-office.ps1's non-secret variables (its token and password come from files, below).
    const launcher = {
      PATH: [mxcliDir, basePath].join(path.delimiter),
      AGENT_OFFICE_LIVE_MXCLI: path.join(mxcliDir, exe),
      AGENT_OFFICE_MXCLI: path.join(mxcliDir, exe),
      AGENT_OFFICE_TOOLKIT_DIR: path.join(spike, 'mendix-toolkit'),
      AGENT_OFFICE_HOME: officeHome,
      AGENT_OFFICE_PROJECTS: officeHome,
      AGENT_OFFICE_LAUNCHER_LOOP: '1',
    };
    // The desktop app: the user's plain environment, through officeEnv (desktop/src/core/options.ts).
    const desktop = officeEnv({ PATH: basePath }, { home: officeHome });
    assert.equal(desktop.AGENT_OFFICE_LIVE_MXCLI, undefined, 'the desktop app sets none of the launcher’s mxcli variables');

    const a = decisions(launcher, home, dataDir);
    const b = decisions(desktop, home, dataDir);
    assert.deepEqual(b, a);
    assert.ok(same(b.liveMxcli, path.join(mxcliDir, exe)), 'the live app runs the workspace’s mxcli, not the older one on PATH');
    assert.ok(same(b.agentsMxcliDir, mxcliDir), 'agents’ `mxcli` is the workspace’s');
    assert.equal(desktop.AGENT_OFFICE_LAUNCHER_LOOP, '1', 'restart safely is offered in both');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('with no workspace mxcli and nothing set, the live app falls back to `mxcli` on PATH', () => {
  const home = tmp();
  try {
    assert.equal(officeMxcli({}, home), undefined);
    assert.equal(liveAppConfig(home, {}, home).mxcli, LIVE_APP_DEFAULTS.mxcli);
    assert.equal(liveAppConfig(home, { AGENT_OFFICE_MXCLI: '/opt/mx/mxcli' }, home).mxcli, '/opt/mx/mxcli');
    assert.equal(liveAppConfig(home, { AGENT_OFFICE_MXCLI: '/opt/mx/mxcli', AGENT_OFFICE_LIVE_MXCLI: '/opt/live/mxcli' }, home).mxcli, '/opt/live/mxcli');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the launcher’s password file is read by the office itself, never in test mode', () => {
  const home = tmp();
  try {
    const env = { AGENT_OFFICE_SECRETS_HOME: home };
    assert.equal(launcherPassword(env), '', 'no file: nothing');
    writeFileSync(path.join(home, '.agent-office-password'), '  test-only-pw  \r\nsecond line\r\n');
    assert.equal(launcherPassword(env), 'test-only-pw', 'its first line, trimmed, as the launcher reads it');
    assert.equal(launcherPassword(env, true), '', 'a test office keeps its own password');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---- Which mxbuild ---------------------------------------------------------------------------------

function fakeMachine(files: string[], o: Partial<MxbuildDeps> = {}): MxbuildDeps {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return {
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files' },
    isFile: (p) => set.has(p.toLowerCase()),
    isDir: () => false,
    readVersion: () => '11.12.4',
    ...o,
  };
}

const STUDIO = 'C:\\Program Files\\Mendix\\11.12.4\\modeler\\mxbuild.exe';

test('mxbuild: toolkit.env first, then the office’s MXBUILD_PATH, then the installed Studio Pro of the project’s version', () => {
  const custom = 'D:\\Mendix\\11.12.4\\modeler\\mxbuild.exe';
  const d = fakeMachine([custom, STUDIO], { env: { ProgramFiles: 'C:\\Program Files', MXBUILD_PATH: 'E:\\other\\mxbuild.exe' } });
  assert.deepEqual(pickMxbuild('App.mpr', { MXBUILD_PATH: custom }, d), { path: custom, source: 'toolkit.env', version: '11.12.4', skipped: [] }, 'toolkit.env wins; the office’s MXBUILD_PATH is never looked at');
  // Git Bash's form, as the toolkit writes it.
  assert.equal(pickMxbuild('App.mpr', { MXBUILD_PATH: '/d/Mendix/11.12.4/modeler/mxbuild.exe' }, d).path, custom);
  const office = fakeMachine(['E:\\other\\mxbuild.exe', STUDIO], { env: { ProgramFiles: 'C:\\Program Files', MXBUILD_PATH: 'E:\\other\\mxbuild.exe' } });
  assert.equal(pickMxbuild('App.mpr', {}, office).source, 'office');
  const fallback = pickMxbuild('App.mpr', { MXBUILD_PATH: 'Z:\\gone\\mxbuild.exe' }, fakeMachine([STUDIO]));
  assert.equal(fallback.path, STUDIO, 'Windows: Studio Pro of the project’s version before any cached download');
  assert.equal(fallback.source, 'studio-pro');
  assert.match(fallback.skipped[0], /toolkit\.env points at Z:\\gone\\mxbuild\.exe, which isn't there/);
});

test('mxbuild: nothing to pass when Studio Pro of that version isn’t installed, or off Windows', () => {
  const none = pickMxbuild('App.mpr', {}, fakeMachine(['C:\\Program Files\\Mendix\\11.6.0\\modeler\\mxbuild.exe']));
  assert.equal(none.path, undefined);
  assert.equal(none.expected, STUDIO, 'where it would be, for the message');
  const linux = pickMxbuild('App.mpr', {}, fakeMachine([STUDIO], { platform: 'linux' }));
  assert.deepEqual(linux, { version: '11.12.4', skipped: [] }, 'on Linux mxcli’s own (CDN) mxbuild is the right one');
  assert.equal(nativePath('/c/Program Files/Mendix', 'win32'), 'C:\\Program Files\\Mendix');
  assert.equal(nativePath('/c/x', 'linux'), '/c/x');
});

test('mxbuild: the Linux-binary error is recognised and explained with the fix', () => {
  const line = 'Error: starting mxbuild serve: mxbuild at C:\\Users\\me\\.mxcli\\mxbuild\\11.6.0\\modeler\\mxbuild is a linux binary and cannot run on windows';
  const found = linuxMxbuildIn(['Starting mxbuild --serve...', line]);
  assert.deepEqual(found, { mxbuild: 'C:\\Users\\me\\.mxcli\\mxbuild\\11.6.0\\modeler\\mxbuild' });
  assert.equal(linuxMxbuildIn(['Error: initial build failed']), undefined);
  const msg = linuxMxbuildMessage(found!, { version: '11.12.4', expected: STUDIO, skipped: [] }, undefined, 'mxcli', 'win32');
  assert.match(msg, /Linux mxbuild \(C:\\Users\\me\\\.mxcli\\mxbuild\\11\.6\.0\\modeler\\mxbuild\), which can't run on Windows/);
  assert.match(msg, /install Studio Pro 11\.12\.4 on the office's computer \(C:\\Program Files\\Mendix\\11\.12\.4\\modeler\\mxbuild\.exe\)/);
  assert.match(msg, /set the mxbuild path \(MXBUILD_PATH in the project's \.claude\/toolkit\.env/);
  const old = linuxMxbuildMessage(found!, { path: STUDIO, source: 'studio-pro', version: '11.12.4', skipped: [] }, false, 'C:\\old\\mxcli.exe', 'win32');
  assert.match(old, /This mxcli \(C:\\old\\mxcli\.exe\) is too old to be given the mxbuild path/);
});

// ---- The live app, with git for real and a stand-in for mxcli ---------------------------------------

/** Stands in for `mxcli run --local …`: records its arguments and MXBUILD_PATH, then fails as told or serves --app-port. */
const FAKE_MXCLI = `const fs = require('fs');
fs.writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ args: process.argv.slice(3), mxbuild: process.env.MXBUILD_PATH || null }));
if (process.env.FAKE_LINUX) { console.log('Error: starting mxbuild serve: mxbuild at C:\\\\cache\\\\mxbuild\\\\11.6.0\\\\modeler\\\\mxbuild is a linux binary and cannot run on windows'); process.exit(1); }
const port = Number(process.argv[process.argv.indexOf('--app-port') + 1]);
require('http').createServer((q, s) => s.end('fake app')).listen(port);`;

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
async function until(what: string, fn: () => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function floorWithApp(dir: string, mxbuildLine?: string) {
  const origin = path.join(dir, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(origin, 'App.mpr'), '');
  writeFileSync(path.join(origin, 'run'), FAKE_MXCLI);
  git(origin, 'add', '.');
  git(origin, 'commit', '-q', '-m', 'first');
  const floorDir = path.join(dir, 'floor');
  git(dir, 'clone', '-q', origin, floorDir);
  if (mxbuildLine) {
    mkdirSync(path.join(floorDir, '.claude'), { recursive: true });
    writeFileSync(path.join(floorDir, '.claude', 'toolkit.env'), `${mxbuildLine}\n`);
  }
  return floorDir;
}

async function runLiveApp(o: { mxbuildLine?: string; flag: boolean; linux?: boolean; files?: string[] }) {
  const dir = tmp();
  const record = path.join(dir, 'record.json');
  const saved = { FAKE_RECORD: process.env.FAKE_RECORD, FAKE_LINUX: process.env.FAKE_LINUX };
  process.env.FAKE_RECORD = record;
  if (o.linux) process.env.FAKE_LINUX = '1';
  else delete process.env.FAKE_LINUX;
  const states: LiveAppState[] = [];
  const floorDir = floorWithApp(dir, o.mxbuildLine);
  const app = new LiveApp({
    cfg: { ...LIVE_APP_DEFAULTS, ports: { from: 8340, to: 8379 }, readyTimeoutMs: 30_000 },
    mxcli: process.execPath,
    floorId: 'demo',
    floorDir,
    liveDir: path.join(dir, 'live'),
    taken: () => new Set(),
    changed: (s) => states.push(s),
    mxbuild: { pick: (mpr, env) => pickMxbuild(mpr, env, fakeMachine(o.files ?? [])), supportsFlag: async () => o.flag },
  });
  const done = async () => {
    await app.stop('Probe').catch(() => undefined);
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  };
  await app.start('Probe');
  return { app, states, record, done };
}

test('live app: --mxbuild-path from the project’s toolkit.env', { timeout: 60_000 }, async () => {
  const custom = 'D:\\Mendix\\11.12.4\\modeler\\mxbuild.exe';
  const r = await runLiveApp({ mxbuildLine: `MXBUILD_PATH="${custom}"`, flag: true, files: [custom] });
  try {
    await until('running', () => r.app.status === 'running');
    const seen = JSON.parse(readFileSync(r.record, 'utf8')) as { args: string[]; mxbuild: string };
    const at = seen.args.indexOf('--mxbuild-path');
    assert.ok(at > 0, `--mxbuild-path passed (${seen.args.join(' ')})`);
    assert.equal(seen.args[at + 1], custom);
    assert.equal(seen.mxbuild, custom, 'and MXBUILD_PATH in its environment');
    assert.ok(r.app.state.log.some((l) => l.includes(`mxbuild: ${custom} (MXBUILD_PATH in the project's .claude/toolkit.env)`)));
  } finally {
    await r.done();
  }
});

test('live app: Studio Pro of the project’s version when nothing is set; an older mxcli only gets MXBUILD_PATH', { timeout: 60_000 }, async () => {
  const r = await runLiveApp({ flag: false, files: [STUDIO] });
  try {
    await until('running', () => r.app.status === 'running');
    const seen = JSON.parse(readFileSync(r.record, 'utf8')) as { args: string[]; mxbuild: string };
    assert.ok(!seen.args.includes('--mxbuild-path'), 'an mxcli without the flag isn’t given it (it would refuse to start)');
    assert.equal(seen.mxbuild, STUDIO);
  } finally {
    await r.done();
  }
});

test('live app: a Linux mxbuild on Windows fails at once with the honest reason and the fix', { timeout: 60_000 }, async () => {
  const r = await runLiveApp({ flag: true, linux: true, files: [] });
  try {
    await until('failed', () => r.app.status === 'failed');
    const s = r.app.state;
    assert.match(s.message ?? '', /mxcli picked a Linux mxbuild \(C:\\cache\\mxbuild\\11\.6\.0\\modeler\\mxbuild\), which can't run on Windows/);
    assert.match(s.message ?? '', /install Studio Pro 11\.12\.4/);
    assert.match(s.message ?? '', /set the mxbuild path/);
    assert.equal(s.failure?.kind, 'build');
    assert.ok(!r.states.some((x) => x.log.some((l) => /trying once more/.test(l))), 'no retry: cleaning the build can’t fix it');
  } finally {
    await r.done();
  }
});
