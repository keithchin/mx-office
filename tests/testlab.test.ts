// The Test Mode page (server/testlab/, http/routes/testlab.ts, client/ui/testlab/): where the throwaway
// test offices go and every refusal that keeps a run off the live office, the runner's progress lines,
// the bounded history and log, a run left going when the office stopped, the run's files' names, the
// routes' admin and re-auth rules, and the page's pure parts. The page lives in the flat views only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { headlineOf, incidentDraft, isRunId, newRunId, parseProgress, refusalOf, resolveRoot, runEnv, safeFileName } from '../src/server/testlab/logic.js';
import { LOG_MAX, RunStore } from '../src/server/testlab/store.js';
import { TestRunner } from '../src/server/testlab/runner.js';
import { testlabRoutes } from '../src/server/http/routes/testlab.js';
import { useTunnelOrigin } from '../src/server/http/util.js';
import { barsOf, tailLines, ticksFor, viewKey } from '../src/client/ui/testlab/logic.js';
import { RUN_HISTORY, TEST_SUITES, testsHref, type RunResult, type RunSummary, type TestLabView } from '../src/shared/testlab.js';

const tmp = (p = 'testlab-') => mkdtempSync(path.join(os.tmpdir(), p));
const root = path.join(import.meta.dirname, '..');
const src = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

test('progress lines, file names and run ids', () => {
  assert.deepEqual(parseProgress('@@progress {"done":3,"of":14,"label":"Board"}'), { done: 3, of: 14, label: 'Board' });
  assert.deepEqual(parseProgress('  @@progress {"done":20,"of":14}\r'), { done: 14, of: 14 }, 'clamped');
  for (const bad of ['progress {"done":1,"of":2}', '@@progress {bad json}', '@@progress {"done":1,"of":0}', '@@progress {"done":-1,"of":3}', 'x @@progress {"done":1,"of":2}']) assert.equal(parseProgress(bad), undefined, bad);
  assert.equal(safeFileName('board.png'), 'board.png');
  assert.equal(safeFileName('summary.md'), 'summary.md');
  for (const bad of ['../secret.png', '..\\x.png', 'a/b.png', 'result.json', '.png', 'x.png.exe', 'c:\\x.png', '', 'a..b.png']) assert.equal(safeFileName(bad), undefined, bad);
  const id = newRunId(Date.UTC(2026, 9, 7), 'ab12cd34');
  assert.ok(isRunId(id), id);
  assert.ok(!isRunId('../run-1-a') && !isRunId('run-1-') && !isRunId('x'));
});

test('the test offices go under scratch/test-offices above the checkout, the env, or the temp folder', () => {
  const base = tmp();
  const repo = path.join(base, 'office-features', 'x');
  const scratch = path.join(base, 'scratch', 'test-offices');
  const has = new Set([scratch]);
  assert.equal(resolveRoot({ repoRoot: repo, tmp: '/t', exists: (p) => has.has(p) }), path.join(scratch, 'perf-guard', 'runs'));
  assert.equal(resolveRoot({ env: ' /e/test-offices/x ', repoRoot: repo, tmp: '/t', exists: () => false }), path.resolve('/e/test-offices/x'));
  assert.equal(resolveRoot({ repoRoot: repo, tmp: path.join(base, 'tmp'), exists: () => false }), path.join(base, 'tmp', 'test-offices', 'agent-office-runs'));
});

