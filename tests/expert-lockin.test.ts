// Expert mode's Lock in (server/expert-lockin/): real git in temp folders, a LOCAL bare repository as the only
// remote (never Team Server, the Portal, the Deploy API or Studio Pro: those are fakes here). The checks run at the
// exact head after the pending changes are committed and land in the ledger at that commit; Lock in refuses while
// the session works or when the commit fails; a merge carries the receipt, refuses failures until they're accepted
// by name (an override in the decision log), needs a data impact confirmed, stops on a conflict with nothing
// resolved, never forces; main goes to the remote in the background; session/main carries on from the new main;
// a deploy request is blocked by demo users; a finished phase closes after a merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SESSION_BRANCH } from '../src/shared/expert-proof.js';
import { holding, mergeRefusal, type LockInCheck, type LockInPhase, type LockInView } from '../src/shared/expert-lockin.js';
import { runProofGit, type ProofGit } from '../src/server/expert/git.js';
import { autoCommit } from '../src/server/expert/commit.js';
import { pushBranch, pushTarget } from '../src/server/expert/push.js';
import { LockInService, type LockInDeps } from '../src/server/expert-lockin/service.js';
import { scriptedLockInChecks, type LockInChecks } from '../src/server/expert-lockin/checks.js';
import { backgroundLockInChecks, rowsOf } from '../src/server/expert-lockin/bg-checks.js';
import { BackgroundChecks, type ChecksDeps, type ChecksResult, type StepIn } from '../src/server/expert-checks/runner.js';
import { forgetLockIn, lockInBook } from '../src/server/expert-lockin/book.js';
import { LOCKIN_TRAILER } from '../src/server/expert-lockin/merge.js';
import { testingStore } from '../src/server/testing/index.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Pat Example', '-c', 'user.email=pat@example.com', ...args], { cwd, encoding: 'utf8' }).trim();
const ME = { name: 'Mx Office', email: 'office@example.com' };
const roots: string[] = [];
test.after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** A project folder on session/main (one commit on main before it) with a local bare repository as origin. */
function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'expert-lockin-'));
  roots.push(root);
  const dir = path.join(root, 'app');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Pat Example');
  git(dir, 'config', 'user.email', 'pat@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(dir, 'README.md'), 'app\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'setup');
  const bare = path.join(root, 'remote.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'checkout', '-q', '-b', SESSION_BRANCH);
  const data = path.join(root, 'data');
  mkdirSync(data);
  return { root, dir, bare, data };
}

