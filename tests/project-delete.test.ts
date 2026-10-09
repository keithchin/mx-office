// Deleting a project (server/project-delete/, shared/project-delete.ts): against real temporary git
// repositories in test-office folders and a fake gh (a function; GitHub is never called), the typed
// name must match, each mode does exactly what it says (remove keeps the folder and the repository,
// delete takes them only when ticked and allowed), the office data is archived before it's removed,
// worktrees with work need an explicit yes, the folder guards hold (outside the projects folder, a
// junction, test mode, the office's own checkout), a failed job carries on from its step, nothing starts
// during a pause or a safe restart, the audit hears project.delete, the project id is retired, and the
// pages on it go Home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanRequest, confirmMatches, confirmTarget, consequences, goesHome, type DeleteJobView, type DeletePlan } from '../src/shared/project-delete.js';
import { ProjectDeletes } from '../src/server/project-delete/index.js';
import { folderRefusal, removeTree } from '../src/server/project-delete/fsops.js';
import { forgetScopes } from '../src/server/project-delete/repo.js';
import type { DeleteDeps, DeleteFloor } from '../src/server/project-delete/types.js';
import { ProjectIds } from '../src/server/projects/ids.js';
import { projectPath } from '../src/server/http/routes/projects.js';
import { removeDir } from './support/cleanup.js';
import { forgetProject } from '../src/server/project-delete/forget.js';
import { dropKeys, forgetWith, keyOfFloor, onForgetFloor } from '../src/server/office/forget.js';
import { BudgetStore } from '../src/server/budget/store.js';
import { RunStore } from '../src/server/analysis/store.js';
import { acceptanceStore } from '../src/server/acceptance/index.js';
import { pacingOf, projectPause, setPacing, setProjectPause, useProjectRunFile } from '../src/server/project-run/store.js';
import { FlowEngine } from '../src/server/flow/engine.js';
import type { RunRecord as AnalysisRun } from '../src/shared/analysis.js';
import { DEFAULT_PACING } from '../src/shared/project-run.js';
import { whoOf } from '../src/server/http/routes/notify-teams.js';
import { profileBy } from '../src/client/ui/project-delete/api.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ENV = ['-c', 'user.name=T', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false'];
const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, ...ENV, 'commit', '-q', '-m', file);
};

interface Office {
  root: string;
  data: string;
  home: string;
  dir: string;
  floor: DeleteFloor;
  deps: DeleteDeps;
  calls: { gh: string[][]; stopped: number; removed: number; retired: number; audits: DeleteJobView[]; announced: number };
  svc: ProjectDeletes;
  tree(name: string): string;
}

