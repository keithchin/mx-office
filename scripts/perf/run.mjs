#!/usr/bin/env node
// Runs one suite of the performance guard against a throwaway TEST office, and writes its result where
// the Test Mode page (/lite?tab=tests) reads it. Never the live office: the test office is made fresh
// under --root (which must be under scratch/test-offices or a test-office… folder), runs in test mode
// with the fake agent only, and is removed after (--keep leaves it).
//
//   node scripts/perf/run.mjs --suite <unit|pages|journey|command-center> --root <test-offices dir>
//     --out <run dir> --id <run id> [--soak <s>] [--scale <n>] [--only a,b] [--keep]
//
// Writes <run dir>/result.json (src/shared/testlab.ts RunResult), <run dir>/summary.md and screenshots.
// Prints `@@progress {"done":n,"of":m,"label":"…"}` lines as it goes. Exit 0 pass, 1 fail, 2 refused/error.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, assertTestDir, startTestOffice, killRealAgentsUnder, removeTestDir, PASSWORD } from './office.mjs';
import { PERF_BUDGETS } from './budgets.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const suite = arg('suite');
const root = arg('root');
const id = arg('id', `run-${Date.now().toString(36)}`);
const outDir = path.resolve(arg('out', path.join(root ?? '.', id, 'out')));
const keep = process.argv.includes('--keep');
const progress = (p) => console.log(`@@progress ${JSON.stringify(p)}`);
const started = Date.now();

function finish(result, code) {
  const full = { id, suite, startedAt: started, finishedAt: Date.now(), durationMs: Date.now() - started, ...result };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(full, null, 2));
  if (result.summary) fs.writeFileSync(path.join(outDir, 'summary.md'), result.summary);
  delete full.summary;
  console.log(`${full.ok ? 'PASS' : 'FAIL'}: ${suite} in ${Math.round(full.durationMs / 1000)} s${full.error ? ` (${full.error})` : ''}`);
  process.exit(code ?? (full.ok ? 0 : 1));
}

/** Runs `node <args>` from the repo, its output passed through; resolves with its exit code and output. */
function node(args, { env = {}, quiet = false, timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd: REPO, env: { ...process.env, ...env }, windowsHide: true });
    let out = '';
    const take = (d) => {
      out += d;
      if (out.length > 4e6) out = out.slice(-2e6);
      if (!quiet) process.stdout.write(d);
    };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on('exit', (code) => {
      clearTimeout(t);
      resolve({ code, out });
    });
  });
}

const VALID = ['unit', 'pages', 'journey', 'command-center'];
if (!VALID.includes(suite)) {
  console.error(`usage: run.mjs --suite ${VALID.join('|')} --root <test-offices dir> --out <dir> --id <id>`);
  process.exit(2);
}
if (suite !== 'unit') {
  try {
    if (!root) throw new Error('refused: no --root for the test office');
    assertTestDir(root, 'the test offices folder');
  } catch (e) {
    finish({ ok: false, error: e.message }, 2);
  }
}
const officeRoot = root ? path.resolve(root, id) : undefined;

/** A fresh big-data office for the run (scripts/perf/fixture.ts). */
async function fixture(scale) {
  progress({ done: 0, of: 1, label: `Making the test office (scale ${scale})` });
  const r = await node(['--import', 'tsx', 'scripts/perf/fixture.ts', '--out', officeRoot, '--scale', String(scale), '--seed', '42', '--base', new Date().toISOString()], { quiet: true });
  if (r.code !== 0) throw new Error(`the fixture generator failed: ${r.out.slice(-800)}`);
  const floors = JSON.parse(fs.readFileSync(path.join(officeRoot, 'office', '.agent-office', 'floors.json'), 'utf8'));
  return { home: path.join(officeRoot, 'office'), floor: floors[0].id, other: floors[1]?.id };
}

async function withOffice(scale, fn) {
  const { home, floor, other } = await fixture(scale);
  progress({ done: 0, of: 1, label: 'Starting the test office' });
  const office = await startTestOffice({ home, env: { FAKE_RATE_MS: arg('rate', '400') } });
  console.log(`test office up at ${office.base} (floor ${floor}, ${home})`);
  try {
    return await fn(office, floor, home, other);
  } finally {
    await office.stop().catch((e) => console.error(String(e.message)));
  }
}