test('a run is refused when it could touch the live office or a real floor, or one is going', () => {
  const ok = { root: '/s/scratch/test-offices/perf-guard/runs', dataDir: '/home/me/agent-office/.agent-office', floorDirs: ['/home/me/agent-office/proj'], runner: '/r/run.mjs', runnerExists: true };
  assert.equal(refusalOf(ok), undefined);
  assert.match(refusalOf({ ...ok, running: true })!, /already going/);
  assert.match(refusalOf({ ...ok, root: '/s/scratch/runs' })!, /isn't a test office's folder/);
  assert.match(refusalOf({ ...ok, root: '/home/me/agent-office/.agent-office/test-offices' })!, /data folder/);
  assert.match(refusalOf({ ...ok, dataDir: '/s/scratch/test-offices/perf-guard/runs/x/.agent-office' })!, /data folder/, 'the office itself inside the root');
  assert.match(refusalOf({ ...ok, floorDirs: ['/s/scratch/test-offices/perf-guard'] })!, /floor/);
  assert.match(refusalOf({ ...ok, runnerExists: false })!, /runner/);
  // The child never inherits the live office's own settings (its home, port, password, agent).
  const env = runEnv({ PATH: '/bin', AGENT_OFFICE_HOME: '/home/me/agent-office', AGENT_OFFICE_AGENT: 'claude', agent_office_password: 'x' });
  assert.deepEqual(env, { PATH: '/bin', AGENT_OFFICE_TEST_MODE: '1' });
});

const sum = (id: string, startedAt: number, o: Partial<RunSummary> = {}): RunSummary => ({ id, suite: 'pages', status: 'pass', startedAt, ...o });

test('the history keeps the newest RUN_HISTORY runs and deletes the older runs’ folders', () => {
  const dir = tmp();
  const store = new RunStore(dir, 3);
  const ids = [1, 2, 3, 4, 5].map((n) => `run-${n}-a`);
  ids.forEach((id, i) => {
    mkdirSync(store.runDir(id), { recursive: true });
    store.put(sum(id, 1000 + i));
  });
  assert.deepEqual(store.list().map((r) => r.id), ['run-5-a', 'run-4-a', 'run-3-a']);
  assert.ok(!existsSync(store.runDir('run-1-a')) && !existsSync(store.runDir('run-2-a')));
  assert.ok(existsSync(store.runDir('run-3-a')));
  assert.equal(RUN_HISTORY, 50);
  // Read back from disk the same.
  assert.deepEqual(new RunStore(dir, 3).list().map((r) => r.id), ['run-5-a', 'run-4-a', 'run-3-a']);
});

test('a run left going when the office stopped opens as interrupted', () => {
  const dir = tmp();
  new RunStore(dir).put(sum('run-9-a', 5, { status: 'running' }));
  const again = new RunStore(dir);
  assert.equal(again.get('run-9-a')!.status, 'error');
  assert.match(again.get('run-9-a')!.headline!, /Interrupted/);
});

test('a run’s log comes back a piece at a time, and only its own plain files', () => {
  const store = new RunStore(tmp());
  store.put(sum('run-1-a', 1));
  mkdirSync(store.runDir('run-1-a'), { recursive: true });
  writeFileSync(store.logFile('run-1-a'), 'hello\nworld\n');
  writeFileSync(path.join(store.runDir('run-1-a'), 'board.png'), 'png');
  const a = store.log('run-1-a', 0)!;
  assert.equal(a.text, 'hello\nworld\n');
  assert.deepEqual(store.log('run-1-a', a.next), { text: '', next: 12, size: 12 });
  assert.equal(store.log('run-1-a', 6)!.text, 'world\n');
  assert.equal(store.log('nope', 0), undefined);
  assert.ok(store.file('run-1-a', 'board.png'));
  assert.equal(store.file('run-1-a', '../index.json'), undefined);
  assert.equal(store.file('run-1-a', 'log.txt'), undefined);
  assert.equal(store.file('run-1-a', 'missing.png'), undefined);
});

/** A child process stand-in: stdout/stderr streams, close when the test says. */
function fakeChild() {
  const c = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; exitCode: number | null };
  c.stdout = new PassThrough();
  c.stderr = new PassThrough();
  c.pid = 4242;
  c.exitCode = null;
  return c;
}

