// Expert mode's background checks (server/expert-checks/, slice 6): the idle trigger and its debounce, never
// running while the session works, one run per project at a time, cancel and rerun, the results recorded in the
// testing ledger at the commit they ran on (real git in a temp folder, the journey runner with a stand-in script
// player), the lint delta against the baseline, the affected set, the proof's shape and words, and Send to session
// never sending a newline and refusing unless the session waits at its prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BackgroundChecks, type ChecksDeps, type StepIn, type TestsOut } from '../src/server/expert-checks/runner.js';
import { lintDelta, lintFindings, readBaseline, findingKey } from '../src/server/expert-checks/lint-delta.js';
import { modulesIn, parseAffected, selectChecks, type SelectDeps } from '../src/server/expert-checks/select.js';
import { cantFill, fillBytes, fillSession } from '../src/server/expert-checks/send.js';
import { folderAt, journeysStep, passedBefore } from '../src/server/expert-checks/steps.js';
import { officeSelect, scriptsIn } from '../src/server/expert-checks/index.js';
import { failurePrompt, fillBlocked, lintPrompt, lintWords, oneLine, testsWords, type ProofLint, type ProofTests } from '../src/shared/expert-checks.js';
import { testingStore } from '../src/server/testing/index.js';
import { ExpertProofService } from '../src/server/expert/service.js';
import { runProofGit } from '../src/server/expert/git.js';

const roots: string[] = [];
test.after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 3 });
});
const tmp = (p: string) => {
  const d = mkdtempSync(path.join(tmpdir(), p));
  roots.push(d);
  return d;
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Pat Example', '-c', 'user.email=pat@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await sleep(5);
  }
}

const SEL = { scope: 'affected' as const, tests: ['tests/Orders.test.mdl'], journeys: ['tests/e2e/J01.journey.js', 'tests/e2e/J02.journey.js'], how: 'changed in this commit', notes: [] };
const ok = (n: number): TestsOut => ({ counts: { passed: n, failed: 0, notRun: 0, total: n }, failures: [], notes: [], records: [`tr_${n}`] });

/** A runner with stand-in steps that log what ran and can be held open. */
function harness(over: Partial<ChecksDeps> = {}) {
  let head = 'a'.repeat(40);
  let previewBusy = false;
  const log: string[] = [];
  const holds: Record<string, (() => void) | undefined> = {};
  const hold = (k: string) => new Promise<void>((r) => (holds[k] = r));
  const gate: Record<string, boolean> = {};
  const changed: string[] = [];
  const step = (k: 'lint' | 'journeys' | 'microflow') => async (i: StepIn) => {
    log.push(`${k}@${i.commit.slice(0, 1)}`);
    if (gate[k]) await Promise.race([hold(k), new Promise<void>((r) => (k === 'journeys' ? i.signal.addEventListener('abort', () => r()) : undefined))]);
    if (k === 'journeys' && i.signal.aborted) return { counts: { passed: 1, failed: 0, notRun: 1, total: 2 }, failures: [], notes: [], records: ['tr_j'] };
    return k === 'lint' ? { delta: { errors: 0, warnings: 1, findings: [{ rule: 'CONV010', severity: 'warning' as const, message: 'x' }], baseline: true }, records: ['tr_l'] } : ok(k === 'journeys' ? 2 : 1);
  };
  const deps: ChecksDeps = {
    head: async () => head,
    select: async () => SEL,
    lint: step('lint'),
    journeys: step('journeys'),
    microflow: step('microflow'),
    previewBusy: () => previewBusy,
    changed: (id) => changed.push(id),
    now: () => Date.now(),
    debounceMs: 30,
    pollMs: 5,
    previewWaitMs: 2000,
    ...over,
  };
  const bc = new BackgroundChecks(deps);
  return {
    bc,
    log,
    changed,
    gate,
    release: (k: string) => holds[k]?.(),
    held: (k: string) => !!holds[k],
    setHead: (h: string) => (head = h),
    setPreview: (b: boolean) => (previewBusy = b),
  };
}

