// The performance guard's harness pieces (scripts/perf/): the budgets are one set of numbers, the CPU
// profile reader finds the long stretches and names what took the time, and the test-office helpers
// refuse anything that isn't a test office and never follow a link out of one when removing it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PERF_BUDGETS } from '../src/shared/testlab.js';
// @ts-expect-error plain .mjs, no types
import { PERF_BUDGETS as HARNESS_BUDGETS } from '../scripts/perf/budgets.mjs';
// @ts-expect-error plain .mjs, no types
import { longStretches } from '../scripts/perf/profile.mjs';
// @ts-expect-error plain .mjs, no types
import { assertTestDir, isTestPath, removeTestDir } from '../scripts/perf/office.mjs';
// @ts-expect-error plain .mjs, no types
import { views } from '../scripts/perf/views.mjs';
import { isTestPath as officeIsTestPath } from '../src/server/testmode.js';

test('the harness budgets are the ones the Test Mode page shows', () => {
  assert.deepEqual(HARNESS_BUDGETS, PERF_BUDGETS);
  assert.equal(PERF_BUDGETS.longTaskMs, 200);
  assert.equal(PERF_BUDGETS.timeToUsableMs, 3000);
});

test('the harness covers every main view', () => {
  const ids = views('f').map((v: { id: string }) => v.id);
  for (const want of ['cc-chat', 'cc-terminal', 'board', 'org', 'workers', 'budget', 'teams', 'audit', 'incidents', 'settings', 'home-projects', 'home-overview', 'home-budget', 'pixel', 'phone', 'mobile']) assert.ok(ids.includes(want), want);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

const frame = (functionName: string, url = '', lineNumber = 0) => ({ functionName, url, lineNumber, columnNumber: 0, scriptId: '1' });

test('a CPU profile: the stretches without idle that pass the budget, and what took their time', () => {
  // root → (idle) | run → draw → layout
  const nodes = [
    { id: 1, callFrame: frame('(root)'), children: [2, 3] },
    { id: 2, callFrame: frame('(idle)') },
    { id: 3, callFrame: frame('run', 'http://x/assets/lite-abc.js', 4), children: [4] },
    { id: 4, callFrame: frame('draw', 'http://x/assets/lite-abc.js', 9), children: [5] },
    { id: 5, callFrame: frame('(program)') },
  ];
  const samples: number[] = [];
  const timeDeltas: number[] = [];
  const add = (id: number, n: number) => {
    for (let i = 0; i < n; i++) {
      samples.push(id);
      timeDeltas.push(1000);
    }
  };
  add(2, 10);
  add(4, 150);
  add(5, 100); // 250 ms without idle: one long task
  add(2, 5);
  add(3, 50); // 50 ms: under the budget
  add(2, 5);
  const out = longStretches({ nodes, samples, timeDeltas }, 200, undefined);
  assert.equal(out.length, 1);
  assert.equal(out[0].ms, 250);
  assert.equal(out[0].at, 11);
  assert.match(out[0].stack[0], /^150 ms self draw lite-abc\.js:10:1$/);
  assert.ok(out[0].stack.some((s: string) => /250 ms total run lite-abc\.js:5:1/.test(s)), 'run is on the stack for all of it');
  // A resolver names the source instead.
  const named = longStretches({ nodes, samples, timeDeltas }, 200, (file: string, line: number) => (file === 'lite-abc.js' ? `src/client/ui/x.ts:${line * 10}` : undefined));
  assert.match(named[0].stack[0], /draw src\/client\/ui\/x\.ts:90$/);
});

test('test offices only: the same folder rule as the office, and a refusal otherwise', () => {
  for (const p of ['C:\\x\\scratch\\test-offices\\perf-guard\\a', '/tmp/test-office-1', 'C:/a/Test-Offices/b']) {
    assert.equal(isTestPath(p), true, p);
    assert.equal(officeIsTestPath(p), true, p);
  }
  for (const p of ['C:\\Users\\me\\agent-office', '/tmp/scratch/office', '']) {
    assert.equal(isTestPath(p), false, p);
    assert.equal(officeIsTestPath(p), false, p);
  }
  assert.throws(() => assertTestDir(path.join(os.tmpdir(), 'agent-office-live')), /refused/);
  assert.throws(() => removeTestDir(path.join(os.tmpdir(), 'not-a-test-folder')), /refused/);
});

test('removing a test office unlinks links inside it and leaves what they point at', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-guard-'));
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  const office = path.join(base, 'test-offices', 'run1');
  fs.mkdirSync(path.join(office, 'floors', 'a'), { recursive: true });
  fs.writeFileSync(path.join(office, 'floors', 'a', 'f.txt'), 'x');
  fs.symlinkSync(outside, path.join(office, 'floors', 'a', 'node_modules'), 'junction');
  removeTestDir(office);
  assert.equal(fs.existsSync(office), false);
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
  fs.rmSync(base, { recursive: true, force: true });
});
