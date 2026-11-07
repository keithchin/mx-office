// Expert mode's background proof (server/expert/): real git in temp folders, a LOCAL bare repository as the only
// remote (never a network remote). The session branch taken without force and never over uncommitted changes, an
// auto-commit after the session goes idle following a change, nothing when HEAD moved (the toolkit's own commit)
// or the tree is clean or git holds the repository, one local git operation at a time, a push that fails recorded
// and retried with back-off, never a force push, and the status's exact shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { isExpertMode, pushWords, SESSION_BRANCH } from '../src/shared/expert-proof.js';
import { ExpertProofService, type ProofDeps } from '../src/server/expert/service.js';
import { runProofGit, serial, type ProofGit } from '../src/server/expert/git.js';
import { ensureSessionBranch } from '../src/server/expert/session.js';
import { AUTO_TRAILER, areaOf, autoCommit, commitMessage } from '../src/server/expert/commit.js';
import { pushBranch, pushTarget } from '../src/server/expert/push.js';
import { isExpertProject } from '../src/server/expert/mode.js';
import { decisionCount, expertProofOf, expertProofView } from '../src/server/expert/index.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Pat Example', '-c', 'user.email=pat@example.com', ...args], { cwd, encoding: 'utf8' }).trim();
const ME = { name: 'Mx Office', email: 'office@example.com' };
const roots: string[] = [];
test.after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A project folder on main with one commit; `remote`: a local bare repository as origin. */
function repo(o: { remote?: boolean } = {}): { dir: string; bare?: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'expert-proof-'));
  roots.push(root);
  const dir = path.join(root, 'app');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  // The repository's own committer, as a session's folder has.
  git(dir, 'config', 'user.name', 'Pat Example');
  git(dir, 'config', 'user.email', 'pat@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(dir, 'README.md'), 'app\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'setup');
  if (!o.remote) return { dir };
  const bare = path.join(root, 'remote.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(dir, 'remote', 'add', 'origin', bare);
  return { dir, bare };
}

const agent = (status: WorkerInfo['status'], action?: WorkerInfo['action']): WorkerInfo => ({ id: 'w1', kind: 'agent', status, action, deskId: 'd', name: 'Session', color: '#fff', acked: true, createdBy: 'Pat', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] });

function service(over: Partial<ProofDeps> = {}) {
  const changed: string[] = [];
  const svc = new ExpertProofService({
    git: runProofGit,
    target: (_id, dir) => pushTarget(runProofGit, dir),
    push: (dir, t, branch) => pushBranch(runProofGit, dir, t, branch),
    identity: () => ME,
    now: () => Date.now(),
    changed: (id) => changed.push(id),
    debounceMs: 20,
    heldRetryMs: 20,
    backoffMs: [30],
    ...over,
  });
  return { svc, changed };
}

async function until(cond: () => boolean, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.ok(cond(), label);
}

test('isExpertProject reads exactly the record’s mode; absent is a Team project', () => {
  assert.equal(isExpertProject({ def: { mode: 'expert' } }), true);
  assert.equal(isExpertProject({ def: { mode: 'team' } }), false);
  assert.equal(isExpertProject({ def: {} }), false);
  assert.equal(isExpertProject(undefined), false);
  assert.equal(isExpertMode({ mode: 'Expert' }), false);
});

test('session branch: created at HEAD on a clean tree, then kept; an existing one is checked out', async () => {
  const { dir } = repo();
  const head = git(dir, 'rev-parse', 'HEAD');
  const r = await ensureSessionBranch(runProofGit, dir);
  assert.deepEqual(r, { ok: true, branch: SESSION_BRANCH, head });
  assert.equal(git(dir, 'symbolic-ref', '--short', 'HEAD'), SESSION_BRANCH);
  assert.equal((await ensureSessionBranch(runProofGit, dir)).ok, true);
  git(dir, 'checkout', '-q', 'main');
  const again = await ensureSessionBranch(runProofGit, dir);
  assert.equal(again.ok, true);
  assert.equal(git(dir, 'symbolic-ref', '--short', 'HEAD'), SESSION_BRANCH);
});

