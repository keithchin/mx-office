// The "Folder name case" check (shared/path-case.ts, server/path-case/): paths that differ only by case and
// Mendix code/module folders not in lower case, read from a commit's tree. The git part uses a temporary
// repository whose commits are built with `git update-index --cacheinfo` (no checkout), so case-differing
// names work on a case-insensitive Windows disk too. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathCaseFindings, pathCaseHeadline, projectRoots } from '../src/shared/path-case.js';
import { checkCommits, draftFromTree, resetPathCase, SUITE, treeAt } from '../src/server/path-case/index.js';
import { TestRunStore } from '../src/server/testing/store.js';
import { checkVerdict } from '../src/shared/testing/record.js';

const CLEAN = ['App.mpr', 'themesource/styling/web/main.scss', 'javasource/myfirstmodule/actions/A.java', 'javascriptsource/atlas_core/actions/x.js', 'widgets/Some.Widget.mpk', 'theme/web/custom-variables.scss'];

test('a clean Mendix tree has no findings', () => {
  assert.deepEqual(pathCaseFindings(CLEAN), { findings: [], more: 0 });
});

test('a module folder not in lower case is found, with a plain message and the right name', () => {
  const { findings } = pathCaseFindings(['App.mpr', 'themesource/Styling/web/main.scss', 'javasource/MyModule/actions/A.java']);
  assert.deepEqual(
    findings.map((f) => [f.kind, f.path, f.expected]),
    [
      ['module', 'javasource/MyModule', 'javasource/mymodule'],
      ['module', 'themesource/Styling', 'themesource/styling'],
    ],
  );
  const m = findings[1].message;
  assert.match(m, /^themesource\/Styling: module folders under themesource must be lower case \(themesource\/styling\)\./);
  assert.match(m, /Linux cloud build ignores it/);
  assert.match(m, /git mv \(two steps on Windows/);
  assert.ok(m.length <= 300, 'fits a result detail');
});

test('a code folder itself in the wrong case is found, and not every module under it again', () => {
  const { findings } = pathCaseFindings(['App.mpr', 'Themesource/Styling/x.scss', 'JavaSource/mod/A.java']);
  assert.deepEqual(
    findings.map((f) => [f.kind, f.path, f.expected]),
    [
      ['top', 'JavaSource', 'javasource'],
      ['top', 'Themesource', 'themesource'],
    ],
  );
  // A file called like a code folder is not a folder.
  assert.deepEqual(pathCaseFindings(['Themesource']).findings, []);
});

test('paths that differ only by case are found once, at the folder that clashes', () => {
  const { findings } = pathCaseFindings(['App.mpr', 'themesource/Styling/web/main.scss', 'themesource/styling/web/main.scss', 'themesource/styling/web/other.scss', 'docs/Readme.md', 'docs/README.md']);
  assert.deepEqual(
    findings.map((f) => [f.kind, f.path, f.others]),
    [
      ['collision', 'docs/README.md', ['docs/Readme.md']],
      ['collision', 'themesource/Styling', ['themesource/styling']],
    ],
  );
  assert.match(findings[1].message, /^themesource\/Styling and themesource\/styling differ only by case\./);
  assert.equal(pathCaseHeadline(findings), 'docs/README.md and docs/Readme.md differ only by case (and 1 more)');
});

test('the Mendix project in a subfolder is where the code folders are looked for', () => {
  assert.deepEqual(projectRoots(['app/Shop.mpr', 'README.md']), ['app']);
  assert.deepEqual(projectRoots(['README.md']), ['']);
  const { findings } = pathCaseFindings(['app/Shop.mpr', 'app/themesource/Styling/x.scss', 'tools/themesource/Other/y.txt']);
  assert.deepEqual(
    findings.map((f) => f.path),
    ['app/themesource/Styling'],
  );
});

test('findings past the cap are counted', () => {
  const files = Array.from({ length: 25 }, (_, i) => `javasource/Mod${i}/A.java`);
  const r = pathCaseFindings(files);
  assert.equal(r.findings.length, 20);
  assert.equal(r.more, 5);
});

function repo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'path-case-'));
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).trim();
  g('init', '-q');
  return dir;
}

