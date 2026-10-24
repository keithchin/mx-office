// The push baseline kept on disk (review-gate/pushes.ts) and the push watch (push-watch/): a commit pushed
// straight to main while the office was down is flagged by the first look after the start, the very first
// look at a project only records where main is (and says when), a move the office can't follow is said as one,
// and the watch's timer stays bounded. Real git repos in temporary folders (a bare "origin", the project's
// clone, someone else's clone); no GitHub, no token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPushes, pushItem, readPushState } from '../src/server/review-gate/pushes.js';
import { MAX_PER_TICK, NO_POLL_EVERY_MS, POLL_EVERY_MS, PushWatch, machineWatchDeps, type WatchDeps, type WatchFloor } from '../src/server/push-watch/index.js';
import type { PushLook } from '../src/server/review-gate/pushes.js';

function tmp(t: { after(fn: () => void): void }, prefix = 'push-watch-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const ME = { GIT_AUTHOR_NAME: 'Keith Chin', GIT_AUTHOR_EMAIL: 'keith@example.test', GIT_COMMITTER_NAME: 'Keith Chin', GIT_COMMITTER_EMAIL: 'keith@example.test' };
const git = (dir: string, args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...ME } }).trim();
function commit(dir: string, file: string, msg: string): string {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), msg);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
}

/** origin (bare), the project's own clone, and an outsider's clone that pushes straight to main. */
function remotes(t: { after(fn: () => void): void }) {
  const root = tmp(t);
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  git(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(root, ['init', '-q', '-b', 'main', seed]);
  commit(seed, 'a.txt', 'Initial commit');
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', '-q', 'origin', 'main']);
  const project = path.join(root, 'project');
  const outsider = path.join(root, 'outsider');
  git(root, ['clone', '-q', origin, project]);
  git(root, ['clone', '-q', origin, outsider]);
  return { root, origin, project, outsider };
}

/** The office as the watch's machine deps see it: one project, no PR list. */
const officeOf = (dataDir: string, dir: string) => ({ cfg: { dataDir }, floors: new Map([['shop', { id: 'shop', dir, github: { pulls: { items: [], fetchedAt: 0, loading: false } } }]]) }) as never;

test('a commit pushed straight to main while the office was down is flagged by the first look after the start', async (t) => {
  const { project, outsider } = remotes(t);
  const data = tmp(t, 'push-watch-data-');
  // The office runs and looks once: the project's very first look records main (and when), flagging nothing.
  const found1: PushLook[] = [];
  const before = new PushWatch(machineWatchDeps(officeOf(data, project), (_f, look) => found1.push(look)));
  const first = await before.lookAt(before.due()[0]);
  assert.equal(first?.first, true, 'no baseline yet: this look is the first');
  assert.deepEqual(first?.fresh, [], 'the very first look flags nothing (older history isn’t news)');
  const kept = await readPushState(data, 'shop');
  assert.ok(kept.tip && kept.since, 'the baseline is on disk, with when it was first recorded');
  assert.equal(found1.length, 0);
  // The office stops. Someone pushes straight to main (no pull request) while it's down.
  const destructive = commit(outsider, 'model/Entity.txt', 'Drop 15 attributes from Customer');
  git(outsider, ['push', '-q', 'origin', 'main']);
  // The office starts again: a new watch with nothing in memory. Its first look fetches, compares with the baseline on disk, and flags the commit.
  const found2: PushLook[] = [];
  const after = new PushWatch(machineWatchDeps(officeOf(data, project), (_f, look) => found2.push(look)));
  assert.equal(after.due().length, 1, 'due at once after a start');
  const look = await after.lookAt(after.due()[0]);
  assert.equal(look?.first, false);
  assert.deepEqual(look?.fresh.map((e) => [e.kind, e.sha]), [['direct', destructive]]);
  assert.equal(found2.length, 1, 'Needs you is told');
  assert.match(pushItem(look!.fresh[0]).text, /reached main without a pull request/);
  // Looking again finds nothing new: the same commit is never flagged twice.
  assert.deepEqual((await after.lookAt({ id: 'shop', dir: project, polling: () => false, merges: () => new Set() }))?.fresh, []);
});

test('a move the office can’t follow (the old tip is gone) is flagged as one, never taken silently as the new baseline', async (t) => {
  const { project } = remotes(t);
  const data = tmp(t, 'push-watch-data-');
  mkdirSync(path.join(data, 'review-gate'), { recursive: true });
  const ghost = 'f'.repeat(40);
  writeFileSync(path.join(data, 'review-gate', 'shop.json'), JSON.stringify({ branch: 'main', tip: ghost, since: 1, events: [] }));
  const head = git(project, ['rev-parse', 'origin/main']);
  const look = await checkPushes(data, 'shop', project, { branch: 'main', sha: head }, new Set());
  assert.deepEqual(look.fresh.map((e) => [e.kind, e.was, e.sha]), [['unknown', ghost, head]]);
  assert.match(pushItem(look.fresh[0]).text, /can't tell which commits skipped a pull request/);
  assert.equal((await readPushState(data, 'shop')).since, 1, 'the first baseline’s date is kept');
});

test('two looks at once (the asks look and the watch) share one, so a commit is flagged once', async (t) => {
  const { project, outsider } = remotes(t);
  const data = tmp(t, 'push-watch-data-');
  await checkPushes(data, 'shop', project, { branch: 'main', sha: git(project, ['rev-parse', 'origin/main']) }, new Set());
  commit(outsider, 'b.txt', 'Hotfix');
  git(outsider, ['push', '-q', 'origin', 'main']);
  git(project, ['fetch', '-q', 'origin']);
  const sha = git(project, ['rev-parse', 'origin/main']);
  const [a, b] = await Promise.all([checkPushes(data, 'shop', project, { branch: 'main', sha }, new Set()), checkPushes(data, 'shop', project, { branch: 'main', sha }, new Set())]);
  assert.equal(a, b);
  assert.equal((await readPushState(data, 'shop')).events.length, 1);
});

/** Fake deps: `n` projects, GitHub's head per project, and a log of what the watch asked. */
function fakeDeps(n: number, opts: { polling?: (id: string) => boolean } = {}) {
  let now = 1_000_000;
  const asked: string[] = [];
  const remote = new Map<string, string>();
  const local = new Map<string, string>();
  const floors: WatchFloor[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, dir: `/p${i}`, polling: () => opts.polling?.(`p${i}`) ?? false, merges: () => new Set<string>() }));
  for (const f of floors) {
    remote.set(f.dir, 'a'.repeat(40));
    local.set(f.dir, 'a'.repeat(40));
  }
  const deps: WatchDeps = {
    floors: () => floors,
    defaultBranch: async () => 'main',
    remoteHead: async (dir) => (asked.push(`ls-remote ${dir}`), remote.get(dir)),
    localHead: async (dir) => local.get(dir),
    fetch: async (dir) => {
      asked.push(`fetch ${dir}`);
      local.set(dir, remote.get(dir)!);
    },
    check: async (id) => (asked.push(`check ${id}`), { events: [], fresh: [], first: false }),
    found: () => undefined,
    localOnly: (dir) => dir === '/local',
    now: () => now,
  };
  return { deps, asked, remote, floors, tick: (ms: number) => (now += ms) };
}