test('session branch: uncommitted changes on the default branch are carried along to session/main, nothing lost', async () => {
  const { dir } = repo();
  writeFileSync(path.join(dir, 'README.md'), 'edited by hand\n');
  writeFileSync(path.join(dir, 'new.txt'), 'untracked\n');
  const r = await ensureSessionBranch(runProofGit, dir);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(git(dir, 'symbolic-ref', '--short', 'HEAD'), SESSION_BRANCH);
  assert.equal(readFileSync(path.join(dir, 'README.md'), 'utf8'), 'edited by hand\n');
  assert.ok(existsSync(path.join(dir, 'new.txt')));
  assert.equal(git(dir, 'rev-list', '--count', '--all'), '1', 'nothing committed by taking the branch');
});

test('a commit that fails (a hook refusing it) is recorded in commit.error and tried again later; signing config is left alone', async () => {
  const { dir } = repo();
  const gd = path.join(dir, '.git');
  writeFileSync(path.join(gd, 'hooks', 'pre-commit'), '#!/bin/sh\nif [ -f .git/block ]; then echo "blocked by the project hook" >&2; exit 1; fi\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(gd, 'block'), '');
  const seen: string[][] = [];
  const spy: ProofGit = (args, cwd, o) => (seen.push(args), runProofGit(args, cwd, o));
  const { svc } = service({ git: spy, target: async () => ({ off: 'no remote' }), backoffMs: [50] });
  await svc.attach('p', dir);
  const head = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(path.join(dir, 'e.txt'), 'e\n');
  assert.equal((await svc.check('p'))?.kind, 'error');
  assert.match(svc.proof('p')!.commit!.error ?? '', /didn't go/);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
  assert.equal(git(dir, 'diff', '--cached', '--name-only'), '', 'unstaged again');
  rmSync(path.join(gd, 'block'));
  await until(() => git(dir, 'rev-parse', 'HEAD') !== head, 'retried and committed');
  await until(() => !(svc.proof('p')?.commit?.error ?? '').includes("didn't go"), 'the commit error clears');
  assert.ok(!seen.some((a) => a.some((x) => /gpgsign/i.test(x))), 'no signing override');
  svc.stop();
});

test('session branch: uncommitted changes on any other branch are reported, never switched over or touched', async () => {
  const { dir } = repo();
  git(dir, 'checkout', '-q', '-b', 'feature/x');
  writeFileSync(path.join(dir, 'README.md'), 'edited by hand\n');
  writeFileSync(path.join(dir, 'new.txt'), 'untracked\n');
  const r = await ensureSessionBranch(runProofGit, dir);
  assert.equal(r.ok, false);
  assert.equal(r.branch, 'feature/x');
  assert.match((r as { why: string }).why, /Uncommitted changes on feature\/x/);
  assert.equal(git(dir, 'symbolic-ref', '--short', 'HEAD'), 'feature/x');
  assert.equal(readFileSync(path.join(dir, 'README.md'), 'utf8'), 'edited by hand\n');
  assert.ok(existsSync(path.join(dir, 'new.txt')));
  assert.equal(git(dir, 'branch', '--list', SESSION_BRANCH), '', 'no branch made');
  // The service says so in the status, and commits nothing.
  const { svc } = service();
  await svc.attach('p', dir);
  const p = svc.proof('p')!;
  assert.equal(p.branch, 'feature/x');
  assert.equal(p.commit?.push, 'off');
  assert.match(p.commit?.error ?? '', /Uncommitted changes on feature\/x/);
  svc.onWorker('p', dir, agent('working', 'edit'));
  svc.onWorker('p', dir, agent('done'));
  assert.equal((await svc.check('p'))?.kind, 'off-branch');
  assert.equal(git(dir, 'rev-list', '--count', '--all'), '1');
  svc.stop();
});

test('auto-commit after the session goes idle following a change: a generated message, no amend, pushed to the local remote', async () => {
  const { dir, bare } = repo({ remote: true });
  const { svc, changed } = service();
  await svc.attach('p', dir);
  const setup = git(dir, 'rev-parse', 'HEAD');
  mkdirSync(path.join(dir, 'javascriptsource', 'Orders', 'actions'), { recursive: true });
  writeFileSync(path.join(dir, 'javascriptsource', 'Orders', 'actions', 'Ship.js'), 'export {}\n');
  writeFileSync(path.join(dir, 'App.mpr'), 'model');
  svc.onWorker('p', dir, agent('working', 'edit'));
  // Still working: nothing is committed.
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(git(dir, 'rev-parse', 'HEAD'), setup);
  svc.onWorker('p', dir, agent('done'));
  await until(() => git(dir, 'rev-parse', 'HEAD') !== setup, 'committed once idle');
  const subject = git(dir, 'log', '-1', '--format=%s');
  assert.equal(subject, 'Session: app model, JavaScript Orders (2 files)');
  assert.match(git(dir, 'log', '-1', '--format=%B'), new RegExp(`${AUTO_TRAILER}: session/main`));
  assert.equal(git(dir, 'rev-parse', 'HEAD~1'), setup, `a new commit on top: history untouched\n${git(dir, 'log', '--format=%h %s', '-5')}`);
  assert.equal(git(dir, 'log', '-1', '--format=%an'), 'Pat Example', 'the repository’s own committer');
  assert.equal(git(dir, 'status', '--porcelain'), '');
  const sha = git(dir, 'rev-parse', 'HEAD');
  await until(() => svc.proof('p')?.commit?.sha === sha && svc.proof('p')?.commit?.push === 'ok', 'the new commit pushed');
  assert.equal(git(bare!, 'rev-parse', `refs/heads/${SESSION_BRANCH}`), git(dir, 'rev-parse', 'HEAD'));
  assert.equal(svc.proof('p')!.commit!.message, subject);
  assert.ok(changed.length > 0, 'pages were told');
  svc.stop();
});

test('skipped when HEAD moved since the last look (the toolkit committed itself), and when the tree is clean', async () => {
  const { dir } = repo();
  const { svc } = service();
  await svc.attach('p', dir);
  // The toolkit commits its own work during the turn and leaves a file behind.
  writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'toolkit: add a');
  writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  const toolkit = git(dir, 'rev-parse', 'HEAD');
  assert.equal((await svc.check('p'))?.kind, 'moved');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), toolkit, 'no second commit on top of the toolkit’s');
  // The next look (HEAD as seen) commits what's left.
  assert.equal((await svc.check('p'))?.kind, 'committed');
  assert.equal(git(dir, 'rev-parse', 'HEAD~1'), toolkit);
  // Clean: nothing.
  const head = git(dir, 'rev-parse', 'HEAD');
  assert.equal((await svc.check('p'))?.kind, 'clean');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
  svc.stop();
});

