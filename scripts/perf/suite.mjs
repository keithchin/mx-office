#!/usr/bin/env node
// `npm run test:perf` and `npm run test:perf:quick`: the performance guard from a terminal, through the
// same entry points the Test Mode page's ▶ Run uses (scripts/test.mjs for the guard's own unit tests,
// scripts/perf/run.mjs for the suites). Every run makes its own throwaway TEST office under
// <scratch/test-offices>/perf-guard/runs (the nearest scratch/test-offices above this checkout, or
// AGENT_OFFICE_TEST_OFFICES), with fake agents only, and removes it after.
//
//   node scripts/perf/suite.mjs            the fixture's tests, every view (60 s soak each), the switch
//                                          stress, the journey and 3 minutes of the busy office (live
//                                          workers, no server stall over 250 ms; about 35 minutes)
//   node scripts/perf/suite.mjs --quick    the fixture's tests, the main views (5 s soak), the journey
//                                          and a minute of the busy office (a few minutes): what to run
//                                          before committing a UI or server change
//
// Needs a build (`npm run build`; the npm scripts build first). Exit code 0 when everything passed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const quick = process.argv.includes('--quick');

/** Where the test offices go: the same rule as the Test Mode page (server/testlab/logic.ts runsRoot). */
function runsRoot() {
  if (process.env.AGENT_OFFICE_TEST_OFFICES) return path.resolve(process.env.AGENT_OFFICE_TEST_OFFICES);
  for (let dir = REPO; ; dir = path.dirname(dir)) {
    const c = path.join(dir, 'scratch', 'test-offices');
    if (fs.existsSync(c)) return path.join(c, 'perf-guard', 'runs');
    if (path.dirname(dir) === dir) break;
  }
  return path.join(os.tmpdir(), 'test-offices', 'agent-office-runs');
}

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out = (d) => process.stdout.write(String(d).replace(/^@@progress (.*)$/gm, (_, j) => {
      try {
        const x = JSON.parse(j);
        return `  … ${x.label ?? ''} (${x.done}/${x.of})`;
      } catch {
        return '';
      }
    }));
    p.stdout.on('data', out);
    p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('exit', (code) => resolve(code ?? 1));
  });
}

if (!fs.existsSync(path.join(REPO, 'dist', 'server', 'server', 'cli.js'))) {
  console.error('The office is not built: run `npm run build` first (the npm scripts do).');
  process.exit(2);
}
const root = runsRoot();
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const results = [];
const step = async (name, args) => {
  console.log(`\n=== ${name}`);
  const code = await run(args);
  results.push({ name, ok: code === 0, code });
};

await step('Performance guard unit tests (fixture, budgets, journey bookkeeping, server caches, stall guard, self-profiling)', ['scripts/test.mjs', 'tests/perf-fixture.test.ts', 'tests/perf-budgets.test.ts', 'tests/perf-journey.test.ts', 'tests/perf-server.test.ts', 'tests/offloop-exec.test.ts', 'tests/offloop-io.test.ts', 'tests/stall-guard.test.ts', 'tests/perfwatch-self.test.ts']);
if (quick) {
  const id = `quick-${stamp}`;
  await step('Quick: main views, the journey and the busy office', ['scripts/perf/run.mjs', '--suite', 'perf-quick', '--root', root, '--id', id, '--out', path.join(root, 'results', id)]);
} else {
  for (const suite of ['pages', 'journey', 'busy']) {
    const id = `${suite}-${stamp}`;
    const name = { pages: 'Every view, 60 s soak each, and the switch stress', journey: 'The end-to-end journey', busy: 'The busy office: live workers for 3 minutes, no server stall' }[suite];
    await step(name, ['scripts/perf/run.mjs', '--suite', suite, '--root', root, '--id', id, '--out', path.join(root, 'results', id)]);
  }
}
console.log('\n=== Performance guard');
for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.ok ? '' : ` (exit ${r.code})`}`);
console.log(`Results (result.json, summary.md, screenshots): ${path.join(root, 'results')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
