// The Documents page's scan (server/deliverables/), made fast: every git call off the event loop, a
// branch's own work one `diff --raw` cached by both commits, a worktree one `git status` over its
// commit's cached tree, a path classified once, one scan per floor at a time and a stale one handed
// out at once while the next runs behind it, and a slow first fetch of origin not waited for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { forkChanges, parseRaw, parseStatus, pool } from '../src/server/deliverables/git.js';
import { scanDeliverables } from '../src/server/deliverables/scan.js';
import { deliverablesOf, FIRST_FETCH_WAIT_MS } from '../src/server/deliverables/index.js';
import { isDeliverablePath, specFor } from '../src/shared/deliverables.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

function repo(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-docs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (base: string, file: string, text: string) => {
    mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    writeFileSync(path.join(base, file), text);
  };
  const g = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' }).toString().trim();
  g(dir, 'init', '-q', '-b', 'main');
  put(dir, '.gitignore', '.agent-office/\n');
  put(dir, 'triage.md', '# Triage\n');
  put(dir, 'design/wireframes/list.html', '<p>list</p>');
  g(dir, 'add', '.');
  g(dir, 'commit', '-qm', 'scaffold');
  return { dir, put, g };
}

test('git status and diff --raw are read right: changed, new, deleted, renamed; deletions are no files of a branch', () => {
  const st = parseStatus(['# branch.oid 0123456789abcdef0123456789abcdef01234567', '# branch.head main', '1 .M N... 100644 100644 100644 aaa bbb docs/a b.md', '1 D. N... 100644 000000 000000 aaa bbb gone.md', '2 R. N... 100644 100644 100644 aaa bbb R100 new name.md', 'old name.md', '? design/new.html', 'u UU N... 1 2 3 4 a b c conflict.md', ''].join('\0'));
  assert.equal(st.head, '0123456789abcdef0123456789abcdef01234567');
  assert.deepEqual([...st.dirty].sort(), ['conflict.md', 'design/new.html', 'docs/a b.md', 'new name.md']);
  assert.deepEqual([...st.gone].sort(), ['gone.md', 'old name.md']);
  const raw = parseRaw([':100644 100644 aaa 1111 M', 'triage.md', ':000000 100644 000 2222 A', 'design/x y.html', ':100644 000000 aaa 000 D', 'old.md', ''].join('\0'));
  assert.deepEqual([...raw], [['triage.md', '1111'], ['design/x y.html', '2222']]);
});

test("a branch's own work is one diff from the fork, asked once per pair of commits", async (t) => {
  const { dir, put, g } = repo(t);
  const base = g(dir, 'rev-parse', 'HEAD');
  g(dir, 'checkout', '-q', '-b', 'office/ada-1234');
  put(dir, 'architecture/blueprint.md', '# Blueprint');
  g(dir, 'add', '.');
  g(dir, 'commit', '-qm', 'blueprint');
  const sha = g(dir, 'rev-parse', 'HEAD');
  g(dir, 'checkout', '-q', 'main');
  const a = forkChanges(dir, base, sha);
  assert.equal(forkChanges(dir, base, sha), a, 'the same promise: cached by both commits');
  assert.deepEqual([...((await a) ?? new Map()).keys()], ['architecture/blueprint.md']);
  const v = await scanDeliverables({ floor: 'f', dir, people: [] });
  const file = v.items.find((i) => i.id === 'blueprint')?.files[0];
  assert.equal(file?.status, 'branch');
  assert.equal(file?.size, '# Blueprint'.length, "its size from one cat-file for all the branches' blobs");
});

test("a worktree: what it changed or added shows, what it deleted doesn't, what it left alone stays main's", async (t) => {
  const { dir, put, g } = repo(t);
  const wt = path.join(dir, '.agent-office', 'worktrees', 'ada');
  g(dir, 'worktree', 'add', '-q', '-b', 'office/ada-c3d4', wt);
  put(wt, 'triage.md', '# Triage, edited\n');
  unlinkSync(path.join(wt, 'design/wireframes/list.html'));
  put(wt, 'architecture/domain-model.md', '# DRAFT — before Stage 3 gate\n');
  const v = await scanDeliverables({ floor: 'f', dir, people: [{ workerId: 'w', name: 'Ada', role: 'lead-designer', dir: wt, branch: 'office/ada-c3d4' }] });
  const item = (id: string) => v.items.find((i) => i.id === id)!;
  assert.deepEqual(item('triage').files[0].where.map((w) => w.src), ['main', 'wt:w'], 'edited in the worktree: another copy');
  assert.deepEqual(item('wireframes').files[0].where.map((w) => w.src), ['main'], 'deleted in the worktree: only main has it');
  assert.equal(item('domain-model').status, 'draft');
});

test('a path is classified once, and the answers are the same as before', () => {
  assert.equal(isDeliverablePath('triage.md'), true);
  assert.equal(isDeliverablePath('../triage.md'), false);
  assert.equal(isDeliverablePath('node_modules/x/README.md'), false);
  assert.equal(isDeliverablePath('javasource/x/brd.md'), false);
  assert.equal(specFor('architecture/blueprint.md')?.id, 'blueprint');
  const t0 = performance.now();
  for (let i = 0; i < 20_000; i++) isDeliverablePath(`mprcontents/${i % 2000}/x.mxunit`);
  assert.ok(performance.now() - t0 < 400, 'thousands of repeat asks are cheap');
});

test('pool: at most n at once, answers in order', async () => {
  let running = 0;
  let most = 0;
  const out = await pool([5, 1, 3, 2, 4], 2, async (n) => {
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, n));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 30, 20, 40]);
  assert.equal(most, 2);
});

test('one scan per floor at a time; a stale one is handed out at once while the next runs; fresh waits for the new one', async (t) => {
  const { dir, put, g } = repo(t);
  const floor = { id: `docs-swr-${Date.now()}`, dir, workers: { list: () => [], get: () => undefined } } as never;
  const ctx = {} as never;
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const a = deliverablesOf(ctx, floor);
  assert.equal(deliverablesOf(ctx, floor), a, 'asked again while it runs: the same scan');
  const first = await a;
  assert.equal(first.items.find((i) => i.id === 'blueprint')?.status, 'missing');
  put(dir, 'architecture/blueprint.md', '# Blueprint');
  g(dir, 'add', '.');
  g(dir, 'commit', '-qm', 'blueprint');
  now += 60_000;
  // Stale: the old answer at once, a new scan behind it.
  assert.equal(await deliverablesOf(ctx, floor), first);
  const fresh = await deliverablesOf(ctx, floor, true);
  assert.equal(fresh.items.find((i) => i.id === 'blueprint')?.status, 'present');
  assert.equal(await deliverablesOf(ctx, floor), fresh, 'the new scan is the one handed out now');
});

test('off the event loop and bounded: no git started on the main thread, the first fetch waited for briefly', () => {
  const gitSrc = read('src/server/deliverables/git.ts');
  assert.doesNotMatch(gitSrc, /from 'node:child_process'/);
  assert.match(gitSrc, /from '\.\.\/offloop\/exec\.js'/);
  const scan = read('src/server/deliverables/scan.ts');
  assert.match(scan, /pool\(members, GIT_PARALLEL/);
  assert.doesNotMatch(scan, /for \(const b of await officeBranches/, 'branches not one after another');
  assert.ok(FIRST_FETCH_WAIT_MS <= 2000);
});