test('never while git holds the repository (index.lock): retried, then committed once it’s gone', async () => {
  const { dir } = repo();
  await ensureSessionBranch(runProofGit, dir);
  const lock = path.join(dir, '.git', 'index.lock');
  writeFileSync(lock, '');
  writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  const head = git(dir, 'rev-parse', 'HEAD');
  assert.deepEqual(await autoCommit(runProofGit, dir, head, () => ME), { kind: 'busy', why: 'git is busy here (index.lock)' });
  const { svc } = service();
  await svc.attach('p', dir);
  assert.equal((await svc.check('p'))?.kind, 'busy');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
  rmSync(lock);
  await until(() => git(dir, 'rev-parse', 'HEAD') !== head, 'committed after the lock went (the retry)');
  svc.stop();
});

test('one local git operation at a time per repository, however many looks come at once', async () => {
  const { dir } = repo();
  let now = 0;
  let most = 0;
  const counting: ProofGit = async (args, cwd, o) => {
    now++;
    most = Math.max(most, now);
    try {
      return await runProofGit(args, cwd, o);
    } finally {
      now--;
    }
  };
  const { svc } = service({ git: counting, target: async () => ({ off: 'no remote' }) });
  await svc.attach('p', dir);
  writeFileSync(path.join(dir, 'd.txt'), 'd\n');
  const looks = [svc.attach('p', dir, true), svc.check('p'), svc.check('p'), svc.check('p'), serial(dir, () => counting(['status'], dir))];
  svc.noteChange('p', dir);
  await Promise.all(looks);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(most, 1, `at most one git at a time (saw ${most})`);
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD'), '2', 'one commit, not one per look');
  svc.stop();
});