test('the runner: one run at a time, progress from its lines, the result makes the history’s line, stop kills it', async () => {
  const base = tmp();
  const repo = path.join(base, 'repo');
  mkdirSync(path.join(repo, 'scripts', 'perf'), { recursive: true });
  writeFileSync(path.join(repo, 'scripts', 'perf', 'run.mjs'), '');
  const store = new RunStore(path.join(base, 'data', 'testlab'));
  const children: ReturnType<typeof fakeChild>[] = [];
  const calls: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const killed: number[] = [];
  const ended: RunSummary[] = [];
  const r = new TestRunner({
    store,
    repoRoot: repo,
    root: path.join(base, 'scratch', 'test-offices', 'runs'),
    dataDir: path.join(base, 'data'),
    floorDirs: () => [path.join(base, 'floor')],
    spawn: (cmd, args, o) => {
      const c = fakeChild();
      children.push(c);
      calls.push({ cmd, args, env: o.env });
      return c as unknown as ChildProcess;
    },
    kill: (c) => void killed.push(c.pid!),
    onEnd: (s) => void ended.push(s),
  });
  process.env.AGENT_OFFICE_HOME = '/should/not/leak';
  const s = r.start('pages', 'Keith');
  delete process.env.AGENT_OFFICE_HOME;
  assert.ok(typeof s !== 'string');
  assert.equal(calls[0].cmd, process.execPath);
  assert.deepEqual(calls[0].args.slice(1), ['--suite', 'pages', '--root', path.join(base, 'scratch', 'test-offices', 'runs'), '--out', store.runDir(s.id), '--id', s.id]);
  assert.equal(calls[0].env.AGENT_OFFICE_HOME, undefined);
  assert.equal(calls[0].env.AGENT_OFFICE_TEST_MODE, '1');
  assert.match(r.start('unit', 'Keith') as string, /already going/);
  assert.equal(store.get(s.id)!.status, 'running');
  children[0].stdout.write('opening Board\n@@progress {"done":2,"of');
  children[0].stdout.write('":5,"label":"Board"}\nmore\n');
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(r.running()!.progress, { done: 2, of: 5, label: 'Board' });
  const result: RunResult = { id: s.id, suite: 'pages', ok: false, startedAt: 1, finishedAt: 2, durationMs: 1, views: [{ id: 'board', name: 'Board', path: '/lite?tab=board', ok: false, ttuMs: 900, longestTaskMs: 420, longTasks: [{ ms: 420, at: 300, stack: ['renderBoard @ kanban.ts:10'] }], heapStartMB: 10, heapEndMB: 11, heapGrowthPct: 10, domNodes: 100, failures: ['a task ran 420 ms'] }, { id: 'home', name: 'Home', path: '/home', ok: true, ttuMs: 500, longestTaskMs: 50, longTasks: [], heapStartMB: 5, heapEndMB: 5, heapGrowthPct: 0, domNodes: 50, failures: [] }] };
  writeFileSync(path.join(store.runDir(s.id), 'result.json'), JSON.stringify(result));
  children[0].emit('close', 1);
  assert.equal(r.running(), undefined);
  const done = store.get(s.id)!;
  assert.equal(done.status, 'fail');
  assert.equal(done.headline, '1/2 views within budget');
  assert.equal(ended.length, 1);
  assert.match(readFileSync(store.logFile(s.id), 'utf8'), /opening Board[\s\S]*FAIL: 1\/2 views/);
  // A second run, stopped: the child tree is killed and the run says so.
  const t = r.start('journey', 'Keith') as RunSummary;
  assert.equal(r.stop('run-0-x'), 'That run isn’t going');
  assert.equal(r.stop(t.id), undefined);
  assert.deepEqual(killed, [4242]);
  children[1].emit('close', null);
  assert.equal(store.get(t.id)!.status, 'error');
  assert.match(store.get(t.id)!.headline!, /Stopped/);
  assert.ok(LOG_MAX >= 1024 * 1024);
});

