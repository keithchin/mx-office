// Release 83, P3: after a local merge the project panel kept the old "Last commit" (the graph's answer from before
// the merge is dropped, and the Overview asks again on the merge's event); BUILD-LOG said "lint could not run
// (lint-gate exit 2)" on every apply (the lint gate couldn't run: no baseline, or no mxcli; one info card says
// which). The late "typed but not received" card is in typed-evidence.test.ts. Real git in a temp folder, fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitGraphs } from '../src/server/gitgraph/index.js';
import { lintGateItem, lintGateWhy, lookLintGate } from '../src/server/review-gate/lint-gate.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Agent', '-c', 'user.email=a@example.test', ...args], { cwd, encoding: 'utf8' }).trim();

test('the lint gate card: none when lint ran; "no baseline" without one; "mxcli not found" with one', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'r83-lint-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    mkdirSync(path.join(dir, 'docs'));
    writeFileSync(path.join(dir, 'docs', 'BUILD-LOG.md'), '# Build log\n\n- apply row 3: lint 0 new findings\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'log');
    assert.equal(await lookLintGate(dir, git(dir, 'rev-parse', 'HEAD')), undefined);
    writeFileSync(path.join(dir, 'docs', 'BUILD-LOG.md'), '# Build log\n\n- apply row 4: mx check 0 errors; lint could not run (lint-gate exit 2)\n- apply row 5: lint could not run (lint-gate exit 2)\n');
    git(dir, 'commit', '-qam', 'two applies');
    const none = await lookLintGate(dir, git(dir, 'rev-parse', 'HEAD'));
    assert.deepEqual(none, { failures: 2, baseline: false });
    const card = lintGateItem(none, 'Blake')!;
    assert.match(card.text, /Lint never ran on apply \(2 times/);
    assert.match(card.lines!.join('\n'), /no lint baseline \(\.claude\/lint-baseline\.json\)[\s\S]*lint-gate\.sh --update-baseline[\s\S]*Decided per ESC/);
    assert.equal(card.level, 'info');
    mkdirSync(path.join(dir, '.claude'));
    writeFileSync(path.join(dir, '.claude', 'lint-baseline.json'), '{}\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'baseline (Decided per ESC-4 rev 1)');
    const withBase = await lookLintGate(dir, git(dir, 'rev-parse', 'HEAD'));
    assert.equal(withBase?.baseline, true);
    assert.match(lintGateWhy(withBase!), /didn't find mxcli/);
    assert.equal(lintGateItem(undefined), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('after a local merge the graph is read again, not its answer from a moment before', async () => {
  let logs = 0;
  const fake = async (args: string[]) => {
    if (args[0] === 'log') logs++;
    if (args[0] === 'remote') return '';
    if (args[0] === 'symbolic-ref') return 'refs/remotes/origin/main\n';
    if (args[0] === 'rev-parse') throw new Error('no ref');
    return '';
  };
  const g = new GitGraphs(fake as never);
  const floor = { id: 'p1', dir: '.', workers: { list: () => [] }, github: { pulls: { items: [] } } };
  await g.graph(floor).catch(() => undefined);
  const first = logs;
  await g.graph(floor).catch(() => undefined);
  assert.equal(logs, first, 'within a few seconds: the same answer');
  g.forget('p1');
  await g.graph(floor).catch(() => undefined);
  assert.ok(logs > first, 'read again after forget');
});

test('the Overview asks for the last commit again on a local merge (mx:local-merged) and when the head moved', () => {
  const src = readFileSync(path.join('src', 'client', 'ui', 'portal', 'overview.ts'), 'utf8');
  assert.match(src, /addEventListener\?\.\('mx:local-merged'/);
  assert.match(src, /head\.sha !== lastCommit\.v\.sha && head\.sha !== headSeen/);
  const merge = readFileSync(path.join('src', 'server', 'local-merge', 'merge.ts'), 'utf8');
  assert.match(merge, /gitGraphsOf\(ctx\)\.forget\(floor\.id\)/);
});