test('a push that fails is recorded (never a modal) and retried with back-off until it lands', async () => {
  const { dir, bare } = repo({ remote: true });
  let fails = 2;
  const tries: number[] = [];
  const { svc } = service({
    push: async (d, t, b) => {
      tries.push(Date.now());
      if (fails-- > 0) throw new Error('fatal: unable to access the remote: Connection refused');
      return pushBranch(runProofGit, d, t, b);
    },
  });
  await svc.attach('p', dir);
  await until(() => svc.proof('p')?.commit?.push === 'failed', 'failed recorded');
  assert.match(svc.proof('p')!.commit!.error ?? '', /Connection refused/);
  assert.match(pushWords(svc.proof('p')!.commit), /^Push failed: /);
  await until(() => svc.proof('p')?.commit?.push === 'ok', 'retried until it landed');
  assert.equal(tries.length, 3);
  assert.equal(svc.proof('p')!.commit!.error, undefined);
  assert.equal(git(bare!, 'rev-parse', `refs/heads/${SESSION_BRANCH}`), git(dir, 'rev-parse', 'HEAD'));
  svc.stop();
});

test('never a force push: a remote that moved on refuses, the error is kept, and the remote is untouched', async () => {
  const { dir, bare } = repo({ remote: true });
  // Someone else's commit on the remote's session/main.
  const other = path.join(path.dirname(dir), 'other');
  git(path.dirname(dir), 'clone', '-q', bare!, other);
  git(other, 'checkout', '-q', '-b', SESSION_BRANCH);
  writeFileSync(path.join(other, 'theirs.txt'), 'x\n');
  git(other, 'add', '.');
  git(other, 'commit', '-q', '-m', 'theirs');
  git(other, 'push', '-q', 'origin', SESSION_BRANCH);
  const theirs = git(bare!, 'rev-parse', `refs/heads/${SESSION_BRANCH}`);
  const seen: string[][] = [];
  const spy: ProofGit = (args, cwd, o) => (seen.push(args), runProofGit(args, cwd, o));
  const { svc } = service({ push: (d, t, b) => pushBranch(spy, d, t, b), backoffMs: [60_000] });
  await svc.attach('p', dir);
  await until(() => svc.proof('p')?.commit?.push === 'failed', 'refused');
  assert.match(svc.proof('p')!.commit!.error ?? '', /nothing was forced/);
  assert.equal(git(bare!, 'rev-parse', `refs/heads/${SESSION_BRANCH}`), theirs, 'the remote keeps its commit');
  const pushes = seen.filter((a) => a.includes('push'));
  assert.ok(pushes.length >= 1);
  for (const a of pushes) {
    assert.ok(!a.some((x) => /^(-f|--force|--force-with-lease|--mirror)/.test(x)), a.join(' '));
    assert.ok(!a.some((x) => x.startsWith('+')), a.join(' '));
  }
  svc.stop();
});

