// Release 83, item 4: while microflow tests loaded the machine, GET /api/local-merge took 52 s to over two minutes
// and /api/m/status timed out, with many `git log --all` (and gate-check's git) piled up, all started by the office.
// Now: an identical read-only git already running shares its answer; the task links' `log --all` is one per folder;
// the local-merge view is kept while nothing it reads moved; the phone's Status lines are kept and refreshed behind
// the answer; an automatic gate-check waits while the test runtime is busy and never starts over one still ending.
// Real git in temp folders, fake runners; no GitHub, no model, no Mendix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readOnlyGit, singleFlight } from '../src/server/gitgraph/single-flight.js';
import { runGit } from '../src/server/gitgraph/index.js';
import { commitsSince, useLogRunner } from '../src/server/tasks/git.js';
import { GateSource, branchInfo } from '../src/server/wizard/gate-source.js';
import { forgetLocalMerges, localMergeView } from '../src/server/local-merge/index.js';
import { forgetLocalOnly } from '../src/server/local-only.js';
import { projectLines, STATUS_FRESH_MS, STATUS_STALE_MS } from '../src/server/mobile/status.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Agent', '-c', 'user.email=a@example.test', ...args], { cwd, encoding: 'utf8' }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('only read-only git shares an in-flight answer, and only while it runs', async () => {
  for (const a of [['log', '--all'], ['rev-parse', 'HEAD'], ['-c', 'x=y', 'for-each-ref'], ['config', '--get', 'user.name'], ['branch', '--list'], ['merge-base', '--is-ancestor', 'a', 'b']]) assert.equal(readOnlyGit(a), true, a.join(' '));
  for (const a of [['fetch', 'origin'], ['push'], ['merge', 'x'], ['commit', '-m', 'x'], ['worktree', 'add', 'x'], ['checkout', 'main'], ['reset', '--hard'], ['config', 'user.name', 'x'], ['branch', '-D', 'x'], ['remote', 'add', 'o', 'u']]) assert.equal(readOnlyGit(a), false, a.join(' '));
  const share = singleFlight<string>();
  let runs = 0;
  const run = () => sleep(30).then(() => `out ${++runs}`);
  const [a, b, c] = await Promise.all([share(['log', '-1'], '/r', run), share(['log', '-1'], '/r', run), share(['log', '-1'], '/other', run)]);
  assert.equal(a, b, 'the second ask shares the first one’s answer');
  assert.equal(runs, 2, 'another folder is another question');
  assert.notEqual(c, a);
  assert.equal(share.inFlight(), 0, 'forgotten once settled');
  await share(['log', '-1'], '/r', run);
  assert.equal(runs, 3, 'a later ask runs git again');
  await Promise.all([share(['fetch'], '/r', run), share(['fetch'], '/r', run)]);
  assert.equal(runs, 5, 'a fetch is never shared');
  // runGit itself: two identical reads at once are one start (the same promise).
  const dir = mkdtempSync(path.join(tmpdir(), 'r83-sf-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'a');
    const p1 = runGit(['rev-parse', 'HEAD'], dir);
    const p2 = runGit(['rev-parse', 'HEAD'], dir);
    assert.equal(p1, p2);
    assert.equal((await p1).trim(), git(dir, 'rev-parse', 'HEAD'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the task links’ log --all: one per folder covering the widest window, each caller its part', async () => {
  const now = Date.UTC(2026, 10, 2, 12, 0, 0);
  const sinces: number[] = [];
  const commits = [10, 40, 70, 100, 130].map((min, i) => `${String(i + 1).padStart(40, 'a')}\u001f${Math.floor((now - min * 60_000) / 1000)}\u001fcommit ${min} min ago\u001e`).join('');
  useLogRunner(async (_dir, since) => {
    sinces.push(since);
    await sleep(50);
    return commits;
  });
  try {
    // Before: one log per answer (five here). Now: the first, one wider, and the rest share them.
    const asks = [60, 120, 30, 90, 45].map((min) => commitsSince('/repo', now - min * 60_000, now));
    const got = await Promise.all(asks);
    assert.equal(sinces.length, 2, `logs started: ${sinces.length}`);
    assert.deepEqual(got.map((cs) => cs.length), [2, 4, 1, 3, 2], 'each caller gets only its window');
    await commitsSince('/repo', now - 100 * 60_000, now + 30_000);
    assert.equal(sinces.length, 2, 'inside the minute and the window: no new log');
    await commitsSince('/repo', now - 60 * 60_000, now + 61_000);
    assert.equal(sinces.length, 3, 'a minute later: asked again');
  } finally {
    useLogRunner();
  }
});

function gateRepos() {
  const root = mkdtempSync(path.join(tmpdir(), 'r83-gates-'));
  const origin = path.join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const floor = path.join(root, 'floor');
  git(root, 'clone', '-q', origin, floor);
  git(floor, 'checkout', '-q', '-b', 'main');
  writeFileSync(path.join(floor, 'PROJECT.md'), '# Project\n\n## Decisions\n');
  git(floor, 'add', '.');
  git(floor, 'commit', '-q', '-m', 'scaffold');
  git(floor, 'push', '-q', 'origin', 'main');
  return { root, floor };
}

test('automatic gate-checks wait while the test runtime is busy; a forced one runs; none over one still ending', { timeout: 60_000 }, async () => {
  const { root, floor } = gateRepos();
  try {
    let busy: string | undefined = 'waiting for a microflow test run to finish';
    let runs = 0;
    const gates = new GateSource(
      async () => {
        runs++;
      },
      { fetch: false, throttleMs: 0, failMs: 0, deferWhile: () => busy },
    );
    const info = (await branchInfo(floor))!;
    assert.equal(gates.regenerate(floor, info), undefined, 'put off while the runtime is busy');
    assert.match(gates.deferredWhy(floor) ?? '', /microflow test run/);
    await gates.regenerate(floor, info, true);
    assert.equal(runs, 1, 'a forced Re-check still runs');
    busy = undefined;
    await gates.regenerate(floor, info);
    assert.equal(runs, 2, 'runs once the runtime is free');
    assert.equal(gates.deferredWhy(floor), undefined);

    // A run that never ends: given up on after the limit and a grace, then no automatic run until it has ended.
    let release: () => void = () => undefined;
    let hung = 0;
    const stuck = new GateSource(
      () => {
        hung++;
        return new Promise<void>((r) => (release = r));
      },
      { fetch: false, throttleMs: 0, failMs: 0, timeoutMs: 100, graceMs: 50 },
    );
    await stuck.regenerate(floor, info, true);
    assert.equal(stuck.busy(floor), false, 'its slot is let go');
    assert.equal(stuck.regenerate(floor, info), undefined, 'none over one still ending');
    assert.equal(hung, 1);
    release();
    await sleep(20);
    await stuck.regenerate(floor, info);
    assert.equal(hung, 2, 'once it ended, the next one runs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the local-merge view is kept while nothing moved and built again after a commit', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'r83-lm-'));
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
    git(floorDir, 'commit', '-q', '-m', 'setup');
    git(floorDir, 'push', '-q', '-u', 'origin', 'main');
    const wt = path.join(dir, 'wt');
    git(floorDir, 'worktree', 'add', '-q', '-b', 'office/dev-1', wt, 'main');
    writeFileSync(path.join(wt, 'notes.md'), '# Notes\n');
    git(wt, 'add', '.');
    git(wt, 'commit', '-q', '-m', 'Notes');
    forgetLocalOnly();
    forgetLocalMerges();
    const ctx = { cfg: { dataDir: path.join(dir, 'data') } } as never;
    const floor = { id: 'app', dir: floorDir, workers: { list: () => [] }, github: { pulls: { items: [] } }, def: { repo: 'o/app' } } as never;
    const t0 = Date.now();
    const v1 = await localMergeView(ctx, floor);
    const cold = Date.now() - t0;
    const t1 = Date.now();
    const v2 = await localMergeView(ctx, floor);
    const warm = Date.now() - t1;
    assert.equal(v2, v1, 'nothing moved: the kept view');
    assert.ok(warm <= cold + 50, `kept view ${warm} ms vs built ${cold} ms`);
    writeFileSync(path.join(wt, 'notes.md'), '# Notes\n\nmore\n');
    git(wt, 'commit', '-q', '-am', 'More notes');
    const v3 = await localMergeView(ctx, floor);
    assert.notEqual(v3, v1, 'a new commit: built again');
    assert.equal(v3.branches.find((b) => b.branch === 'office/dev-1')?.sha, git(wt, 'rev-parse', 'HEAD'));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test('the phone’s Status lines: kept while fresh, refreshed behind the answer, one build at a time', async () => {
  const ctx = { floors: new Map() } as never;
  let builds = 0;
  let gate: () => void = () => undefined;
  const read = () => {
    builds++;
    const n = builds;
    return new Promise<never[]>((r) => (gate = () => r([{ n }] as never)));
  };
  const t = 1_000_000;
  const a = projectLines(ctx, t, read);
  const b = projectLines(ctx, t, read);
  assert.equal(builds, 1, 'a look during the first build shares it');
  gate();
  assert.deepEqual(await a, [{ n: 1 }]);
  assert.equal(await b, await a);
  const kept = await projectLines(ctx, Date.now() + 1, read);
  assert.equal(builds, 1, 'fresh: the kept lines, no build');
  assert.deepEqual(kept, [{ n: 1 }]);
  const stale = await projectLines(ctx, Date.now() + STATUS_STALE_MS + 10, read);
  assert.deepEqual(stale, [{ n: 1 }], 'stale: still answered at once with the kept lines');
  assert.equal(builds, 2, 'and a build started behind the answer');
  projectLines(ctx, Date.now() + STATUS_STALE_MS + 20, read);
  assert.equal(builds, 2, 'one build at a time');
  gate();
  await sleep(10);
  assert.deepEqual(await projectLines(ctx, Date.now() + 1, read), [{ n: 2 }], 'the refreshed lines are kept');
  const old = projectLines(ctx, Date.now() + STATUS_FRESH_MS + 10, read);
  assert.equal(builds, 3, 'too old: the look waits for a build');
  gate();
  assert.deepEqual(await old, [{ n: 3 }]);
});
