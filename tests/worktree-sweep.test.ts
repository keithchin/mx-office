// The worktree cleanup (server/worktree-sweep/): against real temporary repositories, merged worktrees
// no worker has are removed with their branch (merge, fast-forward or squash), everything else is kept
// and said why, worktrees outside .agent-office/worktrees/ are only reported, and links inside a
// worktree (a node_modules junction) are unlinked without touching what they point at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMerged, sweepRepo, targetRefs, unlinkLinks } from '../src/server/worktree-sweep/sweep.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ENV = ['-c', 'user.name=T', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false'];
const commit = (cwd: string, file: string, text: string, msg = file) => {
  writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, ...ENV, 'commit', '-q', '-m', msg);
};

/** A bare origin, a clone of it as the floor's project, on main. */
function project() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'sweep-')));
  const origin = path.join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const dir = path.join(root, 'proj');
  git(root, 'clone', '-q', origin, dir);
  git(dir, 'checkout', '-q', '-b', 'main');
  commit(dir, 'README.md', 'hi\n');
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  return { root, dir };
}

const tree = (dir: string, name: string) => path.join(dir, '.agent-office', 'worktrees', name);

test('merged, clean worktrees no worker has go with their branch; the rest stay, said why', async () => {
  const { root, dir } = project();
  const add = (name: string) => {
    git(dir, 'worktree', 'add', '-q', '-b', `office/${name}`, tree(dir, name), 'main');
    return tree(dir, name);
  };
  // Merged by a merge commit, pushed.
  const merged = add('merged');
  commit(merged, 'a.txt', 'a\n');
  git(dir, ...ENV, 'merge', '-q', '--no-ff', '-m', 'merge', 'office/merged');
  // Squash-merged (two commits on the branch, one on main).
  const squashed = add('squashed');
  commit(squashed, 'b.txt', 'b1\n');
  commit(squashed, 'b.txt', 'b2\n');
  git(dir, ...ENV, 'merge', '-q', '--squash', 'office/squashed');
  git(dir, ...ENV, 'commit', '-q', '-m', 'squash');
  git(dir, 'push', '-q', 'origin', 'main');
  // Not merged; merged but with uncommitted changes; merged but a worker still has it.
  const open = add('open');
  commit(open, 'c.txt', 'c\n');
  const dirty = add('dirty');
  writeFileSync(path.join(dirty, 'scratch.txt'), 'wip');
  const busy = add('busy');
  // One an agent made next to the project.
  const outside = path.join(root, 'leslie-brd');
  git(dir, 'worktree', 'add', '-q', '-b', 'leslie/brd', outside, 'main');

  assert.deepEqual(await targetRefs(dir), ['refs/remotes/origin/main']);
  assert.ok(await isMerged(dir, 'office/merged', 'refs/remotes/origin/main'));
  assert.ok(await isMerged(dir, 'office/squashed', 'refs/remotes/origin/main'), 'a squash merge counts');
  assert.ok(!(await isMerged(dir, 'office/open', 'refs/remotes/origin/main')));

  const dry = await sweepRepo(dir, { owned: (p) => path.resolve(p) === path.resolve(busy), dryRun: true });
  assert.ok(existsSync(merged), 'a dry run changes nothing');
  assert.equal(dry.filter((i) => i.action === 'removed').length, 2);

  const items = await sweepRepo(dir, { owned: (p) => path.resolve(p).toLowerCase() === path.resolve(busy).toLowerCase(), floor: 'proj' });
  const by = (b: string) => items.find((i) => i.branch === b);
  assert.equal(by('office/merged')?.action, 'removed');
  assert.equal(by('office/squashed')?.action, 'removed');
  assert.ok(!existsSync(merged) && !existsSync(squashed));
  assert.equal(git(dir, 'branch', '--list', 'office/merged', 'office/squashed'), '', 'their branches went too');
  assert.equal(by('office/open')?.action, 'kept');
  assert.match(by('office/open')!.why, /not merged into origin\/main/);
  assert.equal(by('office/dirty')?.action, 'kept');
  assert.match(by('office/dirty')!.why, /1 uncommitted or untracked change/);
  assert.equal(by('office/busy'), undefined, 'a worker’s own worktree isn’t even looked at');
  assert.ok(existsSync(busy) && existsSync(open) && existsSync(dirty));
  assert.equal(by('leslie/brd')?.action, 'outside');
  assert.ok(existsSync(outside), 'outside ones are only reported');
  assert.equal(items.find((i) => path.resolve(i.path) === path.resolve(dir)), undefined, 'never the project itself');
});

test('links inside a worktree are unlinked, never followed: a node_modules junction’s target survives', async () => {
  const { root, dir } = project();
  // Another checkout's packages, which a worktree links to (as this very worktree does).
  const packages = path.join(root, 'shared-node_modules');
  mkdirSync(path.join(packages, 'left-pad'), { recursive: true });
  writeFileSync(path.join(packages, 'left-pad', 'index.js'), 'module.exports = 1;\n');
  writeFileSync(path.join(dir, '.gitignore'), 'node_modules\ndeep/\n');
  git(dir, 'add', '.gitignore');
  git(dir, ...ENV, 'commit', '-q', '-m', 'ignore');
  git(dir, 'push', '-q', 'origin', 'main');
  const wt = tree(dir, 'linked');
  git(dir, 'worktree', 'add', '-q', '-b', 'office/linked', wt, 'main');
  symlinkSync(packages, path.join(wt, 'node_modules'), 'junction');
  mkdirSync(path.join(wt, 'deep', 'er'), { recursive: true });
  symlinkSync(packages, path.join(wt, 'deep', 'er', 'nm'), 'junction');
  // Nothing on the branch beyond main: merged.
  const items = await sweepRepo(dir, { owned: () => false });
  assert.equal(items.find((i) => i.branch === 'office/linked')?.action, 'removed', JSON.stringify(items));
  assert.ok(!existsSync(wt));
  assert.equal(readFileSync(path.join(packages, 'left-pad', 'index.js'), 'utf8'), 'module.exports = 1;\n', 'the junction’s target is untouched');

  // unlinkLinks on its own.
  const box = path.join(root, 'box');
  mkdirSync(box);
  symlinkSync(packages, path.join(box, 'nm'), 'junction');
  assert.equal(await unlinkLinks(box), 1);
  assert.ok(!existsSync(path.join(box, 'nm')) && existsSync(path.join(packages, 'left-pad', 'index.js')));
});