function commitFile(dir: string, file: string, text: string, msg = `edit ${file}`) {
  writeFileSync(path.join(dir, file), text);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

async function until(cond: () => boolean, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.ok(cond(), label);
}

interface Fake {
  svc: LockInService;
  calls: string[][];
  audits: { action: string; summary: string }[];
  raised: { title: string; details: string }[];
  closed: string[];
  studio: number;
  state: { busy?: string; licence: 'free' | 'licensed' | 'unknown'; demo: LockInView['demoUsers']; impact: NonNullable<LockInView['impact']>; phase?: LockInPhase; commitError?: string };
}

function fake(p: ReturnType<typeof project>, checks: LockInChecks, over: Partial<LockInDeps> = {}): Fake {
  forgetLockIn();
  const calls: string[][] = [];
  const spy: ProofGit = (args, cwd, o) => (calls.push(args), runProofGit(args, cwd, o));
  const f: Fake = { svc: undefined as never, calls, audits: [], raised: [], closed: [], studio: 0, state: { licence: 'licensed', demo: { on: false, known: true }, impact: { status: 'clear', lines: [] } } };
  f.svc = new LockInService({
    git: spy,
    dataDir: p.data,
    checks: () => checks,
    commit: async (fl) => (f.state.commitError ? { kind: 'error', error: f.state.commitError } : autoCommit(spy, fl.dir, undefined, () => ME)),
    busy: () => f.state.busy,
    identity: () => ME,
    impact: async () => f.state.impact,
    push: async (fl, branch) => {
      const t = await pushTarget(spy, fl.dir, { localOnly: true });
      if ('off' in t) return { off: t.off };
      await pushBranch(spy, fl.dir, t, branch);
      return 'ok';
    },
    licence: async () => f.state.licence,
    demoUsers: async () => f.state.demo,
    raiseDeploy: (_fl, ask) => (f.raised.push(ask), `ESC-${f.raised.length}`),
    phase: async () => f.state.phase,
    closePhase: async (_fl, id) => (f.closed.push(id), undefined),
    openStudio: async () => (f.studio++, { ok: true }),
    audit: (_fl, _by, action, summary) => f.audits.push({ action, summary }),
    changed: () => undefined,
    reattach: () => undefined,
    projectDecisions: async () => 2,
    now: () => Date.now(),
    ...over,
  });
  return f;
}

const floorOf = (p: ReturnType<typeof project>) => ({ id: 'app', dir: p.dir, name: 'Demo App' });
const ALL_PASS = scriptedLockInChecks({}, 5);
const JOURNEY_FAILS = scriptedLockInChecks({ journeys: { status: 'failed', summary: '3 of 4 passed', detail: 'Failed at this commit: J-04' } }, 5);

async function finished(f: Fake, fl: ReturnType<typeof floorOf>) {
  await until(() => !!lockInBook(f.svc.d.dataDir, fl.id).runs.at(-1)?.finishedAt, 'the checks finished');
  return f.svc.view(fl);
}

test('the checks: pending changes committed first, then every check at that exact head, recorded in the ledger at it', async () => {
  const p = project();
  const fl = floorOf(p);
  const f = fake(p, ALL_PASS);
  writeFileSync(path.join(p.dir, 'pending.txt'), 'not committed yet\n');
  const progress: string[] = [];
  const r = await f.svc.start(fl, 'Pat');
  assert.ok(r.ok, JSON.stringify(r));
  const head = git(p.dir, 'rev-parse', 'HEAD');
  assert.equal(git(p.dir, 'status', '--porcelain'), '', 'the pending file was committed through the commit path');
  assert.equal((r as { run: { commit: string } }).run.commit, head, 'the checks run at the head after that commit');
  assert.deepEqual((r as { run: { committed?: { files: number } } }).run.committed?.files, 1);
  const v = await finished(f, fl);
  progress.push(...v.run!.checks.map((c) => `${c.kind}:${c.status}`));
  assert.deepEqual(progress, ['mx-check:passed', 'microflow-tests:passed', 'journeys:passed', 'lint:passed']);
  const recs = (await testingStore(p.data, 'app').all()).filter((x) => x.source === 'office-check');
  assert.equal(recs.length, 4, 'one ledger record per check');
  assert.ok(recs.every((x) => x.testedRevision === head.toLowerCase()), 'each at exactly that commit');
  assert.ok(v.run!.checks.every((c) => c.record?.startsWith('tr_')), 'each check names its record');
  assert.equal(v.decisions, 3, 'PROJECT.md’s 2 rows and the checks’ decision');
  assert.ok(f.audits.some((a) => a.action === 'expert.lockin.start'));
});

test('Lock in refuses while the session works (says why), and when the pending changes can’t be committed', async () => {
  const p = project();
  const fl = floorOf(p);
  const f = fake(p, ALL_PASS);
  f.state.busy = 'The session is working';
  const v = await f.svc.view(fl);
  assert.equal(v.busy, 'The session is working');
  const r = await f.svc.start(fl, 'Pat');
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /session is working.*stop it in the session/);
  f.state.busy = undefined;
  f.state.commitError = 'The commit didn’t go: blocked by the project hook';
  const r2 = await f.svc.start(fl, 'Pat');
  assert.equal(r2.ok, false);
  assert.match((r2 as { error: string }).error, /couldn't be committed \(The commit didn’t go: blocked by the project hook\)/);
  assert.equal(lockInBook(p.data, 'app').runs.length, 0, 'no run started');
});

test('merge: refused on a failure until it is accepted by name (an override in the decision log), then --no-ff with the receipt, no force, pushed, session/main fast-forwarded', async () => {
  const p = project();
  const fl = floorOf(p);
  const f = fake(p, JOURNEY_FAILS);
  commitFile(p.dir, 'feature.txt', 'a feature\n');
  const base = git(p.dir, 'rev-parse', 'main');
  assert.ok((await f.svc.start(fl, 'Pat')).ok);
  const v = await finished(f, fl);
  const sha = v.run!.commit;
  assert.deepEqual(holding(v.run!.checks).map((c) => c.name), ['Journeys']);
  const refused = await f.svc.merge(fl, 'Pat', { commit: sha });
  assert.equal(refused.ok, false);
  assert.match((refused as { error: string }).error, /Journeys did not pass.*accept it by name/);
  assert.equal(git(p.dir, 'rev-parse', 'main'), base, 'main untouched');
  const ok = await f.svc.merge(fl, 'Pat', { commit: sha, accept: ['journeys'] });
  assert.ok(ok.ok, JSON.stringify(ok));
  const m = (ok as { merged: { merge: string; session: string; accepted?: string[] } }).merged;
  assert.equal(git(p.dir, 'rev-parse', 'main'), m.merge);
  assert.equal(git(p.dir, 'rev-list', '--parents', '-n', '1', m.merge).split(' ').length, 3, 'a merge commit (--no-ff)');
  const msg = git(p.dir, 'log', '-1', '--format=%B', m.merge);
  assert.match(msg, new RegExp(`Checks recorded at ${sha.slice(0, 12)}:`));
  assert.match(msg, /- Journeys: failed, 3 of 4 passed \(tr_/);
  assert.match(msg, /Accepted by Pat as known failures: Journeys/);
  assert.match(msg, new RegExp(`${LOCKIN_TRAILER}: session/main@${sha}`));
  assert.equal(git(p.dir, 'log', '-1', '--format=%cn', m.merge), 'Mx Office', 'as the office');
  assert.deepEqual(m.accepted, ['Journeys']);
  const book = lockInBook(p.data, 'app');
  assert.ok(book.decisions.some((d) => d.action === 'override' && /Journeys \(3 of 4 passed\)/.test(d.text)), 'the override is in the decision log');
  assert.ok(book.decisions.some((d) => d.action === 'merge'));
  // session/main carries on from the new main, the session's folder untouched.
  assert.equal(m.session, 'fast-forward');
  assert.equal(git(p.dir, 'rev-parse', 'HEAD'), m.merge);
  assert.equal(git(p.dir, 'symbolic-ref', '--short', 'HEAD'), SESSION_BRANCH);
  // main pushed to the local remote in the background, never forced.
  await until(() => lockInBook(p.data, 'app').merges.at(-1)!.push === 'ok', 'main pushed');
  assert.equal(git(p.bare, 'rev-parse', 'main'), m.merge);
  const forced = f.calls.filter((a) => (a.includes('--force') || a.includes('-f')) && !(a[0] === 'worktree' && a[1] === 'remove'));
  assert.deepEqual(forced, [], 'never a force');
  assert.ok(!f.calls.some((a) => a[0] === 'push' && a.some((x) => x.startsWith('+'))), 'no forced refspec');
  // Merged once: a second merge of the same commit is refused.
  const again = await f.svc.merge(fl, 'Pat', { commit: sha, accept: ['journeys'] });
  assert.equal(again.ok, false);
});

test('merge: a data impact needs an explicit confirmation naming it; it is recorded in the receipt and the decision log', async () => {
  const p = project();
  const fl = floorOf(p);
  const f = fake(p, ALL_PASS);
  f.state.impact = { status: 'impact', lines: ['may drop data in Sales.Order.Notes'] };
  commitFile(p.dir, 'model.txt', 'Order without Notes\n');
  await f.svc.start(fl, 'Pat');
  const v = await finished(f, fl);
  assert.deepEqual(v.impact, { status: 'impact', lines: ['may drop data in Sales.Order.Notes'] });
  const r = await f.svc.merge(fl, 'Pat', { commit: v.run!.commit });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /may affect stored data \(may drop data in Sales\.Order\.Notes\)\. Confirm the data impact/);
  const ok = await f.svc.merge(fl, 'Pat', { commit: v.run!.commit, confirmImpact: true });
  assert.ok(ok.ok, JSON.stringify(ok));
  const merge = (ok as { merged: { merge: string } }).merged.merge;
  assert.match(git(p.dir, 'log', '-1', '--format=%B', merge), /Data impact confirmed by Pat: may drop data in Sales\.Order\.Notes/);
  assert.ok(lockInBook(p.data, 'app').decisions.some((d) => d.action === 'impact'));
});

test('merge: a conflict stops with the files named, main unchanged, nothing resolved or left mid-merge', async () => {
  const p = project();
  const fl = floorOf(p);
  const f = fake(p, ALL_PASS);
  commitFile(p.dir, 'README.md', 'the session’s readme\n');
  // main moved on its own (Studio Pro's Publish commit, say) with a clashing change.
  git(p.dir, 'checkout', '-q', 'main');
  const mainSha = commitFile(p.dir, 'README.md', 'main’s readme\n');
  git(p.dir, 'checkout', '-q', SESSION_BRANCH);
  await f.svc.start(fl, 'Pat');
  const v = await finished(f, fl);
  const r = await f.svc.merge(fl, 'Pat', { commit: v.run!.commit });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /conflicts with main in 1 file \(README\.md\)\. Nothing was changed or resolved/);
  assert.equal(git(p.dir, 'rev-parse', 'main'), mainSha);
  assert.equal(git(p.dir, 'status', '--porcelain'), '');
  assert.equal(git(p.dir, 'worktree', 'list').split('\n').length, 1, 'the temporary worktree is gone');
});