/** A test office: its data folder, its projects folder with one project (a clone of a bare origin), a floor for it, and fake deps. */
function office(t: { after(fn: () => void): void }, opts: { scopes?: string; testMode?: boolean; blocked?: string; local?: boolean; root?: string } = {}): Office {
  forgetScopes();
  const root = opts.root ?? realpathSync(mkdtempSync(path.join(os.tmpdir(), 'test-office-delete-')));
  t.after(() => removeDir(root));
  const data = path.join(root, '.agent-office');
  const home = path.join(root, 'projects');
  const origin = path.join(root, 'origin.git');
  mkdirSync(home, { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const dir = path.join(home, 'acme', 'shop');
  git(root, 'clone', '-q', origin, dir);
  git(dir, 'checkout', '-q', '-b', 'main');
  commit(dir, 'README.md', 'hi\n');
  commit(dir, '.gitignore', 'node_modules\n');
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  // The office's data for the floor, and the project's own .agent-office.
  for (const [rel, text] of [
    ['roster/shop.json', '{"team":1}'],
    ['chatter/shop.jsonl', '{"m":1}\n'],
    ['budget/shop.json', '{"ledger":{}}'],
    ['acceptance/shop.jsonl', '{"a":1}\n'],
    ['acceptance/shop/one.json', '{}'],
    ['roster/other.json', '{"keep":true}'],
    ['incidents/incidents.jsonl', '{"incident":{"id":"i1","floors":["shop"]}}\n{"incident":{"id":"i2","floors":["other"]}}\n'],
  ]) {
    mkdirSync(path.dirname(path.join(data, rel)), { recursive: true });
    writeFileSync(path.join(data, rel), text);
  }
  mkdirSync(path.join(dir, '.agent-office'), { recursive: true });
  writeFileSync(path.join(dir, '.agent-office', 'workers.json'), '[]');
  const floor: DeleteFloor = { id: 'shop', name: 'shop', repo: 'acme/shop', dir, projectId: 'prj_01HZZZZZZZZZZZZZZZZZZZZZZZ', local: !!opts.local };
  let onFloors = true;
  const calls: Office['calls'] = { gh: [], stopped: 0, removed: 0, retired: 0, audits: [], announced: 0 };
  const deps: DeleteDeps = {
    dataDir: data,
    projectsHome: () => home,
    floor: (id) => (id === 'shop' && onFloors ? floor : undefined),
    agents: () => (calls.stopped ? 0 : 2),
    blocked: () => opts.blocked,
    stopAgents: async () => (calls.stopped++, calls.stopped === 1 ? 2 : 0),
    removeFloor: () => ((onFloors = false), calls.removed++, undefined),
    pin: () => ({ commit: 'abc1234', floorDir: dir, at: 1 }),
    forget: async (f, archive) => void (await forgetProject(f, archive, {})),
    retire: () => void calls.retired++,
    audit: (_f, _by, job) => void calls.audits.push(job),
    announce: () => void calls.announced++,
    gh: async (args) => {
      calls.gh.push(args);
      if (args[0] === 'api' && args[1] === '-i') return `HTTP/2.0 200 OK\nX-Oauth-Scopes: ${opts.scopes ?? 'repo, read:org'}\n\n{"login":"me"}`;
      if (args.includes('DELETE')) return '';
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
    testMode: () => !!opts.testMode,
    ghIsFake: () => true,
    now: () => Date.now(),
  };
  return { root, data, home, dir, floor, deps, calls, svc: new ProjectDeletes(deps), tree: (name) => path.join(dir, '.agent-office', 'worktrees', name) };
}

const run = async (o: Office, body: Record<string, unknown>) => {
  const r = await o.svc.start('shop', { confirm: 'acme/shop', ...body }, { name: 'Ada' });
  await o.svc.settled('shop');
  return r;
};

test('the typed name must be exactly the repository (or the floor id): the request is cleaned the safe way', () => {
  assert.equal(confirmTarget({ floor: 'shop', repo: 'acme/shop' }), 'acme/shop');
  assert.equal(confirmTarget({ floor: 'shop' }), 'shop');
  assert.ok(confirmMatches('acme/shop', 'acme/shop'));
  for (const typed of ['Acme/shop', 'acme/shop ', ' acme/shop', 'acme', '', undefined, 42]) assert.ok(!confirmMatches(typed, 'acme/shop'), String(typed));
  assert.ok(!confirmMatches('', ''), 'nothing to type never matches');
  // Remove never takes the folder or the repository, whatever is sent.
  assert.deepEqual(cleanRequest({ mode: 'remove', deleteFolder: true, deleteRepo: true, confirm: 'x' }), { mode: 'remove', deleteFolder: false, deleteRepo: false, discardWork: false, confirm: 'x' });
  assert.deepEqual(cleanRequest({ mode: 'delete', deleteFolder: 'yes', confirm: 'x' }), { mode: 'delete', deleteFolder: false, deleteRepo: false, discardWork: false, confirm: 'x' });
  assert.equal(typeof cleanRequest({ mode: 'nuke' }), 'string');
  assert.deepEqual(projectPath('/api/projects/shop/delete'), { floor: 'shop', what: 'delete' });
  assert.deepEqual(projectPath('/api/projects/shop/delete-plan'), { floor: 'shop', what: 'delete-plan' });
  assert.equal(projectPath('/api/projects/../x/delete'), undefined);
});

test('a wrong name is refused by the server and nothing changes', async (t) => {
  const o = office(t);
  const r = await o.svc.start('shop', { mode: 'delete', deleteFolder: true, confirm: 'acme/Shop' }, { name: 'Ada' });
  assert.match(String(r), /type acme\/shop exactly/);
  assert.equal(o.calls.stopped, 0);
  assert.ok(existsSync(o.dir));
  assert.ok(existsSync(path.join(o.data, 'roster', 'shop.json')));
});

test('Remove from office: agents stopped, worktrees gone, data archived then removed, folder and repository kept, audited, id retired', async (t) => {
  const o = office(t, { scopes: 'repo, delete_repo' });
  git(o.dir, 'worktree', 'add', '-q', '-b', 'office/clean', o.tree('clean'), 'main');
  // A junction in a worktree (node_modules to another checkout's packages): never followed.
  const elsewhere = path.join(o.root, 'packages');
  mkdirSync(elsewhere);
  writeFileSync(path.join(elsewhere, 'keep.txt'), 'keep');
  symlinkSync(elsewhere, path.join(o.tree('clean'), 'node_modules'), 'junction');
  const plan = (await o.svc.plan('shop')) as DeletePlan;
  assert.equal(plan.confirm, 'acme/shop');
  assert.equal(plan.agents, 2);
  assert.equal(plan.worktrees.length, 1);
  assert.equal(plan.worktrees[0].dirty, 0);
  assert.equal(plan.worktrees[0].unpushed, 0);
  assert.ok(plan.repoDelete.possible);
  assert.match(consequences(plan, { mode: 'remove' }).join(' '), /2 agents stopped.*1 worktree removed.*kept.*acme\/shop kept/);

  const job = (await run(o, { mode: 'remove', deleteFolder: true, deleteRepo: true })) as DeleteJobView;
  assert.equal(job.deleteFolder, false, 'remove never deletes the folder');
  const done = (await o.svc.job('shop'))!;
  assert.equal(done.status, 'done', done.error);
  assert.deepEqual(
    done.steps.map((s) => `${s.id}:${s.status}`),
    ['agents:done', 'worktrees:done', 'archive:done', 'data:done', 'folder:skipped', 'repo:skipped', 'floor:done'],
  );
  assert.equal(o.calls.stopped, 1);
  assert.ok(!existsSync(o.tree('clean')), 'the worktree is gone');
  assert.ok(!git(o.dir, 'branch', '--list', 'office/clean'), 'its merged branch too');
  assert.ok(existsSync(path.join(elsewhere, 'keep.txt')), "the junction's target is untouched");
  assert.ok(existsSync(path.join(o.dir, 'README.md')), 'the folder stays');
  assert.ok(!o.calls.gh.some((a) => a.includes('DELETE')), 'the repository is never deleted');
  // Archived, then removed; other floors' files untouched.
  const archive = done.archiveDir!;
  assert.ok(archive.startsWith(path.join(o.data, 'deleted', 'shop-')));
  for (const rel of ['office/roster/shop.json', 'office/chatter/shop.jsonl', 'office/budget/shop.json', 'office/acceptance/shop.jsonl', 'office/acceptance/shop/one.json', 'project-agent-office/workers.json', 'toolkit-pin.json', 'floor.json', 'manifest.json']) assert.ok(existsSync(path.join(archive, rel)), rel);
  assert.match(readFileSync(path.join(archive, 'incidents.jsonl'), 'utf8'), /"i1"/);
  assert.doesNotMatch(readFileSync(path.join(archive, 'incidents.jsonl'), 'utf8'), /"i2"/);
  assert.ok(!existsSync(path.join(archive, 'project-agent-office', 'worktrees')), 'worktrees are never archived');
  for (const rel of ['roster/shop.json', 'chatter/shop.jsonl', 'budget/shop.json', 'acceptance/shop.jsonl', 'acceptance/shop']) assert.ok(!existsSync(path.join(o.data, rel)), rel);
  assert.ok(!existsSync(path.join(o.dir, '.agent-office')), "the project's office data is removed");
  assert.ok(existsSync(path.join(o.data, 'roster', 'other.json')), "another project's data stays");
  assert.ok(existsSync(path.join(o.data, 'incidents', 'incidents.jsonl')), 'the incident log is never cut');
  assert.ok(!existsSync(path.join(o.data, 'deleted', 'jobs', 'shop.json')), 'a finished job leaves no job file');
  assert.equal(o.calls.removed, 1);
  assert.equal(o.calls.retired, 1);
  assert.equal(o.calls.announced, 1);
  assert.equal(o.calls.audits.length, 1);
  assert.equal(o.calls.audits[0].mode, 'remove');
});

test('Delete project with the folder and the repository: the archive is made before either goes, gh deletes only with the scope', async (t) => {
  const o = office(t, { scopes: 'repo, delete_repo' });
  let archivedFirst = false;
  const gh = o.deps.gh;
  o.deps.gh = async (args) => {
    if (args.includes('DELETE')) {
      const archive = readdirSync(path.join(o.data, 'deleted')).find((n) => n.startsWith('shop-'));
      archivedFirst = !!archive && existsSync(path.join(o.data, 'deleted', archive, 'office', 'roster', 'shop.json')) && !existsSync(o.dir);
    }
    return gh(args);
  };
  const job = await run(o, { mode: 'delete', deleteFolder: true, deleteRepo: true });
  assert.equal(typeof job, 'object', String(job));
  const done = (await o.svc.job('shop'))!;
  assert.equal(done.status, 'done', done.error);
  assert.ok(!existsSync(o.dir), 'the folder is gone');
  assert.ok(existsSync(path.join(o.home, 'acme')), 'only the project folder, not its parent');
  assert.deepEqual(
    o.calls.gh.filter((a) => a.includes('DELETE')),
    [['api', '-X', 'DELETE', 'repos/acme/shop']],
  );
  assert.ok(archivedFirst, 'archived (and the folder gone) before the repository is deleted');
  assert.equal(o.calls.audits[0].deleteRepo, true);
});

test("without delete_repo the repository can't be deleted: the plan says where to do it on GitHub, and asking anyway is refused", async (t) => {
  const o = office(t, { scopes: 'repo' });
  const plan = (await o.svc.plan('shop')) as DeletePlan;
  assert.equal(plan.repoDelete.possible, false);
  assert.match(plan.repoDelete.why!, /can’t delete repositories/);
  assert.equal(plan.repoDelete.settingsUrl, 'https://github.com/acme/shop/settings');
  const r = await run(o, { mode: 'delete', deleteRepo: true });
  assert.match(String(r), /repository can’t be deleted/);
  assert.equal(o.calls.stopped, 0);
  assert.ok(!o.calls.gh.some((a) => a.includes('DELETE')));
});

test('worktrees with uncommitted or unpushed work are listed and need an explicit yes; an unpushed branch stays when the folder does', async (t) => {
  const o = office(t);
  git(o.dir, 'worktree', 'add', '-q', '-b', 'office/dirty', o.tree('dirty'), 'main');
  writeFileSync(path.join(o.tree('dirty'), 'wip.txt'), 'wip');
  git(o.dir, 'worktree', 'add', '-q', '-b', 'office/ahead', o.tree('ahead'), 'main');
  commit(o.tree('ahead'), 'new.txt', 'new\n');
  const plan = (await o.svc.plan('shop')) as DeletePlan;
  const by = Object.fromEntries(plan.worktrees.map((w) => [w.branch, w]));
  assert.equal(by['office/dirty'].dirty, 1);
  assert.equal(by['office/ahead'].unpushed, 1);
  assert.match(consequences(plan, { mode: 'remove' }).join(' '), /2 worktrees removed, 2 of them with uncommitted or unpushed work/);
  const refused = await run(o, { mode: 'remove' });
  assert.match(String(refused), /2 worktrees have uncommitted or unpushed work/);
  assert.equal(o.calls.stopped, 0);
  const ok = await run(o, { mode: 'remove', discardWork: true });
  assert.equal(typeof ok, 'object', String(ok));
  const done = (await o.svc.job('shop'))!;
  assert.equal(done.status, 'done', done.error);
  assert.ok(!existsSync(o.tree('dirty')) && !existsSync(o.tree('ahead')));
  assert.equal(git(o.dir, 'branch', '--list', 'office/ahead').replace(/^[*+ ]+/, ''), 'office/ahead', 'the unpushed commit is still in the repository');
  assert.match(done.steps.find((s) => s.id === 'worktrees')!.detail!, /kept the branch office\/ahead/);
});

test('folder guards: outside the projects folder, a junction, test mode outside test offices, the office’s own checkout or data', async (t) => {
  const o = office(t);
  const rules = { home: o.home, dataDir: o.data, local: false, testMode: false };
  assert.equal(await folderRefusal(o.dir, rules), undefined);
  assert.match((await folderRefusal(o.root, rules))!, /isn’t inside the office’s projects folder/);
  assert.match((await folderRefusal(o.home, rules))!, /isn’t inside/, 'never the projects folder itself');
  const link = path.join(o.home, 'acme', 'link');
  symlinkSync(o.dir, link, 'junction');
  assert.match((await folderRefusal(link, rules))!, /junction or symbolic link/);
  assert.match((await folderRefusal(o.dir, { ...rules, local: true }))!, /started in/);
  assert.match((await folderRefusal(o.dir, { ...rules, dataDir: path.join(o.dir, '.agent-office') }))!, /own data is inside it/);
  // Test mode: a real folder (not under a test-office folder) is never deleted.
  const real = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pd-real-')));
  t.after(() => removeDir(real));
  mkdirSync(path.join(real, 'projects', 'a', 'b'), { recursive: true });
  assert.match((await folderRefusal(path.join(real, 'projects', 'a', 'b'), { home: path.join(real, 'projects'), dataDir: path.join(real, 'data'), local: false, testMode: true }))!, /test mode/);
  assert.equal(await folderRefusal(path.join(real, 'projects', 'a', 'b'), { home: path.join(real, 'projects'), dataDir: path.join(real, 'data'), local: false, testMode: false }), undefined);
  // And the job refuses before anything happens.
  const r = await run(office(t, { local: true }), { mode: 'delete', deleteFolder: true });
  assert.match(String(r), /folder can’t be deleted: it’s the project the office was started in/);
});

test("the project the office was started in keeps its .agent-office (the office's own data) when removed", async (t) => {
  const o = office(t, { local: true });
  await run(o, { mode: 'remove' });
  assert.equal((await o.svc.job('shop'))!.status, 'done');
  assert.ok(existsSync(path.join(o.dir, '.agent-office', 'workers.json')));
  assert.ok(!existsSync(path.join(o.data, 'roster', 'shop.json')));
});

test('a job that fails part way carries on from that step when asked again, without redoing the rest', async (t) => {
  const o = office(t, { scopes: 'delete_repo' });
  const gh = o.deps.gh;
  let fail = true;
  o.deps.gh = async (args) => {
    if (args.includes('DELETE') && fail) throw new Error('HTTP 502: Bad Gateway');
    return gh(args);
  };
  await run(o, { mode: 'delete', deleteFolder: true, deleteRepo: true });
  const failed = (await o.svc.job('shop'))!;
  assert.equal(failed.status, 'failed');
  assert.match(failed.error!, /Deleting the GitHub repository: GitHub wouldn’t delete acme\/shop: HTTP 502/);
  assert.ok(existsSync(path.join(o.data, 'deleted', 'jobs', 'shop.json')), 'kept for the retry');
  assert.equal(o.calls.removed, 0, 'still in floors.json');
  const plan = (await o.svc.plan('shop')) as DeletePlan;
  assert.equal(plan.unfinished?.status, 'failed');
  // A new service (the office restarted) carries on from the saved job.
  fail = false;
  const again = new ProjectDeletes(o.deps);
  const r = await again.start('shop', { mode: 'delete', confirm: 'acme/shop' }, { name: 'Ada' });
  assert.equal(typeof r, 'object', String(r));
  await again.settled('shop');
  const done = (await again.job('shop'))!;
  assert.equal(done.status, 'done', done.error);
  assert.equal(done.deleteRepo, true, 'carried on with what was asked the first time');
  assert.equal(o.calls.stopped, 1, 'the agents were not stopped twice');
  assert.equal(o.calls.gh.filter((a) => a.includes('DELETE')).length, 1);
  assert.equal(o.calls.removed, 1);
  assert.equal(o.calls.audits.length, 1);
});

test('nothing starts while a pause or a safe restart is under way', async (t) => {
  const o = office(t, { blocked: 'A safe restart is under way: delete the project once the office is back' });
  const plan = (await o.svc.plan('shop')) as DeletePlan;
  assert.match(plan.blocked!, /safe restart/);
  const r = await run(o, { mode: 'remove' });
  assert.match(String(r), /safe restart/);
  assert.equal(o.calls.stopped, 0);
  assert.ok(existsSync(path.join(o.data, 'roster', 'shop.json')));
});

test('test mode never deletes a real GitHub repository (only the fake gh)', async (t) => {
  const o = office(t, { scopes: 'delete_repo', testMode: true });
  o.deps.ghIsFake = () => false;
  const plan = (await o.svc.plan('shop')) as DeletePlan;
  assert.equal(plan.repoDelete.possible, false);
  assert.match(String(await run(o, { mode: 'delete', deleteRepo: true })), /test mode never deletes a real GitHub repository/);
  assert.ok(!o.calls.gh.some((a) => a.includes('DELETE')));
});

test('removeTree: read-only files, long paths, and a junction inside left pointing where it did', async (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'test-office-rm-')));
  t.after(() => removeDir(root));
  const dir = path.join(root, 'proj');
  let deep = dir;
  while (deep.length < 300) deep = path.join(deep, 'a-rather-long-folder-name');
  mkdirSync(deep, { recursive: true });
  writeFileSync(path.join(deep, 'f.txt'), 'x');
  const ro = path.join(dir, 'readonly.txt');
  writeFileSync(ro, 'x');
  chmodSync(ro, 0o444);
  const target = path.join(root, 'target');
  mkdirSync(target);
  writeFileSync(path.join(target, 'keep.txt'), 'keep');
  symlinkSync(target, path.join(dir, 'node_modules'), 'junction');
  await removeTree(dir);
  assert.ok(!existsSync(dir));
  assert.ok(existsSync(path.join(target, 'keep.txt')));
  await removeTree(dir); // gone already: nothing to do
});

