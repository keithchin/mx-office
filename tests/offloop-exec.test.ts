// Starting programs off the event loop (src/server/offloop/exec.ts): the same answers as execFile
// (output, exit codes, a missing program, a time limit, stdin), and the main thread stays free while
// a program starts and runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileOffP, spawnOff, stopExecWorker } from '../src/server/offloop/exec.js';

const node = process.execPath;

test.after(() => stopExecWorker());

test('output, as execFile gives it', async () => {
  const { stdout, stderr } = await execFileOffP(node, ['-e', 'process.stdout.write("out"); process.stderr.write("err")']);
  assert.equal(stdout, 'out');
  assert.equal(stderr, 'err');
});

test('a failing program rejects with its exit code and output', async () => {
  const err = await execFileOffP(node, ['-e', 'process.stderr.write("bad"); process.exit(3)']).then(
    () => assert.fail('should reject'),
    (e) => e,
  );
  assert.equal(err.code, 3);
  assert.equal(err.stderr, 'bad');
});

test('a missing program rejects with ENOENT', async () => {
  const err = await execFileOffP('no-such-program-agent-office-test', []).then(
    () => assert.fail('should reject'),
    (e) => e,
  );
  assert.equal(err.code, 'ENOENT');
});

test('the time limit kills it', async () => {
  const err = await execFileOffP(node, ['-e', 'setTimeout(() => {}, 10000)'], { timeout: 300 }).then(
    () => assert.fail('should reject'),
    (e) => e,
  );
  assert.equal(err.killed, true);
});

test('input goes to stdin; env and cwd are passed', async () => {
  const { stdout } = await execFileOffP(node, ['-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(s+"|"+process.env.OFF_T+"|"+process.cwd()))'], {
    input: 'hello',
    env: { ...process.env, OFF_T: 'yes' },
    cwd: process.cwd(),
  });
  assert.equal(stdout, `hello|yes|${process.cwd()}`);
});

test('the main thread keeps running while programs start and run', async () => {
  // A timer every 10 ms: with execFileSync in a loop instead, it would be late by each run's whole length.
  let worst = 0;
  let last = performance.now();
  const t = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last - 10);
    last = now;
  }, 10);
  await Promise.all(Array.from({ length: 6 }, () => execFileOffP(node, ['-e', '1'])));
  clearInterval(t);
  assert.ok(worst < 150, `the event loop was blocked for ${Math.round(worst)} ms`);
});

test('spawnOff: output as it comes, stdin, the pid, and close with the exit code', async () => {
  const child = spawnOff(node, ['-e', 'process.stdin.on("data", (d) => { process.stdout.write("got " + d); process.exit(4); })'], { stdin: true });
  let out = '';
  child.on('stdout', (d: string) => (out += d));
  await new Promise((r) => child.once('spawn', r));
  assert.ok(child.pid && child.pid > 0);
  child.write('hi');
  const [code] = await new Promise<[number | null]>((r) => child.once('close', (c: number | null) => r([c])));
  assert.equal(code, 4);
  assert.equal(out, 'got hi');
});

test('spawnOff: a missing program is an error with ENOENT, and kill stops a running one', async () => {
  const missing = spawnOff('no-such-program-agent-office-test', []);
  const err = await new Promise<{ code?: string }>((r) => missing.once('error', r));
  assert.equal(err.code, 'ENOENT');
  const long = spawnOff(node, ['-e', 'setTimeout(() => {}, 10000)']);
  await new Promise((r) => long.once('spawn', r));
  long.kill();
  const [code, signal] = await new Promise<[number | null, string | null]>((r) => long.once('close', (c: number | null, s: string | null) => r([c, s])));
  assert.ok(code !== 0 || signal, 'it was stopped');
});
