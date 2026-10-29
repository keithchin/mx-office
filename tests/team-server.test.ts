// Mendix Team Server (shared/team-server.ts, server/team-server/, wizard/team-server-step.ts) against a fake Portal and
// a fake Team Server on 127.0.0.1 (support/fake-teamserver.ts): never the real Mendix API. Covers the Projects API's
// create and job (statuses, refusals in words), the New project setup on Team Server (the app made once, its history
// adopted, main pushed and checked), the token kept out of .git/config, URLs, process arguments, logs and the audit
// log, the sync both ways and when both moved, and Connect to Team Server for an existing local-only project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeTeamServer, type FakeTeamServer } from './support/fake-teamserver.js';
import { createProject, waitForProject, PortalRefusal } from '../src/server/team-server/api.js';
import { HELPER, teamServerGitEnv, tsGit } from '../src/server/team-server/git.js';
import { syncMain } from '../src/server/team-server/sync.js';
import { forgetTeamServer, teamServerAt } from '../src/server/team-server/project.js';
import { TeamServerOffice } from '../src/server/team-server/index.js';
import { cleanProjectId, defaultRepoHome, homeOf, planFor, portalAppName, portalSummary, repoHomeBlocked, teamServerUrl } from '../src/shared/team-server.js';
import { newJob, type JobState } from '../src/server/wizard/job.js';
import type { WizardConfig } from '../src/server/wizard/config.js';
import { runCommand, type RunOptions } from '../src/server/wizard/run.js';
import { setupSteps, type SetupDeps } from '../src/server/wizard/steps.js';
import { cleanPlan } from '../src/server/wizard/plan.js';
import { localBareOf } from '../src/server/wizard/local-only.js';
import { forgetLocalOnly } from '../src/server/local-only.js';
import { useAudit } from '../src/server/audit/index.js';
import type { AuditInput } from '../src/shared/audit.js';
import { discoveryPlan } from './support/discovery-plans.js';

const TOKENS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'MENDIX_PAT', 'MENDIX_TOKEN', 'MX_PAT'];
const ID = { GIT_AUTHOR_NAME: 'Probe', GIT_AUTHOR_EMAIL: 'probe@localhost', GIT_COMMITTER_NAME: 'Probe', GIT_COMMITTER_EMAIL: 'probe@localhost' };
const tmp = (n: string) => mkdtempSync(path.join(os.tmpdir(), `ts-${n}-`));
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...ID } }).trim();
const quick = async () => undefined;

/** The environment every git here runs with: no tokens of the machine, no prompts. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...ID, GIT_TERMINAL_PROMPT: '0' };
  for (const k of TOKENS) delete env[k];
  return env;
}

/** A runner that records every command's arguments (and checks the token never is one). */
function recorder() {
  const calls: { cmd: string; args: string[]; env?: Record<string, string | undefined> }[] = [];
  const run = (cmd: string, args: string[], o: RunOptions) => {
    calls.push({ cmd, args, env: o.env });
    return runCommand(cmd, args, o);
  };
  return { calls, run: run as typeof runCommand };
}

function audited() {
  const events: AuditInput[] = [];
  useAudit({ append: (e: AuditInput) => (events.push(e), { ...e, id: String(events.length), at: Date.now(), prev: '', hash: '' }) } as never);
  return { events, stop: () => useAudit(undefined) };
}

/** Nothing anywhere holds the token: the recorded arguments, the log, the git configs, the URLs asked, the audit log. */
function assertNoToken(fake: FakeTeamServer, where: { calls?: { args: string[] }[]; lines?: string[]; dirs?: string[]; events?: AuditInput[] }) {
  const t = fake.token;
  for (const c of where.calls ?? []) assert.ok(!c.args.some((a) => a.includes(t)), `the token in a command's arguments: git ${c.args.join(' ')}`);
  for (const l of where.lines ?? []) assert.ok(!l.includes(t), `the token in a log line: ${l}`);
  for (const d of where.dirs ?? []) {
    const cfg = path.join(d, '.git', 'config');
    const file = existsSync(cfg) ? cfg : path.join(d, 'config');
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes(t), `the token in ${file}`);
    assert.doesNotMatch(text, /https?:\/\/[^/\s]*@/, `a URL with credentials in ${file}`);
  }
  for (const r of fake.requests) assert.ok(!r.url.includes(t), `the token in a URL asked: ${r.url}`);
  for (const e of where.events ?? []) assert.ok(!JSON.stringify(e).includes(t), `the token in the audit log: ${e.summary}`);
}

