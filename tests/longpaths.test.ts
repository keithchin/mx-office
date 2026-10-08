import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureLongPaths, forgetLongPaths, hasLongPaths } from '../src/server/longpaths.js';
import { Worktrees } from '../src/server/worktrees.js';

function repo(t: { after(fn: () => void): void }) {
  forgetLongPaths();
  const root = mkdtempSync(path.join(tmpdir(), 'office-longpaths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'project');
  const run = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  run('add', '.');
  run('commit', '-qm', 'a');
  return { dir, run, config: path.join(dir, '.git', 'config') };
}

test("core.longpaths is read from the repository's own config, as git reads a boolean", (t) => {
  const r = repo(t);
  assert.equal(hasLongPaths(r.dir), false);
  for (const [text, want] of [
    ['[core]\n\tlongpaths = true\n', true],
    ['[core]\n\tlongPaths = yes ; on\n', true],
    ['[core]\n\tlongpaths\n', true],
    ['[core]\n\tlongpaths = false\n', false],
    ['[core]\n\tlongpaths = true\n[core]\n\tlongpaths = 0\n', false],
    ['[remote "origin"]\n\tlongpaths = true\n', false],
    ['# [core] longpaths = true\n', false],
  ] as const) {
    writeFileSync(r.config, text);
    assert.equal(hasLongPaths(r.dir), want, text);
  }
  assert.equal(hasLongPaths(path.join(r.dir, 'nope')), null, 'not a checkout');
});

test('on Windows the office sets core.longpaths true (repo-local) once, and not elsewhere', async (t) => {
  const r = repo(t);
  await ensureLongPaths(r.dir, 'linux');
  assert.equal(hasLongPaths(r.dir), false, 'paths are long enough off Windows');
  await ensureLongPaths(r.dir, 'win32');
  assert.equal(r.run('config', '--local', 'core.longpaths'), 'true');
  assert.equal(hasLongPaths(r.dir), true);
  // Seen once, it isn't looked at again (no git run, no file read per hire).
  writeFileSync(r.config, '[core]\n\trepositoryformatversion = 0\n');
  await ensureLongPaths(r.dir, 'win32');
  assert.equal(hasLongPaths(r.dir), false);
});

test('a worker worktree on Windows: the floor gets core.longpaths before git checks it out (the "Filename too long" hire, 2026-10-08)', { skip: process.platform !== 'win32' && 'Windows only' }, async (t) => {
  const r = repo(t);
  // A file as deep as a Mendix app's javascriptsource npm packages, committed without a working copy of it.
  const deep = [...Array.from({ length: 10 }, (_, i) => `node_modules_${i}_${'x'.repeat(16)}`), 'RNCAsyncStorage.xcodeproj', 'file.txt'].join('/');
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: r.dir, input: 'deep', encoding: 'utf8' }).trim();
  r.run('update-index', '--add', '--cacheinfo', `100644,${blob},${deep}`);
  r.run('commit', '-qm', 'deep');
  assert.equal(hasLongPaths(r.dir), false);
  const made = await new Worktrees(r.dir).create('ada-1');
  assert.ok(typeof made !== 'string', String(made));
  assert.equal(r.run('config', '--local', 'core.longpaths'), 'true');
  const wt = path.join(r.dir, made.path);
  assert.ok(path.join(wt, deep).length > 260, 'past MAX_PATH');
  assert.equal(execFileSync('git', ['-C', wt, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'checked out whole');
});