test('headlines and the incident drafted from a failure', () => {
  assert.deepEqual(headlineOf(undefined, null), { status: 'error', headline: 'Stopped before it wrote a result' });
  assert.equal(headlineOf({ id: 'x', suite: 'unit', ok: false, startedAt: 0, finishedAt: 0, durationMs: 0, counts: { pass: 10, fail: 2 } }, 1).headline, '10 pass, 2 fail');
  assert.equal(headlineOf({ id: 'x', suite: 'journey', ok: true, startedAt: 0, finishedAt: 0, durationMs: 0, steps: [{ id: 'a', name: 'A', ok: true, ms: 1 }] }, 0).status, 'pass');
  assert.equal(headlineOf({ id: 'x', suite: 'pages', ok: false, startedAt: 0, finishedAt: 0, durationMs: 0, error: 'Refused: not a test path' }, 2).status, 'error');
  const view = { id: 'board', name: 'Board', path: '/', ok: true, ttuMs: 1, longestTaskMs: 1, longTasks: [], heapStartMB: 1, heapEndMB: 1, heapGrowthPct: 0, domNodes: 1, failures: [] };
  assert.equal(headlineOf({ id: 'x', suite: 'perf-quick', ok: false, startedAt: 0, finishedAt: 0, durationMs: 0, views: [view], steps: [{ id: 'a', name: 'A', ok: false, ms: 1 }] }, 1).headline, '1/1 views within budget, 0/1 steps passed', 'a quick check says both');
  const s = sum('run-1-a', 1, { status: 'fail' });
  const r: RunResult = { id: 'run-1-a', suite: 'pages', ok: false, startedAt: 0, finishedAt: 0, durationMs: 0, views: [{ id: 'board', name: 'Board', path: '/lite?tab=board', ok: false, ttuMs: 100, longestTaskMs: 420, longTasks: [{ ms: 420, at: 1, stack: ['renderBoard @ kanban.ts:10'] }], heapStartMB: 1, heapEndMB: 1, heapGrowthPct: 0, domNodes: 1, failures: ['a task ran 420 ms'] }] };
  const d = incidentDraft(s, r, 'board');
  assert.ok(typeof d !== 'string');
  assert.match(d.title, /Board/);
  assert.match(d.summary, /renderBoard @ kanban\.ts:10/);
  assert.match(d.summary, /\/lite\?tab=tests&run=run-1-a/);
  assert.equal(incidentDraft(s, r, 'nope'), 'No such view in that run');
});

type Handle = (c: unknown, r: unknown) => Promise<void> | void;
function call(route: { handle: unknown }, p: string, o: { method?: string; admin: boolean; origin?: string; body?: unknown; dataDir: string }) {
  const headers: Record<string, string> = { host: 'office.test', 'content-type': 'application/json', ...(o.origin ? { origin: o.origin } : {}) };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(o.body ?? {}))]), { method: o.method ?? 'GET', headers, socket: {} });
  let status = 0;
  let body: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = b && JSON.parse(b)), headersSent: false };
  const ctx = { cfg: { trustProxy: false, dataDir: o.dataDir }, meOf: () => ({ admin: o.admin }), floors: new Map() };
  const url = new URL(`http://office.test${p}`);
  return Promise.resolve((route.handle as Handle)(ctx, { req, res, url, path: url.pathname, session: { account: { id: 'a1', name: 'Keith' } } })).then(() => ({ status, body: body as Record<string, unknown> }));
}