test('the words and rules: app names and summaries the Projects API takes, ids, URLs, the four choices and their default', () => {
  assert.equal(portalAppName('visitor-desk'), 'visitor-desk');
  assert.equal(portalAppName('Sales.Portal v2!'), 'Sales Portal v2');
  assert.equal(portalAppName('...'), undefined);
  assert.equal(portalSummary('A desk: for visitors (front office), 24/7!'), 'A desk for visitors front office 24 7');
  assert.equal(cleanProjectId(' {1A2B3C4D-1111-2222-3333-444455556666} '), '1a2b3c4d-1111-2222-3333-444455556666');
  assert.equal(cleanProjectId('not-an-id'), undefined);
  assert.equal(teamServerUrl('abc'), 'https://git.api.mendix.com/abc.git');
  const a = { mendixToken: true, githubToken: true, offline: false };
  assert.equal(defaultRepoHome(a), 'teamserver', 'a Mendix token: Team Server by default');
  assert.equal(defaultRepoHome({ ...a, mendixToken: false }), 'github', 'none: GitHub, as before');
  assert.match(repoHomeBlocked('teamserver', { ...a, mendixToken: false })!, /No Mendix token/);
  assert.match(repoHomeBlocked('teamserver-github', { ...a, githubToken: false })!, /GitHub admin token/);
  assert.equal(repoHomeBlocked('local', { mendixToken: false, githubToken: false, offline: false }), undefined, 'Local only always works');
  for (const h of ['teamserver', 'teamserver-github', 'github', 'local'] as const) assert.equal(homeOf(planFor(h)), h);
  assert.deepEqual(planFor('teamserver'), { localOnly: true, teamServer: { mirror: false } }, 'Team Server alone is local only too');
});

test('the plan: Team Server is a new project only; alone it is local only, with the mirror it is on GitHub; GitHub and local plans are unchanged', () => {
  const base = { kind: 'new', owner: 'Test-Org', name: 'visitor-desk', mendix: '11.12.4', entry: 'greenfield', roles: [] };
  const ts = cleanPlan({ ...base, teamServer: { mirror: false } }, ['11.12.4'], 'Test-Org');
  assert.ok(typeof ts !== 'string');
  assert.deepEqual(ts.teamServer, { mirror: false });
  assert.equal(ts.localOnly, true);
  const mirror = cleanPlan({ ...base, localOnly: true, teamServer: { mirror: true, projectId: '1A2B3C4D-1111-2222-3333-444455556666' } }, ['11.12.4'], 'Test-Org');
  assert.ok(typeof mirror !== 'string');
  assert.deepEqual(mirror.teamServer, { mirror: true, projectId: '1a2b3c4d-1111-2222-3333-444455556666' });
  assert.ok(!mirror.localOnly, 'a mirror is on GitHub');
  const gh = cleanPlan(base, ['11.12.4'], 'Test-Org');
  assert.ok(typeof gh !== 'string' && !gh.teamServer && !gh.localOnly);
  const local = cleanPlan({ ...base, localOnly: true }, ['11.12.4'], 'Test-Org');
  assert.ok(typeof local !== 'string' && local.localOnly === true && !local.teamServer);
  const change = cleanPlan({ ...base, kind: 'change', teamServer: { mirror: false } }, ['11.12.4'], 'Test-Org');
  assert.ok(typeof change !== 'string' && !change.teamServer, 'never for an existing repository');
});