test('session/main carries on: main merged back in when the session committed after the checks (never rewritten)', async () => {
  const p = project();
  const fl = floorOf(p);
  const f = fake(p, ALL_PASS);
  commitFile(p.dir, 'a.txt', 'a\n');
  await f.svc.start(fl, 'Pat');
  const v = await finished(f, fl);
  const newer = commitFile(p.dir, 'b.txt', 'b\n', 'the session goes on');
  const ok = await f.svc.merge(fl, 'Pat', { commit: v.run!.commit });
  assert.ok(ok.ok, JSON.stringify(ok));
  const m = (ok as { merged: { merge: string; session: string; newer: number } }).merged;
  assert.equal(m.newer, 1);
  assert.equal(m.session, 'merged-main');
  const head = git(p.dir, 'rev-parse', 'HEAD');
  assert.equal(git(p.dir, 'rev-parse', `${head}^1`), newer, 'the session’s own commit kept as the first parent');
  assert.equal(git(p.dir, 'rev-parse', `${head}^2`), m.merge, 'main merged in');
  assert.doesNotMatch(git(p.dir, 'log', '--format=%B', '-1', 'main'), /b\.txt/);
});

test('session/main waits for the session to be idle before merging main back in', async () => {
  const p = project();
  const fl = floorOf(p);
  const f = fake(p, ALL_PASS);
  commitFile(p.dir, 'a.txt', 'a\n');
  await f.svc.start(fl, 'Pat');
  const v = await finished(f, fl);
  commitFile(p.dir, 'b.txt', 'b\n');
  f.state.busy = 'The session is working';
  const ok = await f.svc.merge(fl, 'Pat', { commit: v.run!.commit });
  assert.ok(ok.ok);
  assert.equal((ok as { merged: { session: string } }).merged.session, 'waiting');
  f.state.busy = undefined;
  await f.svc.view(fl);
  await until(() => lockInBook(p.data, 'app').merges.at(-1)!.session === 'merged-main', 'merged in once idle');
});