test('the routes are for admins only, and starting, stopping or opening an incident through Phone access needs the password again', async () => {
  const dataDir = path.join(tmp(), '.agent-office');
  const O = 'http://office.test';
  assert.equal((await call(testlabRoutes.view, '/api/testlab', { admin: false, dataDir })).status, 403);
  assert.equal((await call(testlabRoutes.run, '/api/testlab/runs/run-1-a', { admin: false, dataDir })).status, 403);
  assert.equal((await call(testlabRoutes.run, '/api/testlab/runs/run-1-a/log', { admin: false, dataDir })).status, 403);
  for (const [route, p] of [[testlabRoutes.start, '/api/testlab/runs'], [testlabRoutes.run, '/api/testlab/runs/run-1-a/stop'], [testlabRoutes.run, '/api/testlab/runs/run-1-a/incident']] as const) {
    assert.equal((await call(route, p, { method: 'POST', admin: false, origin: O, body: { suite: 'pages' }, dataDir })).status, 403, `${p}: not an admin`);
    assert.equal((await call(route, p, { method: 'POST', admin: true, origin: 'https://evil.test', body: { suite: 'pages' }, dataDir })).status, 403, `${p}: another site`);
  }
  // An admin on the office's own address gets through to the view.
  const v = await call(testlabRoutes.view, '/api/testlab', { admin: true, dataDir });
  assert.equal(v.status, 200);
  assert.equal((v.body as unknown as TestLabView).suites.length, TEST_SUITES.length);
  assert.deepEqual((v.body as unknown as TestLabView).suites.map((s) => s.suite), ['unit', 'perf-quick', 'pages', 'journey', 'command-center']);
  assert.equal((await call(testlabRoutes.start, '/api/testlab/runs', { method: 'POST', admin: true, origin: O, body: { suite: 'nope' }, dataDir })).status, 400);
  // Through the tunnel, a stale session is asked for its password before anything starts.
  useTunnelOrigin({ via: () => true, host: () => 'office.test' });
  try {
    const r = await call(testlabRoutes.start, '/api/testlab/runs', { method: 'POST', admin: true, origin: O, body: { suite: 'pages' }, dataDir });
    assert.equal(r.status, 401);
    assert.equal(r.body.reauth, true);
    const s = await call(testlabRoutes.run, '/api/testlab/runs/run-1-a/stop', { method: 'POST', admin: true, origin: O, dataDir });
    assert.equal(s.status, 401);
  } finally {
    useTunnelOrigin(undefined);
  }
});

test('the page’s pure parts: a cheap key, the chart’s bars and ticks, the log tail, its address', () => {
  const v: TestLabView = { testMode: { on: true }, suites: [], history: [sum('run-1-a', 1)] };
  assert.equal(viewKey(v), viewKey(structuredClone(v)), 'the same view, the same key: nothing drawn again');
  assert.notEqual(viewKey(v), viewKey({ ...v, running: { ...sum('run-2-a', 2, { status: 'running' }), progress: { done: 1, of: 5 } } }));
  assert.notEqual(viewKey({ ...v, running: { ...sum('run-2-a', 2), progress: { done: 1, of: 5 } } }), viewKey({ ...v, running: { ...sum('run-2-a', 2), progress: { done: 2, of: 5 } } }));
  const r = { views: [{ id: 'a', name: 'A', path: '/', ok: true, ttuMs: null, longestTaskMs: 300, longTasks: [], heapStartMB: 1, heapEndMB: 1, heapGrowthPct: 0, domNodes: 1, failures: [] }] } as unknown as RunResult;
  assert.deepEqual(barsOf(r, 'longest', 200).map((b) => [b.value, b.over]), [[300, true]]);
  assert.deepEqual(barsOf(r, 'ttu', 3000).map((b) => b.over), [true], 'never usable is over');
  assert.deepEqual(ticksFor(230), [0, 100, 200, 300]);
  assert.deepEqual(ticksFor(0), [0, 1]);
  assert.equal(tailLines('a\nb\nc', 2), 'b\nc');
  assert.equal(testsHref('f1', 'run-1-a'), '/lite?floor=f1&tab=tests&run=run-1-a');
});

test('the page is in the flat views only: the 1D view, the ☰, the home page and Settings › Testing', () => {
  const lite = src('src/client/lite.ts');
  assert.match(lite, /import \{ testlabView \} from '\.\/ui\/testlab'/);
  assert.match(lite, /tests: \(\) => showTab\('tests'\)/);
  assert.match(src('src/client/lite.html'), /id="tests-view"/);
  assert.match(src('src/client/shared/flatmenu.ts'), /id: 'tests'.*shown: \(\) => store\.me\.admin/);
  assert.match(src('src/client/home.html'), /id="to-tests"/);
  assert.match(src('src/client/ui/settings/page.ts'), /testing: \(\) => testingPart\(\)/);
  for (const f of ['src/client/ui/menuitems.ts']) assert.doesNotMatch(src(f), /testlab|settings\/testing|'\.\/testing'/, `${f} doesn't load the Test Mode page`);
  // Colors are the theme's tokens: no hex in its stylesheet.
  assert.doesNotMatch(src('src/client/ui/testlab/ui.css'), /#[0-9a-f]{3,8}\b/i);
});
