import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultFromSymref, MAX_MERGED, mergedBy, mergeRefs, parseCounts, parseLog, parseRefs, pick, SEP, type Tip } from '../src/server/gitgraph/parse.js';
import { GitGraphs, pool } from '../src/server/gitgraph/index.js';
import { lanePath, layout, rowFor, tally, TRUNK_Y } from '../src/client/ui/git/layout.js';
import type { GitBranch, GitCommit } from '../src/shared/gitgraph.js';
import type { GhPull, WorkerInfo } from '../src/shared/protocol.js';

const sha = (n: number) => n.toString(16).padStart(40, '0');
const row = (...f: string[]) => f.join(SEP);

function worker(id: string, branch: string, more: Partial<WorkerInfo> = {}): WorkerInfo {
  return { id, kind: 'agent', deskId: `desk-${id}`, name: id, color: '#ff8800', status: 'working', acked: false, createdBy: 'test', createdAt: 0, cols: 80, rows: 24, viewers: [], worktree: { path: `wt/${id}`, branch, base: sha(1) }, ...more };
}
function pull(number: number, headRefName: string, more: Partial<GhPull> = {}): GhPull {
  return { number, title: `PR ${number}`, state: 'OPEN', isDraft: false, url: `https://x/${number}`, author: 'a', labels: [], reviewDecision: '', headRefName, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 0, deletions: 0, checks: 'pass', body: '', closes: [], ...more };
}

test('refs and log lines are read field by field, a subject with odd characters intact', () => {
  const refs = parseRefs([row('refs/heads/feat/a', sha(2), '2026-10-01T10:00:00+02:00', 'Ada', 'Fix | the "thing"'), 'garbage', row('refs/remotes/origin/HEAD', sha(3), '', '', '')].join('\n') + '\r\n');
  assert.equal(refs.length, 2);
  assert.deepEqual(refs[0], { ref: 'refs/heads/feat/a', sha: sha(2), date: '2026-10-01T10:00:00+02:00', author: 'Ada', subject: 'Fix | the "thing"' });
  const log = parseLog(row(sha(5), `${sha(4)} ${sha(9)}`, '2026-10-02T00:00:00Z', 'Bo', 'Merge branch x') + '\n' + row(sha(4), '', '2026-10-01T00:00:00Z', 'Bo', 'root'));
  assert.deepEqual(log[0].parents, [sha(4), sha(9)]);
  assert.deepEqual(log[1].parents, []);
  assert.deepEqual(parseCounts('12\t3\n'), { behind: 12, ahead: 3 });
  assert.deepEqual(parseCounts(''), { behind: 0, ahead: 0 });
  assert.equal(defaultFromSymref('refs/remotes/origin/trunk\n'), 'trunk');
  assert.equal(defaultFromSymref(''), undefined);
});

test('local and origin refs of a branch are one, the default branch and origin/HEAD left out, newest first', () => {
  const tips = mergeRefs(
    parseRefs(
      [
        row('refs/heads/main', sha(1), '2026-10-05T00:00:00Z', 'a', 'm'),
        row('refs/remotes/origin/main', sha(1), '2026-10-05T00:00:00Z', 'a', 'm'),
        row('refs/remotes/origin/HEAD', sha(1), '2026-10-05T00:00:00Z', 'a', 'm'),
        row('refs/heads/old', sha(2), '2026-09-01T00:00:00Z', 'a', 'old'),
        row('refs/heads/both', sha(3), '2026-10-03T00:00:00Z', 'a', 'local tip'),
        row('refs/remotes/origin/both', sha(4), '2026-10-02T00:00:00Z', 'a', 'remote tip'),
        row('refs/remotes/origin/far', sha(5), '2026-10-04T00:00:00Z', 'a', 'far'),
      ].join('\n'),
    ),
    'main',
  );
  assert.deepEqual(tips.map((t) => [t.name, t.where, t.diverged ?? false]), [['far', 'remote', false], ['both', 'both', true], ['old', 'local', false]]);
  assert.equal(tips[1].sha, sha(3));
  assert.equal(tips[1].ref, 'refs/heads/both');
});

