// Expert mode, slice 4 (shared/expert-ready.ts, server/expert-ready/): the readiness check of an existing toolkit
// project on temporary fixture folders ("Order Desk"): each look's ok / warn / error, a look that takes too long,
// that the check never writes to the folder (every file, .git included, the same before and after), and that
// each fix writes only what it says. Fakes only: no mxcli, no Team Server, no office.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { toolkitCommitOf, checkBudget, checkDemo, checkFolder, checkLint, checkMendix, checkTeamServer, checkTests, checkToolkit, remoteKind, type ReadyDeps } from '../src/server/expert-ready/checks.js';
import { lookAtModel } from '../src/server/expert-ready/model.js';
import { addTeamServerRemote, pinToolkit, WishBook } from '../src/server/expert-ready/fixes.js';
import { readyGit, ReadyService } from '../src/server/expert-ready/index.js';
import { budgetAmount } from '../src/shared/expert-ready.js';
import type { TsGit } from '../src/server/team-server/git.js';
import { hasSqlite, project, type MadeUnit } from './support/mendix.js';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function tmp(t: { after(fn: () => void): void }, name = 'order-desk') {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-ready-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  return { root, dir };
}

const put = (dir: string, rel: string, text: string) => {
  const f = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
};

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 'sam@example.com', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 'sam@example.com' } });

/** Every file under `dir` (.git too): size, modified time and content hash. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const go = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) go(f);
      else {
        const s = statSync(f);
        out[path.relative(dir, f)] = `${s.size}|${s.mtimeMs}|${createHash('sha1').update(readFileSync(f)).digest('hex')}`;
      }
    }
  };
  go(dir);
  return out;
}

const changed = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();

const UNITS = (demo: boolean): MadeUnit[] => [
  { n: 1, container: 1, hash: 'h1', doc: { $Type: 'Projects$Project', Name: 'OrderDesk' } },
  { n: 2, container: 1, hash: 'h2', doc: { $Type: 'Projects$ModuleImpl', Name: 'Orders' } },
  { n: 3, container: 1, hash: 'h3', doc: { $Type: 'Projects$ModuleImpl', Name: 'Helpers', FromAppStore: true } },
  { n: 4, container: 2, hash: 'h4', doc: { $Type: 'DomainModels$DomainModel', Name: '', Entities: [{ Name: 'Order' }, { Name: 'OrderLine' }] } },
  { n: 5, container: 2, hash: 'h5', doc: { $Type: 'Microflows$Microflow', Name: 'ACT_Order_Save' } },
  { n: 6, container: 2, hash: 'h6', doc: { $Type: 'Forms$Page', Name: 'Order_Overview' } },
  { n: 7, container: 3, hash: 'h7', doc: { $Type: 'Microflows$Microflow', Name: 'Helper_Log' } },
  { n: 8, container: 1, hash: 'h8', doc: { $Type: 'Security$ProjectSecurity', EnableDemoUsers: demo, DemoUsers: [{ UserName: 'demo_clerk' }, { UserName: 'demo_manager' }] } },
];

async function mendixApp(dir: string, demo = true, version = '11.12.4') {
  await project(dir, UNITS(demo));
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'App.mpr'));
  db.exec('CREATE TABLE _MetaData (_ProductVersion TEXT)');
  db.prepare('INSERT INTO _MetaData VALUES (?)').run(version);
  db.close();
}

/** A toolkit project: skills, a subagent, project scripts, PROJECT.md's toolkit line, tests, journeys, lint baseline. */
function toolkitBits(dir: string) {
  put(dir, '.claude/skills/mdl/SKILL.md', '# mdl');
  put(dir, '.claude/skills/tests/SKILL.md', '# tests');
  put(dir, '.claude/agents/mdl-agent.md', '# agent');
  put(dir, 'bin/_common.sh', '#!/bin/sh');
  put(dir, 'bin/affected-tests.sh', '#!/bin/sh');
  put(dir, 'PROJECT.md', `# Order Desk\n\nToolkit commit: ${SHA.slice(0, 7)}\n`);
  put(dir, 'journeys/J01.journey.json', '{}');
  put(dir, 'journeys/example.journey.json', '{}');
  put(dir, 'tests/e2e/j01.js', '');
  put(dir, '.claude/lint-baseline.json', JSON.stringify({ counts: { CONV010: 3, MPR001: 2 }, total: 5, findings: {} }));
}