async function runSuite() {
  if (suite === 'unit') {
    // Every test file but the ones known to hang on Windows (the next pass fixes those).
    const skip = new Set(process.platform === 'win32' ? ['dsh.test.ts', 'repos.test.ts', 'workers.test.ts'] : []);
    const files = fs.readdirSync(path.join(REPO, 'tests')).filter((f) => f.endsWith('.test.ts') && !skip.has(f)).map((f) => `tests/${f}`);
    progress({ done: 0, of: 1, label: `${files.length} test files` });
    const r = await node(['--import', 'tsx', '--import=#tests/css', '--test', '--test-reporter=tap', '--test-concurrency=4', ...files], { quiet: true });
    const num = (k) => Number(r.out.match(new RegExp(`^# ${k} (\\d+)`, 'm'))?.[1] ?? 0);
    const failures = [...r.out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim()).filter((n) => !/\.test\.ts$/.test(n) || true).slice(0, 100);
    const counts = { pass: num('pass'), fail: num('fail'), skip: num('skipped') };
    console.log(r.out.split('\n').filter((l) => /^# /.test(l)).join('\n'));
    const skipped = [...skip].map((f) => `skipped on Windows: tests/${f}`);
    return { ok: r.code === 0 && counts.fail === 0, counts, failures, summary: `# Unit tests: ${counts.pass} pass, ${counts.fail} fail\n\n${[...failures.map((f) => `- FAIL ${f}`), ...skipped.map((s) => `- ${s}`)].join('\n')}\n` };
  }
  if (suite === 'pages') {
    const { runPages, pagesSummary } = await import('./pages.mjs');
    return withOffice(Number(arg('scale', '10')), async (office, floor, _home, other) => {
      // Give the live workers a moment to come up and start sending.
      await new Promise((r) => setTimeout(r, 4000));
      const res = await runPages({ base: office.base, floor, other, password: PASSWORD, outDir, soakSeconds: Number(arg('soak', PERF_BUDGETS.soakSeconds)), only: arg('only')?.split(','), onProgress: progress });
      return { ...res, officeDir: officeRoot, summary: pagesSummary(res), failures: res.views.filter((v) => !v.ok).map((v) => `${v.name}: ${v.failures.join('; ')}`) };
    });
  }
  if (suite === 'command-center') {
    return withOffice(Number(arg('scale', '10')), async (office, floor) => {
      await new Promise((r) => setTimeout(r, 4000));
      const failures = [];
      for (const [i, view] of ['chat', 'terminal'].entries()) {
        progress({ done: i, of: 2, label: `Command Center (${view})` });
        const r = await node(['scripts/check-command-center.mjs', '--base', office.base, '--password', PASSWORD, '--floor', floor, '--seconds', '15', '--view', view]);
        if (r.code !== 0) failures.push(`${view}: ${r.out.match(/FAIL: (.*)/)?.[1] ?? `exit ${r.code}`}`);
      }
      progress({ done: 2, of: 2, label: 'done' });
      return { ok: failures.length === 0, failures, officeDir: officeRoot, counts: { pass: 2 - failures.length, fail: failures.length }, summary: `# Command Center check: ${failures.length ? 'FAIL' : 'pass'}\n\n${failures.map((f) => `- ${f}`).join('\n')}\n` };
    });
  }
  if (suite === 'journey') {
    const { runJourney, journeySummary } = await import('./journey.mjs');
    const res = await runJourney({ root: officeRoot, outDir, onProgress: progress });
    return { ...res, officeDir: officeRoot, summary: journeySummary(res) };
  }
}

let result;
let code;
try {
  result = await runSuite();
} catch (e) {
  result = { ok: false, error: String(e?.message ?? e).slice(0, 2000) };
  code = 2;
} finally {
  if (officeRoot) {
    const real = killRealAgentsUnder(officeRoot);
    if (real.length) {
      result = { ...(result ?? {}), ok: false, error: `real agent CLIs ran under the test office and were killed: ${real.join('; ')}` };
      code = 2;
    }
    if (!keep && fs.existsSync(officeRoot) && !outDir.startsWith(officeRoot)) removeTestDir(officeRoot);
  }
}
finish(result, code);