test('the idle trigger: a run a debounce after the session settles, not before', async () => {
  const h = harness();
  h.bc.settled('p', '/x');
  await sleep(10);
  assert.deepEqual(h.log, [], 'nothing before the debounce');
  await until(() => h.bc.proof('p').tests?.state === 'done');
  assert.deepEqual(h.log, ['lint@a', 'journeys@a', 'microflow@a'], 'lint, then journeys, then microflow tests');
  const p = h.bc.proof('p');
  assert.equal(p.tests?.commit, 'a'.repeat(40));
  assert.equal(p.tests?.journeys.passed, 2);
  assert.equal(p.lint?.warnings, 1);
  // The same commit again: not checked twice.
  h.bc.settled('p', '/x');
  await sleep(80);
  assert.equal(h.log.length, 3);
  h.bc.stop();
});

test('never while the session works: a turn starting cancels the debounce; settling while busy does nothing', async () => {
  const h = harness();
  h.bc.settled('p', '/x');
  h.bc.busy('p', '/x', true);
  await sleep(80);
  assert.deepEqual(h.log, [], 'the turn cancelled the pending run');
  h.bc.settled('p', '/x');
  await sleep(80);
  assert.deepEqual(h.log, [], 'settled while busy: nothing');
  assert.equal(await h.bc.kick('p'), undefined, 'a kick while busy: nothing');
  h.bc.busy('p', '/x', false);
  h.bc.settled('p', '/x');
  await until(() => h.log.length === 3);
  h.bc.stop();
});

test('one run per project at a time: a trigger during a run asks for one more after it, never a second at once', async () => {
  const h = harness();
  h.gate.lint = true;
  h.bc.settled('p', '/x');
  await until(() => h.held('lint'));
  h.setHead('b'.repeat(40));
  assert.equal(await h.bc.kick('p'), undefined, 'no second run while one is under way');
  assert.equal(h.bc.runningOn('p')?.commit, 'a'.repeat(40));
  h.gate.lint = false;
  h.release('lint');
  await until(() => h.log.includes('microflow@b'), 4000);
  assert.deepEqual(h.log, ['lint@a', 'journeys@a', 'microflow@a', 'lint@b', 'journeys@b', 'microflow@b'], 'the second ran after the first, in full');
  h.bc.stop();
});

test('cancel and rerun: the session getting busy stops journeys at once, skips the rest, and it runs again on the next idle', async () => {
  const h = harness();
  h.gate.journeys = true;
  h.bc.settled('p', '/x');
  await until(() => h.held('journeys'));
  h.bc.busy('p', '/x', true);
  await until(() => h.bc.proof('p').tests?.state === 'cancelled');
  assert.deepEqual(h.log, ['lint@a', 'journeys@a'], 'microflow tests never started');
  assert.match(h.bc.proof('p').tests!.notes.join(' '), /Stopped: the session started working again/);
  h.gate.journeys = false;
  // Idle again, nothing new committed: it runs once more anyway.
  h.bc.busy('p', '/x', false);
  await until(() => h.bc.proof('p').tests?.state === 'done');
  assert.deepEqual(h.log.slice(2), ['lint@a', 'journeys@a', 'microflow@a']);
  h.bc.stop();
});

test('an mxcli microflow run that started finishes even when the session gets busy', async () => {
  const h = harness();
  h.gate.microflow = true;
  h.bc.settled('p', '/x');
  await until(() => h.held('microflow'));
  h.bc.busy('p', '/x', true);
  await sleep(30);
  assert.equal(h.bc.proof('p').tests?.state, 'running', 'still running: it can’t be stopped safely');
  h.release('microflow');
  await until(() => h.bc.proof('p').tests?.state !== 'running');
  assert.equal(h.bc.proof('p').tests?.microflow.passed, 1, 'its results kept');
  h.bc.stop();
});

test('the preview first: a step waits while the preview reloads', async () => {
  const h = harness();
  h.setPreview(true);
  h.bc.settled('p', '/x');
  await sleep(120);
  assert.deepEqual(h.log, [], 'waits while the preview builds or reloads');
  assert.equal(h.bc.proof('p').tests?.state, 'running');
  h.setPreview(false);
  await until(() => h.log.length === 3);
  h.bc.stop();
});