function deps(over: Partial<ReadyDeps> = {}): ReadyDeps {
  return {
    git: readyGit,
    model: lookAtModel,
    toolkitCommit: async () => ({ sha: SHA, how: 'ack' }),
    mxcli: async (dir) => ({ bin: path.join(dir, 'mxcli.exe'), from: 'project', version: 'v0.0.1-test' }),
    studioVersions: () => ['11.12.4'],
    budget: () => undefined,
    wishes: () => ({}),
    mendixAccount: () => true,
    ...over,
  };
}

const byId = (r: { checks: { id: string }[] }, id: string) => r.checks.find((c) => c.id === id) as ReturnType<typeof checkBudget>;

test('a full Order Desk folder: each look answers, and the check writes nothing (not even in .git)', async (t) => {
  if (!(await hasSqlite())) return t.skip('node:sqlite missing');
  const { dir } = tmp(t);
  toolkitBits(dir);
  await mendixApp(dir, true);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Order list page');
  git(dir, 'remote', 'add', 'origin', 'https://github.com/example/order-desk.git');
  put(dir, 'PROJECT.md', `# Order Desk\n\nToolkit commit: ${SHA.slice(0, 7)}\n\nChanged.\n`);
  const before = snapshot(dir);
  const r = await checkFolder(dir, deps());
  assert.deepEqual(changed(before, snapshot(dir)), [], 'the check changed files in the folder');
  assert.equal(r.mpr, 'App.mpr');
  assert.deepEqual(r.stats, { modules: 1, entities: 2, microflows: 1, pages: 1 });
  assert.equal(byId(r, 'toolkit').state, 'warn');
  assert.match(byId(r, 'toolkit').line, /commit a1b2c3d/);
  assert.match(byId(r, 'toolkit').detail!, /2 skills, 1 subagent, 2 project scripts/);
  assert.equal(byId(r, 'toolkit').fix?.id, 'pin-toolkit');
  assert.equal(byId(r, 'mxcli').state, 'ok');
  assert.match(byId(r, 'mxcli').line, /Found in project · v0\.0\.1-test/);
  assert.equal(byId(r, 'mendix').state, 'ok');
  assert.match(byId(r, 'mendix').line, /11\.12\.4 · Studio Pro 11\.12\.4 installed/);
  assert.equal(byId(r, 'git').state, 'ok');
  assert.match(byId(r, 'git').line, /^1 commit on main · 1 uncommitted change$/);
  assert.match(byId(r, 'git').detail!, /“Order list page”/);
  const ts = byId(r, 'teamserver');
  assert.equal(ts.state, 'warn');
  assert.match(ts.line, /origin points to a GitHub repo/);
  assert.doesNotMatch(JSON.stringify(r), /github\.com|example\/order-desk/, 'a remote URL reached the report');
  assert.equal(ts.fix?.id, 'add-teamserver');
  assert.equal(byId(r, 'demo').state, 'error');
  assert.match(byId(r, 'demo').line, /On · 2 demo users/);
  assert.deepEqual(r.blocksDeploy, ['Demo users are on']);
  assert.equal(byId(r, 'tests').state, 'warn');
  assert.equal(byId(r, 'tests').line, '0 microflow tests · 1 journey · 1 e2e script');
  assert.equal(byId(r, 'budget').state, 'warn');
  assert.equal(byId(r, 'lint').state, 'ok');
  assert.match(byId(r, 'lint').line, /5 findings across 2 rules/);
  assert.equal(r.toLookAt, 5);
  assert.deepEqual(r.checks.map((c) => c.id), ['toolkit', 'mxcli', 'mendix', 'git', 'teamserver', 'demo', 'tests', 'budget', 'lint']);
});