test('a merge commit in the history is found by its other parent', () => {
  const history: GitCommit[] = [{ sha: sha(10), parents: [sha(9), sha(7)], subject: '', author: '', date: '' }, { sha: sha(9), parents: [sha(8)], subject: '', author: '', date: '' }];
  assert.equal(mergedBy(history, sha(7)), sha(10));
  assert.equal(mergedBy(history, sha(8)), undefined);
});

test('pick shows unmerged branches, folds old merged ones away, caps merged ones, and finds worker and PR', () => {
  const now = Date.parse('2026-10-05T00:00:00Z');
  const tip = (name: string, date: string, n: number): Tip => ({ name, ref: `refs/heads/${name}`, where: 'local', sha: sha(n), date, author: 'a', subject: name });
  const tips = [tip('office/ada-1', '2026-10-04T00:00:00Z', 20), tip('squashed', '2026-10-03T00:00:00Z', 21), tip('ancient', '2026-01-01T00:00:00Z', 22)];
  for (let i = 0; i < MAX_MERGED + 2; i++) tips.push(tip(`m${i}`, '2026-10-02T00:00:00Z', 30 + i));
  const reachable = new Set(['refs/heads/ancient', ...tips.filter((t) => t.name.startsWith('m')).map((t) => t.ref)]);
  const { chosen, hidden } = pick({ tips, reachable, history: [], workers: [worker('ada', 'office/ada-1')], pulls: [pull(7, 'office/ada-1'), pull(3, 'squashed', { state: 'MERGED' })], now });
  const ada = chosen.find((c) => c.name === 'office/ada-1')!;
  assert.equal(ada.worker?.id, 'ada');
  assert.equal(ada.pr?.number, 7);
  assert.equal(ada.merged, false);
  // Squash-merged: its PR says so, though git doesn't.
  const sq = chosen.find((c) => c.name === 'squashed')!;
  assert.equal(sq.merged, true);
  assert.equal(sq.reachable, false);
  assert.ok(!chosen.some((c) => c.name === 'ancient'));
  assert.equal(chosen.filter((c) => c.merged).length, MAX_MERGED);
  assert.equal(hidden.merged, 1 + 3);
});