test('the credential helper: the token only in that git child’s environment, git’s own helpers reset, no prompts', () => {
  const env = teamServerGitEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'false', GIT_ASKPASS: 'askpass.exe' }, 'secret-token-123456', 'https://git.api.mendix.com');
  assert.equal(env.GIT_CONFIG_COUNT, '8');
  assert.equal(env.GIT_CONFIG_KEY_0, 'core.autocrlf', 'what was there stays');
  assert.equal(env.GIT_CONFIG_KEY_1, 'credential.helper');
  assert.equal(env.GIT_CONFIG_VALUE_1, '', 'git’s credential manager neither answers nor stores');
  assert.equal(env.GIT_CONFIG_KEY_2, 'credential.https://git.api.mendix.com.helper');
  assert.equal(env.GIT_CONFIG_VALUE_2, HELPER);
  assert.ok(!HELPER.includes('secret-token'), 'the helper’s text holds no secret');
  assert.equal(env.MX_OFFICE_TEAMSERVER_TOKEN, 'secret-token-123456');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_ASKPASS, undefined);
  const keys = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]));
  assert.ok(keys['core.hooksPath'] && !existsSync(keys['core.hooksPath']!), 'no hook of the repository runs where the token is');
  assert.equal(keys['core.fsmonitor'], 'false');
  assert.equal(keys['push.gpgSign'], 'false');
});