test('an empty folder: no toolkit, mxcli, .mpr or git are errors; nothing throws', async (t) => {
  const { dir } = tmp(t);
  const r = await checkFolder(dir, deps({ mxcli: async () => undefined, toolkitCommit: async () => undefined }));
  for (const id of ['toolkit', 'mxcli', 'mendix', 'git']) assert.equal(byId(r, id).state, 'error', id);
  assert.equal(byId(r, 'teamserver').fix?.off, 'Needs a git repository first');
  assert.equal(byId(r, 'demo').state, 'warn');
  assert.equal(byId(r, 'lint').state, 'warn');
  assert.deepEqual(readdirSync(dir), []);
});

test('a look that takes too long gives a row saying so, the rest still answer', async (t) => {
  const { dir } = tmp(t);
  writeFileSync(path.join(dir, 'App.mpr'), '');
  const r = await checkFolder(dir, deps({ model: () => new Promise(() => undefined), mxcli: () => new Promise(() => undefined), timeoutMs: 50 }));
  assert.equal(byId(r, 'mxcli').line, 'Took too long to check');
  assert.match(byId(r, 'mendix').detail!, /took too long/);
  assert.equal(byId(r, 'lint').line, 'No baseline');
});

test('toolkit: pinned is ok; present without a known commit warns with no fix', async (t) => {
  const { dir } = tmp(t);
  put(dir, '.claude/skills/a/SKILL.md', '');
  assert.equal((await checkToolkit(dir, { toolkitCommit: async () => undefined })).fix, undefined);
  put(dir, 'agent-office.project.json', JSON.stringify({ toolkit: { commit: SHA, at: '', by: 'Sam', history: [] } }));
  const c = await checkToolkit(dir, {});
  assert.equal(c.state, 'ok');
  assert.match(c.line, /pinned to a1b2c3d/);
});

test("toolkit commit: PROJECT.md's line wins over the scripts' estimate; the estimate fills in its full sha", async () => {
  const other = { sha: 'ffffffffffffffffffffffffffffffffffffffff', how: 'snapshot' };
  assert.deepEqual(await toolkitCommitOf('x', 'Toolkit commit: 3f2a9c1', { toolkitCommit: async () => other }), { sha: '3f2a9c1', how: 'PROJECT.md' });
  assert.equal((await toolkitCommitOf('x', `Toolkit commit: ${SHA.slice(0, 7)}`, { toolkitCommit: async () => ({ sha: SHA, how: 'ack' }) }))?.sha, SHA);
  assert.equal(await toolkitCommitOf('x', undefined, { toolkitCommit: async () => undefined }), undefined);
});

test('mendix: installed, another patch installed, none installed, no version', () => {
  assert.equal(checkMendix({ version: '11.12.4' }, 'x.mpr', ['11.12.4']).state, 'ok');
  const near = checkMendix({ version: '11.12.4' }, 'x.mpr', ['11.12.2']);
  assert.equal(near.state, 'warn');
  assert.match(near.detail!, /11\.12\.2 is installed/);
  assert.match(checkMendix({ version: '11.12.4' }, 'x.mpr', []).detail!, /No Studio Pro/);
  assert.equal(checkMendix({}, 'x.mpr', []).line, 'Version unknown');
  assert.equal(checkMendix(undefined, undefined, []).state, 'error');
});

test('team server: a Team Server remote is ok; the fix is off without a Mendix account; URLs are only kinds', async (t) => {
  const { dir } = tmp(t);
  assert.equal((await checkTeamServer(dir, { repo: true, remotes: [{ name: 'teamserver', kind: 'teamserver' }] }, { mendixAccount: () => false })).state, 'ok');
  const off = await checkTeamServer(dir, { repo: true, remotes: [] }, { mendixAccount: () => false });
  assert.match(off.fix!.off!, /Mendix account in Settings/);
  assert.equal(remoteKind('https://git.api.mendix.com/0000.git'), 'teamserver');
  assert.equal(remoteKind('git@github.com:example/app.git'), 'github');
  assert.equal(remoteKind('C:\\repos\\app.git'), 'local');
  assert.equal(remoteKind('https://gitlab.example.com/app.git'), 'other');
});

