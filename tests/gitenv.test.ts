// Long paths for every git the office starts (gitenv.ts), whatever git's config files say: the
// "Filename too long" hire on equipment-rental, whose floor was cloned before release 21 and so never
// got core.longpaths in its own config (2026-10-08..11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LONGPATHS_KEY, hasLongPathsEnv, withGitLongPaths } from '../src/server/gitenv.js';
import { ensureLongPaths, forgetLongPaths, hasLongPaths } from '../src/server/longpaths.js';
import { Worktrees } from '../src/server/worktrees.js';
import { gitOff } from '../src/server/floor-sync/index.js';
import { syncFloor } from '../src/server/floor-sync/sync.js';
import { childEnv } from '../src/server/workers/env.js';
import { toolkitEnv, wizardConfig } from '../src/server/wizard/config.js';
import { useAudit } from '../src/server/audit/index.js';
import type { AuditInput } from '../src/shared/audit.js';

const WIN = process.platform === 'win32';

test('core.longpaths=true goes in through GIT_CONFIG_*, after what is there, once, and only on Windows', () => {
  const plain: Record<string, string | undefined> = { PATH: 'x' };
  withGitLongPaths(plain, 'win32');
  assert.deepEqual(plain, { PATH: 'x', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: LONGPATHS_KEY, GIT_CONFIG_VALUE_0: 'true' });
  withGitLongPaths(plain, 'win32');
  assert.equal(plain.GIT_CONFIG_COUNT, '1', 'never twice');
  // Someone's own GIT_CONFIG_* stays as it was; ours comes after it.
  const theirs: Record<string, string | undefined> = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Ada' };
  withGitLongPaths(theirs, 'win32');
  assert.deepEqual(theirs, { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Ada', GIT_CONFIG_KEY_1: LONGPATHS_KEY, GIT_CONFIG_VALUE_1: 'true' });
  assert.equal(hasLongPathsEnv(theirs), true);
  const linux: Record<string, string | undefined> = { PATH: 'x' };
  withGitLongPaths(linux, 'linux');
  assert.deepEqual(linux, { PATH: 'x' }, 'paths are long enough elsewhere');
});

test("the office's environment has it on Windows, and so do the agents' (childEnv) and the setup's (toolkitEnv)", () => {
  assert.equal(hasLongPathsEnv(process.env), WIN, 'set as the office starts (gitenv.ts is imported by offloop/exec.ts and cli.ts)');
  assert.equal(hasLongPathsEnv(childEnv()), WIN, "a worker's Claude session runs git with it");
  // Even a base env with nothing in it (a test's, or one built from scratch) gets it for the setup's git.
  assert.equal(hasLongPathsEnv(toolkitEnv(wizardConfig(), { PATH: process.env.PATH })), WIN);
});

/** A repository whose newest commit has a file deeper than Windows' 260 characters, and git configs that say nothing about long paths. */
function deepRepo(t: { after(fn: () => void): void }) {
  forgetLongPaths();
  const root = mkdtempSync(path.join(tmpdir(), 'office-gitenv-'));
  // No system config, and an empty global one: nothing anywhere turns long paths on but the environment.
  const saved = { nosys: process.env.GIT_CONFIG_NOSYSTEM, global: process.env.GIT_CONFIG_GLOBAL };
  const empty = path.join(root, 'empty-gitconfig');
  writeFileSync(empty, '');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CONFIG_GLOBAL = empty;
  t.after(() => {
    for (const [k, v] of [['GIT_CONFIG_NOSYSTEM', saved.nosys], ['GIT_CONFIG_GLOBAL', saved.global]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const origin = path.join(root, 'origin');
  const run = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', origin], { stdio: 'ignore' });
  writeFileSync(path.join(origin, 'a.txt'), 'a');
  run(origin, 'add', '.');
  run(origin, 'commit', '-qm', 'a');
  // The floor: cloned before the deep file arrived, its own config without core.longpaths (as equipment-rental's).
  const floor = path.join(root, 'floor');
  run(root, 'clone', '-q', origin, floor);
  const deep = [...Array.from({ length: 10 }, (_, i) => `node_modules_${i}_${'x'.repeat(16)}`), 'RNCAsyncStorage.xcodeproj', 'file.txt'].join('/');
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: origin, input: 'deep', encoding: 'utf8' }).trim();
  run(origin, 'update-index', '--add', '--cacheinfo', `100644,${blob},${deep}`);
  run(origin, 'commit', '-qm', 'deep');
  run(floor, 'fetch', '-q', 'origin');
  return { root, origin, floor, deep, run };
}

/** git without the office's GIT_CONFIG_* (what the office was before this fix). */
const bareEnv = () => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(k)) env[k] = v;
  return env;
};

test('Windows, no core.longpaths in any config and the repository never given it: a worker worktree still checks out whole', { skip: !WIN && 'Windows only' }, async (t) => {
  const r = deepRepo(t);
  r.run(r.floor, 'merge', '-q', '--ff-only', 'origin/main');
  assert.equal(hasLongPaths(r.floor), false);
  // The regression: without the environment, git refuses exactly as the hire did.
  const failed = (() => {
    try {
      execFileSync('git', ['worktree', 'add', '-q', '-b', 'probe', path.join(r.floor, '.agent-office', 'worktrees', 'probe'), 'HEAD'], { cwd: r.floor, env: bareEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      return '';
    } catch (err) {
      return String((err as { stderr?: Buffer }).stderr ?? err);
    }
  })();
  assert.match(failed, /Filename too long/, 'the test reproduces the failure without the fix');
  // The repository's own setting as release 21 left it on that floor: never written (seen once, then taken away again).
  writeFileSync(path.join(r.floor, '.git', 'config'), `${readFileSync(path.join(r.floor, '.git', 'config'), 'utf8')}[core]\n\tlongpaths = true\n`);
  await ensureLongPaths(r.floor, 'win32');
  writeFileSync(path.join(r.floor, '.git', 'config'), readFileSync(path.join(r.floor, '.git', 'config'), 'utf8').replace(/\[core\]\n\tlongpaths = true\n$/, ''));
  assert.equal(hasLongPaths(r.floor), false, "the repository's config says nothing");
  const made = await new Worktrees(r.floor).create('ada-1');
  assert.ok(typeof made !== 'string', String(made));
  assert.equal(hasLongPaths(r.floor), false, 'it went through on the environment alone');
  const wt = path.join(r.floor, made.path);
  assert.ok(path.join(wt, r.deep).length > 260, 'past MAX_PATH');
  assert.ok(existsSync(path.join(wt, r.deep)), 'the deep file is there');
});

test('Windows, no core.longpaths anywhere: the floor sync fast-forwards the folder onto a commit with a deep path', { skip: !WIN && 'Windows only' }, async (t) => {
  const r = deepRepo(t);
  assert.equal(hasLongPaths(r.floor), false);
  const s = await syncFloor('deep', r.floor, { git: gitOff, exists: (p) => access(p).then(() => true, () => false), studioOpen: async () => false, busyHere: () => [], now: () => 1000 });
  assert.equal(s.state, 'moved', JSON.stringify(s));
  assert.ok(existsSync(path.join(r.floor, r.deep)), 'the deep file is in the folder');
  assert.equal(hasLongPaths(r.floor), false, 'on the environment alone');
});

test("a repository whose config the office couldn't set is said in the audit log, once, not only on the console", async (t) => {
  forgetLongPaths();
  const events: AuditInput[] = [];
  useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);
  const warn = console.warn;
  console.warn = () => undefined;
  t.after(() => {
    useAudit(undefined);
    console.warn = warn;
    forgetLongPaths();
  });
  const gone = path.join(tmpdir(), `office-gitenv-gone-${process.pid}`);
  await ensureLongPaths(gone, 'win32');
  await ensureLongPaths(gone, 'win32');
  const said = events.filter((e) => e.action === 'git.longpaths');
  assert.equal(said.length, 1, 'once per repository per run');
  assert.equal(said[0].severity, 'warning');
  assert.match(said[0].summary, /core\.longpaths/);
});
