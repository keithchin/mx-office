// No console windows from the programs the office, its pty host and the test and perf harnesses start on
// Windows (server/hidewindows.ts and explicit windowsHide): with Windows Terminal as the default terminal,
// a console program started by a process without a console opened a window of its own ("a lot of
// terminals opening up" during test runs: node-pty forking its helper from the detached pty host).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { hideChildWindows, withWindowsHidden } from '../src/server/hidewindows.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('every child_process call gets windowsHide: true unless it says otherwise, its other options and callback kept', () => {
  const cb = () => undefined;
  assert.deepEqual(withWindowsHidden('spawn', ['git']), ['git', { windowsHide: true }]);
  assert.deepEqual(withWindowsHidden('spawn', ['git', ['status']]), ['git', ['status'], { windowsHide: true }]);
  assert.deepEqual(withWindowsHidden('spawn', ['git', ['status'], { cwd: 'x' }]), ['git', ['status'], { cwd: 'x', windowsHide: true }]);
  assert.deepEqual(withWindowsHidden('spawn', ['git', { cwd: 'x' }]), ['git', { cwd: 'x', windowsHide: true }]);
  assert.deepEqual(withWindowsHidden('execFile', ['git', ['status'], cb]), ['git', ['status'], { windowsHide: true }, cb]);
  assert.deepEqual(withWindowsHidden('execFile', ['git', cb]), ['git', { windowsHide: true }, cb]);
  assert.deepEqual(withWindowsHidden('execFile', ['git', ['status'], undefined, cb]), ['git', ['status'], { windowsHide: true }, cb]);
  assert.deepEqual(withWindowsHidden('exec', ['git status', cb]), ['git status', { windowsHide: true }, cb]);
  assert.deepEqual(withWindowsHidden('execSync', ['git status', { encoding: 'utf8' }]), ['git status', { encoding: 'utf8', windowsHide: true }]);
  assert.deepEqual(withWindowsHidden('fork', ['agent.js', ['1']]), ['agent.js', ['1'], { windowsHide: true }]);
  // Said: kept (Studio Pro and the browser are windows of their own).
  assert.deepEqual(withWindowsHidden('spawn', ['studio', [], { detached: true, windowsHide: false }]), ['studio', [], { detached: true, windowsHide: false }]);
  const opts = { cwd: 'x' };
  withWindowsHidden('spawn', ['git', [], opts]);
  assert.deepEqual(opts, { cwd: 'x' }, 'the caller’s object is not changed');
});

test('patched, child_process still runs programs, and execFile’s promise form still gives { stdout, stderr }', async () => {
  hideChildWindows('win32');
  hideChildWindows('win32');
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write("hi")'], { encoding: 'utf8' });
  assert.equal(r.stdout, 'hi');
  const p = promisify(execFile)(process.execPath, ['-e', 'process.stdout.write("ok")']);
  assert.ok((p as unknown as { child?: unknown }).child, 'the promise carries the child');
  const { stdout } = await p;
  assert.equal(stdout, 'ok');
  await assert.rejects(promisify(execFile)(process.execPath, ['-e', 'process.stderr.write("bad"); process.exit(3)']), (e: Error & { code?: number; stderr?: string }) => e.code === 3 && e.stderr === 'bad');
});

test('the office and its pty host load it first; what they start themselves says windowsHide; the shims and harnesses too', () => {
  assert.match(read('src/server/cli.ts'), /^\/\/ First: [^\n]*\nimport '\.\/hidewindows\.js';/);
  assert.match(read('src/server/ptyhost.ts'), /\n\/\/ First: node-pty forks[^\n]*\nimport '\.\/hidewindows\.js';/);
  // node-pty's helper, forked from the detached host on every session it stops, with no options of its own.
  assert.match(read('src/server/ptys.ts'), /spawnOff\(process\.execPath, \[[^\]]*\], \{ detached: true, cwd, windowsHide: true \}\)/);
  assert.match(read('src/server/offloop/exec.ts'), /const o: SpawnOptions = \{ windowsHide: true, /);
  assert.match(read('src/server/offloop/exec.ts'), /const o: ExecFileOptions = \{ windowsHide: true, /);
  // The browser it opens is a window.
  assert.match(read('src/server/browser.ts'), /detached: true, windowsHide: false \}/);
  // The tests' and the journey's shims: node gets no window of its own when the shim has no console.
  for (const f of ['tests/support/shim.cs', 'scripts/perf/journey/stubs.mjs']) assert.match(read(f), /psi\.CreateNoWindow = GetConsoleCP\(\) == 0;/, f);
  for (const f of ['tests/support/winshim.ts', 'scripts/perf/slowstart.mjs', 'scripts/perf/journey/stubs.mjs']) assert.match(read(f), /shim\.cs'\)\], \{ stdio: 'pipe', windowsHide: true \}\)/, `${f}: csc`);
  assert.match(read('scripts/test.mjs'), /windowsHide: true,\n\s+\}\);/);
  assert.match(read('scripts/test.mjs'), /'\/PID', String\(child\.pid\)\], \{ stdio: 'ignore', windowsHide: true \}/);
  const office = read('scripts/perf/office.mjs');
  assert.match(office, /'--no-open'\], \{[^}]*windowsHide: true,/);
  assert.equal((office.match(/execFileSync\('(taskkill|powershell\.exe)'[^\n]*windowsHide: true/g) ?? []).length, 3, 'taskkill and both PowerShell queries');
  assert.match(read('scripts/perf/diskload.mjs'), /fork\(SELF, [^\n]*\{ stdio: 'ignore', windowsHide: true \}\)/);
  for (const f of ['scripts/perf/run.mjs', 'scripts/perf/suite.mjs', 'scripts/perf/busy.mjs']) assert.match(read(f), /windowsHide: true/, f);
});
