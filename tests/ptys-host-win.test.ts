// The Windows terminal host (src/server/ptys.ts, ptyhost.ts): workers' terminals run in a process of
// their own, tied to the office, so that node-pty's native calls (CreateProcess above all: seconds for a
// big binary under the virus scanner) never hold the office's event loop. What it must keep: output,
// input (multi-line too), resize, exit codes, kill; and nothing may outlive it, or the office.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PtyHost, type Pty, type PtyExit } from '../src/server/ptys.js';
import { removeDir } from './support/cleanup.js';

const skip = process.platform !== 'win32' && 'the tied host is Windows-only (Unix has the detached one)';
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitFor<T>(fn: () => T | undefined | false, ms = 15_000, what = 'it'): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function hostPids(dir: string): number[] {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*ptyhost*' -and $_.CommandLine -like '*${dir.replaceAll("'", "''")}*' } | ForEach-Object { $_.ProcessId }`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean).map(Number);
}

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pty-host-win-'));
  t.after(() => removeDir(dir));
  return dir;
}

function collect(p: Pty) {
  const out = { text: '', exit: undefined as PtyExit | undefined };
  p.onData((d) => (out.text += d));
  p.onExit((e) => (out.exit = e));
  return out;
}

const env = () => Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'));

test('terminals run in the host: output, multi-line input, resize, pid, exit code', { skip }, async (t) => {
  const dir = fixture(t);
  const host = new PtyHost(dir, () => {});
  t.after(() => host.stop());
  assert.equal(await host.connect(), true);
  assert.equal(host.hosted, true);
  const script = path.join(dir, 'echo.cjs');
  writeFileSync(
    script,
    `process.stdout.write('ready=' + process.stdout.columns + 'x' + process.stdout.rows + '\\n');
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  if (buf.includes('END')) { process.stdout.write('lines=' + buf.split(/\\r\\n|\\r|\\n/).filter(Boolean).length + '\\n'); setTimeout(() => process.exit(7), 100); }
});`,
  );
  const p = host.spawn({ file: process.execPath, args: [script], cwd: dir, env: env(), cols: 100, rows: 30 });
  // Not one the next office could adopt: a Windows host's terminals end with the office.
  assert.equal(p.id, undefined);
  const out = collect(p);
  await waitFor(() => /ready=100x30/.test(out.text), 15_000, 'the first output');
  await waitFor(() => p.pid > 0, 5000, 'the pid');
  assert.equal(alive(p.pid), true);
  p.resize(120, 40);
  // The pseudo console says its new size (node in it keeps the size it started with).
  await waitFor(() => out.text.includes('\x1b[8;40;120t'), 10_000, 'the resize');
  p.write('one\rtwo\rthree\rEND\r');
  await waitFor(() => out.exit, 10_000, 'the exit');
  assert.match(out.text, /lines=4/);
  assert.equal(out.exit!.exitCode, 7);
  assert.equal(out.exit!.lost, undefined);
});

