// Unfinished new-project setups and Cancel & undo (shared/setup-cancel.ts, server/wizard/cancel.ts,
// blockers.ts): against a real job book on the office's workflow engine, Delete project's real service,
// real temporary git repositories in test-office folders and a fake gh (GitHub is never called): what the
// setup made is offered ticked and nothing else is, the typed name must match, the floor, its office data
// and the setup's record go, the folder and the repository go only when ticked (a repository someone
// created by hand never by default), nothing starts while agents are mid-turn or a restart runs, a cancel
// that stopped carries on, and the audit hears it. And Retry says why it would fail before it runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cancelConfirmed, cancelConsequences, cleanCancelRequest, madeBySetup, type CancelJobView, type CancelPlan } from '../src/shared/setup-cancel.js';
import { SETUP_STEPS, type ProjectPlan, type StepId } from '../src/shared/wizard.js';
import { ProjectDeletes } from '../src/server/project-delete/index.js';
import { forgetScopes } from '../src/server/project-delete/repo.js';
import { forgetProject } from '../src/server/project-delete/forget.js';
import type { DeleteDeps, DeleteFloor } from '../src/server/project-delete/types.js';
import { JobBook, newJob, type JobState } from '../src/server/wizard/job.js';
import { SetupCancels, type CancelDeps, type SetupSnapshot } from '../src/server/wizard/cancel.js';
import { setupBlocker } from '../src/server/wizard/blockers.js';
import { removeDir } from './support/cleanup.js';
import { executableOf, ghIsFake } from '../src/server/project-delete/fakegh.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ENV = ['-c', 'user.name=T', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false'];

const PLAN: ProjectPlan = {
  kind: 'new',
  owner: 'acme',
  name: 'shop',
  description: '',
  private: true,
  mendix: '11.12.4',
  entry: 'greenfield',
  tier: 'standard',
  interview: 'steering',
  execApproval: 'auto',
  intake: [],
  clients: [],
  operators: [],
  roles: ['pm'],
  discovery: { issue: true, queue: false, model: 'opus' },
  createdByHand: false,
};

type Steps = Partial<Record<StepId, { status: 'done' | 'skipped' | 'failed' | 'pending'; detail?: string }>>;
const CREATED: Steps = {
  repo: { status: 'done', detail: 'created acme/shop on GitHub (private)' },
  clone: { status: 'done', detail: 'cloned into C:\\projects' },
  env: { status: 'done' },
  app: { status: 'done', detail: 'Shop.mpr' },
  init: { status: 'done' },
  hooks: { status: 'done' },
  intake: { status: 'done' },
  decisions: { status: 'done' },
  settings: { status: 'done' },
  gates: { status: 'done' },
  commit: { status: 'done', detail: 'committed, pushed' },
  issue: { status: 'done', detail: '#1' },
  team: { status: 'failed', detail: 'Couldn’t hire the Project Coordinator: Project paused: no new agents until it’s resumed' },
};

interface World {
  root: string;
  data: string;
  home: string;
  dir: string;
  book: JobBook;
  job: JobState;
  svc: SetupCancels;
  deletes: ProjectDeletes;
  calls: { gh: string[][]; audits: { setup: SetupSnapshot; job: CancelJobView }[]; deleteAudits: number; removedFloor: number };
  onFloors(): boolean;
  set: { busy: string[]; blocked?: string; failDelete: number };
}