test('a hook planted in the project (its .git is shared with the agents’ worktrees) never sees the token while the office pushes to Team Server', async (t) => {
  const fake = await fakeTeamServer();
  const root = tmp('hooks');
  t.after(async () => (await fake.close(), rmSync(root, { recursive: true, force: true })));
  const id = fake.makeApp();
  const p = project(root, 'hooked', { 'App.mpr': 'model\n' });
  const proof = path.join(root, 'hook-ran.txt');
  for (const hook of ['pre-push', 'reference-transaction']) {
    writeFileSync(path.join(p.dir, '.git', 'hooks', hook), `#!/bin/sh\necho "ran: $MX_OFFICE_TEAMSERVER_TOKEN" >> "${proof.replace(/\\/g, '/')}"\nexit 0\n`);
  }
  const g = tsGit({ token: fake.token, env: cleanEnv(), git: fake.url });
  const record = { projectId: id, url: `${fake.url}/${id}.git`, remote: 'teamserver', how: 'linked' as const, by: 'Probe', at: 1 };
  git(p.dir, 'remote', 'add', 'teamserver', record.url);
  await syncMain({ g, dir: p.dir, rec: record });
  const env = { ...process.env, ...ID };
  const adopt = execFileSync('git', ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-p', fake.head(id), '-m', 'adopt'], { cwd: p.dir, encoding: 'utf8', env }).trim();
  git(p.dir, 'push', '-q', 'origin', `${adopt}:refs/heads/main`);
  // The hooks do run for the test's own git (no token there): proof that they're live.
  assert.ok(existsSync(proof) && !readFileSync(proof, 'utf8').includes(fake.token), 'the planted hooks are live for a plain git');
  rmSync(proof, { force: true });
  const s = await syncMain({ g, dir: p.dir, rec: record });
  assert.equal(s.state, 'pushed', s.message);
  // Local commands (no token in their environment) may run them as any git does; never one that holds the token.
  assert.ok(!existsSync(proof) || !readFileSync(proof, 'utf8').includes(fake.token), 'the planted hooks never ran with the token');
  assert.equal(fake.head(id), adopt, 'and the push went');
});

test('the Projects API: create, the job followed to the app’s id, and every refusal in words', async (t) => {
  const fake = await fakeTeamServer();
  t.after(() => fake.close());
  const api = { token: fake.token, endpoints: fake.endpoints, sleep: quick };
  const jobId = await createProject(api, { name: 'visitor-desk', summary: 'For visitors' });
  assert.deepEqual(fake.creates.at(-1), { name: 'visitor-desk', summary: 'For visitors' });
  assert.equal(fake.requests.at(-1)!.auth, `MxToken ${fake.token}`, 'the PAT as the MxToken header');
  const said: string[] = [];
  const id = await waitForProject(api, jobId, (l) => said.push(l));
  assert.ok(cleanProjectId(id));
  assert.deepEqual(said, ["Mendix Portal: the app's creation is scheduled…", "Mendix Portal: the app's creation is running…"]);
  assert.ok(fake.head(id), 'its Team Server repository is there');

  const refused = async (status: number, detail: string) => {
    fake.refuse = { status, body: { error: { message: 'x', detail, code: status } } };
    try {
      await createProject(api, { name: 'visitor-desk' });
      assert.fail('should refuse');
    } catch (err) {
      assert.ok(err instanceof PortalRefusal, `${status} is a refusal the person acts on`);
      return (err as Error).message;
    } finally {
      fake.refuse = undefined;
    }
  };
  assert.match(await refused(403, 'Token does not have the required scope'), /missing the mx:app:create scope/);
  assert.match(await refused(403, 'Your company policy does not allow creating apps'), /company’s Mendix settings don’t allow/);
  assert.match(await refused(409, 'An app with this name already exists'), /app name is taken/);
  assert.match(await refused(400, 'Name is invalid'), /didn’t accept the app’s details/);
  await assert.rejects(createProject({ ...api, token: 'wrong-token-000000' }, { name: 'x' }), /refused \(401/);

  fake.failJob = 'The app limit of your company is reached';
  const failing = await createProject(api, { name: 'visitor-desk' });
  await assert.rejects(waitForProject(api, failing), /couldn’t create the app: The app limit/);
  fake.failJob = undefined;

  fake.steps = Array(50).fill('running');
  let clock = 0;
  const slow = await createProject(api, { name: 'visitor-desk' });
  await assert.rejects(waitForProject({ ...api, now: () => (clock += 60_000) }, slow, undefined, 5 * 60_000), /still creating the app after 5 minutes/);
  assertNoToken(fake, {});
});

/** The setup's deps for a Team Server project, recording git's arguments, against the fake. */
function setupFor(fake: FakeTeamServer, root: string) {
  const projects = path.join(root, 'projects');
  const cfg: WizardConfig = { toolkitDir: path.join(root, 'toolkit'), bash: 'bash', mendixDir: path.join(root, 'Mendix'), org: 'Test-Org', adminTokenFile: path.join(root, 'no-token') };
  const rec = recorder();
  const adopted: { repo: string; dir: string; local?: boolean }[] = [];
  const saves: number[] = [];
  const deps: SetupDeps = {
    cfg,
    env: cleanEnv(),
    run: rec.run,
    mendixToken: () => fake.token,
    teamServer: { endpoints: fake.endpoints, sleep: quick },
    projectsDir: () => projects,
    floorOf: () => undefined,
    addFloor: async () => 'never from GitHub here',
    adoptFloor: (repo, dir, _by, local) => (adopted.push({ repo, dir, local }), { id: 'visitor-desk', dir }),
    queue: () => 'unused',
    hired: () => false,
    known: () => false,
    hire: async () => undefined,
  };
  return { deps, projects, rec, adopted, saves };
}

test('New project on Team Server: the Portal app made once, its history adopted, main pushed there and checked, the token nowhere', async (t) => {
  const fake = await fakeTeamServer();
  const root = tmp('wizard');
  const a = audited();
  t.after(async () => (a.stop(), await fake.close(), rmSync(root, { recursive: true, force: true })));
  const { deps, projects, rec, adopted } = setupFor(fake, root);
  const steps = setupSteps(deps);
  const plan = discoveryPlan('greenfield', { teamServer: { mirror: false }, localOnly: true, roles: [] });
  plan.name = 'visitor-desk';
  plan.owner = 'Test-Org';
  plan.description = 'A desk for visitors';
  const job: JobState = newJob(plan, 'Probe');
  const lines: string[] = [];
  let saved = 0;
  const io = { log: (l: string) => void lines.push(l), save: () => void saved++ };

  const repo = await steps.repo(job, io);
  assert.equal(fake.creates.length, 1, 'one create');
  assert.deepEqual(fake.creates[0], { name: 'visitor-desk', summary: 'A desk for visitors' });
  const id = job.teamServer?.projectId;
  assert.ok(id && cleanProjectId(id), 'the app’s id saved on the job');
  assert.equal(job.plan.sprintrAppId, id, 'and on the plan: mx create-project binds the new app to it');
  assert.ok(saved >= 3, 'saved before the create, with the job id and with the app id');
  assert.match(String(repo.detail), /^on Mendix Team Server, nothing on GitHub: a local bare repository at /, 'the repo step’s own words, which Cancel & undo reads (no longer “local only”: the code goes to Team Server)');
  assert.ok(lines.some((l) => /Cancel & undo never deletes it/.test(l)));

  // A Retry of the step never creates a second app.
  await steps.repo(job, io);
  assert.equal(fake.creates.length, 1);

  await steps.clone(job, io);
  const dir = path.join(projects, 'Test-Org', 'visitor-desk');
  assert.deepEqual(adopted, [{ repo: 'Test-Org/visitor-desk', dir, local: true }]);
  assert.equal(git(dir, 'remote', 'get-url', 'teamserver'), `${fake.url}/${id}.git`, 'the plain URL');
  const template = fake.head(id!);
  git(dir, 'merge-base', '--is-ancestor', template, 'HEAD');
  assert.ok(!existsSync(path.join(dir, 'mprcontents')), 'the template’s files are not taken in: the app step makes the model at the picked version');

  // The model the app step would make (mx isn't run here), then settings and the commit.
  writeFileSync(path.join(dir, 'App.mpr'), 'our model\n');
  const settings = await steps.settings(job, io);
  assert.match(String(settings.detail), /Team Server app .* recorded/);
  forgetTeamServer();
  const recd = teamServerAt(dir);
  assert.equal(recd?.projectId, id);
  assert.equal(recd?.url, `${fake.url}/${id}.git`);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'agent-office.project.json'), 'utf8')).localOnly, true, 'still local only: no GitHub');
  const claude = readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /## Mendix Team Server/);
  assert.match(claude, /Never push to Team Server yourself/);
  assert.match(claude, /Never push to GitHub/, 'and the local-only rule');

  const commit = await steps.commit(job, io);
  assert.match(String(commit.detail), /Pushed main \(\w{7}\) to Team Server/);
  const local = git(dir, 'rev-parse', 'HEAD');
  const bare = localBareOf(projects, 'Test-Org', 'visitor-desk');
  assert.equal(git(bare, 'rev-parse', 'main'), local, 'origin (this machine) has main');
  assert.equal(fake.head(id!), local, 'Team Server has the same main');
  git(path.join(fake.root, `${id}.git`), 'merge-base', '--is-ancestor', template, 'main');
  assert.ok(git(path.join(fake.root, `${id}.git`), 'ls-tree', '--name-only', 'main').split('\n').includes('agent-office.project.json'));

  assertNoToken(fake, { calls: rec.calls, lines, dirs: [dir, bare], events: a.events });
  assert.ok(rec.calls.some((c) => c.args.includes('push') && c.env?.MX_OFFICE_TEAMSERVER_TOKEN === fake.token), 'the push had the token in its environment');
  assert.ok(rec.calls.filter((c) => c.args[0] === 'remote' || c.args.includes('commit-tree')).every((c) => !c.env?.MX_OFFICE_TEAMSERVER_TOKEN), 'local commands never get it');
  const actions = a.events.map((e) => e.action);
  assert.ok(actions.includes('team-server.app-create') && actions.includes('team-server.app-created') && actions.includes('team-server.sync'), actions.join(', '));
  // …and in the new project's own audit log, once the clone step made the project (Connect records them there too).
  const mine = a.events.filter((e) => e.floor === 'visitor-desk').map((e) => e.action);
  assert.ok(mine.includes('team-server.app-create') && mine.includes('team-server.app-created'), `the project's log: ${mine.join(', ')}`);
  assert.equal(a.events.filter((e) => e.floor === 'visitor-desk' && e.action === 'team-server.app-created').length, 1, 'once, not on every Retry');
  assert.match(String(settings.detail), /no GitHub recorded \(the code goes to Team Server\)/);
  assert.doesNotMatch(String(settings.detail), /local only recorded/);
});

