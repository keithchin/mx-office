// Real-build fixes: the Project Manager merges a local-only project's work (server/local-merge/,
// docs/mockups/product-assessment/real-build-test.md P1-3). Real git in a temp folder, no GitHub at all:
// a review is bound to the head (a newer commit needs a new one), an author can't review their own branch,
// the merge is --no-ff into the local main, as the office's identity, pushed without force, recorded and
// counted by the review gate as a reviewed merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bookOf, forgetLocalMerges, localMergeCommits, localMergeView, mergeLocal, reviewLocal } from '../src/server/local-merge/index.js';
import { forgetLocalOnly } from '../src/server/local-only.js';
import { mergeStateWords } from '../src/shared/local-merge.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();
const as = (name: string) => ['-c', `user.name=${name}`, '-c', 'user.email=a@agents.mx-office.local'];

test('local-only PM merge through the gate: review bound to the head, --no-ff into main, audited and recorded, no GitHub', { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rb-local-merge-'));
  try {
    const bare = path.join(dir, '.local-git', 'o', 'app.git');
    mkdirSync(path.dirname(bare), { recursive: true });
    git(dir, 'init', '-q', '--bare', '-b', 'main', bare);
    const floorDir = path.join(dir, 'o', 'app');
    git(dir, 'clone', '-q', bare, floorDir);
    git(floorDir, 'checkout', '-q', '-b', 'main');
    writeFileSync(path.join(floorDir, 'agent-office.project.json'), JSON.stringify({ localOnly: true }));
    writeFileSync(path.join(floorDir, 'README.md'), 'app\n');
    git(floorDir, 'add', '.');
    git(floorDir, ...as('Mx Office'), 'commit', '-q', '-m', 'setup');
    git(floorDir, 'push', '-q', '-u', 'origin', 'main');
    // The lead's branch in a worktree, as the office's agents work.
    const wt = path.join(dir, 'wt-alan');
    git(floorDir, 'worktree', 'add', '-q', '-b', 'office/alan-1', wt, 'main');
    writeFileSync(path.join(wt, 'triage.md'), '# Triage\n');
    git(wt, 'add', '.');
    git(wt, ...as('Alan (Mx Office Solo Lead)'), 'commit', '-q', '-m', 'Stage 0: triage');
    forgetLocalOnly();
    forgetLocalMerges();
    const data = path.join(dir, 'data');
    const ctx = { cfg: { dataDir: data } } as never;
    const floor = { id: 'app', dir: floorDir, workers: { list: () => [] }, github: { pulls: { items: [] } }, def: { repo: 'o/app' } } as never;

    let v = await localMergeView(ctx, floor);
    assert.equal(v.localOnly, true);
    assert.equal(v.pmDecides, true, 'Guided: merges are the PM’s');
    const b = v.branches.find((x) => x.branch === 'office/alan-1');
    assert.ok(b, JSON.stringify(v.branches));
    assert.match(mergeStateWords(b!), /not reviewed/);
    const pat = { name: 'Pat Morgan', id: 'u1' };

    // No review: refused. A review by one of its authors: refused.
    const r0 = await mergeLocal(ctx, floor, { branch: b!.branch, sha: b!.sha }, pat);
    assert.equal(r0.ok, false);
    assert.match((r0 as { error: string }).error, /has no review/);
    const self = await reviewLocal(ctx, floor, { branch: b!.branch, sha: b!.sha, verdict: 'approve' }, { name: 'Alan (Mx Office Solo Lead)' });
    assert.equal(self.ok, false);
    assert.match((self as { error: string }).error, /wouldn't be independent/);

    // The PM approves the head they saw; then the branch moves on: Merge takes exactly the reviewed commit
    // (merge-safe: never the moving head), and the newer commit stays on the branch for its own review.
    assert.equal((await reviewLocal(ctx, floor, { branch: b!.branch, sha: b!.sha, verdict: 'approve' }, pat)).ok, true);
    writeFileSync(path.join(wt, 'brd.md'), '# BRD\n');
    git(wt, 'add', '.');
    git(wt, ...as('Alan (Mx Office Solo Lead)'), 'commit', '-q', '-m', 'Stage 2: BRD');
    const moved = await mergeLocal(ctx, floor, { branch: b!.branch, sha: b!.sha }, pat);
    assert.ok(moved.ok, JSON.stringify(moved));
    assert.equal((moved as { newer: number }).newer, 1);
    const first = (moved as { merge: string }).merge;
    v = await localMergeView(ctx, floor);
    const b2 = v.branches.find((x) => x.branch === 'office/alan-1')!;
    assert.notEqual(b2.sha, b!.sha);
    assert.equal(b2.review, undefined, 'a review of an older head doesn’t count');
    const late = await mergeLocal(ctx, floor, { branch: b2.branch, sha: b2.sha }, pat);
    assert.equal(late.ok, false, 'the new head needs its own review');

    // Reviewed at the new head: merged with --no-ff into main, as the office, pushed to the local origin.
    assert.equal((await reviewLocal(ctx, floor, { branch: b2.branch, sha: b2.sha, verdict: 'approve' }, pat)).ok, true);
    const ok = await mergeLocal(ctx, floor, { branch: b2.branch, sha: b2.sha }, pat);
    assert.ok(ok.ok, JSON.stringify(ok));
    const merge = (ok as { merge: string }).merge;
    assert.equal(git(bare, 'rev-parse', 'main'), merge, 'the local origin’s main is the merge');
    assert.equal(git(bare, 'rev-list', '--parents', '-n', '1', merge).split(' ').length, 3, 'a merge commit with two parents (--no-ff)');
    assert.equal(git(bare, 'log', '-1', '--format=%cn|%an', merge), 'Mx Office|Mx Office', 'as the office, never the machine user');
    assert.match(git(bare, 'log', '-1', '--format=%B', merge), /Reviewed at [0-9a-f]{12} by Pat Morgan[\s\S]*Mx-Office-Local-Merge: office\/alan-1@/);
    assert.equal(git(floorDir, 'rev-parse', 'HEAD'), merge, 'the project folder fast-forwarded to it');
    // Recorded, and the review gate counts it as a reviewed merge, not a push around review.
    assert.deepEqual(localMergeCommits(data, 'app'), [first, merge]);
    assert.equal(bookOf(data, 'app').merges[0].by, 'Pat Morgan');
    v = await localMergeView(ctx, floor);
    assert.equal(v.branches.some((x) => x.branch === 'office/alan-1'), false, 'nothing left ahead of main');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('a project on GitHub gets no local merge: its PRs go through the merge gate', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rb-local-merge-gh-'));
  try {
    forgetLocalOnly();
    const floor = { id: 'gh', dir, workers: { list: () => [] }, github: { pulls: { items: [] } } } as never;
    const r = await mergeLocal({ cfg: { dataDir: dir } } as never, floor, { branch: 'office/x', sha: 'abcdef1' }, { name: 'Pat' });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /on GitHub/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the office’s own commits (setup scaffold, local merges) use a neutral office identity unless one is configured', async () => {
  const { officeGitEnv } = await import('../src/server/workers/git-identity.js');
  const def = officeGitEnv(undefined);
  assert.equal(def.GIT_AUTHOR_NAME, 'Mx Office');
  assert.equal(def.GIT_COMMITTER_NAME, 'Mx Office');
  assert.match(def.GIT_AUTHOR_EMAIL, /^office@agents\.mx-office\.local$/);
  const set = officeGitEnv({ name: 'Acme Office', email: 'office@acme.example' });
  assert.deepEqual([set.GIT_AUTHOR_NAME, set.GIT_AUTHOR_EMAIL], ['Acme Office', 'office@acme.example']);
  // The setup's commit step passes it to git (wizard/steps.ts): never the machine user's own config.
  const { readFileSync } = await import('node:fs');
  const steps = readFileSync(path.join(import.meta.dirname, '..', 'src', 'server', 'wizard', 'steps.ts'), 'utf8');
  assert.match(steps, /runCommand\('git', args, \{ cwd: dir, env: \{ \.\.\.env\(\), \.\.\.officeGitEnv\(\) \}/);
  assert.doesNotMatch(steps, /user\.name=agent-office/);
});