test('demo users: off is ok; on is an error with the seed users wish; a recorded wish says so', () => {
  assert.equal(checkDemo({ demo: { on: false, count: 0 } }, {}).state, 'ok');
  const on = checkDemo({ demo: { on: true, count: 3 } }, {});
  assert.equal(on.fix?.id, 'seed-users');
  assert.match(on.detail!, /Blocks Deploy/);
  assert.match(checkDemo({ demo: { on: true, count: 3 } }, { seedUsers: { at: 1, by: 'Sam' } }).done!, /Ask the session after attaching/);
});

test('tests: microflow tests make it ok; none warns with the add-tests wish', async (t) => {
  const { dir } = tmp(t);
  assert.equal((await checkTests(dir, {})).fix?.id, 'add-tests');
  put(dir, 'tests/orders/order.test.mdl', '/**\n * @test saves an order\n */\n/**\n * @test refuses an empty order\n */\n');
  const c = await checkTests(dir, {});
  assert.equal(c.state, 'ok');
  assert.match(c.line, /^2 microflow tests/);
});

test('budget and lint rows', async (t) => {
  assert.equal(checkBudget({ total: 500 }, {}).state, 'ok');
  assert.match(checkBudget(undefined, { budget: { total: 800, autoPause: true, at: 1, by: 'Sam' } }).line, /\$800 total · set when you attach/);
  assert.equal(checkBudget(undefined, {}).fix?.id, 'set-budget');
  const { dir } = tmp(t);
  put(dir, '.claude/lint-baseline.json', '{not json');
  assert.equal((await checkLint(dir)).line, 'Baseline unreadable');
  assert.equal(budgetAmount('$1,200'), 1200);
  assert.equal(budgetAmount(-1), undefined);
});

test('pin toolkit writes only agent-office.project.json, keeping its other settings', async (t) => {
  const { dir } = tmp(t);
  toolkitBits(dir);
  put(dir, 'agent-office.project.json', JSON.stringify({ name: 'Order Desk', mendix: '11.12.4' }));
  const before = snapshot(dir);
  assert.match(await pinToolkit(dir, SHA, 'Sam'), /Pinned to a1b2c3d/);
  assert.deepEqual(changed(before, snapshot(dir)), ['agent-office.project.json']);
  const j = JSON.parse(readFileSync(path.join(dir, 'agent-office.project.json'), 'utf8'));
  assert.equal(j.name, 'Order Desk');
  assert.equal(j.toolkit.commit, SHA);
  assert.equal(j.toolkit.history.at(-1).action, 'pin');
  await assert.rejects(pinToolkit(dir, 'not-a-sha', 'Sam'));
});

function fakeTs(remotes: string[]) {
  const calls: string[] = [];
  const ok = (stdout = '') => ({ code: 0, stdout, tail: [] as string[] });
  const g: TsGit = {
    auth: async (_d, args) => (calls.push(`auth ${args.join(' ')}`), ok()),
    plain: async (_d, args) => {
      calls.push(`plain ${args.join(' ')}`);
      if (args[0] === 'remote' && args.length === 1) return ok(remotes.join('\n'));
      return ok();
    },
    hide: (s) => s,
  };
  return { g, calls };
}

const ENDPOINTS = { git: 'https://git.example.test', projectsApi: 'https://api.example.test/v2' };
const APP = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