test("a deleted project's id is retired: never handed out again, and looked up as deleted", (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'test-office-ids-')));
  t.after(() => removeDir(root));
  const ids = new ProjectIds(root, () => 1_760_000_000_000);
  const first = ids.ensure({ id: 'shop', repo: 'acme/shop', dir: path.join(root, 'shop') });
  ids.retire(first, 'Ada', 'shop');
  const again = ids.ensure({ id: 'shop', repo: 'acme/shop', dir: path.join(root, 'shop') });
  assert.notEqual(again, first, 'the same repository added again is a new project');
  assert.notEqual(ids.ensure({ id: 'shop', repo: 'acme/shop', dir: path.join(root, 'shop'), projectId: first }), first, 'even when something still carries the old id');
  const gone = new ProjectIds(root).deletedFor(first)!;
  assert.equal(gone.deleted?.by, 'Ada');
  assert.equal(new Date(gone.deleted!.at).toISOString().slice(0, 10), '2025-10-09');
  assert.equal(new ProjectIds(root).deletedFor('shop')?.projectId, first, 'by its old floor id too');
});

test('pages that were on a deleted project go Home; Home and other projects only toast', () => {
  const msg = { floor: 'shop' };
  assert.ok(goesHome({ ...msg, wasHere: true }, { path: '/lite', floor: 'other', search: '' }), 'moved off it when its floor closed');
  assert.ok(goesHome(msg, { path: '/pixel', floor: 'shop', search: '' }));
  assert.ok(goesHome(msg, { path: '/lite', floor: null, search: '?floor=shop&tab=settings' }));
  assert.ok(!goesHome(msg, { path: '/lite', floor: 'other', search: '?floor=other' }));
  assert.ok(!goesHome({ ...msg, wasHere: true }, { path: '/home', floor: 'shop', search: '' }), 'Home stays Home');
});

