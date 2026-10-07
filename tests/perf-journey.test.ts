// The end-to-end journey's own pieces (scripts/perf/journey.mjs runs the whole thing against a test office,
// which takes minutes, so `npm test` only pins what it's made of): the step bookkeeping (a step that
// needs a failed one is skipped, not run), the summary, which open incidents fail it, and the fake
// GitHub CLI it runs the office against (journey/fake-gh.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Plain .mjs (no types): the harnesses run without a build.
import { StepBook, journeySummary, judgeIncidents, waitFor } from '../scripts/perf/journey/steps.mjs';

test('steps run in order; a step that needs a failed one is skipped and says why', async () => {
  let t = 0;
  const progress: { done: number; of: number; label: string }[] = [];
  const book = new StepBook({ now: () => (t += 100), onProgress: (p: { done: number; of: number; label: string }) => progress.push(p), total: 4 });
  await book.run({ id: 'a', name: 'A', run: async () => 'did a' });
  await book.run({ id: 'b', name: 'B', needs: ['a'], run: async () => { throw new Error('b broke'); } });
  let ranC = false;
  await book.run({ id: 'c', name: 'C', needs: ['a', 'b'], run: async () => { ranC = true; } });
  await book.run({ id: 'd', name: 'D', needs: ['a'], run: async () => ({ detail: 'did d', screenshot: 'd.png' }) });
  const r = book.result();
  assert.equal(r.ok, false);
  assert.deepEqual(r.steps.map((s: { id: string; ok: boolean }) => [s.id, s.ok]), [['a', true], ['b', false], ['c', false], ['d', true]]);
  assert.equal(ranC, false, 'never run');
  assert.equal(r.steps[2].detail, 'skipped: needs b');
  assert.equal(r.steps[1].detail, 'b broke');
  assert.equal(r.steps[0].ms, 100);
  assert.equal(r.steps[3].screenshot, 'd.png');
  assert.deepEqual(progress.map((p) => p.label), ['A', 'B', 'C', 'D']);
  assert.equal(progress[0].of, 4);
});

test('a run with every step passed is ok; one with none is not', async () => {
  const book = new StepBook();
  assert.equal(book.result().ok, false);
  await book.run({ id: 'a', name: 'A', run: async () => undefined });
  assert.equal(book.result().ok, true);
});

test('the summary is a Markdown table with the count, and cells cannot break it', () => {
  const md = journeySummary({ ok: false, steps: [
    { id: 'a', name: 'Wizard | creates', ok: true, ms: 1500, detail: 'floor x' },
    { id: 'b', name: 'Team', ok: false, ms: 0, detail: 'line one\nline two' },
  ] });
  assert.match(md, /^# End-to-end journey: 1\/2 steps passed/);
  assert.match(md, /\| pass \| Wizard \\\| creates \| 1\.5 \| floor x \|/);
  assert.match(md, /\| \*\*FAIL\*\* \| Team \| 0\.0 \| line one line two \|/);
});

test('waitFor returns the first truthy answer, and times out naming what it waited for', async () => {
  let n = 0;
  assert.equal(await waitFor(() => (++n >= 3 ? 'yes' : undefined), { ms: 2000, every: 5 }), 'yes');
  await assert.rejects(waitFor(() => false, { ms: 30, every: 5, what: 'the moon' }), /waiting for the moon/);
});

test('safety incidents fail the journey; page and server stalls are only reported', () => {
  const inc = (rule: string, status = 'open') => ({ number: 1, title: rule, status, detectedBy: { rule } });
  const { dirty, noted } = judgeIncidents([inc('realLaunch'), inc('interrupted'), inc('serverStall'), inc('pageStall'), inc('crashLoop', 'resolved')]);
  assert.deepEqual(dirty.map((i: { title: string }) => i.title), ['realLaunch', 'interrupted']);
  assert.deepEqual(noted.map((i: { title: string }) => i.title), ['serverStall', 'pageStall']);
});

test('the fake gh keeps pull requests in a file and lists the offline wizard issues', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'test-offices-fake-gh-'));
  mkdirSync(path.join(dir, 'test-org', 'leave-app.issues'), { recursive: true });
  writeFileSync(path.join(dir, 'test-org', 'leave-app.issues', '1.md'), '# Discovery: kickoff\n\nThe brief.\n');
  const gh = (...args: string[]) => execFileSync(process.execPath, [path.join('scripts', 'perf', 'journey', 'fake-gh.mjs'), ...args], { env: { ...process.env, FAKE_GH_DIR: dir }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(gh('pr', 'list', '--state', 'open', '--json', 'number,title')), []);
  assert.match(gh('pr', 'create', '--head', 'office/x', '--title', 'Fix it', '--body', 'b'), /pull\/1/);
  assert.deepEqual(JSON.parse(gh('pr', 'list', '--state', 'open', '--json', 'number,headRefName')), [{ number: 1, headRefName: 'office/x' }]);
  assert.deepEqual(JSON.parse(gh('pr', 'list', '--state', 'merged', '--json', 'number')), []);
  assert.equal(JSON.parse(gh('pr', 'view', '1', '--json', 'url,state')).state, 'OPEN');
  assert.throws(() => execFileSync(process.execPath, [path.join('scripts', 'perf', 'journey', 'fake-gh.mjs'), 'pr', 'view', '9', '--json', 'url'], { env: { ...process.env, FAKE_GH_DIR: dir }, stdio: 'pipe' }));
  const issues = JSON.parse(gh('issue', 'list', '--state', 'open', '--json', 'number,title,state'));
  assert.deepEqual(issues, [{ number: 1, title: 'Discovery: kickoff', state: 'OPEN' }]);
  assert.equal(gh('api', 'user', '--jq', '.login').trim(), 'perf-tester');
});
