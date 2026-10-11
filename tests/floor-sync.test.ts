// The floor sync (server/floor-sync/): a floor's own checkout brought up to date with GitHub only by a
// fast-forward nobody can lose anything to, on real temporary repos (a bare "GitHub", the floor's clone,
// and a teammate's clone that pushes), and every reason it refuses; the audit log told once per reason;
// no git on the event loop; and what "Edit in Studio Pro" says when there's still no .mpr.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AuditInput } from '../src/shared/audit.js';
import type { FloorSyncState } from '../src/shared/studio.js';
import { changedPaths, refusalKey, syncFloor, whyNoMpr, type SyncDeps } from '../src/server/floor-sync/sync.js';
import { busyInFolder, floorSyncOf, gitOff, noteSync, syncFloorNow, worthALook } from '../src/server/floor-sync/index.js';
import { onOriginNews, originNews } from '../src/server/floor-sync/bus.js';
import { sightFloor } from '../src/server/studio/detect.js';

const root = path.join(import.meta.dirname, '..');
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t', GIT_TERMINAL_PROMPT: '0' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', windowsHide: true }).trim();

interface Repos {
  base: string;
  origin: string;
  floor: string;
  mate: string;
}

/** A bare origin on main, the floor's clone of it (with .agent-office/ excluded, as the office does), and a teammate's clone. */
function repos(): Repos {
  const base = mkdtempSync(path.join(os.tmpdir(), 'floor-sync-'));
  const origin = path.join(base, 'origin.git');
  const seed = path.join(base, 'seed');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(base, 'init', '-q', '-b', 'main', seed);
  writeFileSync(path.join(seed, 'README.md'), '# app\n');
  writeFileSync(path.join(seed, '.gitignore'), 'deployment/\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'start');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');
  const floor = path.join(base, 'floor');
  const mate = path.join(base, 'mate');
  git(base, 'clone', '-q', origin, floor);
  git(base, 'clone', '-q', origin, mate);
  writeFileSync(path.join(floor, '.git', 'info', 'exclude'), '.agent-office/\n');
  return { base, origin, floor, mate };
}

/** The teammate merges `n` commits on GitHub (the last adds project.mpr), and the floor fetches them. */
function mergedOnGitHub(r: Repos, n = 3) {
  for (let i = 1; i <= n; i++) {
    if (i === n) writeFileSync(path.join(r.mate, 'project.mpr'), 'mpr');
    else writeFileSync(path.join(r.mate, `f${i}.txt`), String(i));
    git(r.mate, 'add', '.');
    git(r.mate, 'commit', '-q', '-m', `c${i}`);
  }
  git(r.mate, 'push', '-q', 'origin', 'main');
  git(r.floor, 'fetch', '-q', 'origin');
}

function deps(over: Partial<SyncDeps> = {}): SyncDeps {
  return {
    git: gitOff,
    exists: (p) => access(p).then(
      () => true,
      () => false,
    ),
    studioOpen: async () => false,
    busyHere: () => [],
    now: () => 1000,
    ...over,
  };
}

const head = (dir: string) => git(dir, 'rev-parse', 'HEAD');
const originMain = (dir: string) => git(dir, 'rev-parse', 'refs/remotes/origin/main');

test('a clean floor behind GitHub is fast-forwarded, and the .mpr main has turns up in the folder', async (t) => {
  const r = repos();
  t.after(() => rmSync(r.base, { recursive: true, force: true }));
  mergedOnGitHub(r, 3);
  // The office's own folder (worktrees and all) doesn't count: it's in .git/info/exclude.
  mkdirSync(path.join(r.floor, '.agent-office', 'worktrees', 'w1'), { recursive: true });
  writeFileSync(path.join(r.floor, '.agent-office', 'worktrees', 'w1', 'x.txt'), 'x');
  // Nor does what .gitignore ignores.
  mkdirSync(path.join(r.floor, 'deployment'));
  writeFileSync(path.join(r.floor, 'deployment', 'log.txt'), 'x');
  const from = head(r.floor);
  assert.equal(existsSync(path.join(r.floor, 'project.mpr')), false);
  const s = await syncFloor('shop', r.floor, deps());
  assert.equal(s.state, 'moved', JSON.stringify(s));
  assert.equal(s.from, from);
  assert.equal(s.to, originMain(r.floor));
  assert.equal(s.commits, 3);
  assert.equal(s.behind, 0);
  assert.equal(head(r.floor), originMain(r.floor));
  assert.equal(existsSync(path.join(r.floor, 'project.mpr')), true);
  // Looked at again: current, nothing to do.
  const again = await syncFloor('shop', r.floor, deps());
  assert.equal(again.state, 'current');
});

