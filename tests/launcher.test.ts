// The portable launcher (scripts/start-office.ps1) and its shortcut (scripts/install-shortcut.ps1): both
// parse in Windows PowerShell, use no personal paths, and the launcher's -DryRun shows what it would
// start the office with from its options and the environment (an environment variable set already
// wins over its defaults, so the older launcher keeps working). Plus finding and running a program the
// way the first-run checks do (a .cmd shim through cmd.exe), and the performance guard's cleanup that
// never fails a run (scripts/perf/office.mjs cleanupTestDir).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findOnPath, runOff } from '../src/server/first-run/checks.js';
// @ts-expect-error: a plain .mjs script, no types
import { cleanupTestDir } from '../scripts/perf/office.mjs';

const root = path.join(import.meta.dirname, '..');
const SCRIPTS = ['scripts/start-office.ps1', 'scripts/install-shortcut.ps1'];
const win = process.platform === 'win32';
const ps = (args: string[], env: NodeJS.ProcessEnv = {}) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true, timeout: 60_000 });

test('both scripts are ASCII and have no personal paths in them', () => {
  for (const f of SCRIPTS) {
    const text = readFileSync(path.join(root, f), 'utf8');
    assert.ok(/^[\x00-\x7f]*$/.test(text), `${f} is ASCII (Windows PowerShell 5.1 reads it in the code page)`);
    assert.ok(!/agent-spike|z00556et|AI-Taskforce|C:\\Users\\/i.test(text), `${f} has no personal paths`);
  }
});

test('both scripts parse in Windows PowerShell', { skip: !win }, () => {
  for (const f of SCRIPTS) {
    const out = ps(['-Command', `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path.join(root, f)}', [ref]$null, [ref]$e); $e.Count`]);
    assert.equal(out.trim(), '0', `${f} parses without errors`);
  }
});

const dry = (args: string[], env: NodeJS.ProcessEnv = {}) => JSON.parse(ps(['-File', path.join(root, 'scripts', 'start-office.ps1'), '-DryRun', ...args], env));

test('the launcher: office home and port from its options, else the environment, else %USERPROFILE%\\mx-office and 4600', { skip: !win }, () => {
  const clean = { AGENT_OFFICE_HOME: '', AGENT_OFFICE_PROJECTS: '', PORT: '', AGENT_OFFICE_NO_OPEN: '', USERPROFILE: 'C:\\Users\\someone' };
  const d = dry([], clean);
  assert.equal(d.officeHome, 'C:\\Users\\someone\\mx-office');
  assert.equal(d.homeFrom, 'default');
  assert.equal(d.port, 4600);
  assert.equal(d.setEnv.AGENT_OFFICE_HOME, d.officeHome);
  assert.equal(d.setEnv.AGENT_OFFICE_PROJECTS, d.officeHome);
  assert.equal(d.setEnv.AGENT_OFFICE_LAUNCHER_LOOP, '1', 'Restart safely is offered');
  assert.equal(d.setEnv.AGENT_OFFICE_NO_WELCOME, '1', 'the browser’s setup, not the terminal walkthrough');
  assert.equal(d.restartExitCode, 75);
  assert.deepEqual(d.officeArgs, []);
  assert.equal(d.entry, path.join(root, 'bin', 'agent-office.js'));

  // The older launcher's variables win over the defaults and are left as they are.
  const env = dry([], { ...clean, AGENT_OFFICE_HOME: 'C:\\Office\\home', AGENT_OFFICE_PROJECTS: 'D:\\Projects', PORT: '4701' });
  assert.equal(env.officeHome, 'C:\\Office\\home');
  assert.equal(env.homeFrom, 'env');
  assert.equal(env.setEnv.AGENT_OFFICE_HOME, undefined, 'not set again');
  assert.equal(env.setEnv.AGENT_OFFICE_PROJECTS, undefined);
  assert.equal(env.port, 4701);
  assert.deepEqual(env.officeArgs, [], 'PORT is read by the office itself');

  // Options beat both; anything else goes to the office as it is.
  const opt = dry(['-OfficeHome', 'C:\\Elsewhere', '-Port', '4710', '-NoBrowser', '--city', 'Berlin'], { ...clean, AGENT_OFFICE_HOME: 'C:\\Office\\home' });
  assert.equal(opt.officeHome, 'C:\\Elsewhere');
  assert.equal(opt.setEnv.AGENT_OFFICE_HOME, 'C:\\Elsewhere');
  assert.deepEqual(opt.officeArgs, ['--port', '4710', '--city', 'Berlin']);
  assert.equal(opt.setEnv.AGENT_OFFICE_NO_OPEN, '1');
  assert.equal(opt.url, 'http://localhost:4710');
});

