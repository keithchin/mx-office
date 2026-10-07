// Reading git's answers from a checkout's files (src/server/gitfiles.ts) gives exactly what git
// itself says, or null (ask git) when the files don't settle it: a normal checkout, a worktree, a
// detached HEAD, packed refs, a repository with no commit yet, no origin, and a config that rewrites URLs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commonDirOf, headBranch, headSha, originUrl, refSha } from '../src/server/gitfiles.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tryGit = (cwd: string, ...args: string[]) => {
  try {
    return git(cwd, ...args);
  } catch {
    return undefined;
  }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfiles-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function repo(name: string, commit = true) {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  git(d, 'config', 'user.email', 't@test.invalid');
  git(d, 'config', 'user.name', 'T');
  if (commit) {
    fs.writeFileSync(path.join(d, 'a.txt'), 'a');
    git(d, 'add', '.');
    git(d, 'commit', '-q', '-m', 'one');
  }
  return d;
}

/** What git says, beside what the files say (unless they say null). */
function same(dir: string) {
  const b = headBranch(dir);
  if (b !== null) assert.equal(b, tryGit(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), `branch in ${dir}`);
  const s = headSha(dir);
  if (s !== null) assert.equal(s, tryGit(dir, 'rev-parse', '--verify', '-q', 'HEAD'), `sha in ${dir}`);
  const o = originUrl(dir);
  if (o !== null) assert.equal(o, tryGit(dir, 'remote', 'get-url', 'origin'), `origin in ${dir}`);
  const c = commonDirOf(dir);
  if (c !== null) assert.equal(fs.realpathSync(c), fs.realpathSync(path.resolve(dir, git(dir, 'rev-parse', '--git-common-dir'))), `common dir in ${dir}`);
  return { b, s, o, c };
}

test('a normal checkout with an origin', () => {
  const d = repo('plain');
  git(d, 'remote', 'add', 'origin', 'https://github.com/test-org/plain.git');
  const r = same(d);
  assert.equal(r.b, 'main');
  assert.equal(r.o, 'https://github.com/test-org/plain.git');
  assert.ok(r.s);
});

test('a worktree, a detached HEAD and packed refs', () => {
  const d = repo('main-repo');
  git(d, 'branch', 'side');
  const wt = path.join(tmp, 'wt');
  git(d, 'worktree', 'add', '-q', wt, 'side');
  assert.equal(same(wt).b, 'side');
  git(d, 'pack-refs', '--all');
  assert.equal(same(d).b, 'main');
  assert.equal(same(wt).b, 'side');
  assert.equal(refSha(d, 'refs/heads/side'), git(d, 'rev-parse', 'side'));
  git(d, 'checkout', '-q', '--detach');
  assert.equal(same(d).b, 'HEAD');
});

test('no commit yet, and no origin', () => {
  const d = repo('empty', false);
  const r = same(d);
  assert.equal(r.b, undefined);
  assert.equal(r.s, undefined);
  assert.equal(r.o, undefined);
});

test('a URL rewrite, a subfolder or no repository at all is left to git', () => {
  const d = repo('rewrite');
  git(d, 'config', 'url.https://example.invalid/.insteadOf', 'gh:');
  git(d, 'remote', 'add', 'origin', 'gh:test-org/x');
  assert.equal(originUrl(d), null);
  fs.mkdirSync(path.join(d, 'sub'));
  assert.equal(headBranch(path.join(d, 'sub')), null);
  assert.equal(headBranch(path.join(tmp, 'nowhere')), null);
});