test('every reason it refuses, and the folder left exactly as it was each time', async (t) => {
  const cases: [string, (r: Repos) => Partial<SyncDeps> | void, FloorSyncState['reason'], RegExp][] = [
    [
      'a changed file',
      (r) => writeFileSync(path.join(r.floor, 'README.md'), 'mine\n'),
      'dirty',
      /3 commits behind GitHub and has local changes in README\.md — commit or stash them/,
    ],
    ['an untracked file', (r) => writeFileSync(path.join(r.floor, 'notes.txt'), 'x'), 'dirty', /local changes in notes\.txt/],
    [
      'a staged file',
      (r) => {
        writeFileSync(path.join(r.floor, 'new.txt'), 'x');
        git(r.floor, 'add', 'new.txt');
      },
      'dirty',
      /local changes in new\.txt/,
    ],
    ['another branch', (r) => void git(r.floor, 'switch', '-q', '-c', 'spike'), 'branch', /on branch spike, not main — switch it to main/],
    ['detached', (r) => void git(r.floor, 'checkout', '-q', '--detach'), 'detached', /isn't on a branch .* switch it to main/],
    [
      'diverged',
      (r) => {
        writeFileSync(path.join(r.floor, 'mine.txt'), 'x');
        git(r.floor, 'add', '.');
        git(r.floor, 'commit', '-q', '-m', 'mine');
      },
      'diverged',
      /has 1 commit GitHub hasn't got and is 3 commits behind/,
    ],
    ['Studio Pro open', () => ({ studioOpen: async () => true }), 'studio-open', /Studio Pro has the project open — close Studio Pro/],
    ['an agent mid-turn in the folder', () => ({ busyHere: () => ['Ada'] }), 'agent-busy', /Ada is working in it right now/],
    [
      'a merge in progress',
      (r) => {
        git(r.floor, 'switch', '-q', '-c', 'side');
        writeFileSync(path.join(r.floor, 'side.txt'), 'x');
        git(r.floor, 'add', '.');
        git(r.floor, 'commit', '-q', '-m', 'side');
        git(r.floor, 'switch', '-q', 'main');
        git(r.floor, 'merge', '-q', '--no-ff', '--no-commit', 'side');
      },
      'in-progress',
      /A merge is in progress in the project folder — finish or abort it/,
    ],
  ];
  for (const [name, arrange, reason, message] of cases) {
    const r = repos();
    t.after(() => rmSync(r.base, { recursive: true, force: true }));
    mergedOnGitHub(r, 3);
    const over = arrange(r) ?? {};
    const before = head(r.floor);
    const status = git(r.floor, 'status', '--porcelain');
    const s = await syncFloor('shop', r.floor, deps(over));
    assert.equal(s.state, 'refused', `${name}: ${JSON.stringify(s)}`);
    assert.equal(s.reason, reason, name);
    assert.match(s.message ?? '', message, name);
    assert.equal(head(r.floor), before, `${name}: HEAD didn't move`);
    assert.equal(git(r.floor, 'status', '--porcelain'), status, `${name}: nothing touched`);
    assert.equal(existsSync(path.join(r.floor, 'project.mpr')), false, name);
  }
});

test('a floor ahead of GitHub (commits not pushed yet) is current, and one with no remote is left alone', async (t) => {
  const r = repos();
  t.after(() => rmSync(r.base, { recursive: true, force: true }));
  writeFileSync(path.join(r.floor, 'mine.txt'), 'x');
  git(r.floor, 'add', '.');
  git(r.floor, 'commit', '-q', '-m', 'mine');
  const s = await syncFloor('shop', r.floor, deps());
  assert.equal(s.state, 'current');
  assert.equal(s.ahead, 1);
  const lone = path.join(r.base, 'lone');
  git(r.base, 'init', '-q', '-b', 'main', lone);
  assert.equal((await syncFloor('lone', lone, deps())).state, 'no-remote');
  assert.equal((await syncFloor('none', path.join(r.base, 'not-a-repo'), deps())).state !== 'moved', true);
});

test("Studio Pro's lock counts as open only when its Studio Pro runs (the sighting the sync asks)", () => {
  const mpr = 'C:\\floors\\shop\\project.mpr';
  assert.equal(sightFloor(mpr, '{"ProcessId":4242}', [{ pid: 4242, cmd: '' }]).open, true);
  assert.equal(sightFloor(mpr, '{"ProcessId":4242}', []).open, false, 'a stale lock');
  assert.equal(sightFloor(mpr, undefined, [{ pid: 7, cmd: `"C:\\Mendix\\studiopro.exe" "${mpr}"` }]).open, true);
});

test('changedPaths reads porcelain: renames to their new name, quoted paths unquoted', () => {
  assert.deepEqual(changedPaths(' M README.md\n?? notes.txt\nR  a.txt -> b.txt\n?? "with space.txt"\n'), ['README.md', 'notes.txt', 'b.txt', 'with space.txt']);
});

test('the audit log: a move always, a refusal once per reason until the folder is current again', () => {
  const got: AuditInput[] = [];
  const rec = (e: AuditInput) => void got.push(e);
  const floor = { id: 'audit-floor', def: { name: 'Shop' } } as never;
  const refused = (reason: FloorSyncState['reason'], on?: string): FloorSyncState => ({ floor: 'audit-floor', state: 'refused', reason, message: `no: ${reason}`, behind: 5, branch: 'main', ...(on ? { on } : {}), at: 1 });
  noteSync(floor, refused('dirty'), rec);
  noteSync(floor, refused('dirty'), rec);
  noteSync(floor, refused('dirty'), rec);
  assert.equal(got.length, 1, 'the same refusal three times: once');
  assert.equal(got[0].action, 'floor.sync-refused');
  assert.equal(got[0].severity, 'warning');
  assert.match(got[0].summary, /no: dirty/);
  noteSync(floor, refused('branch', 'spike'), rec);
  noteSync(floor, refused('branch', 'other'), rec);
  assert.equal(got.length, 3, 'another reason, or another branch: said again');
  noteSync(floor, { floor: 'audit-floor', state: 'current', branch: 'main', behind: 0, at: 2 }, rec);
  assert.equal(got.length, 3, 'current is not news');
  noteSync(floor, refused('branch', 'other'), rec);
  assert.equal(got.length, 4, 'after it was current, the same refusal is news again');
  noteSync(floor, { floor: 'audit-floor', state: 'moved', branch: 'main', behind: 0, from: 'a'.repeat(40), to: 'b'.repeat(40), commits: 386, at: 3 }, rec);
  assert.equal(got.length, 5);
  assert.equal(got[4].action, 'floor.sync');
  assert.match(got[4].summary, /main aaaaaaa → bbbbbbb \(386 commits\)/);
  assert.deepEqual(got[4].details, { branch: 'main', from: 'a'.repeat(40), to: 'b'.repeat(40), commits: 386 });
  assert.equal(floorSyncOf('audit-floor')?.state, 'moved');
  assert.equal(refusalKey(refused('branch', 'x')), 'branch|x');
});

test('looks on news: a current floor again after a short while, a refused one only every few minutes', () => {
  assert.equal(worthALook(undefined, 0), true);
  const current: FloorSyncState = { floor: 'f', state: 'current', behind: 0, at: 0 };
  assert.equal(worthALook(current, 5_000), false);
  assert.equal(worthALook(current, 20_000), true);
  const refused: FloorSyncState = { floor: 'f', state: 'refused', reason: 'dirty', behind: 3, at: 0 };
  assert.equal(worthALook(refused, 60_000), false);
  assert.equal(worthALook(refused, 6 * 60_000), true);
});

test('two asks at once share one look', async (t) => {
  const r = repos();
  t.after(() => rmSync(r.base, { recursive: true, force: true }));
  mergedOnGitHub(r, 2);
  let looks = 0;
  const d = deps({ studioOpen: async () => (looks++, false) });
  const floor = { id: 'join-floor', dir: r.floor, def: { name: 'Join' }, workers: { list: () => [] } } as never;
  const [a, b] = await Promise.all([syncFloorNow(floor, { deps: d }), syncFloorNow(floor, { deps: d })]);
  assert.equal(a, b);
  assert.equal(a.state, 'moved');
  assert.equal(looks, 1);
});

test('only an agent mid-turn without a worktree of its own counts as working in the folder', () => {
  const w = (name: string, status: string, extra: object = {}) => ({ name, status, kind: 'agent', ...extra });
  const floor = { workers: { list: () => [w('Ada', 'working'), w('Bo', 'idle'), w('Cy', 'working', { worktree: { path: 'x', branch: 'b', base: 'c' } }), { name: 'Sh', status: 'working', kind: 'shell' }] } } as never;
  assert.deepEqual(busyInFolder(floor), ['Ada']);
});

test('the bus tells whoever listens, and a listener that throws stops nobody', () => {
  const heard: string[] = [];
  const off1 = onOriginNews(() => {
    throw new Error('boom');
  });
  const off2 = onOriginNews((dir, news) => heard.push(`${dir}:${news}`));
  const err = console.error;
  console.error = () => undefined;
  try {
    originNews('/f', 'stale');
  } finally {
    console.error = err;
  }
  off1();
  off2();
  originNews('/f');
  assert.deepEqual(heard, ['/f:stale']);
});

test('why there is no .mpr: always with the reason, never just "no .mpr found"', () => {
  const dir = 'C:\\floors\\shop';
  const refused: FloorSyncState = { floor: 'f', state: 'refused', reason: 'dirty', message: 'Your project folder is 386 commits behind GitHub and has local changes in README.md — commit or stash them, then try again', behind: 386, at: 1 };
  assert.match(whyNoMpr(dir, refused), /couldn't bring it up to date with GitHub\. Your project folder is 386 commits behind GitHub and has local changes in README\.md/);
  assert.match(whyNoMpr(dir, { floor: 'f', state: 'current', branch: 'main', behind: 0, at: 1 }), /even up to date with origin\/main: GitHub doesn't have one either/);
  assert.match(whyNoMpr(dir, { floor: 'f', state: 'no-remote', behind: 0, at: 1 }), /no GitHub remote/);
  assert.match(whyNoMpr(dir, undefined), /no GitHub remote/);
});

test('no git on the event loop: the floor sync starts every program off it (offloop/exec.ts)', () => {
  const dir = path.join(root, 'src/server/floor-sync');
  for (const f of readdirSync(dir)) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /\b(execFileSync|execSync|spawnSync|execFile\(|spawn\()/, `${f} starts a program on the event loop`);
  }
  assert.match(readFileSync(path.join(dir, 'index.ts'), 'utf8'), /execFileOff\('git'/);
});

/** POST /api/studio/<what> as an admin from the office's own page, for a floor at `dir`. */
async function route(what: 'sync' | 'open', dir: string) {
  const { Readable } = await import('node:stream');
  const { studioRoutes } = await import('../src/server/http/routes/studio.js');
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ floor: 'travel-route' }))]), { method: 'POST', headers: { host: 'office.test', origin: 'http://office.test' } });
  let status = 0;
  let body: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = JSON.parse(b)), headersSent: false };
  const floor = { id: 'travel-route', dir, def: { name: 'Travel' }, workers: { list: () => [] } };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: true }), floors: new Map([['travel-route', floor]]), toastFloor: () => undefined };
  const r = studioRoutes[what];
  await (r.handle as (c: unknown, r: unknown) => Promise<void>)(ctx, { req, res, url: new URL(`http://office.test${r.path}`), path: r.path, session: {} });
  return { status, body: body as Record<string, any> };
}