test('deploy: blocked while demo users are on (says why, points to the fix), for a Free App and before a merge; a request goes to approval', async () => {
  const p = project();
  const fl = floorOf(p);
  const f = fake(p, ALL_PASS);
  let r = await f.svc.requestDeploy(fl, 'Pat');
  assert.match((r as { error: string }).error, /Merge to main first/);
  commitFile(p.dir, 'a.txt', 'a\n');
  await f.svc.start(fl, 'Pat');
  const v0 = await finished(f, fl);
  assert.ok((await f.svc.merge(fl, 'Pat', { commit: v0.run!.commit })).ok);
  f.state.demo = { on: true, count: 6, known: true };
  const v = await f.svc.view(fl);
  assert.equal(v.deploy.allowed, false);
  assert.match(v.deploy.why!, /Demo users are on \(6\): they block Deploy\. Switch to seed users first/);
  r = await f.svc.requestDeploy(fl, 'Pat');
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Deploy blocked: Demo users are on/);
  assert.equal(f.raised.length, 0);
  f.state.demo = { on: false, known: true };
  f.state.licence = 'free';
  r = await f.svc.requestDeploy(fl, 'Pat');
  assert.match((r as { error: string }).error, /Free App: there is no deploy API/);
  f.state.licence = 'licensed';
  r = await f.svc.requestDeploy(fl, 'Pat');
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(f.raised.length, 1);
  assert.match(f.raised[0].details, /never deploys by itself/);
  assert.equal((await f.svc.view(fl)).deploy.requested?.id, 'ESC-1');
  assert.ok(lockInBook(p.data, 'app').decisions.some((d) => d.action === 'deploy-request'));
});

