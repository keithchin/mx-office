#!/usr/bin/env node
// `npm test`: every tests/*.test.ts, each in a node test process of its own, a few at a time, with a
// time limit per test (--test-timeout), per file, and on the whole run, so no test file can hang the
// suite again (on Windows the workers, repos and DSH tests did, for good). A file that runs past its
// limit is stopped with everything it started and reported as timed out, by name.
//
//   node scripts/test.mjs [tests/a.test.ts …] [--json <file>]
//
// Environment: TEST_CONCURRENCY (files at once; default half the CPUs, 2 to 6), TEST_TIMEOUT_MS (one
// test; default 120000), TEST_FILE_TIMEOUT_MS (one file; default 300000), TEST_WATCHDOG_MS (the whole
// run; default 2400000). Prints one line per file as it ends, then each failure's output, then the
// totals; exit code 0 only when every file passed. --json writes { files, counts, failures } too.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const CONCURRENCY = num(process.env.TEST_CONCURRENCY, Math.min(6, Math.max(2, Math.floor(os.availableParallelism() / 2))));
const TEST_TIMEOUT = num(process.env.TEST_TIMEOUT_MS, 120_000);
const FILE_TIMEOUT = num(process.env.TEST_FILE_TIMEOUT_MS, 300_000);
const WATCHDOG = num(process.env.TEST_WATCHDOG_MS, 40 * 60_000);

const argv = process.argv.slice(2);
const jsonAt = argv.indexOf('--json');
const jsonOut = jsonAt >= 0 ? argv.splice(jsonAt, 2)[1] : undefined;
const files = (argv.length ? argv : fs.readdirSync(path.join(REPO, 'tests')).filter((f) => f.endsWith('.test.ts')).map((f) => `tests/${f}`)).map((f) => f.replaceAll('\\', '/'));

/** Stops a process and everything it started. */
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // gone already
  }
}

const running = new Set();
const results = [];
const started = Date.now();

function runFile(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ['--import', 'tsx', '--import=#tests/css', '--test', `--test-timeout=${TEST_TIMEOUT}`, '--test-reporter=spec', file], {
      cwd: REPO,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    running.add(child);
    let out = '';
    const take = (d) => {
      out += d;
      if (out.length > 4_000_000) out = out.slice(-2_000_000);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, FILE_TIMEOUT);
    child.on('close', (code) => {
      clearTimeout(timer);
      running.delete(child);
      const count = (k) => Number(out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm'))?.[1] ?? 0);
      const r = { file, ms: Date.now() - t0, code, timedOut, pass: count('pass'), fail: count('fail'), skipped: count('skipped'), cancelled: count('cancelled'), out };
      r.ok = !timedOut && code === 0 && r.fail === 0 && r.cancelled === 0;
      const what = timedOut ? `TIMED OUT after ${Math.round(FILE_TIMEOUT / 1000)} s` : `${r.pass} pass${r.fail ? `, ${r.fail} fail` : ''}${r.cancelled ? `, ${r.cancelled} cancelled` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}${code !== 0 && !r.fail ? `, exit ${code}` : ''}`;
      console.log(`${r.ok ? '✔' : '✖'} ${file} (${what}, ${(r.ms / 1000).toFixed(1)} s)`);
      results.push(r);
      resolve(r);
    });
  });
}

const watchdog = setTimeout(() => {
  console.error(`\n✖ the whole run passed ${Math.round(WATCHDOG / 60000)} min: stopping ${running.size} file(s) still going`);
  for (const c of running) killTree(c);
  setTimeout(() => process.exit(2), 2000).unref();
}, WATCHDOG);
watchdog.unref();

console.log(`${files.length} test files, ${CONCURRENCY} at a time (a test may take ${TEST_TIMEOUT / 1000} s, a file ${FILE_TIMEOUT / 1000} s)`);
const queue = [...files];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await runFile(queue.shift());
  }),
);
clearTimeout(watchdog);

const bad = results.filter((r) => !r.ok);
for (const r of bad) {
  console.log(`\n──── ${r.file} ${r.timedOut ? '(timed out)' : ''}`);
  const at = r.out.indexOf('✖ failing tests:');
  console.log((at >= 0 ? r.out.slice(at) : r.out.slice(-6000)).trimEnd());
}
const sum = (k) => results.reduce((n, r) => n + r[k], 0);
const counts = { files: results.length, pass: sum('pass'), fail: sum('fail'), skipped: sum('skipped'), cancelled: sum('cancelled'), timedOut: results.filter((r) => r.timedOut).length };
console.log(`\nℹ files ${counts.files}\nℹ pass ${counts.pass}\nℹ fail ${counts.fail}\nℹ skipped ${counts.skipped}\nℹ cancelled ${counts.cancelled}\nℹ timed out ${counts.timedOut}\nℹ duration_ms ${Date.now() - started}`);
if (jsonOut) {
  const failures = bad.flatMap((r) => (r.timedOut ? [`${r.file}: timed out`] : [...r.out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => `${r.file}: ${m[1]}`).filter((x, i, a) => a.indexOf(x) === i)));
  fs.writeFileSync(jsonOut, JSON.stringify({ files: results.map(({ out, ...r }) => r), counts, failures }, null, 2));
}
process.exit(bad.length ? 1 : 0);