test('runChecks (Lock in) waits for the run under way, runs the kinds asked, and the session’s turns don’t cancel it', async () => {
  const h = harness();
  h.gate.lint = true;
  h.bc.settled('p', '/x');
  await until(() => h.held('lint'));
  const asked = h.bc.runChecks('p', '/x', { scope: 'all', kinds: ['lint', 'journeys', 'tests'] });
  await sleep(30);
  assert.deepEqual(h.log, ['lint@a'], 'waits its turn');
  h.gate.lint = false;
  h.release('lint');
  const r = await asked;
  assert.deepEqual(h.log, ['lint@a', 'journeys@a', 'microflow@a', 'lint@a', 'journeys@a', 'microflow@a']);
  assert.equal(r.scope, 'all');
  assert.deepEqual(r.records, ['tr_l', 'tr_2', 'tr_1']);
  // The session's turn during an asked-for run doesn't stop it.
  h.gate.journeys = true;
  const again = h.bc.runChecks('p', '/x');
  await until(() => h.held('journeys'));
  h.bc.busy('p', '/x', true);
  await sleep(20);
  h.release('journeys');
  const r2 = await again;
  assert.equal(r2.cancelled, false);
  assert.equal(r2.commit, 'a'.repeat(40));
  h.bc.stop();
});

test('the proof’s shape and words: nulls before a run, then the mockup’s cells', async () => {
  const h = harness();
  assert.deepEqual(h.bc.proof('nope'), { tests: null, lint: null });
  const t: ProofTests = { state: 'done', commit: 'c'.repeat(40), startedAt: 0, endedAt: 130_000, scope: 'affected', journeys: { passed: 33, failed: 1, notRun: 0, total: 34 }, microflow: { passed: 0, failed: 0, notRun: 0, total: 0 }, failures: [{ kind: 'journey', id: 'J04b', detail: 'step 3: status chip shows 0', passedAt: '7b779a9'.padEnd(40, '0') }], notes: [] };
  assert.equal(testsWords(t), '33/34 journeys · J04b regressed · 0 microflow');
  assert.equal(testsWords({ ...t, state: 'running', now: 'journey J07' }), 'running · journey J07…');
  const l: ProofLint = { state: 'done', commit: 'c'.repeat(40), startedAt: 0, errors: 0, warnings: 1, findings: [{ rule: 'CONV010', severity: 'warning', module: 'Orders', document: 'ACT_Save', message: 'Microflow has no error handler' }], baseline: true };
  assert.equal(lintWords(l), '0 errors +1 warn');
  assert.equal(lintWords({ ...l, state: 'running' }), 'running…');
  const p = failurePrompt(t.failures[0], t.commit);
  assert.match(p, /^Journey J04b failed in the background check at ccccccc: step 3: status chip shows 0\. It passed at 7b779a9, before this change\. Find the cause and fix it\.$/);
  assert.match(lintPrompt(l), /CONV010 \(warning\) in Orders\.ACT_Save: Microflow has no error handler/);
  h.bc.stop();
});

test('lint delta: new findings against the baseline’s multiset, rules that couldn’t run left out, counts-only baselines', () => {
  const json = JSON.stringify({
    violations: [
      { ruleId: 'CONV010', severity: 'warning', module: 'Orders', document: 'ACT_A', message: 'no handler' },
      { ruleId: 'CONV010', severity: 'warning', module: 'Orders', document: 'ACT_B', message: 'no handler' },
      { ruleId: 'MPR001', severity: 'error', module: 'Orders', document: 'Page1', message: 'bad name' },
      { ruleId: 'CONV020', severity: 'info', module: '_rule', message: 'inspected nothing' },
      { ruleId: 'CONV018', severity: 'error', module: '', message: 'Starlark rule error: boom' },
    ],
  });
  const now = lintFindings(`Linting...\n${json}`)!;
  assert.equal(now.length, 3, 'blind and crashed rules are not findings');
  const base = readBaseline(JSON.stringify({ counts: { CONV010: 1 }, total: 1, findings: { [findingKey(now[0])]: 1 } }))!;
  const d = lintDelta(now, base);
  assert.equal(d.errors, 1);
  assert.equal(d.warnings, 1);
  assert.deepEqual(
    d.findings.map((f) => f.document),
    ['Page1', 'ACT_B'],
    'errors first; the baseline’s own finding is not new',
  );
  const counts = lintDelta(now, readBaseline(JSON.stringify({ counts: { CONV010: 2, MPR001: 1 } })));
  assert.deepEqual([counts.errors, counts.warnings], [0, 0], 'no rule rose');
  const none = lintDelta(now, undefined);
  assert.equal(none.baseline, false);
  assert.deepEqual(none.findings, [], 'without a baseline nothing is listed as new');
  assert.equal(readBaseline('not json'), undefined);
  assert.equal(lintFindings('no json'), undefined);
});