test('publish: a Free App opens Studio Pro on the merged main (a fake here); a licensed app is told to use Deploy', async () => {
  const p = project();
  const fl = floorOf(p);
  const f = fake(p, ALL_PASS);
  f.state.licence = 'free';
  assert.match(((await f.svc.publish(fl, 'Pat')) as { error: string }).error, /Merge to main first/);
  commitFile(p.dir, 'a.txt', 'a\n');
  await f.svc.start(fl, 'Pat');
  const v = await finished(f, fl);
  assert.ok((await f.svc.merge(fl, 'Pat', { commit: v.run!.commit })).ok);
  assert.ok((await f.svc.publish(fl, 'Pat')).ok);
  assert.equal(f.studio, 1);
  assert.ok(lockInBook(p.data, 'app').decisions.some((d) => d.action === 'publish'));
  f.state.licence = 'licensed';
  assert.match(((await f.svc.publish(fl, 'Pat')) as { error: string }).error, /use Deploy/);
});

test('phase end: “Close phase N” only after a merge and with every row done; recorded', async () => {
  const p = project();
  const fl = floorOf(p);
  const f = fake(p, ALL_PASS);
  f.state.phase = { id: 'ph-2', name: 'Orders', order: 2, of: 4, rowsDone: 3, rows: 4, complete: false };
  commitFile(p.dir, 'a.txt', 'a\n');
  await f.svc.start(fl, 'Pat');
  const v = await finished(f, fl);
  assert.match(((await f.svc.closePhase(fl, 'Pat', 'ph-2')) as { error: string }).error, /after a Lock in merge/);
  assert.ok((await f.svc.merge(fl, 'Pat', { commit: v.run!.commit })).ok);
  assert.match(((await f.svc.closePhase(fl, 'Pat', 'ph-2')) as { error: string }).error, /1 row left/);
  f.state.phase = { ...f.state.phase, rowsDone: 4, complete: true };
  assert.ok((await f.svc.closePhase(fl, 'Pat', 'ph-2')).ok);
  assert.deepEqual(f.closed, ['ph-2']);
  const after = await f.svc.view(fl);
  assert.deepEqual(after.closed, { id: 'ph-2', name: 'Orders' });
  const actions = lockInBook(p.data, 'app').decisions.map((d) => d.action);
  assert.deepEqual(actions, ['checks', 'merge', 'phase-close']);
  assert.equal(after.decisions, 2 + 3, 'every Lock in step counts in DECISIONS');
});

test('mergeRefusal: no run, still running, another commit, and a failure not accepted', () => {
  const run = { id: 'r', commit: 'a'.repeat(40), by: 'Pat', startedAt: 1, finishedAt: 2, checks: [{ kind: 'lint', name: 'Lint', status: 'not-run', summary: 'Didn’t run' }] as LockInCheck[] };
  assert.match(mergeRefusal({ running: false }, {})!, /Run the checks first/);
  assert.match(mergeRefusal({ run: { ...run, finishedAt: undefined }, running: true }, {})!, /still running/);
  assert.match(mergeRefusal({ run, running: false }, { commit: 'b'.repeat(40) })!, /run them again/);
  assert.match(mergeRefusal({ run, running: false }, {})!, /Lint did not pass/);
  assert.equal(mergeRefusal({ run, running: false }, { accept: ['Lint'] }), undefined);
});

