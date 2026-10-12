// What a new-project setup records about what it made (shared/setup-provenance.ts) and how it asks
// GitHub (server/wizard/repo-lookup.ts): the repo step creates a repository only when GitHub says plainly
// it isn't there (a timeout, a login that doesn't work, a 403 or GitHub down stops the step with "Couldn't
// check"), records GitHub's id for what it created, and records a repository that was there already as
// pre-existing, never its own; the clone step records the folder it cloned, and a folder already there as
// pre-existing. The record is versioned and survives a restart. Fakes only: gh is a function, never run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETUP_STEPS, type ProjectPlan, type StepId } from '../src/shared/wizard.js';
import { JobBook, newJob, type JobState, type StepImpl, type StepIO } from '../src/server/wizard/job.js';
import { setupSteps, type SetupDeps } from '../src/server/wizard/steps.js';
import type { WizardConfig } from '../src/server/wizard/config.js';
import type { RunOptions, RunResult } from '../src/server/wizard/run.js';
import { classifyLookupFailure, lookupWithGh } from '../src/server/wizard/repo-lookup.js';
import { PROVENANCE_VERSION, readProvenance, repoProof, withProvenance } from '../src/shared/setup-provenance.js';
import { removeDir } from './support/cleanup.js';

const PLAN: ProjectPlan = {
  kind: 'new',
  owner: 'Test-Org',
  name: 'demo-app',
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
const REPO = 'Test-Org/demo-app';
const NOT_THERE = `GraphQL: Could not resolve to a Repository with the name '${REPO}'. (repository)`;
const io: StepIO = { log: () => undefined };

type Answer = Partial<RunResult> | Error;
/** A fake runCommand: each gh call takes the next answer for its subcommand (`view` or `create`), and is recorded. */
function fakeGh(answers: { view: Answer[]; create?: Answer[] }) {
  const calls: string[][] = [];
  const run = async (cmd: string, args: string[], _opts: RunOptions): Promise<RunResult> => {
    assert.equal(cmd, 'gh');
    calls.push(args);
    const list = args[1] === 'create' ? (answers.create ?? []) : answers.view;
    const a = list.length > 1 ? list.shift()! : list[0];
    if (!a) throw new Error(`unexpected gh ${args.join(' ')}`);
    if (a instanceof Error) throw a;
    return { code: 0, tail: [], stdout: '', ...a };
  };
  return { run, calls, created: () => calls.filter((c) => c[1] === 'create').length };
}

function setup(t: { after(fn: () => void): void }, run: SetupDeps['run'], over: Partial<SetupDeps> = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'test-office-ownership-')));
  t.after(() => removeDir(root));
  const tokenFile = path.join(root, 'admin-token');
  writeFileSync(tokenFile, 'github_pat_FAKEADMIN0123456789\n');
  const projects = path.join(root, 'projects');
  mkdirSync(projects);
  const cfg: WizardConfig = { toolkitDir: root, bash: 'bash', mendixDir: root, org: 'Test-Org', adminTokenFile: tokenFile };
  const deps: SetupDeps = {
    cfg,
    env: { PATH: process.env.PATH },
    run,
    projectsDir: () => projects,
    floorOf: () => undefined,
    addFloor: async () => 'unused',
    adoptFloor: () => 'unused',
    queue: () => undefined,
    hired: () => false,
    known: () => false,
    hire: async () => 'unused',
    ...over,
  };
  return { root, projects, steps: setupSteps(deps) };
}

test('a failed lookup is "not found" only when gh says so plainly; a timeout, the login, a 403, GitHub down or silence is unknown', () => {
  assert.equal(classifyLookupFailure(NOT_THERE, REPO).state, 'not-found');
  assert.equal(classifyLookupFailure('HTTP 404: Not Found (https://api.github.com/repos/Test-Org/demo-app)', REPO).state, 'not-found');
  assert.equal(classifyLookupFailure("gh can't find this repository on GitHub (check the remote and access)", REPO).state, 'not-found', "github.ts's friendly line for it");
  // The repository's own name says nothing: acme/network-tools that isn't there is still not found.
  assert.equal(classifyLookupFailure("GraphQL: Could not resolve to a Repository with the name 'acme/network-timeout-tls'.", 'acme/network-timeout-tls').state, 'not-found');
  for (const said of [
    'HTTP 401: Bad credentials (https://api.github.com/graphql)',
    'To get started with GitHub CLI, please run:  gh auth login',
    "gh isn't signed in to GitHub on the office's machine — run `gh auth login` there",
    'HTTP 403: Must have admin rights to Repository.',
    'HTTP 403: Resource not accessible by integration; HTTP 404 Not Found',
    'HTTP 502: Bad Gateway',
    'HTTP 429: rate limit exceeded',
    'gh repo took longer than 60s and was stopped',
    'error connecting to api.github.com: dial tcp: lookup api.github.com: no such host ENOTFOUND',
    'Command failed: gh repo view Test-Org/demo-app --json id,nameWithOwner',
    '',
  ])
    assert.equal(classifyLookupFailure(said, REPO).state, 'unknown', said);
});

