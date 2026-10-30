// Release 82, team flow #3: the office runs and records mx check at the exact commit a merge is about
// (server/merge-check/): when an agent asks to merge or review a named commit, and when the merge confirm opens
// with none recorded. A recorded check is shown, never run again; a notes-only commit gets none. Real git in a
// temp folder; the check itself is a fake (no mxcli, no Mendix).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runGit } from '../src/server/gitgraph/index.js';
import { checkAsked, ensureCheck, type MergeCheckDeps } from '../src/server/merge-check/index.js';
import { checkPending, mergeCheckWords } from '../src/shared/merge-check.js';
import type { MxCheckResult } from '../src/shared/security.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'user.name=Agent', '-c', 'user.email=a@example.test', ...args], { cwd, encoding: 'utf8' }).trim();
function commit(dir: string, file: string, msg: string): string {
  writeFileSync(path.join(dir, file), `${msg}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

function fakeDeps(): MergeCheckDeps & { started: string[]; records: Map<string, MxCheckResult> } {
  const records = new Map<string, MxCheckResult>();
  const started: string[] = [];
  let running: string | undefined;
  return {
    git: runGit,
    records,
    started,
    checkAt: async (_f, sha) => records.get(sha),
    runningOn: () => (running ? { commit: running, since: 0 } : undefined),
    start: async (_floor, sha, by) => {
      started.push(`${sha.slice(0, 7)} by ${by}`);
      running = sha;
      const r: MxCheckResult = { commit: sha, at: 1, status: 'pass', errors: 0, ms: 5, by };
      records.set(sha, r);
      running = undefined;
      return r;
    },
  };
}

test('a merge ask starts mx check at its exact commit once; a recorded one is shown; notes-only gets none', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'r82-mxcheck-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir, 'App.mpr', 'model v1');
    git(dir, 'checkout', '-q', '-b', 'office/blake-1');
    const asked = commit(dir, 'App.mpr', 'Row 12: form page');
    git(dir, 'checkout', '-q', 'main');
    const d = fakeDeps();
    const floor = { id: 'f1', dir };
    const e = { id: 'e1', by: 'Blake', at: 1, title: `Approve merge of ${asked.slice(0, 7)} (office/blake-1)`, details: '', options: [], status: 'open' as const, workerId: 'w' };
    const views = await checkAsked(d, floor, e);
    assert.equal(views.length, 1);
    assert.equal(views[0].status, 'running');
    assert.equal(views[0].started, true);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(d.started, [`${asked.slice(0, 7)} by Mx Office (Blake's merge ask ESC-e1)`]);
    // The confirm opened later: the record at that commit, not a second run.
    const again = await ensureCheck(d, floor, asked, 'Mx Office (merge confirm)');
    assert.equal(again.status, 'pass');
    assert.equal(d.started.length, 1);
    assert.match(mergeCheckWords(again), /mx check passed at @[0-9a-f]{7}/);
    assert.equal(checkPending(again), false);
    // A commit without an app: nothing to check.
    const noApp = mkdtempSync(path.join(tmpdir(), 'r82-noapp-'));
    try {
      git(noApp, 'init', '-q', '-b', 'main');
      const notes = commit(noApp, 'NOTES.md', 'journal');
      assert.equal((await ensureCheck(d, { id: 'f2', dir: noApp }, notes, 'x')).status, 'no-app');
    } finally {
      rmSync(noApp, { recursive: true, force: true });
    }
    // An ask for a commit already on main starts nothing.
    const onMain = git(dir, 'rev-parse', 'HEAD');
    assert.deepEqual(await checkAsked(d, floor, { ...e, id: 'e2', title: `Approve merge of ${onMain.slice(0, 7)}` }), []);
    git(dir, 'checkout', '-q', 'office/blake-1');
    // Looking only (start false) says none, starts nothing.
    const other = commit(dir, 'App.mpr', 'Row 13');
    assert.equal((await ensureCheck(d, floor, other, 'x', false)).status, 'none');
    assert.equal(d.started.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the confirm model check line in words, for each state', () => {
  assert.match(mergeCheckWords({ status: 'fail', commit: 'abc1234def', errors: 2, codes: ['CE0463'] }), /mx check found 2 errors at @abc1234 \(CE0463\)/);
  assert.match(mergeCheckWords({ status: 'running', commit: 'abc1234def', started: true }), /The office started mx check/);
  assert.match(mergeCheckWords({ status: 'error', commit: 'abc1234def', why: 'no mxbuild' }), /didn't finish at @abc1234: no mxbuild/);
  assert.equal(checkPending({ status: 'running', commit: 'x' }), true);
});
