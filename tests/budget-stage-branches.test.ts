// Main lags the team (release 81): spend was booked to "Stage P" for days because the stage is read from main,
// and the team's PROJECT.md with Stage P and 0 confirmed was still on its branch; the forecast warned about Stage P
// wrongly. Now a later stage the team settled on a recent branch is the one in use, and the Budget tab says where
// it came from and what main still says. A real git repository (a bare origin and a clone), no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { laterStage, refreshStage, registerStage, stageSourceOf } from '../src/server/budget/stage.js';
import { setupViewOf } from '../src/server/wizard/setup.js';

const register = (rows: [string, string, string][]) => `# Project\n\nEntry mode: requirements-driven\n\n## Decisions\n\n| Stage | Decision | Status |\n| --- | --- | --- |\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;

test('registerStage: a stage CONFIRMED in the Decisions counts as settled; laterStage orders P before 0-7', () => {
  const md = register([['0', 'Scope agreed', 'CONFIRMED by the PM']]);
  assert.equal(registerStage(setupViewOf({ 'PROJECT.md': md }), md, undefined), 'P', 'P still open');
  const both = register([['P', 'Kickoff done', 'CONFIRMED'], ['0', 'Scope agreed', 'CONFIRMED']]);
  assert.equal(registerStage(setupViewOf({ 'PROJECT.md': both }), both, undefined), '1');
  assert.equal(laterStage('P', '1'), '1');
  assert.equal(laterStage('2', '1'), '2');
  assert.equal(laterStage('—', 'P'), 'P');
});

test("the stage in use follows the team's branch when main lags, and says so; main catching up clears the note", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-stage-branch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...a], { cwd, stdio: 'pipe' });
  const origin = path.join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', origin);
  const dir = path.join(root, 'floor');
  git(root, 'clone', '-q', origin, dir);
  // main: the register with nothing confirmed → Stage P.
  writeFileSync(path.join(dir, 'PROJECT.md'), register([['P', 'Kickoff', 'PROPOSED']]));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'kickoff');
  git(dir, 'push', '-q', 'origin', 'HEAD:main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  assert.equal(await refreshStage(dir), 'P');
  assert.equal(stageSourceOf(dir), undefined, 'main says it: nothing to explain');
  // The team's docs branch: P and 0 confirmed in the register. Pushed, not merged.
  git(dir, 'checkout', '-q', '-b', 'docs/stage-0');
  writeFileSync(path.join(dir, 'PROJECT.md'), register([['P', 'Kickoff', 'CONFIRMED'], ['0', 'Scope agreed', 'CONFIRMED']]));
  git(dir, 'commit', '-q', '-am', 'stage 0 docs');
  git(dir, 'push', '-q', 'origin', 'docs/stage-0');
  git(dir, 'checkout', '-q', 'main');
  assert.equal(await refreshStage(dir), '1', "the team's branch has Stage P and 0 settled: spend goes to Stage 1");
  assert.deepEqual(stageSourceOf(dir), { main: 'P', branch: 'docs/stage-0' });
  // The docs are merged: main says Stage 1 itself, and the note goes.
  git(dir, 'merge', '-q', '--ff-only', 'docs/stage-0');
  git(dir, 'push', '-q', 'origin', 'main');
  assert.equal(await refreshStage(dir), '1');
  assert.equal(stageSourceOf(dir), undefined);
});

test("the Budget tab's stage table says when the stage is read from a team branch, and what main still says", async (t) => {
  const { BudgetService, localDay } = await import('../src/server/budget/service.js');
  const { stagePlanOf } = await import('../src/server/budget/stage-warn.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-stage-via-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let via: { main: 'P'; branch: string } | undefined = { main: 'P', branch: 'docs/stage-0' };
  const b = new BudgetService({
    dataDir: dir,
    now: () => Date.UTC(2026, 9, 28, 9),
    floors: () => [{ id: 'p', name: 'demo', dir }],
    workers: () => [],
    floorOfWorker: () => 'p',
    roleOf: () => undefined,
    taskIssue: () => undefined,
    stageOf: () => '1',
    stageSource: () => via,
    officeLedger: { add: () => {}, state: () => ({ day: localDay(Date.UTC(2026, 9, 28, 9)), pauseHiring: false }) as never },
    runs: () => [],
  });
  const floor = { id: 'p', name: 'demo', dir };
  b.file(floor).ledger.backfilled = true;
  assert.deepEqual(stagePlanOf(b, floor).stageVia, { stage: '1', main: 'P', branch: 'docs/stage-0' });
  via = undefined;
  assert.equal(stagePlanOf(b, floor).stageVia, undefined);
});