test('O3: a lookup that times out, a login that fails or a 403 never creates the repository: the step stops with "Couldn\'t check"', async (t) => {
  const cases: [string, Answer][] = [
    ['timeout', new Error('gh repo took longer than 60s and was stopped')],
    ['auth', { code: 1, tail: ['HTTP 401: Bad credentials (https://api.github.com/graphql)', 'Try authenticating with:  gh auth login'] }],
    ['403', { code: 1, tail: ['HTTP 403: Must have admin rights to Repository. (https://api.github.com/graphql)'] }],
    ['service', { code: 1, tail: ['HTTP 503: Service Unavailable'] }],
    ['silent', { code: 1, tail: [] }],
    ['killed', { code: null, tail: [] }],
  ];
  for (const [name, answer] of cases) {
    const gh = fakeGh({ view: [answer], create: [{ code: 0 }] });
    const { steps } = setup(t, gh.run);
    const job = newJob(PLAN, 'Probe');
    await assert.rejects(steps.repo(job, io), (err: Error) => {
      assert.match(err.message, /^Couldn't check whether Test-Org\/demo-app exists on GitHub: .+\. Check the office's GitHub login in 🔌 Connections, then Retry$/, name);
      return true;
    });
    assert.equal(gh.created(), 0, `${name}: no gh repo create`);
    assert.equal(job.provenance, undefined, `${name}: nothing recorded`);
  }
  // "I created it myself" with a lookup that couldn't tell says the same, not "couldn't find it".
  const gh = fakeGh({ view: [{ code: 1, tail: ['HTTP 401: Bad credentials'] }] });
  await assert.rejects(setup(t, gh.run).steps.repo(newJob({ ...PLAN, createdByHand: true }, 'Probe'), io), /Couldn't check whether/);
});

test('a repository GitHub says isn\'t there is created, and the setup records it made it, with GitHub\'s id, in a versioned record that survives a restart', async (t) => {
  const gh = fakeGh({ view: [{ code: 1, tail: [NOT_THERE] }, { code: 0, stdout: JSON.stringify({ id: 'R_kgDOnew', nameWithOwner: REPO }) }], create: [{ code: 0 }] });
  const { root, steps } = setup(t, gh.run);
  const book = new JobBook(path.join(root, 'jobs'));
  const job = newJob(PLAN, 'Probe');
  book.add(job);
  const only = Object.fromEntries(SETUP_STEPS.map((s) => [s.id, s.id === 'repo' ? steps.repo : async () => ({ status: 'skipped' as const })])) as Record<StepId, StepImpl>;
  await book.run(job, only);
  assert.equal(job.steps.repo.status, 'done', job.steps.repo.detail);
  assert.equal(gh.created(), 1);
  assert.deepEqual(gh.calls[0], ['repo', 'view', REPO, '--json', 'id,nameWithOwner,createdAt']);
  assert.equal(job.provenance?.v, PROVENANCE_VERSION);
  assert.deepEqual({ ...job.provenance?.repo, at: 0 }, { createdBySetup: true, nameWithOwner: REPO, githubId: 'R_kgDOnew', at: 0 });
  const again = new JobBook(path.join(root, 'jobs')).get(job.id) as JobState;
  assert.deepEqual(again.provenance, job.provenance, 'kept in the setup’s record on disk');
  assert.deepEqual(repoProof(readProvenance(again.provenance), REPO, true), { proof: 'recorded', githubId: 'R_kgDOnew' });
});

test('O2: a repository already on GitHub is recorded as pre-existing, never the setup\'s; a Retry keeps the setup\'s own only for the same id', async (t) => {
  const there = fakeGh({ view: [{ code: 0, stdout: JSON.stringify({ id: 'R_kgDOold', nameWithOwner: REPO }) }] });
  const job = newJob(PLAN, 'Probe');
  const r = await setup(t, there.run).steps.repo(job, io);
  assert.equal(r.status, 'skipped');
  assert.equal(there.created(), 0);
  assert.deepEqual({ ...r.provenance?.repo, at: 0 }, { createdBySetup: false, preExisting: true, nameWithOwner: REPO, githubId: 'R_kgDOold', at: 0 });
  assert.equal(repoProof(withProvenance(undefined, r.provenance!), REPO, false).proof, 'pre-existing');
  // The setup made it on an earlier try: found again with the same id, it stays the setup's; another id at that name isn't.
  job.provenance = { v: PROVENANCE_VERSION, repo: { createdBySetup: true, nameWithOwner: REPO, githubId: 'R_kgDOmine', at: 1 } };
  const same = await setup(t, fakeGh({ view: [{ code: 0, stdout: JSON.stringify({ id: 'R_kgDOmine', nameWithOwner: REPO }) }] }).run).steps.repo(job, io);
  assert.equal(same.provenance?.repo?.createdBySetup, true);
  const other = await setup(t, fakeGh({ view: [{ code: 0, stdout: JSON.stringify({ id: 'R_kgDOswapped', nameWithOwner: REPO }) }] }).run).steps.repo(job, io);
  assert.deepEqual([other.provenance?.repo?.createdBySetup, other.provenance?.repo?.preExisting, other.provenance?.repo?.githubId], [false, true, 'R_kgDOswapped']);
});

test('a repository created but whose id GitHub didn\'t give is the setup\'s with no id: Cancel & undo won\'t delete it', async (t) => {
  const gh = fakeGh({ view: [{ code: 1, tail: [NOT_THERE] }, { code: 1, tail: ['HTTP 502: Bad Gateway'] }], create: [{ code: 0 }] });
  const lines: string[] = [];
  const r = await setup(t, gh.run).steps.repo(newJob(PLAN, 'Probe'), { log: (l) => lines.push(l) });
  assert.equal(r.status, 'done');
  assert.equal(r.provenance?.repo?.createdBySetup, true);
  assert.equal(r.provenance?.repo?.githubId, undefined);
  assert.ok(lines.some((l) => /couldn't read GitHub's id/.test(l)));
  assert.equal(repoProof(withProvenance(undefined, r.provenance!), REPO, true).proof, 'no-id');
});

test('the clone step records the folder it cloned as the setup\'s, and one already there (or a floor already) as pre-existing', async (t) => {
  const git = (cwd: string) => execFileSync('git', ['init', '-q'], { cwd, stdio: 'ignore' });
  const mk = (projects: string) => async () => {
    const dir = path.join(projects, 'Test-Org', 'demo-app');
    mkdirSync(dir, { recursive: true });
    git(dir);
    return { id: 'demo-app', dir };
  };
  // Cloned now: the setup's, at its real path.
  const a = setup(t, undefined);
  const ja = newJob(PLAN, 'Probe');
  const ra = await setupSteps({ ...depsOf(a.projects), addFloor: mk(a.projects) }).clone(ja, io);
  assert.equal(ra.status, 'done');
  assert.equal(ja.provenance?.folder?.createdBySetup, true);
  assert.equal(ja.provenance?.folder?.path, realpathSync(path.join(a.projects, 'Test-Org', 'demo-app')));
  // There before the clone step (the building moves into it): never the setup's.
  const b = setup(t, undefined);
  mkdirSync(path.join(b.projects, 'Test-Org', 'demo-app'), { recursive: true });
  const jb = newJob(PLAN, 'Probe');
  await setupSteps({ ...depsOf(b.projects), addFloor: mk(b.projects) }).clone(jb, io);
  assert.deepEqual([jb.provenance?.folder?.createdBySetup, jb.provenance?.folder?.preExisting], [false, true]);
  // A floor already.
  const c = setup(t, undefined);
  const dir = path.join(c.projects, 'Test-Org', 'demo-app');
  mkdirSync(dir, { recursive: true });
  git(dir);
  const jc = newJob(PLAN, 'Probe');
  const rc = await setupSteps({ ...depsOf(c.projects), floorOf: () => ({ id: 'demo-app', dir }) }).clone(jc, io);
  assert.equal(rc.status, 'skipped');
  assert.deepEqual([jc.provenance?.folder?.createdBySetup, jc.provenance?.folder?.preExisting], [false, true]);
  assert.ok(existsSync(dir));
});

test('Cancel & undo\'s lookup through the office\'s gh: found with the id, not found, or unknown', async () => {
  assert.deepEqual(await lookupWithGh(async () => JSON.stringify({ id: 'R_1', nameWithOwner: REPO }), REPO), { state: 'found', nameWithOwner: REPO, githubId: 'R_1' });
  assert.deepEqual(await lookupWithGh(async () => Promise.reject(new Error(NOT_THERE)), REPO), { state: 'not-found' });
  assert.equal((await lookupWithGh(async () => Promise.reject(new Error('HTTP 403: Forbidden')), REPO)).state, 'unknown');
  // A record of another version, or garbage, is no record.
  assert.equal(readProvenance({ v: 2, repo: { createdBySetup: true, nameWithOwner: REPO, githubId: 'R_1', at: 1 } }), undefined);
  assert.equal(readProvenance('created'), undefined);
});

function depsOf(projects: string): SetupDeps {
  return {
    cfg: { toolkitDir: projects, bash: 'bash', mendixDir: projects, org: 'Test-Org', adminTokenFile: path.join(projects, 'none') },
    env: { PATH: process.env.PATH },
    projectsDir: () => projects,
    floorOf: () => undefined,
    addFloor: async () => 'unused',
    adoptFloor: () => 'unused',
    queue: () => undefined,
    hired: () => false,
    known: () => false,
    hire: async () => 'unused',
  };
}