/** A test office with one setup that stopped (by default at the team step, with its floor, folder and repository made). */
function world(t: { after(fn: () => void): void }, opts: { steps?: Steps; floor?: boolean; scopes?: string; testMode?: boolean } = {}): World {
  forgetScopes();
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'test-office-cancel-')));
  t.after(() => removeDir(root));
  const data = path.join(root, '.agent-office');
  const home = path.join(root, 'projects');
  const origin = path.join(root, 'origin.git');
  mkdirSync(home, { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const dir = path.join(home, 'acme', 'shop');
  git(root, 'clone', '-q', origin, dir);
  git(dir, 'checkout', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'Shop.mpr'), 'mpr');
  git(dir, 'add', '.');
  git(dir, ...ENV, 'commit', '-q', '-m', 'app');
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  for (const [rel, text] of [
    ['roster/shop.json', '{"team":1}'],
    ['budget/shop.json', '{"ledger":{}}'],
  ]) {
    mkdirSync(path.dirname(path.join(data, rel)), { recursive: true });
    writeFileSync(path.join(data, rel), text);
  }
  const hasFloor = opts.floor !== false;
  const book = new JobBook(path.join(data, 'wizard'));
  const job = newJob(PLAN, 'Keith');
  for (const [id, s] of Object.entries(opts.steps ?? CREATED)) job.steps[id as StepId] = { ...s! };
  job.status = 'failed';
  if (hasFloor) {
    job.floor = 'shop';
    job.dir = dir;
  }
  book.add(job);
  book.engine.get(job.id)!.floor = job.floor;
  book.save(job);
  let onFloors = hasFloor;
  const calls: World['calls'] = { gh: [], audits: [], deleteAudits: 0, removedFloor: 0 };
  const set: World['set'] = { busy: [], failDelete: 0 };
  const floor: DeleteFloor = { id: 'shop', name: 'shop', repo: 'acme/shop', dir, local: false };
  const gh = async (args: string[]) => {
    calls.gh.push(args);
    if (args[0] === 'api' && args[1] === '-i') return `HTTP/2.0 200 OK\nX-Oauth-Scopes: ${opts.scopes ?? 'repo, delete_repo'}\n\n{}`;
    if (args.includes('DELETE')) {
      if (set.failDelete > 0) {
        set.failDelete--;
        throw new Error('HTTP 502: GitHub is having a moment');
      }
      return '';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  const ddeps: DeleteDeps = {
    dataDir: data,
    projectsHome: () => home,
    floor: (id) => (id === 'shop' && onFloors ? floor : undefined),
    agents: () => 0,
    blocked: () => set.blocked,
    stopAgents: async () => 0,
    removeFloor: () => ((onFloors = false), calls.removedFloor++, undefined),
    pin: () => undefined,
    // The office's own: the floor's workflow runs (the setup's among them) go into its archive.
    forget: async (f, archive) => void (await forgetProject(f, archive, { flows: book.engine })),
    retire: () => undefined,
    audit: () => void calls.deleteAudits++,
    announce: () => undefined,
    gh,
    testMode: () => !!opts.testMode,
    ghIsFake: () => true,
    now: () => Date.now(),
  };
  const deletes = new ProjectDeletes(ddeps);
  const cdeps: CancelDeps = {
    dataDir: data,
    projectsHome: () => home,
    setup: (id) => book.get(id),
    running: (id) => book.isRunning(id),
    removeSetup: (id) => book.remove(id),
    defaultDir: (owner, name) => path.join(home, owner, name),
    hasFloor: (id) => id === 'shop' && onFloors,
    busyAgents: () => set.busy,
    blocked: () => set.blocked,
    studioOpen: () => false,
    deletes,
    gh,
    testMode: () => !!opts.testMode,
    ghIsFake: () => true,
    audit: (setup, _by, j) => void calls.audits.push({ setup, job: j }),
    now: () => Date.now(),
  };
  return { root, data, home, dir, book, job, svc: new SetupCancels(cdeps), deletes, calls, onFloors: () => onFloors, set };
}

/** The request the dialog sends with its boxes as it ticks them (what the setup made). */
const asTicked = (p: CancelPlan, confirm = p.confirm) => ({ confirm, deleteFolder: p.folder.deletable && p.folder.createdBySetup, deleteRepo: p.repoDelete.possible && p.repoDelete.createdBySetup });
const deleted = (w: World) => w.calls.gh.filter((a) => a.includes('DELETE')).map((a) => a[a.length - 1]);

test('what the setup made itself, from its steps: offered ticked for that and nothing else', () => {
  const steps = (s: Steps) => SETUP_STEPS.map((x) => ({ id: x.id, status: s[x.id]?.status ?? 'pending', detail: s[x.id]?.detail }));
  assert.deepEqual(madeBySetup(steps(CREATED)), { repo: true, repoByHand: false, offline: false, folder: true });
  // Created by hand, or there already: never the setup's to delete.
  assert.deepEqual(madeBySetup(steps({ repo: { status: 'skipped', detail: 'acme/shop is already on GitHub' }, clone: { status: 'done', detail: 'cloned into C:\\p' } })), { repo: false, repoByHand: true, offline: false, folder: true });
  // A floor already: the folder isn't the setup's either.
  assert.equal(madeBySetup(steps({ clone: { status: 'skipped', detail: 'already a floor (C:\\p)' } })).folder, false);
  // A test office's local bare repository: nothing on GitHub.
  assert.deepEqual(madeBySetup(steps({ repo: { status: 'done', detail: 'offline: a local bare repository at C:\\x' }, clone: { status: 'done', detail: 'offline floor at C:\\p' } })), { repo: false, repoByHand: false, offline: true, folder: true });
  // Failed before it made anything.
  assert.deepEqual(madeBySetup(steps({ repo: { status: 'failed', detail: 'no token' } })), { repo: false, repoByHand: true, offline: false, folder: false });
  // The request: anything odd is the safe choice; the typed name exactly.
  assert.deepEqual(cleanCancelRequest({ confirm: 'acme/shop', deleteFolder: 'yes' }), { confirm: 'acme/shop', deleteFolder: false, deleteRepo: false });
  for (const typed of ['Acme/shop', 'acme/shop ', 'shop', '', undefined]) assert.ok(!cancelConfirmed(typed, 'acme/shop'), String(typed));
  assert.ok(cancelConfirmed('acme/shop', 'acme/shop'));
});

test('Retry says what would stop it before it runs: a paused project (with Resume), a budget pause, a restart, Studio Pro open', () => {
  const at = (s: Steps, floor = 'shop') => ({ steps: s as JobState['steps'], floor });
  const facts = { restart: false, studioOpen: false };
  assert.equal(setupBlocker(at(CREATED), facts), undefined, 'nothing in the way');
  const paused = setupBlocker(at(CREATED), { ...facts, pause: { why: 'person', by: 'Keith' } });
  assert.equal(paused?.kind, 'paused');
  assert.equal(paused?.resume, 'shop', 'Resume wakes the floor');
  assert.match(paused!.text, /paused \(by Keith\): resume it, then Retry/);
  assert.equal(setupBlocker(at(CREATED), { ...facts, pause: { why: 'budget', by: 'the office' } })?.kind, 'budget');
  assert.equal(setupBlocker(at(CREATED), { ...facts, run: 'pause', pause: { why: 'person', by: 'K' } })?.kind, 'pause-run');
  assert.equal(setupBlocker(at(CREATED), { ...facts, restart: true })?.kind, 'restart');
  // A pause only matters while the team is still to be hired or queued.
  const hired: Steps = { ...CREATED, team: { status: 'done' }, queue: { status: 'failed' } };
  assert.equal(setupBlocker(at(hired), { ...facts, pause: { why: 'person', by: 'K' } })?.kind, 'paused');
  assert.equal(setupBlocker(at({ ...hired, queue: { status: 'done' } }), { ...facts, pause: { why: 'person', by: 'K' } }), undefined);
  // Studio Pro open blocks only steps that write in the folder.
  assert.equal(setupBlocker(at({ ...CREATED, commit: { status: 'failed' } }), { ...facts, studioOpen: true })?.kind, 'studio');
  assert.equal(setupBlocker(at(CREATED), { ...facts, studioOpen: true }), undefined);
  // No floor yet: no pause to speak of.
  assert.equal(setupBlocker({ steps: { repo: { status: 'failed' } } as JobState['steps'] }, { ...facts, pause: { why: 'person', by: 'K' } }), undefined);
});

test('Cancel & undo: the plan says what the setup did and offers ticked only what it made; a wrong name changes nothing', async (t) => {
  const w = world(t);
  const p = await w.svc.plan(w.job.id);
  assert.ok(typeof p === 'object', String(p));
  assert.equal(p.confirm, 'acme/shop');
  assert.equal(p.floor, 'shop');
  assert.ok(p.did.some((l) => /Create the GitHub repository: created acme\/shop/.test(l)));
  assert.deepEqual([p.folder.exists, p.folder.createdBySetup, p.folder.deletable], [true, true, true]);
  assert.deepEqual([p.repoDelete.createdBySetup, p.repoDelete.byHand, p.repoDelete.possible], [true, false, true]);
  assert.equal(p.mendix.mpr, true, 'the .mpr goes with the folder');
  assert.ok(cancelConsequences(p, asTicked(p)).some((l) => /Mendix Portal \/ Team Server app is never deleted/.test(l)));
  const r = await w.svc.start(w.job.id, { ...asTicked(p), confirm: 'acme/Shop' }, { name: 'Keith' });
  assert.match(String(r), /type acme\/shop exactly/);
  assert.ok(w.onFloors() && existsSync(w.dir) && w.book.get(w.job.id), 'nothing changed');
  assert.deepEqual(deleted(w), []);
});

test('Cancel & undo with the boxes as offered: floor, office data, setup record, folder and the repository the setup created all go, and the audit hears it', async (t) => {
  const w = world(t);
  const p = (await w.svc.plan(w.job.id)) as CancelPlan;
  const r = await w.svc.start(w.job.id, asTicked(p), { name: 'Keith' });
  assert.ok(typeof r === 'object', String(r));
  await w.svc.settled(w.job.id);
  const j = await w.svc.job(w.job.id);
  assert.equal(j?.status, 'done', JSON.stringify(j));
  assert.equal(w.onFloors(), false, 'off floors.json');
  assert.equal(w.calls.removedFloor, 1);
  assert.equal(existsSync(path.join(w.data, 'roster', 'shop.json')), false, 'office data removed');
  const archives = readdirSync(path.join(w.data, 'deleted')).filter((n) => n.startsWith('shop-'));
  assert.equal(archives.length, 1, 'archived first');
  assert.ok(existsSync(path.join(w.data, 'deleted', archives[0], 'flows.json')), "the setup's record went into the archive with the floor's runs");
  assert.equal(w.book.get(w.job.id), undefined, 'the setup is gone: New project no longer lists it');
  assert.equal(new JobBook(path.join(w.data, 'wizard')).get(w.job.id), undefined, 'and not back after a restart');
  assert.equal(existsSync(w.dir), false, 'the folder the setup cloned is deleted');
  assert.deepEqual(deleted(w), ['repos/acme/shop'], 'the repository the setup created is deleted');
  assert.equal(w.calls.audits.length, 1);
  assert.equal(w.calls.audits[0].setup.repo, 'acme/shop');
  assert.ok(w.calls.audits[0].job.deleteFolder && w.calls.audits[0].job.deleteRepo);
  assert.equal(w.calls.deleteAudits, 1, 'Delete project recorded project.delete too');
  assert.deepEqual(await w.svc.unfinished(), [], 'nothing left unfinished');
  assert.ok(readdirSync(path.join(w.data, 'deleted', 'setup-cancels', 'done')).length === 1, 'what was undone is kept');
});

test('a repository someone created by hand is not deleted by default, and the folder only when ticked', async (t) => {
  const w = world(t, { steps: { ...CREATED, repo: { status: 'skipped', detail: 'acme/shop is already on GitHub' } } });
  const p = (await w.svc.plan(w.job.id)) as CancelPlan;
  assert.equal(p.repoDelete.createdBySetup, false);
  assert.equal(p.repoDelete.byHand, true);
  assert.equal(asTicked(p).deleteRepo, false, 'left unticked');
  await w.svc.start(w.job.id, { ...asTicked(p), deleteFolder: false }, { name: 'Keith' });
  await w.svc.settled(w.job.id);
  assert.equal((await w.svc.job(w.job.id))?.status, 'done');
  assert.deepEqual(deleted(w), [], 'GitHub untouched');
  assert.ok(existsSync(w.dir), 'the folder kept (unticked)');
  assert.equal(w.onFloors(), false);
  assert.equal(w.book.get(w.job.id), undefined);
});

test('a setup that never made a floor: its repository (made by it) deleted here, the folder it never cloned left alone', async (t) => {
  const w = world(t, { floor: false, steps: { repo: { status: 'done', detail: 'created acme/shop on GitHub (private)' }, clone: { status: 'failed', detail: 'gh repo clone failed' } } });
  const p = (await w.svc.plan(w.job.id)) as CancelPlan;
  assert.equal(p.floor, undefined);
  assert.equal(p.folder.createdBySetup, false, 'its clone failed: the folder isn’t its own');
  assert.equal(asTicked(p).deleteFolder, false);
  await w.svc.start(w.job.id, asTicked(p), { name: 'Keith' });
  await w.svc.settled(w.job.id);
  const j = await w.svc.job(w.job.id);
  assert.equal(j?.status, 'done', JSON.stringify(j));
  assert.equal(j?.steps.find((s) => s.id === 'project')?.status, 'skipped');
  assert.deepEqual(deleted(w), ['repos/acme/shop']);
  assert.ok(existsSync(w.dir));
  assert.equal(w.book.get(w.job.id), undefined);
});

test('nothing starts while agents are mid-turn, the setup runs, or a restart is under way; and test mode never deletes a real repository', async (t) => {
  const w = world(t);
  const p = (await w.svc.plan(w.job.id)) as CancelPlan;
  w.set.busy = ['Ada'];
  assert.match(String(await w.svc.start(w.job.id, asTicked(p), { name: 'K' })), /Ada is mid-turn/);
  assert.match((await w.svc.plan(w.job.id) as CancelPlan).blocked ?? '', /mid-turn/);
  w.set.busy = [];
  w.set.blocked = 'A safe restart is under way: cancel the setup once the office is back';
  assert.match(String(await w.svc.start(w.job.id, asTicked(p), { name: 'K' })), /safe restart/);
  w.set.blocked = undefined;
  assert.ok(w.onFloors() && w.book.get(w.job.id), 'nothing changed');
  const tm = world(t, { testMode: true });
  const p2 = (await tm.svc.plan(tm.job.id)) as CancelPlan;
  assert.equal(p2.repoDelete.possible, true, 'with the tests’ fake gh');
  const noScope = world(t, { scopes: 'repo' });
  const p3 = (await noScope.svc.plan(noScope.job.id)) as CancelPlan;
  assert.equal(p3.repoDelete.possible, false);
  assert.match(p3.repoDelete.settingsUrl ?? '', /github\.com\/acme\/shop\/settings/);
  assert.match(String(await noScope.svc.start(noScope.job.id, { confirm: 'acme/shop', deleteFolder: false, deleteRepo: true }, { name: 'K' })), /can’t be deleted/);
});

test('a cancel that stops part way (GitHub down) is listed and carries on where it stopped', async (t) => {
  const w = world(t);
  w.set.failDelete = 1;
  const p = (await w.svc.plan(w.job.id)) as CancelPlan;
  await w.svc.start(w.job.id, asTicked(p), { name: 'Keith' });
  await w.svc.settled(w.job.id);
  const first = await w.svc.job(w.job.id);
  assert.equal(first?.status, 'failed');
  assert.match(first?.error ?? '', /GitHub is having a moment|502/);
  const listed = await w.svc.unfinished();
  assert.equal(listed.length, 1, 'shown as a card');
  assert.equal((await w.svc.plan(w.job.id) as CancelPlan).unfinished?.status, 'failed');
  // Asked again with the same name: it carries on.
  await w.svc.start(w.job.id, { confirm: 'acme/shop', deleteFolder: true, deleteRepo: true }, { name: 'Keith' });
  await w.svc.settled(w.job.id);
  assert.equal((await w.svc.job(w.job.id))?.status, 'done');
  assert.deepEqual(deleted(w), ['repos/acme/shop', 'repos/acme/shop'], 'tried, then done');
  assert.equal(w.onFloors(), false);
  assert.equal(existsSync(w.dir), false);
  assert.deepEqual(await w.svc.unfinished(), []);
  assert.equal(w.calls.audits.length, 1);
});

test('✨ New project opens a fresh wizard: unfinished setups are cards above its first page and on Home, never taking it over', () => {
  const src = (p: string) => readFileSync(path.join(import.meta.dirname, '..', p), 'utf8');
  const wizard = src('src/client/ui/wizard/index.ts');
  assert.doesNotMatch(wizard, /info\.jobs\[0\]/, 'no setup reopened by itself');
  assert.match(wizard, /unfinishedSection\(/);
  assert.match(src('src/client/home/projects.ts'), /unfinishedSection\(/);
  assert.match(src('src/client/home/portal.ts'), /deps\.unfinished/);
  const cards = src('src/client/ui/wizard/unfinished.ts');
  for (const label of ['Retry', 'Cancel & undo…', 'Open project', 'Resume project']) assert.ok(cards.includes(`'${label}'`), label);
});

test('test mode only lets a fake gh delete: the gh execFile really starts, never a .cmd shim ahead of a real gh.exe', (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gh-lookup-')));
  t.after(() => removeDir(root));
  const fake = path.join(root, 'test-office-x', 'bin');
  const real = path.join(root, 'Program Files', 'GitHub CLI');
  mkdirSync(fake, { recursive: true });
  mkdirSync(real, { recursive: true });
  writeFileSync(path.join(fake, 'gh.cmd'), '@echo off\r\n');
  writeFileSync(path.join(real, 'gh.exe'), '');
  const env = { PATH: [fake, real].join(';') };
  // A .cmd shim never runs from execFile('gh'): the real gh.exe does, so it isn't a fake.
  assert.equal(executableOf('gh', env, 'win32'), path.join(real, 'gh.exe'));
  assert.equal(ghIsFake(env, 'win32'), false);
  writeFileSync(path.join(fake, 'gh.exe'), '');
  assert.equal(executableOf('gh', env, 'win32'), path.join(fake, 'gh.exe'));
  assert.equal(ghIsFake(env, 'win32'), true);
  assert.equal(ghIsFake({ PATH: '' }, 'win32'), false, 'no gh at all is no fake');
});
