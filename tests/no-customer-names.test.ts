// No real client's names in this public repo: tracked files (contents and paths) must not contain any term
// of tests/fixtures/customer-denylist.json, case-insensitive. CHANGELOG.md's published sections (from the
// first `## 2026` heading down) are released history and left as they are; its Unreleased part is checked.
// One `git grep` with fixed strings finds candidates fast; the real expressions (word bounds) confirm them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DENYLIST = 'tests/fixtures/customer-denylist.json';
const terms: string[] = JSON.parse(readFileSync(path.join(REPO, DENYLIST), 'utf8')).terms;
const patterns = terms.map((t) => new RegExp(t, 'i'));
const hits = (s: string): boolean => patterns.some((p) => p.test(s));

const git = (args: string[]): string | undefined => {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20, windowsHide: true });
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1) return ''; // git grep: nothing found
    return undefined;
  }
};
const inRepo = git(['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';

test('no tracked file contains a client name from the denylist', { skip: !inRepo && 'not a git checkout' }, () => {
  const fixed = terms.flatMap((t) => ['-e', t.replaceAll('\\b', '')]);
  const out = git(['grep', '-I', '-n', '-i', '-F', ...fixed, '--', '.', ':!CHANGELOG.md', `:!${DENYLIST}`]);
  assert.notEqual(out, undefined, 'git grep failed');
  const found = (out ?? '').split('\n').filter((l) => l && hits(l.replace(/^[^:]*:\d+:/, '')));
  assert.deepEqual(found, [], 'use neutral examples instead of real client names');
});

test('no tracked file path contains a client name', { skip: !inRepo && 'not a git checkout' }, () => {
  const files = (git(['ls-files']) ?? '').split('\n').filter((f) => f && hits(f));
  assert.deepEqual(files, []);
});

test("CHANGELOG.md's Unreleased section names no client", () => {
  const text = readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
  const cut = text.search(/^## 2026/m);
  const unreleased = cut >= 0 ? text.slice(0, cut) : text;
  assert.deepEqual(unreleased.split('\n').filter(hits), []);
});

test('the guard catches a planted name (self-check)', () => {
  // Planted text is built from the denylist, so this file never holds a name itself.
  for (const t of terms) {
    const plain = t.replaceAll('\\b', '');
    assert.ok(hits(`Shipped for ${plain.toUpperCase()} today`), t);
    if (t.includes('\\b')) assert.ok(!hits(`a ${plain}x-like token`), `${t} keeps its word bounds`);
  }
});