test('push target: Team Server remote first, origin only when it is the only remote, a test office only to this machine', async () => {
  const { dir, bare } = repo({ remote: true });
  assert.deepEqual(await pushTarget(runProofGit, dir), { remote: 'origin', teamServer: false });
  git(dir, 'remote', 'add', 'upstream', bare!);
  assert.match(((await pushTarget(runProofGit, dir)) as { off: string }).off, /origin isn't the only remote/);
  git(dir, 'remote', 'add', 'teamserver', bare!);
  assert.deepEqual(await pushTarget(runProofGit, dir), { remote: 'teamserver', teamServer: true });
  git(dir, 'remote', 'remove', 'upstream');
  git(dir, 'remote', 'remove', 'teamserver');
  git(dir, 'remote', 'set-url', 'origin', 'https://example.com/app.git');
  assert.match(((await pushTarget(runProofGit, dir, { localOnly: true })) as { off: string }).off, /test office/);
  // A Team Server target without a Mendix token: an error, nothing run.
  await assert.rejects(pushBranch(async () => assert.fail('no git without a token'), dir, { remote: 'teamserver', teamServer: true }, SESSION_BRANCH, () => undefined), /No Mendix token/);
  const { dir: none } = repo();
  assert.match(((await pushTarget(runProofGit, none)) as { off: string }).off, /no remote/);
});

test('commit message: areas from the changed files, the model first, capped', () => {
  assert.equal(areaOf('javasource/orders/actions/Ship.java'), 'Java orders');
  assert.equal(areaOf('mprcontents/ab/cd/x.mxunit'), 'app model');
  assert.equal(areaOf('README.md'), 'README.md');
  const m = commitMessage([
    { status: 'M', path: 'docs/a.md' },
    { status: 'A', path: 'App.mpr' },
  ]);
  assert.equal(m.split('\n')[0], 'Session: app model, docs (2 files)');
  const many = commitMessage(Array.from({ length: 40 }, (_, i) => ({ status: 'A', path: `area${i}/f.txt` })));
  assert.ok(many.split('\n')[0].length <= 72);
  assert.match(many, /… and 10 more/);
});

test('status: exactly { branch, commit, budget, stuck, decisions }, decisions from PROJECT.md', async () => {
  const { dir } = repo();
  writeFileSync(path.join(dir, 'PROJECT.md'), '# App\n\n## Decisions\n\n| Stage | Decision | Status |\n|---|---|---|\n| 1 | Filter defaults to my team | CONFIRMED |\n| 2 | Seed users | ASSUMED |\n\n## Other\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'project file');
  assert.equal(await decisionCount(dir), 2);
  const data = mkdtempSync(path.join(tmpdir(), 'expert-proof-data-'));
  roots.push(data);
  const floor = { id: 'p', dir, def: { id: 'p', name: 'App', dir, mode: 'expert' }, workers: { list: () => [] }, github: { pulls: { items: [] }, issues: { items: [] } } };
  const ctx = { cfg: { dataDir: data }, floors: new Map([['p', floor]]), toFloor: () => undefined, workerFloor: () => undefined } as never;
  const v = await expertProofView(ctx, floor as never);
  assert.deepEqual(Object.keys(v).sort(), ['branch', 'budget', 'commit', 'decisions', 'stuck']);
  assert.equal(v.branch, SESSION_BRANCH);
  assert.deepEqual(Object.keys(v.commit!).filter((k) => k !== 'error').sort(), ['at', 'message', 'push', 'sha']);
  assert.equal(v.commit!.message, 'project file');
  await until(() => expertProofOf(ctx).proof('p')?.commit?.push === 'off', 'no remote: push off');
  assert.match((await expertProofView(ctx, floor as never)).commit?.error ?? '', /no remote/);
  assert.equal(v.decisions, 2);
  if (v.budget) assert.deepEqual(Object.keys(v.budget).sort(), ['paused', 'spentUsd', 'todayUsd', 'totalUsd']);
  if (v.stuck) assert.deepEqual(Object.keys(v.stuck).filter((k) => k !== 'reason').sort(), ['idleSec', 'stuck']);
});