test('a Team Server setup that stopped after the create was sent asks the person to look in the Portal before creating again', async (t) => {
  const fake = await fakeTeamServer();
  const root = tmp('unsure');
  t.after(async () => (await fake.close(), rmSync(root, { recursive: true, force: true })));
  const { deps } = setupFor(fake, root);
  const steps = setupSteps(deps);
  const plan = discoveryPlan('greenfield', { teamServer: { mirror: false }, localOnly: true, roles: [] });
  plan.name = 'visitor-desk';
  const job: JobState = newJob(plan, 'Probe');
  job.teamServer = { sentAt: Date.now() - 1000 };
  const io = { log: () => undefined };
  await assert.rejects(steps.repo(job, io), /stopped before it heard back.*Look in the Portal/);
  assert.equal(fake.creates.length, 0, 'nothing created blind');
  await steps.repo(job, io);
  assert.equal(fake.creates.length, 1, 'the next Retry creates it');

  // A pasted App ID links that app instead (checked on Team Server first), and nothing is created.
  const existing = fake.makeApp();
  const linked = newJob({ ...plan, name: 'visitor-desk-2', teamServer: { mirror: false, projectId: existing } }, 'Probe');
  await steps.repo(linked, io);
  assert.equal(linked.teamServer?.projectId, existing);
  assert.equal(linked.teamServer?.how, 'linked');
  assert.equal(fake.creates.length, 1);
  const bogus = newJob({ ...plan, name: 'visitor-desk-3', teamServer: { mirror: false, projectId: '00000000-0000-0000-0000-000000000000' } }, 'Probe');
  await assert.rejects(steps.repo(bogus, io), /no repository for that app|Team Server/);
  // No token: said plainly, nothing sent.
  const none = setupSteps({ ...deps, mendixToken: () => undefined });
  await assert.rejects(none.repo(newJob({ ...plan, name: 'visitor-desk-4' }, 'Probe'), io), /No Mendix token in 🔌 Connections/);
});