test('kill ends the process; a program that cannot start says so', { skip }, async (t) => {
  const dir = fixture(t);
  const host = new PtyHost(dir, () => {});
  t.after(() => host.stop());
  assert.equal(await host.connect(), true);
  const p = host.spawn({ file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000); console.log("up")'], cwd: dir, env: env(), cols: 80, rows: 24 });
  const out = collect(p);
  await waitFor(() => /up/.test(out.text) && p.pid > 0, 15_000, 'it to start');
  const pid = p.pid;
  p.kill();
  await waitFor(() => out.exit, 10_000, 'the exit after kill');
  await waitFor(() => !alive(pid), 5000, 'the process to be gone');

  const bad = host.spawn({ file: path.join(dir, 'no-such-program.exe'), args: [], cwd: dir, env: env(), cols: 80, rows: 24 });
  const badOut = collect(bad);
  await waitFor(() => badOut.exit, 10_000, 'the failed start to be reported');
  assert.notEqual(badOut.exit!.exitCode, 0);
});

test('if the host dies, its terminals are reported lost (their processes gone with it) and a fresh host runs the next ones', { skip }, async (t) => {
  const dir = fixture(t);
  let lost = 0;
  const host = new PtyHost(dir, () => lost++);
  t.after(() => host.stop());
  assert.equal(await host.connect(), true);
  const p = host.spawn({ file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000); console.log("up")'], cwd: dir, env: env(), cols: 80, rows: 24 });
  const out = collect(p);
  await waitFor(() => /up/.test(out.text) && p.pid > 0, 15_000, 'it to start');
  const [hostPid] = hostPids(dir);
  assert.ok(hostPid, 'the host process is found');
  execFileSync('taskkill', ['/F', '/PID', String(hostPid)], { stdio: 'ignore' });
  await waitFor(() => out.exit, 10_000, 'the lost exit');
  assert.equal(out.exit!.lost, true);
  assert.equal(lost, 1);
  // Closing its pseudo console ended what ran in it: no orphan.
  await waitFor(() => !alive(p.pid), 5000, "the dead host's terminal process to be gone");
  // What starts right away (a worker resuming) waits for the fresh host and runs there.
  const next = host.spawn({ file: process.execPath, args: ['-e', 'console.log("again"); setTimeout(() => process.exit(3), 200)'], cwd: dir, env: env(), cols: 80, rows: 24 });
  const nextOut = collect(next);
  await waitFor(() => nextOut.exit, 20_000, 'the terminal in the fresh host');
  assert.match(nextOut.text, /again/);
  assert.equal(nextOut.exit!.exitCode, 3);
  assert.equal(host.hosted, true);
  const pids = hostPids(dir);
  assert.equal(pids.length, 1);
  assert.notEqual(pids[0], hostPid);
});

test('when the office dies without a word, the host ends its terminals and exits', { skip }, async (t) => {
  const dir = fixture(t);
  // A stand-in office: connects a host, starts a long-running terminal, says the pids, and waits to be killed.
  const office = path.join(dir, 'office.mts');
  const pids = path.join(dir, 'pids.json');
  writeFileSync(
    office,
    `import { writeFileSync } from 'node:fs';
import { PtyHost } from ${JSON.stringify(pathToFileURL(path.join(REPO, 'src', 'server', 'ptys.ts')).href)};
const host = new PtyHost(${JSON.stringify(dir)}, () => {});
if (!(await host.connect())) process.exit(5);
const env = Object.fromEntries(Object.entries(process.env).filter((e) => typeof e[1] === 'string'));
const p = host.spawn({ file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000); console.log("up")'], cwd: ${JSON.stringify(dir)}, env, cols: 80, rows: 24 });
p.onData(() => { if (p.pid) writeFileSync(${JSON.stringify(pids)}, JSON.stringify({ child: p.pid })); });
setInterval(() => {}, 1000);
`,
  );
  const proc = spawn(process.execPath, ['--import', 'tsx', office], { cwd: REPO, stdio: 'ignore', windowsHide: true });
  t.after(() => proc.kill());
  const { child } = await waitFor(() => existsSync(pids) && (JSON.parse(readFileSync(pids, 'utf8')) as { child: number }), 30_000, 'the stand-in office to start its terminal');
  const [hostPid] = hostPids(dir);
  assert.ok(hostPid && alive(child));
  execFileSync('taskkill', ['/F', '/PID', String(proc.pid)], { stdio: 'ignore' });
  await waitFor(() => !alive(hostPid) && !alive(child), 10_000, 'the host and its terminal to end with the office');
});

test("a slow program start doesn't hold the office's event loop", { skip }, async (t) => {
  const dir = fixture(t);
  const host = new PtyHost(dir, () => {});
  t.after(() => host.stop());
  assert.equal(await host.connect(), true);
  // Fresh copies of node: the virus scanner looks at each one as it starts (seconds, in-process).
  const exes = [0, 1, 2].map((i) => {
    const exe = path.join(dir, `slow-start-${i}.exe`);
    copyFileSync(process.execPath, exe);
    return exe;
  });
  let last = performance.now();
  let longest = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last - 10);
    last = now;
  }, 10);
  try {
    const outs = exes.map((file) => collect(host.spawn({ file, args: ['-e', 'console.log("up"); setTimeout(() => {}, 500)'], cwd: dir, env: env(), cols: 80, rows: 24 })));
    await waitFor(() => outs.every((o) => o.exit), 60_000, 'every slow start to run and exit');
    assert.ok(outs.every((o) => /up/.test(o.text)));
  } finally {
    clearInterval(tick);
  }
  assert.ok(longest < 250, `the event loop was held ${Math.round(longest)} ms`);
});

test('a terminal asked for while the host is still starting waits for it, and runs there', { skip }, async (t) => {
  const dir = fixture(t);
  const host = new PtyHost(dir, () => {});
  t.after(() => host.stop());
  // The office hires before its floor's host is up (a project the wizard just made).
  const connecting = host.connect();
  assert.equal(host.hosted, false);
  const p = host.spawn({ file: process.execPath, args: ['-e', 'console.log("waited"); setTimeout(() => process.exit(4), 200)'], cwd: dir, env: env(), cols: 80, rows: 24 });
  p.write('typed early\r');
  const out = collect(p);
  assert.equal(await connecting, true);
  await waitFor(() => out.exit, 20_000, 'the exit');
  assert.match(out.text, /waited/);
  assert.equal(out.exit!.exitCode, 4);
  assert.equal(hostPids(dir).length, 1, 'it ran in the host');
});