test('slice 6’s result as Lock in rows: every journey and test at the commit, regressions, none, couldn’t run, lint, mx check, records', () => {
  const zero = { passed: 0, failed: 0, notRun: 0, total: 0 };
  const r: ChecksResult = {
    commit: 'c'.repeat(40), scope: 'all', kinds: ['mxcheck', 'tests', 'journeys', 'lint'], startedAt: 0, endedAt: 1, cancelled: false,
    selection: { scope: 'all', tests: [], journeys: ['tests/J-04.journey.json', 'tests/J-05.journey.json'], how: 'everything', notes: [] },
    tests: { state: 'done', commit: 'c'.repeat(40), startedAt: 0, scope: 'all', journeys: { passed: 1, failed: 1, notRun: 0, total: 2 }, microflow: zero, failures: [{ kind: 'journey', id: 'J-05', detail: 'step 2: no rows', passedAt: 'b'.repeat(40), record: 'tr_j' }], notes: [] },
    lint: { state: 'done', commit: 'c'.repeat(40), startedAt: 0, errors: 0, warnings: 1, findings: [{ rule: 'CONV010', severity: 'warning', module: 'Shop', document: 'Orders', message: 'x' }], baseline: true },
    mxcheck: { status: 'pass' },
    records: ['tr_j', 'tr_l'],
  };
  const rows = rowsOf(r, new Map([['tr_j', { source: 'office-journey', sourceKey: 'k' }], ['tr_l', { source: 'office-check', sourceKey: 'expert-lint:x' }]]));
  assert.deepEqual(rows.map((c) => `${c.kind}:${c.status}:${c.summary}`), ['mx-check:passed:0 errors', 'microflow-tests:warn:None in this app', 'journeys:failed:1 of 2 passed', 'lint:warn:0 new errors · 1 new warning']);
  assert.match(rows[2].detail!, /J-05 \(regressed\): step 2: no rows/);
  assert.equal(rows[2].record, 'tr_j');
  assert.equal(rows[3].record, 'tr_l');
  assert.match(rows[3].detail!, /CONV010 in Shop\.Orders/);
  const off = rowsOf({ ...r, tests: { ...r.tests!, journeys: { passed: 0, failed: 0, notRun: 2, total: 2 }, failures: [], notes: ['The preview isn’t running: start it and the journeys run on the next idle'] }, lint: { ...r.lint!, state: 'skipped', note: 'no mxcli' }, mxcheck: { status: 'error', why: 'no mx' } }, new Map());
  assert.deepEqual(off.map((c) => c.status), ['not-run', 'warn', 'not-run', 'not-run']);
  assert.match(off[2].detail!, /2 journeys didn’t run: The preview isn’t running/);
});

test('Lock in on slice 6’s runner: waits for the background run under way, runs every journey (scope all) and the mx check, the session’s turns don’t cancel it, live progress', async () => {
  let release: (() => void) | undefined;
  const asked: { scope: string; journeys: number }[] = [];
  const head = 'd'.repeat(40);
  const steps = (k: string) => async (i: StepIn) => {
    asked.push({ scope: `${k}:${i.scope}`, journeys: i.selection.journeys.length });
    if (k === 'lint' && i.scope === 'affected') await new Promise<void>((r) => (release = r));
    if (k === 'journeys') {
      await new Promise((r) => setTimeout(r, 30));
      return { counts: { passed: 3, failed: 0, notRun: 0, total: 3 }, failures: [], notes: [], records: [] };
    }
    if (k === 'lint') return { delta: { errors: 0, warnings: 0, findings: [], baseline: true }, records: [] };
    return { counts: { passed: 2, failed: 0, notRun: 0, total: 2 }, failures: [], notes: [], records: [] };
  };
  const deps: ChecksDeps = {
    head: async () => head,
    select: async (_d, _t, o) => ({ scope: o.scope, tests: ['a.test'], journeys: o.scope === 'all' ? ['J1', 'J2', 'J3'] : ['J1'], how: o.scope, notes: [] }),
    lint: steps('lint'),
    journeys: steps('journeys'),
    microflow: steps('microflow'),
    mxcheck: async () => ({ status: 'pass' }),
    previewBusy: () => false,
    changed: () => undefined,
    now: () => Date.now(),
    debounceMs: 5,
    pollMs: 5,
  };
  const bg = new BackgroundChecks(deps);
  bg.settled('p', '/x');
  await until(() => !!release, 'the background run is under way');
  const progress: string[] = [];
  const commits: string[] = [];
  const run = backgroundLockInChecks({ cfg: { dataDir: mkdtempSync(path.join(tmpdir(), 'lockin-bg-')) } } as never, () => bg, 5).run({ id: 'p', dir: '/x' }, head, {
    kinds: ['mx-check', 'microflow-tests', 'journeys', 'lint'],
    by: 'Pat',
    onProgress: (c) => progress.push(`${c.kind}:${c.status}`),
    onCommit: (c) => commits.push(c),
  });
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(progress.every((x) => x.endsWith(':waiting')) && progress.length === 4, `waits for the background run: ${progress.join(', ')}`);
  bg.busy('p', '/x', true); // the session starts a turn: the background run stops at its next safe point
  release!();
  await new Promise((r) => setTimeout(r, 10));
  bg.busy('p', '/x', false);
  bg.busy('p', '/x', true); // and a turn during Lock in's run doesn't stop it
  const rows = await run;
  assert.deepEqual(rows.map((c) => `${c.kind}:${c.status}:${c.summary}`), ['mx-check:passed:0 errors', 'microflow-tests:passed:2 of 2 passed', 'journeys:passed:3 of 3 passed', 'lint:passed:0 new errors · 0 new warnings']);
  assert.ok(asked.some((a) => a.scope === 'journeys:all' && a.journeys === 3), 'every journey at the commit');
  assert.ok(progress.includes('journeys:running') || progress.includes('lint:running'), `live progress: ${progress.join(', ')}`);
  assert.deepEqual(commits, [head]);
  bg.stop();
});