test('the affected set: the toolkit’s rows, the module fallback, a model change with no script, and all', async () => {
  const files = ['App.mpr', 'mdl/orders.mdl', 'tests/Orders.test.mdl', 'tests/Billing.test.mdl', 'tests/e2e/J01.journey.js', 'journeys/Orders.journey.json', 'journeys/Billing.journey.json', 'tests/e2e/seed.journey.json'];
  const texts: Record<string, string> = { 'mdl/orders.mdl': 'create microflow Orders.ACT_Save ();', 'tests/Orders.test.mdl': 'call Orders.ACT_Save', 'tests/Billing.test.mdl': 'call Billing.X' };
  const d = (changed: string[], tk?: SelectDeps['toolkit']): SelectDeps => ({ changed: async () => changed, files: async () => files, read: async (_d, _s, fs) => new Map(fs.map((f) => [f, texts[f] ?? ''])), ...(tk ? { toolkit: tk } : {}) });
  const tk = await selectChecks(d(['mdl/orders.mdl'], async () => parseAffected('strategy\tchange\nunit\ttests/Orders.test.mdl\tnames Orders.ACT_Save\njourney\tjourneys/Orders.journey.json\tmodule Orders\nrun\tx')), '/x', 'b', { scope: 'affected', from: 'a' });
  assert.deepEqual([tk.tests, tk.journeys], [['tests/Orders.test.mdl'], ['journeys/Orders.journey.json']]);
  assert.match(tk.how, /affected-tests\.sh/);
  const fb = await selectChecks(d(['mdl/orders.mdl']), '/x', 'b', { scope: 'affected', from: 'a' });
  assert.deepEqual([fb.tests, fb.journeys], [['tests/Orders.test.mdl'], ['journeys/Orders.journey.json']], 'the fallback: what names the changed module');
  const model = await selectChecks(d(['App.mpr']), '/x', 'b', { scope: 'affected', from: 'a' });
  assert.deepEqual(model.journeys, ['journeys/Billing.journey.json', 'journeys/Orders.journey.json', 'tests/e2e/J01.journey.js'], 'every journey (never the seed journey)');
  assert.deepEqual(model.tests, []);
  const hooked = await selectChecks(d([]), '/x', 'b', { scope: 'affected', from: 'a', scripts: ['mdl/orders.mdl'] });
  assert.deepEqual(hooked.tests, ['tests/Orders.test.mdl'], 'a script the session’s exec.sh named counts too');
  const all = await selectChecks(d([]), '/x', 'b', { scope: 'all' });
  assert.equal(all.tests.length, 2);
  assert.equal(all.journeys.length, 3);
  assert.deepEqual(modulesIn('-- System.User\ncreate entity Orders.Order; call Atlas_Core.x'), ['Orders']);
  assert.deepEqual(scriptsIn('bash bin/exec.sh mdl/101-orders.mdl && ./bin/exec.sh --quiet "scripts/b.mdl"'), ['mdl/101-orders.mdl', 'scripts/b.mdl']);
});