/** A commit with exactly `files` (empty blobs), built in the index only: no file on disk, no checkout. */
function commitOf(dir: string, files: string[]): string {
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).trim();
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: 'x\n', encoding: 'utf8' }).trim();
  g('read-tree', '--empty');
  for (const f of files) g('update-index', '--add', '--cacheinfo', `100644,${blob},${f}`);
  const tree = g('write-tree');
  return g('commit-tree', tree, '-m', 'c');
}

test('a commit with case-differing folders is read from its tree and recorded as a failed check at that commit', async () => {
  const dir = repo();
  const data = mkdtempSync(path.join(os.tmpdir(), 'path-case-data-'));
  try {
    resetPathCase();
    const bad = commitOf(dir, ['App.mpr', 'themesource/Styling/web/main.scss', 'themesource/styling/web/main.scss', 'javasource/MyModule/A.java']);
    const good = commitOf(dir, CLEAN);
    const files = await treeAt(dir, bad);
    assert.ok(files?.includes('themesource/Styling/web/main.scss') && files.includes('themesource/styling/web/main.scss'));
    assert.equal(await treeAt(dir, 'f'.repeat(40)), undefined, 'a commit the folder lacks reads as unknown');

    const store = new TestRunStore(path.join(data, 'testing'), 'p1');
    let reads = 0;
    const tree = (d: string, s: string) => (reads++, treeAt(d, s));
    await checkCommits(store, dir, [bad, good, 'f'.repeat(40)], { tree });
    const recs = await store.all();
    assert.equal(recs.length, 1, 'only the commit with a finding gets a record');
    const b = recs.find((r) => r.testedRevision === bad)!;
    assert.equal(b.source, 'office-check');
    assert.equal(checkVerdict(b), 'failed');
    assert.ok(b.suite.startsWith(`${SUITE}: `));
    assert.deepEqual(
      b.results.map((r) => r.name),
      ['themesource/Styling', 'javasource/MyModule'],
    );

    // Cached per commit: a second look reads nothing again (the missing commit waits for its retry).
    reads = 0;
    await checkCommits(store, dir, [bad, good, 'f'.repeat(40)], { tree });
    assert.equal(reads, 0);
    assert.equal((await store.all()).length, 1);
    // After the office restarts, the record on disk is enough for the bad commit (the clean one is read again).
    resetPathCase();
    await checkCommits(store, dir, [bad, good], { tree });
    assert.equal(reads, 1);
    assert.equal((await store.all()).length, 1);
  } finally {
    resetPathCase();
    rmSync(dir, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

test('a clean tree records nothing; a bad one is one failed run keyed by its commit', () => {
  assert.equal(draftFromTree('a'.repeat(40), CLEAN, 0), undefined);
  const d = draftFromTree('A'.repeat(40), ['javasource/Mod/A.java'], 0)!;
  assert.equal(d.conclusion, 'failed');
  assert.equal(d.sourceKey, `path-case:${'a'.repeat(40)}`);
  assert.equal(d.suite, `${SUITE}: javasource/Mod must be lower case`);
});

test('the local merge confirm reads the check at its commit even when no other view has looked yet', async () => {
  const dir = repo();
  const data = mkdtempSync(path.join(os.tmpdir(), 'path-case-merge-'));
  try {
    resetPathCase();
    const bad = commitOf(dir, ['App.mpr', 'themesource/Styling/web/main.scss']);
    const { resultsAt } = await import('../src/server/local-merge/describe.js');
    const ctx = { cfg: { dataDir: data }, floors: new Map([['p1', { id: 'p1', dir }]]) } as never;
    const r = await resultsAt(ctx, 'p1', bad);
    const c = r.checks.find((x) => x.name.startsWith(SUITE));
    assert.ok(c, `the merge dialog's checks: ${JSON.stringify(r.checks)}`);
    assert.equal(c.verdict, 'failed');
  } finally {
    resetPathCase();
    rmSync(dir, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});