test('routes: admins only, from the office’s own pages, Expert projects only; Lock in refused while the session works', async () => {
  const { Readable } = await import('node:stream');
  const { expertLockInRoutes } = await import('../src/server/http/routes/expert-lockin.js');
  const p = project();
  const working = { kind: 'agent', status: 'working', id: 'w1' };
  const floors = new Map<string, unknown>([
    ['app', { id: 'app', dir: p.dir, def: { name: 'Demo App', mode: 'expert' }, workers: { list: () => [working], get: () => working } }],
    ['team', { id: 'team', dir: p.dir, def: { name: 'Team App' }, workers: { list: () => [] } }],
  ]);
  let admin = true;
  const ctx = { cfg: { dataDir: p.data }, meOf: () => ({ admin }), floors, toFloor: () => undefined } as never;
  async function post(route: { handle: (c: never, a: never) => unknown }, body: unknown, origin = 'http://office.test') {
    let status = 0;
    let out = '';
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { headers: { origin, host: 'office.test' } });
    const res = { writeHead: (s: number) => (status = s), end: (b: string) => (out = b) };
    await route.handle(ctx, { req, res, url: new URL('http://office.test/x'), session: { account: { id: 'u1', name: 'Pat' } } } as never);
    return { status, body: JSON.parse(out || '{}') as { error?: string } };
  }
  assert.equal((await post(expertLockInRoutes.run, { floor: 'app' }, 'http://elsewhere.test')).status, 403);
  admin = false;
  assert.match((await post(expertLockInRoutes.run, { floor: 'app' })).body.error!, /Only admins/);
  admin = true;
  assert.equal((await post(expertLockInRoutes.run, { floor: 'nope' })).status, 404);
  assert.equal((await post(expertLockInRoutes.run, { floor: 'team' })).status, 409);
  const busy = await post(expertLockInRoutes.run, { floor: 'app' });
  assert.equal(busy.status, 409);
  assert.match(busy.body.error!, /The session is working/);
  assert.equal((await post(expertLockInRoutes.merge, { floor: 'app', commit: 'abc' })).status, 400, 'a full commit id');
  assert.equal((await post(expertLockInRoutes.closePhase, { floor: 'app' })).status, 400);
});

test('commitNow (slice 2’s commit path, for Lock in): commits what is pending even after HEAD moved, never an amend', async () => {
  const { ExpertProofService } = await import('../src/server/expert/service.js');
  const p = project();
  const svc = new ExpertProofService({ git: runProofGit, target: async () => ({ off: 'none' }), push: async () => undefined, identity: () => ME, now: () => Date.now(), changed: () => undefined });
  await svc.attach('app', p.dir);
  const moved = commitFile(p.dir, 'own.txt', 'the toolkit’s own commit\n');
  writeFileSync(path.join(p.dir, 'pending.txt'), 'pending\n');
  const r = await svc.commitNow('app', p.dir);
  assert.equal(r.kind, 'committed');
  assert.equal(git(p.dir, 'rev-parse', 'HEAD^'), moved, 'on top of the moved HEAD, nothing rewritten');
  assert.equal(git(p.dir, 'status', '--porcelain'), '');
  assert.equal((await svc.commitNow('app', p.dir)).kind, 'clean');
  svc.stop();
});