test('add Team Server remote: an existing app by App ID, only the teamserver remote and the record; origin untouched, nothing pushed', async (t) => {
  const { dir } = tmp(t);
  put(dir, 'agent-office.project.json', JSON.stringify({ name: 'Order Desk' }));
  const before = snapshot(dir);
  const { g, calls } = fakeTs(['origin']);
  const r = await addTeamServerRemote({ g, dir, name: 'Order Desk', endpoints: ENDPOINTS, api: { token: 'x' }, projectId: APP, by: 'Sam', now: () => 5 });
  assert.match(r.message, /existing Portal app/);
  assert.deepEqual(changed(before, snapshot(dir)), ['agent-office.project.json']);
  const j = JSON.parse(readFileSync(path.join(dir, 'agent-office.project.json'), 'utf8'));
  assert.equal(j.name, 'Order Desk');
  assert.equal(j.teamServer.projectId, APP);
  assert.equal(j.teamServer.remote, 'teamserver');
  assert.ok(calls.some((c) => c === `plain remote add teamserver https://git.example.test/${APP}.git`), calls.join('\n'));
  assert.ok(!calls.some((c) => /\bpush\b|\bcommit\b|origin/.test(c)), calls.join('\n'));
});

test('add Team Server remote: a new app through the Projects API (mocked); refuses a folder that has one already', async (t) => {
  const { dir } = tmp(t);
  const { g } = fakeTs([]);
  const answers = [new Response(JSON.stringify({ jobId: 'job-1' }), { status: 202 }), new Response(JSON.stringify({ status: 'completed', projectId: APP }), { status: 200 })];
  const fetch = (async () => answers.shift()!) as typeof globalThis.fetch;
  const r = await addTeamServerRemote({ g, dir, name: 'Order Desk', endpoints: ENDPOINTS, api: { token: 'x', fetch, endpoints: ENDPOINTS, sleep: async () => undefined }, by: 'Sam' });
  assert.match(r.message, /new Portal app/);
  await assert.rejects(addTeamServerRemote({ g: fakeTs(['origin', 'teamserver']).g, dir, name: 'x', endpoints: ENDPOINTS, api: { token: 'x' }, projectId: APP, by: 'Sam' }), /already has a “teamserver” remote/);
  await assert.rejects(addTeamServerRemote({ g, dir, name: 'x', endpoints: ENDPOINTS, api: { token: 'x' }, projectId: APP, by: 'Sam' }), /already names a Team Server app/);
});

test('the office service: wishes and a budget before attaching go to the office data, never the folder; reports are cached', async (t) => {
  const { root, dir } = tmp(t);
  const dataDir = path.join(root, 'data');
  mkdirSync(dataDir);
  toolkitBits(dir);
  let runs = 0;
  const svc = new ReadyService({ cfg: { dataDir } as never, floors: new Map() as never }, { token: () => undefined, check: { mxcli: async () => undefined, toolkitCommit: async () => (runs++, undefined), studioVersions: () => [] } });
  const before = snapshot(dir);
  const a = svc.check(dir);
  assert.equal(svc.check(dir), a, 'two asks share one run');
  await a;
  for (const fix of ['seed-users', 'add-tests'] as const) assert.ok('message' in (await svc.fix(dir, { fix }, 'Sam')));
  const b = await svc.fix(dir, { fix: 'set-budget', total: 800 }, 'Sam');
  assert.ok('message' in b && /set when you attach/.test(b.message));
  assert.ok('error' in (await svc.fix(dir, { fix: 'set-budget', total: 'lots' }, 'Sam')));
  assert.match(String((await svc.fix(dir, { fix: 'add-teamserver' }, 'Sam') as { error: string }).error), /Mendix account in Settings/);
  assert.deepEqual(changed(before, snapshot(dir)), []);
  const w = new WishBook(path.join(dataDir, 'expert-ready', 'wishes.json')).get(dir);
  assert.ok(w.seedUsers && w.addTests);
  assert.equal(w.budget?.total, 800);
  const r = await svc.check(dir);
  assert.match(byId(r, 'demo').line + byId(r, 'budget').line, /\$800 total/);
  assert.match(byId(r, 'tests').done!, /Ask the session/);
  await svc.check(dir, true);
  assert.ok(runs >= 2);
});