test('Edit in Studio Pro on a folder behind GitHub: refused with the reason, then brought up to date and the .mpr found', async (t) => {
  const r = repos();
  t.after(() => rmSync(r.base, { recursive: true, force: true }));
  // GitHub has the .mpr; the floor hasn't fetched it yet, and has a change of its own.
  for (let i = 1; i <= 3; i++) {
    if (i === 3) writeFileSync(path.join(r.mate, 'project.mpr'), 'mpr');
    else writeFileSync(path.join(r.mate, `f${i}.txt`), String(i));
    git(r.mate, 'add', '.');
    git(r.mate, 'commit', '-q', '-m', `c${i}`);
  }
  git(r.mate, 'push', '-q', 'origin', 'main');
  writeFileSync(path.join(r.floor, 'README.md'), 'mine\n');
  const refused = await route('sync', r.floor);
  assert.equal(refused.status, 200);
  assert.equal(refused.body.sync.state, 'refused');
  assert.equal(refused.body.info.hasMpr, false);
  assert.match(refused.body.info.error, /No Mendix project \(\.mpr\) in the project folder yet, and the office couldn't bring it up to date with GitHub\. Your project folder is 3 commits behind GitHub and has local changes in README\.md — commit or stash them, then try again/);
  const open = await route('open', r.floor);
  assert.equal(open.status, 404);
  assert.match(open.body.error, /3 commits behind GitHub and has local changes in README\.md/);
  // The change goes: the next ask brings the folder up to date, and the .mpr is there.
  git(r.floor, 'checkout', '--', 'README.md');
  const moved = await route('sync', r.floor);
  assert.equal(moved.body.sync.state, 'moved', JSON.stringify(moved.body.sync));
  assert.equal(moved.body.sync.commits, 3);
  assert.equal(moved.body.info.hasMpr, true);
  assert.equal(moved.body.info.mpr, 'project.mpr');
  assert.equal(floorSyncOf('travel-route')?.state, 'moved');
});