test('the launcher reads the office’s own settings: the mxcli picked in setup goes first on PATH', { skip: !win }, () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'launcher-home-'));
  const tools = path.join(home, 'tools');
  mkdirSync(path.join(home, '.agent-office'), { recursive: true });
  mkdirSync(tools);
  writeFileSync(path.join(home, '.agent-office', 'office-settings.json'), JSON.stringify({ mxcliPath: path.join(tools, 'mxcli.exe'), projectOrg: 'acme' }));
  const d = dry(['-OfficeHome', home], { AGENT_OFFICE_HOME: '' });
  assert.equal(d.mxcli, path.join(tools, 'mxcli.exe'));
  assert.deepEqual([d.pathAdd].flat(), [tools]);
  // A settings file it can't read is skipped, not fatal.
  writeFileSync(path.join(home, '.agent-office', 'office-settings.json'), '{ not json');
  assert.equal(dry(['-OfficeHome', home], { AGENT_OFFICE_HOME: '' }).mxcli, null);
});

test('the shortcut runs start-office.ps1 from this checkout with the options given', { skip: !win }, () => {
  const out = JSON.parse(ps(['-File', path.join(root, 'scripts', 'install-shortcut.ps1'), '-DryRun', '-Port', '4610', '-OfficeHome', 'D:\\office', '-NoStartMenu']));
  assert.equal([out.links].flat().length, 1);
  assert.match([out.links].flat()[0], /Mx Office\.lnk$/);
  assert.match(out.target, /powershell\.exe$/i);
  assert.ok(out.arguments.includes(path.join(root, 'scripts', 'start-office.ps1')));
  assert.match(out.arguments, /-Port 4610/);
  assert.match(out.arguments, /-OfficeHome "D:\\office"/);
  assert.equal(out.workingDirectory, root);
});

test('a program is found on PATH with PATHEXT, and a .cmd shim runs through cmd.exe, off the event loop', { skip: !win }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'shim dir '));
  writeFileSync(path.join(dir, 'fakegh.cmd'), '@echo off\r\necho fake gh %*\r\n');
  const env = { PATH: `${dir};${process.env.PATH}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const found = await findOnPath('fakegh', env, 'win32');
  assert.equal(found?.toLowerCase(), path.join(dir, 'fakegh.cmd').toLowerCase());
  const r = await runOff(found!, ['auth', 'status']);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'fake gh auth status');
  assert.equal(await findOnPath('surely-not-installed-xyz', env, 'win32'), undefined);
});

test('the performance guard’s cleanup tries a held folder again, and never fails the run when it still won’t go', async () => {
  const held = (times: number, code = 'EPERM') => {
    let n = 0;
    return () => {
      if (n++ < times) throw Object.assign(new Error(`${code}: operation not permitted`), { code });
    };
  };
  const warned: string[] = [];
  const slept: number[] = [];
  const opts = { delayMs: 5, warn: (m: string) => warned.push(m), sleep: async (ms: number) => void slept.push(ms) };
  assert.equal(await cleanupTestDir('C:/x/test-offices/a', { ...opts, remove: held(2) }), true, 'gone on the third try');
  assert.deepEqual(slept, [5, 5]);
  assert.deepEqual(warned, []);
  assert.equal(await cleanupTestDir('C:/x/test-offices/b', { ...opts, attempts: 3, remove: held(99, 'EBUSY') }), false, 'never throws');
  assert.equal(warned.length, 1);
  assert.match(warned[0], /EBUSY.*left in place/);
  // Anything else isn't retried, and still doesn't fail the run.
  slept.length = 0;
  assert.equal(await cleanupTestDir('C:/x/test-offices/c', { ...opts, remove: held(1, 'ENOENT_ODD') }), false);
  assert.deepEqual(slept, []);
});