/** A project whose origin is a bare repository here (this machine's, or GitHub's stand-in), cloned, with a commit. */
function project(root: string, name: string, files: Record<string, string>) {
  const origin = path.join(root, `${name}-origin.git`);
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  const dir = path.join(root, name);
  git(root, 'clone', '-q', origin, dir);
  git(dir, 'checkout', '-q', '-B', 'main');
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Our first commit');
  git(dir, 'push', '-q', 'origin', 'main');
  return { origin, dir };
}

test('the sync: pushed when Team Server is behind, nothing when equal, Studio Pro commits pulled to main, both moved never forced', async (t) => {
  const fake = await fakeTeamServer();
  const root = tmp('sync');
  t.after(async () => (await fake.close(), rmSync(root, { recursive: true, force: true })));
  const id = fake.makeApp();
  const p = project(root, 'mirror-app', { 'App.mpr': 'model\n' });
  const rec = recorder();
  const g = tsGit({ token: fake.token, env: cleanEnv(), git: fake.url, run: rec.run });
  const record = { projectId: id, url: `${fake.url}/${id}.git`, remote: 'teamserver', mirror: true, how: 'linked' as const, by: 'Probe', at: 1 };
  // Unrelated histories: the template and ours. The first push needs the adoption (done by connect or the wizard): here, by hand.
  git(p.dir, 'remote', 'add', 'teamserver', record.url);
  const first = await syncMain({ g, dir: p.dir, rec: record });
  assert.equal(first.state, 'diverged', 'unrelated histories are never forced');
  assert.equal(fake.head(id), git(path.join(fake.root, `${id}.git`), 'rev-parse', 'main'));

  // Adopt by hand (our tree, Team Server's main as the second parent), as connect does.
  const tsMain = fake.head(id);
  const env = { ...process.env, ...ID };
  // (Team Server's main was fetched by the first sync.)
  const adopt = execFileSync('git', ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-p', tsMain, '-m', 'adopt'], { cwd: p.dir, encoding: 'utf8', env }).trim();
  git(p.dir, 'merge', '--ff-only', '-q', adopt);
  git(p.dir, 'push', '-q', 'origin', 'main');
  const pushed = await syncMain({ g, dir: p.dir, rec: record });
  assert.equal(pushed.state, 'pushed', pushed.message);
  assert.equal(fake.head(id), adopt);
  assert.equal((await syncMain({ g, dir: p.dir, rec: record })).state, 'same');

  // A Studio Pro commit on Team Server comes to origin's main, fast-forward.
  const studio = tmp('studio');
  t.after(() => rmSync(studio, { recursive: true, force: true }));
  git(studio, 'clone', '-q', path.join(fake.root, `${id}.git`), 'c');
  const c = path.join(studio, 'c');
  writeFileSync(path.join(c, 'App.mpr'), 'model changed in Studio Pro\n');
  git(c, 'commit', '-q', '-am', 'Studio Pro commit');
  git(c, 'push', '-q', 'origin', 'main');
  const pulled = await syncMain({ g, dir: p.dir, rec: record });
  assert.equal(pulled.state, 'pulled', pulled.message);
  assert.equal(git(p.origin, 'rev-parse', 'main'), git(c, 'rev-parse', 'HEAD'));

  // Both moved: nothing pushed anywhere.
  git(c, 'commit', '-q', '--allow-empty', '-m', 'another Studio Pro commit');
  git(c, 'push', '-q', 'origin', 'main');
  git(p.dir, 'pull', '-q', '--ff-only', 'origin', 'main');
  git(p.dir, 'commit', '-q', '--allow-empty', '-m', 'the team’s merge');
  git(p.dir, 'push', '-q', 'origin', 'main');
  const both = await syncMain({ g, dir: p.dir, rec: record });
  assert.equal(both.state, 'diverged');
  assert.match(both.message, /both moved.*Nothing was pushed/);
  assert.equal(fake.head(id), git(c, 'rev-parse', 'HEAD'), 'Team Server untouched');

  // A wrong token: Team Server's refusal in words, never a prompt.
  const bad = await syncMain({ g: tsGit({ token: 'wrong-token-0000000', env: cleanEnv(), git: fake.url }), dir: p.dir, rec: record });
  assert.equal(bad.state, 'failed');
  assert.match(bad.message, /Team Server refused the Mendix token/);
  assertNoToken(fake, { calls: rec.calls, dirs: [p.dir] });
});

test('Connect to Team Server: a local-only project gets a Portal app, the remote and its main there, its history kept, audited', async (t) => {
  const fake = await fakeTeamServer();
  const root = tmp('connect');
  const a = audited();
  t.after(async () => (a.stop(), await fake.close(), rmSync(root, { recursive: true, force: true })));
  const p = project(root, 'records', { 'Records.mpr': 'model\n', 'agent-office.project.json': `${JSON.stringify({ description: 'Keeps records', localOnly: true }, null, 2)}\n`, 'CLAUDE.md': '# Records\n' });
  forgetLocalOnly();
  const before = git(p.dir, 'rev-parse', 'HEAD');
  const rec = recorder();
  const ts = new TeamServerOffice({ dataDir: path.join(root, 'data'), token: () => fake.token, env: cleanEnv, endpoints: fake.endpoints, sleep: quick, run: rec.run });
  const floor = { id: 'records', dir: p.dir, name: 'records', description: 'Keeps records' };

  assert.match((await ts.connect(floor, {}, { name: 'Ada' }) as { error: string }).error, /Paste the App ID .* or confirm/);
  assert.match((await ts.connect(floor, { projectId: 'nope' }, { name: 'Ada' }) as { error: string }).error, /isn’t an App ID/);
  const r = await ts.connect(floor, { create: true }, { name: 'Ada', id: 'a1' });
  assert.ok(r.ok, !r.ok ? r.error : '');
  const id = r.view.record!.projectId;
  assert.equal(fake.creates.length, 1);
  assert.deepEqual(fake.creates[0], { name: 'records', summary: 'Keeps records' });
  const main = git(p.origin, 'rev-parse', 'main');
  assert.equal(fake.head(id), main, 'Team Server has main');
  git(p.dir, 'merge-base', '--is-ancestor', before, main);
  git(p.dir, 'merge-base', '--is-ancestor', fake.head(id, 'main^2'), main);
  assert.equal(git(p.dir, 'rev-parse', 'HEAD'), main, 'the folder followed (on main, nothing uncommitted)');
  const tree = git(p.dir, 'ls-tree', '-r', '--name-only', 'main').split('\n');
  assert.ok(tree.includes('Records.mpr') && !tree.includes('App.mpr') && !tree.includes('mprcontents/mprname'), 'our tree, not the template’s');
  forgetTeamServer();
  assert.equal(teamServerAt(p.dir)?.projectId, id, 'recorded in agent-office.project.json');
  assert.match(readFileSync(path.join(p.dir, 'CLAUDE.md'), 'utf8'), /## Mendix Team Server/);
  assert.equal(git(p.dir, 'remote', 'get-url', 'teamserver'), `${fake.url}/${id}.git`);
  assert.equal(r.view.last?.state, 'pushed');
  assert.match(r.view.portalUrl!, new RegExp(`sprintr\\.home\\.mendix\\.com/link/project/${id}`));
  assert.ok(a.events.some((e) => e.action === 'team-server.connected' && e.actor.name === 'Ada'));
  assert.match((await ts.connect(floor, { create: true }, { name: 'Ada' }) as { error: string }).error, /already/);

  // Later merges into main go to Team Server.
  writeFileSync(path.join(p.dir, 'README.md'), 'more\n');
  git(p.dir, 'add', '-A');
  git(p.dir, 'commit', '-q', '-m', 'a merge into main');
  git(p.dir, 'push', '-q', 'origin', 'main');
  const s = await ts.sync(floor, { name: 'Ada' });
  assert.equal(s.state, 'pushed', s.message);
  assert.equal(fake.head(id), git(p.dir, 'rev-parse', 'HEAD'));
  assert.ok(a.events.some((e) => e.action === 'team-server.sync' && /Pushed main/.test(e.summary)));

  // Linking an existing app by its App ID: checked on Team Server, nothing created.
  const q = project(root, 'ledger', { 'Ledger.mpr': 'model\n', 'agent-office.project.json': '{"localOnly":true}\n' });
  forgetLocalOnly();
  const existing = fake.makeApp();
  const linked = await ts.connect({ id: 'ledger', dir: q.dir, name: 'ledger' }, { projectId: existing.toUpperCase() }, { name: 'Ada' });
  assert.ok(linked.ok, !linked.ok ? linked.error : '');
  assert.equal(linked.view.record?.how, 'linked');
  assert.equal(fake.creates.length, 1);
  assert.equal(fake.head(existing), git(q.origin, 'rev-parse', 'main'));

  // A GitHub project isn't connected here; no token, nothing at all.
  const gh = project(root, 'on-github', { 'agent-office.project.json': '{}\n' });
  assert.match((await ts.connect({ id: 'gh', dir: gh.dir, name: 'gh' }, { create: true }, { name: 'Ada' }) as { error: string }).error, /for local-only projects/);
  const none = new TeamServerOffice({ dataDir: path.join(root, 'data2'), token: () => undefined });
  assert.match((await none.connect({ id: 'x', dir: q.dir, name: 'x' }, { create: true }, { name: 'Ada' }) as { error: string }).error, /already|No Mendix token/);
  assert.equal((await none.sync({ id: 'records', dir: p.dir })).state, 'no-token');

  assertNoToken(fake, { calls: rec.calls, dirs: [p.dir, q.dir, p.origin], events: a.events });
  assert.ok(!readFileSync(path.join(root, 'data', 'team-server', 'records.json'), 'utf8').includes(fake.token), 'nor the office’s own state file');
});