test('Send to session: one pasted line, never a newline, never a control character, only while the session waits', () => {
  const b = fillBytes('Fix J04b\r\nthen press enter\n\x1b[2J\x03 now')!;
  assert.ok(!/[\r\n]/.test(b), 'no newline or carriage return');
  assert.equal(b, '\x1b[200~Fix J04b then press enter [2J now\x1b[201~', 'one bracketed paste; the escape and Ctrl-C were taken out');
  assert.equal(fillBytes(' \n\t '), undefined);
  assert.ok(oneLine('x'.repeat(1000)).length <= 400);
  const writes: string[] = [];
  const target = (status: string) => ({ get: () => ({ status: status as 'idle', session: true }), write: (_id: string, data: string) => void writes.push(data) });
  for (const s of ['working', 'needs_input', 'starting', 'exited', 'offline']) {
    assert.ok(fillSession(target(s), 'w1', 'Fix it', 'Pat'), `refused while ${s}`);
    assert.ok(fillBlocked(s));
  }
  assert.equal(writes.length, 0, 'nothing written while the session isn’t at its prompt');
  assert.equal(fillSession(target('idle'), 'w1', 'Fix it\n', 'Pat'), undefined);
  assert.equal(fillSession(target('done'), 'w1', 'Fix it', 'Pat'), undefined);
  assert.deepEqual(writes, ['\x1b[200~Fix it\x1b[201~', '\x1b[200~Fix it\x1b[201~']);
  assert.ok(writes.every((w) => !w.includes('\r') && !w.includes('\n')), 'never submitted');
  assert.match(cantFill(undefined)!, /isn’t running/);
  assert.equal(fillSession({ get: () => ({ status: 'idle', session: false }), write: () => assert.fail('wrote to a non-session') }, 'w2', 'x', 'Pat'), 'Not an Expert session');
});

test('journeys at the commit: recorded in the testing ledger by journey id, and a failure that passed before is a regression', async () => {
  const root = tmp('bgchecks-');
  const dir = path.join(root, 'app');
  const data = path.join(root, 'data');
  mkdirSync(path.join(dir, 'tests', 'e2e'), { recursive: true });
  git(root, 'init', '-q', '-b', 'main', dir);
  writeFileSync(path.join(dir, 'App.mpr'), '');
  writeFileSync(path.join(dir, 'tests', 'e2e', 'J01.journey.js'), '// the orders list shows\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'first');
  const first = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(path.join(dir, 'App.mpr'), 'changed');
  git(dir, 'commit', '-q', '-am', 'second');
  const second = git(dir, 'rev-parse', 'HEAD');
  let verdict: 'passed' | 'failed' = 'passed';
  const env = {
    dataDir: data,
    preview: () => ({ url: 'http://127.0.0.1:9/', runtimeLog: path.join(root, 'runtime.log') }),
    floor: () => undefined,
    // The folder is taken as exactly the commit here; the real look (folderAt) is tried below.
    exact: async () => true,
    journeyDeps: { runnerConfig: async () => undefined, js: async () => ({ status: verdict, steps: [{ n: 1, caption: 'Open the orders', status: verdict, ...(verdict === 'failed' ? { why: 'no rows' } : {}) }], ...(verdict === 'failed' ? { failure: 'step 1 (Open the orders): no rows' } : {}), exitCode: verdict === 'passed' ? 0 : 1, ms: 5 }) },
  };
  const step = (commit: string): StepIn => ({ floorId: 'orderdesk', dir, commit, scope: 'affected', selection: { ...SEL, journeys: ['tests/e2e/J01.journey.js'] }, signal: new AbortController().signal, now: () => undefined });
  const a = await journeysStep(env, step(first));
  assert.deepEqual(a.counts, { passed: 1, failed: 0, notRun: 0, total: 1 });
  verdict = 'failed';
  const b = await journeysStep(env, step(second));
  assert.equal(b.counts.failed, 1);
  assert.equal(b.failures[0].id, 'J01');
  assert.equal(b.failures[0].passedAt, first, 'it passed at the first commit: a regression');
  const recs = await testingStore(data, 'orderdesk').all();
  assert.deepEqual(
    recs.map((r) => [r.source, r.testedRevision, r.results[0]?.name, r.results[0]?.status]),
    [
      ['office-journey', first, 'J01', 'passed'],
      ['office-journey', second, 'J01', 'failed'],
    ],
    'each run recorded at the commit it ran on, by journey id',
  );
  assert.equal(passedBefore(recs, 'J01', second), first);
  assert.equal(passedBefore(recs, 'J99', second), undefined);
  // The preview serves the working folder: with a change nobody committed, the result shows but isn't recorded at HEAD.
  assert.equal(await folderAt(dir, second), true, 'clean at HEAD');
  assert.equal(await folderAt(dir, first), false, 'HEAD is another commit');
  writeFileSync(path.join(dir, 'App.mpr'), 'edited, not committed');
  assert.equal(await folderAt(dir, second), false, 'uncommitted change');
  verdict = 'passed';
  const dirty = await journeysStep({ ...env, exact: undefined }, step(second));
  assert.equal(dirty.counts.passed, 1, 'still shown');
  assert.deepEqual(dirty.records, [], 'no ledger record');
  assert.match(dirty.notes[0], /Not recorded at [0-9a-f]{7}: the folder had changes that weren't committed while J01 ran/);
  assert.equal((await testingStore(data, 'orderdesk').all()).length, 2, 'the ledger is unchanged');
  // No preview: nothing runs, and it says so.
  const off = await journeysStep({ ...env, preview: () => undefined }, step(second));
  assert.equal(off.counts.notRun, 1);
  assert.match(off.notes[0], /preview isn’t running/);
});

test('the office’s git selection deps read the change between two commits and a first commit’s own change', async () => {
  const dir = tmp('bgsel-');
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'a.mdl'), 'create entity Orders.Order;');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'one');
  const one = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(path.join(dir, 'b.txt'), 'x');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'two');
  const two = git(dir, 'rev-parse', 'HEAD');
  assert.deepEqual(await officeSelect.changed(dir, undefined, one), ['a.mdl']);
  assert.deepEqual(await officeSelect.changed(dir, one, two), ['b.txt']);
  assert.deepEqual((await officeSelect.files(dir, two)).sort(), ['a.mdl', 'b.txt']);
  assert.equal(await officeSelect.toolkit!(dir, ['a.mdl']), undefined, 'no bin/affected-tests.sh: the fallback');
});