test('which cache keys belong to a floor: its id, <id>:… keys and its folder, never another floor that starts the same', () => {
  const f = { id: 'shop', dir: path.resolve('/projects/acme/shop') };
  for (const k of ['shop', 'shop:lead', 'shop|stage', path.resolve('/projects/acme/shop'), path.join(path.resolve('/projects/acme/shop'), '.agent-office')]) assert.ok(keyOfFloor(k, f), k);
  for (const k of ['shop-2', 'shop-2:lead', 'workshop', 'w_123', path.resolve('/projects/acme/shop-2')]) assert.ok(!keyOfFloor(k, f), k);
  const m = new Map<string, unknown>([['shop', 1], ['shop:x', 2], ['crm', 3]]);
  const timer = setTimeout(() => assert.fail('a dropped timer still ran'), 50);
  m.set('shop|t', timer);
  dropKeys(m, f);
  assert.deepEqual([...m.keys()], ['crm']);
  // Instances are held weakly; module caches until they stop.
  let heard = 0;
  const off = onForgetFloor(() => heard++);
  const owner = { n: 0 };
  forgetWith(owner, (o) => o.n++);
  const archive = mkdtempSync(path.join(os.tmpdir(), 'test-office-forget-'));
  return forgetProject({ ...f, name: 'shop', local: false }, archive, {}).then((errors) => {
    off();
    removeDir(archive);
    assert.deepEqual(errors, []);
    assert.equal(heard, 1);
    assert.equal(owner.n, 1);
  });
});

