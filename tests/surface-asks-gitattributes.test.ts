// Nothing waits on the PM unseen, S9: a new project's .gitattributes. With core.autocrlf=true and no
// attributes, every text file checked out into an agent's worktree came out CRLF and the toolkit's LF
// rewrite showed ~200 modified files. Checked with real git: a text file is LF in the checkout under
// autocrlf=true, and the .mpr and the mprcontents units are binary (never converted).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GITATTRIBUTES, writeGitattributes } from '../src/server/wizard/gitattributes.js';

test('written once, never over an existing one', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ga-'));
  assert.equal(writeGitattributes(dir), true);
  assert.equal(readFileSync(path.join(dir, '.gitattributes'), 'utf8'), GITATTRIBUTES);
  writeFileSync(path.join(dir, '.gitattributes'), '* -text\n');
  assert.equal(writeGitattributes(dir), false);
  assert.equal(readFileSync(path.join(dir, '.gitattributes'), 'utf8'), '* -text\n');
  for (const l of ['* text=auto eol=lf', '*.mpr binary', '*.mpk binary', '*.mxunit binary', 'mprcontents/** binary', '*.png binary', '*.ps1 text eol=crlf']) assert.ok(GITATTRIBUTES.split('\n').includes(l), l);
});

test('with core.autocrlf=true a checkout has LF text, and the model files are binary', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ga-git-'));
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  g('init', '-q', '-b', 'main');
  g('config', 'core.autocrlf', 'true');
  writeGitattributes(dir);
  mkdirSync(path.join(dir, 'skills'));
  mkdirSync(path.join(dir, 'mprcontents', '00'), { recursive: true });
  writeFileSync(path.join(dir, 'skills', 'a.md'), 'one\ntwo\n');
  writeFileSync(path.join(dir, 'App.mpr'), Buffer.from([0x53, 0x51, 0x0d, 0x0a, 0x00, 0x0a]));
  writeFileSync(path.join(dir, 'mprcontents', '00', 'u.mxunit'), Buffer.from([0x01, 0x0a, 0x0d]));
  g('add', '-A');
  g('commit', '-q', '-m', 'scaffold');
  // A fresh worktree, as an agent's: its text is LF, nothing shows modified.
  const wt = path.join(dir, 'wt');
  g('worktree', 'add', '-q', wt, '-b', 'office/a');
  assert.equal(readFileSync(path.join(wt, 'skills', 'a.md'), 'utf8'), 'one\ntwo\n');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim(), '');
  const attrs = g('check-attr', 'text', 'diff', '--', 'App.mpr', 'mprcontents/00/u.mxunit');
  assert.match(attrs, /App\.mpr: text: unset/);
  assert.match(attrs, /u\.mxunit: text: unset/);
  assert.deepEqual([...readFileSync(path.join(wt, 'App.mpr'))], [0x53, 0x51, 0x0d, 0x0a, 0x00, 0x0a]);
});
