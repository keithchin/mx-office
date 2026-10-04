import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scorecardRows, shotLabel } from '../src/shared/prshots.js';
import { listShots, PrShots, shotsDir } from '../src/server/prshots/index.js';

const STICKY = `<!-- mx-pr-checks-scorecard -->
## ✅ Mendix PR checks — passing

| | Check | Result |
|---|---|---|
| ✅ | Studio Pro \`mx check\` | 0 error(s) |
| ⚠️ | \`mxcli lint\` | 0 error(s), 17 warning(s), 23 info |
| ✅ | Best-practices score (\`mxcli report\`) | **86**/100 — Security 69 |
| ✅ | Unit tests (\`mxcli test\`) | 5 passed, 0 failed |
| ✅ | E2E UI tests (Playwright) | 4 passed, 0 failed, 0 skipped |
`;

test('scorecard rows: one per check, icons and all', () => {
  const rows = scorecardRows(STICKY);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { icon: '✅', check: 'Studio Pro mx check', result: '0 error(s)' });
  assert.equal(rows[2].result, '86/100 — Security 69');
  assert.equal(rows[4].check, 'E2E UI tests (Playwright)');
});

test('shot labels come from the test folder', () => {
  assert.equal(shotLabel('smoke-home-page-loads-chromium', 'test-finished-1.png'), 'smoke home page loads');
  assert.equal(shotLabel('data', '0f04e88.png'), '0f04e88');
});

/** A fake gh: answers by the command, and counts downloads. */
function fakeGh(dir: string, artifact = 'test-results') {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'api' && args[1].endsWith('/comments')) return `${JSON.stringify('LGTM')}\n${JSON.stringify(STICKY)}\n`;
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify([{ databaseId: 77, status: 'completed', conclusion: 'success', headSha: 'c0ffee1234', url: 'https://x/runs/77', createdAt: '2026-10-04T13:50:47Z' }]);
    if (args[0] === 'api' && args[1].endsWith('/artifacts')) return JSON.stringify([{ name: 'model-results', expired: false }, { name: artifact, expired: false }]);
    if (args[0] === 'run' && args[1] === 'download') {
      const to = args[args.indexOf('-D') + 1];
      for (const f of ['tests/e2e/test-results/smoke-home-page-loads-chromium/test-finished-1.png', 'tests/e2e/playwright-report/data/abc.png', 'results/app.log']) {
        mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
        writeFileSync(path.join(to, f), 'x');
      }
      return '';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { calls, run, dir };
}

test('PR checks: the scorecard, the run, and its screenshots downloaded once', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prshots-'));
  try {
    const gh = fakeGh(dir);
    const shots = new PrShots(dir, { workflow: 'pr-checks.yml', artifacts: ['screenshots', 'test-results'] }, gh.run);
    const c = await shots.checks('org/app', dir, 8, 'ci/pr-checks');
    assert.equal(c.headline, '✅ Mendix PR checks — passing');
    assert.equal(c.scorecard?.score, 86);
    assert.equal(c.scorecard?.testsPassed, 9);
    assert.equal(c.run?.id, 77);
    assert.deepEqual(c.shots, [{ name: 'tests/e2e/test-results/smoke-home-page-loads-chromium/test-finished-1.png', label: 'smoke home page loads' }]);
    assert.ok(gh.calls.some((a) => a.includes('--branch') && a.includes('ci/pr-checks')));
    // A new PrShots (an office restart) finds the download on disk: no second download.
    const again = new PrShots(dir, { workflow: 'pr-checks.yml', artifacts: ['screenshots', 'test-results'] }, gh.run);
    await again.checks('org/app', dir, 8, 'ci/pr-checks');
    assert.equal(gh.calls.filter((a) => a[1] === 'download').length, 1);
    // Pictures are served only from inside the run's folder.
    assert.ok(again.file('org/app', 8, 77, c.shots[0].name));
    assert.equal(again.file('org/app', 8, 77, '../../../../etc/passwd.png'), undefined);
    assert.equal(again.file('org/app', 8, 77, 'results/app.log'), undefined);
    assert.ok(existsSync(shotsDir(dir, 'org/app', 8, 77)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PR checks: no run yet is just nothing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prshots-'));
  try {
    const run = async (args: string[]) => (args[0] === 'run' ? '[]' : '');
    const c = await new PrShots(dir, { workflow: 'pr-checks.yml', artifacts: ['test-results'] }, run).checks('org/app', dir, 3, 'feature');
    assert.deepEqual([c.run, c.rows, c.shots], [undefined, [], []]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listShots falls back to the report pictures when there are no named ones', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prshots-'));
  try {
    mkdirSync(path.join(dir, 'playwright-report', 'data'), { recursive: true });
    writeFileSync(path.join(dir, 'playwright-report', 'data', 'aa.png'), 'x');
    assert.deepEqual(listShots(dir), [{ name: 'playwright-report/data/aa.png', label: 'aa' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