test('the background proof says settled once the session is idle and its change is committed', async () => {
  const dir = tmp('bgsettle-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Pat Example');
  git(dir, 'config', 'user.email', 'pat@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'setup');
  const settled: string[] = [];
  const svc = new ExpertProofService({ git: runProofGit, target: async () => ({ off: 'no remote' }), push: async () => undefined, identity: () => ({ name: 'Mx Office', email: 'office@example.com' }), now: () => Date.now(), changed: () => undefined, settled: (id) => settled.push(id), debounceMs: 10 });
  await svc.attach('p', dir);
  writeFileSync(path.join(dir, 'README.md'), 'changed\n');
  svc.noteChange('p', dir);
  await svc.check('p');
  assert.deepEqual(settled, ['p']);
  svc.stop();
});

test('the first lint run says it may take a few minutes (no lint copy of the app yet), in the cell and its words', async () => {
  let first = true;
  const h = harness({ lintFirst: () => first });
  h.gate.lint = true;
  const r = h.bc.runChecks('p', '/x', { kinds: ['lint'] });
  await until(() => h.held('lint'));
  const l = h.bc.proof('p').lint!;
  assert.equal(l.note, 'first lint run, may take a few minutes');
  assert.equal(lintWords(l), 'running · first lint run, may take a few minutes…');
  h.gate.lint = false;
  h.release('lint');
  await r;
  first = false;
  const seen: (string | undefined)[] = [];
  const warm = harness({ lintFirst: () => first, lint: async () => (seen.push(warm.bc.proof('p').lint?.note), { skipped: 'stand-in', records: [] }) });
  await warm.bc.runChecks('p', '/x', { kinds: ['lint'] });
  assert.deepEqual(seen, [undefined], 'no note once the copy is there');
  warm.bc.stop();
  h.bc.stop();
});