test('pool runs everything, in order, a few at a time', async () => {
  let running = 0;
  let most = 0;
  const out = await pool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    most = Math.max(most, ++running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.equal(most, 3);
});

// ---- The map's layout -------------------------------------------------------------------------------

const commit = (n: number, parents: number[] = [n - 1]): GitCommit => ({ sha: sha(n), parents: parents.map(sha), subject: `c${n}`, author: 'a', date: '2026-10-01T00:00:00Z' });
const branch = (name: string, more: Partial<GitBranch>): GitBranch => ({ name, where: 'local', sha: sha(99), subject: '', author: '', date: '2026-10-01T00:00:00Z', ahead: 1, behind: 0, merged: false, ...more });

test('the trunk runs oldest to newest, and a branch leaves it at its fork', () => {
  const history = [commit(5, [4, 50]), commit(4), commit(3), commit(2), commit(1, [])];
  const L = layout({ history, branches: [branch('a', { fork: sha(3), ahead: 3 }), branch('b', { fork: sha(1), ahead: 9 })] });
  assert.deepEqual(L.stations.map((s) => s.commit.sha), [1, 2, 3, 4, 5].map(sha));
  assert.ok(L.stations[4].merge);
  assert.equal(L.headX, L.stations[4].x);
  const [a, b] = L.lanes;
  assert.equal(a.forkX, L.stations[2].x);
  assert.equal(a.dots.length, 3);
  assert.equal(b.dots.length, 5);
  assert.equal(b.more, 4);
  assert.ok(a.path.startsWith(`M${a.forkX} ${L.trunkY}`));
  assert.equal(L.trunkY, TRUNK_Y);
  assert.ok(a.y > L.trunkY && !a.up);
  assert.ok(L.width >= Math.max(...L.lanes.map((l) => l.tipX)));
});

test('a merged branch climbs back onto the trunk at its merge; one forked before the history starts is marked older', () => {
  const history = [commit(5, [4, 50]), commit(4), commit(3), commit(2), commit(1, [])];
  const L = layout({ history, branches: [branch('done', { merged: true, ahead: 0, commits: 2, fork: sha(2), mergedBy: sha(5) }), branch('old', { fork: sha(77) })] });
  const [done, old] = L.lanes;
  assert.equal(done.joinX, L.stations[4].x);
  assert.equal(done.squashed, false);
  assert.ok(done.dots.every((x) => x > done.forkX && x < done.joinX!));
  assert.ok(done.path.endsWith(`L${done.joinX} ${L.trunkY}`));
  // It loops above the trunk, which moves down to make room.
  assert.ok(done.up && done.y < L.trunkY && L.trunkY > TRUNK_Y);
  assert.ok(old.y > L.trunkY);
  assert.equal(old.older, true);
  assert.ok(old.forkX < L.stations[0].x);
});

test('lines share a row only when they neither overlap nor drop through one another', () => {
  const rows: [number, number][][] = [];
  const drops: [number, number][] = [];
  assert.equal(rowFor(rows, 100, 300, drops), 0);
  // Leaves the trunk under the first line: it can't help crossing it, so the next row down.
  assert.equal(rowFor(rows, 200, 400, drops), 1);
  // Clear of row 0, and its drop crosses nothing: the top row.
  assert.equal(rowFor(rows, 320, 500, drops), 0);
  // Leaves under a line in row 0, so it crosses that one anyway: the first row it fits.
  assert.equal(rowFor(rows, 450, 600, drops), 1);
  // A line deeper down drops at 350: nothing above it may be drawn across that.
  const deep: [number, number][][] = [[], [], [[340, 600]]];
  assert.equal(rowFor(deep, 300, 500, [[350, 2]]), 3);
  assert.equal(lanePath(10, 200, 100), `M10 ${TRUNK_Y} L10 186 Q10 200 24 200 L100 200`);
});

test('the strip counts open branches, those with open PRs, and stale ones', () => {
  const t = tally(
    [
      branch('a', { behind: 25, pr: { number: 1, title: '', state: 'OPEN', isDraft: false, checks: 'pass', reviewDecision: '', url: '' } }),
      branch('b', { behind: 2 }),
      branch('c', { merged: true, behind: 40 }),
    ],
    20,
  );
  assert.deepEqual(t, { branches: 2, withPr: 1, stale: 1 });
});

// ---- Against a real repository ---------------------------------------------------------------------

test('GitGraphs reads a real repository: default branch, history with a merge, and each branch where it left', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gitpage-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const edit = (name: string, msg: string) => {
    writeFileSync(path.join(dir, name), msg);
    git('add', name);
    git('commit', '-q', '-m', msg);
  };
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 'Tester');
    git('config', 'commit.gpgsign', 'false');
    edit('a', 'one');
    edit('a', 'two');
    git('checkout', '-q', '-b', 'feat/merged');
    edit('b', 'merged work');
    git('checkout', '-q', 'main');
    edit('a', 'three');
    git('merge', '-q', '--no-ff', '-m', 'Merge feat/merged', 'feat/merged');
    git('checkout', '-q', '-b', 'office/ada-1');
    edit('c', 'ada one');
    edit('c', 'ada two');
    git('checkout', '-q', 'main');
    edit('a', 'four');
    const floor = { id: 'f1', dir, workers: { list: () => [worker('ada', 'office/ada-1')] }, github: { pulls: { items: [pull(4, 'office/ada-1', { checks: 'fail' })] } } };
    const g = await new GitGraphs().graph(floor);
    assert.equal(g.defaultBranch, 'main');
    assert.equal(g.defaultRef, 'main');
    assert.equal(g.history.length, 5);
    assert.equal(g.history.filter((c) => c.parents.length > 1).length, 1);
    const ada = g.branches.find((b) => b.name === 'office/ada-1')!;
    assert.equal(ada.ahead, 2);
    assert.equal(ada.behind, 1);
    assert.equal(ada.merged, false);
    assert.equal(ada.worker?.id, 'ada');
    assert.equal(ada.pr?.checks, 'fail');
    assert.equal(ada.fork, g.history[1].sha);
    const merged = g.branches.find((b) => b.name === 'feat/merged')!;
    assert.equal(merged.merged, true);
    assert.equal(merged.mergedBy, g.history[1].parents.length > 1 ? g.history[1].sha : g.history.find((c) => c.parents.length > 1)!.sha);
    assert.equal(merged.commits, 1);
    assert.equal(merged.fork, git('rev-parse', 'main~3'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