test('the watch’s timer is bounded: a few projects a tick, one at a time, each at most every 2 minutes (10 with GitHub polling), a fetch only when GitHub moved', async () => {
  const f = fakeDeps(5, { polling: (id) => id === 'p4' });
  const w = new PushWatch(f.deps);
  assert.equal(await w.tick(), MAX_PER_TICK, 'at most MAX_PER_TICK projects per tick');
  assert.equal(await w.tick(), MAX_PER_TICK);
  assert.equal(await w.tick(), 1, 'the rest next tick');
  assert.equal(await w.tick(), 0, 'nothing due until its interval passes');
  assert.ok(!f.asked.some((a) => a.startsWith('fetch')), 'GitHub’s head was the local one: no fetch');
  f.tick(NO_POLL_EVERY_MS);
  const due = w.due().map((x) => x.id);
  assert.ok(!due.includes('p4'), 'a project whose PR list polls GitHub waits 10 minutes');
  assert.ok(due.length <= MAX_PER_TICK);
  f.tick(POLL_EVERY_MS);
  f.remote.set('/p0', 'b'.repeat(40));
  f.asked.length = 0;
  await w.lookAt(f.floors[0]);
  assert.deepEqual(f.asked, ['ls-remote /p0', 'fetch /p0', 'check p0'], 'GitHub moved: one ls-remote, one fetch, the local check');
  // Something else fetched the folder lately: no ls-remote, only the local check.
  f.asked.length = 0;
  w.heardFetch('/p1');
  await w.lookAt(f.floors[1]);
  assert.deepEqual(f.asked, ['check p1']);
  // Never two ticks at once.
  f.tick(POLL_EVERY_MS);
  const [x, y] = await Promise.all([w.tick(), w.tick()]);
  assert.equal(x + y, x, 'the second tick while one is going does nothing');
  assert.equal(y, 0);
});

test('local-only projects are never asked', async () => {
  const f = fakeDeps(0);
  const floors: WatchFloor[] = [{ id: 'l', dir: '/local', polling: () => false, merges: () => new Set() }];
  const w = new PushWatch({ ...f.deps, floors: () => floors });
  assert.equal(await w.tick(), 0);
  assert.deepEqual(f.asked, []);
});