test('delete, then add the same floor id again before a restart: its budget, acceptance, pause, pacing, analysis and workflow runs start fresh', async (t) => {
  const o = office(t);
  useProjectRunFile(o.data);
  t.after(() => useProjectRunFile(undefined));
  const budget = new BudgetStore(o.data);
  budget.floor('shop').alerts.push({ at: 1, level: 'full' } as never);
  budget.changed('shop');
  await budget.flushSoon();
  const accept = acceptanceStore(o.data, 'shop');
  setProjectPause('shop', { by: 'Ada', at: 1, why: 'person', waiting: [] });
  setPacing('shop', { concurrent: 1, gapSec: 99 });
  const runs = new RunStore(o.data);
  runs.put({ id: 'shop:w1', floor: 'shop', worker: 'Ana', workerId: 'w1' } as AnalysisRun);
  runs.put({ id: 'crm:w2', floor: 'crm', worker: 'Bo', workerId: 'w2' } as AnalysisRun);
  const removed: string[] = [];
  const engine = new FlowEngine({
    store: { loadAll: () => [{ runId: 'project-pause-1', workflow: 'project-pause', floor: 'shop', status: 'done', updatedAt: 1 } as never], save() {}, cacheGet: () => undefined, cachePut() {}, remove: (r) => void removed.push(r.runId) },
  });
  assert.equal(engine.list({ floor: 'shop' }).length, 1);
  o.deps.forget = async (f, archive) => void (await forgetProject(f, archive, { runs, flows: engine }));

  await run(o, { mode: 'remove' });
  const done = (await o.svc.job('shop'))!;
  assert.equal(done.status, 'done', done.error);
  // The same floor id, added again: nothing of the old project comes back.
  assert.equal(budget.has('shop'), false);
  assert.equal(budget.floor('shop').alerts.length, 0);
  assert.notEqual(acceptanceStore(o.data, 'shop'), accept, 'a fresh acceptance store');
  assert.equal(acceptanceStore(o.data, 'shop').all().length, 0);
  assert.equal(projectPause('shop'), undefined);
  assert.deepEqual(pacingOf('shop'), DEFAULT_PACING);
  assert.deepEqual(runs.all().map((r) => r.id), ['crm:w2'], 'another project keeps its runs');
  assert.equal(engine.list({ floor: 'shop' }).length, 0);
  assert.deepEqual(removed, ['project-pause-1']);
  // ...and the old ones are in the archive.
  assert.match(readFileSync(path.join(done.archiveDir!, 'analysis-runs.jsonl'), 'utf8'), /"shop:w1"/);
  assert.match(readFileSync(path.join(done.archiveDir!, 'flows.json'), 'utf8'), /project-pause-1/);
  assert.match(readFileSync(path.join(done.archiveDir!, 'office', 'budget', 'shop.json'), 'utf8'), /"full"/);
});

test('who deleted it: the account, else the name this browser goes by, else "An admin"', () => {
  assert.equal(whoOf('Keith', 'Ada'), 'Keith');
  assert.equal(whoOf(undefined, profileBy('Ada')), 'Ada');
  assert.equal(whoOf(undefined, profileBy('Guest')), 'An admin');
  assert.equal(whoOf(undefined, profileBy('  ')), 'An admin');
  assert.equal(whoOf(undefined, profileBy(undefined)), 'An admin');
});
