// "Keep this project off GitHub" (wizard/local-only.ts, server/local-only.ts): the setup makes no GitHub
// repository and runs no gh at all (a fake gh, an .exe shim first on PATH, records every call, and the
// office's own runner records every command), the project's origin is a bare repository on this machine,
// the Discovery brief is a local file handed to the team, the choice is recorded in agent-office.project.json
// and CLAUDE.md, and the office's GitHub calls for the project say "not on GitHub" instead of failing.
// GitHub tokens are stripped from every environment here; nothing can reach the real GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newJob, type JobState } from '../src/server/wizard/job.js';
import type { WizardConfig } from '../src/server/wizard/config.js';
import type { RunOptions, RunResult } from '../src/server/wizard/run.js';
import { setupSteps, handsDiscoveryToAnalyst, type SetupDeps } from '../src/server/wizard/steps.js';
import { cleanPlan } from '../src/server/wizard/plan.js';
import { DISCOVERY_FILE, discoveryTask, localBareOf, withRules, localOnlyRules } from '../src/server/wizard/local-only.js';
import { LOCAL_ONLY_HIRE_LINE, LOCAL_ONLY_TEXT, forgetLocalOnly, localOnlyAt, withLocalOnlyLine } from '../src/server/local-only.js';
import { gh } from '../src/server/github.js';
import { defaultLocalOnly } from '../src/client/ui/wizard/new/local-only-field.js';
import { detailRows, LOCAL_ONLY_LABEL } from '../src/client/ui/portal/overview-logic.js';
import { runnable } from './support/winshim.js';
import { madeBySetup } from '../src/shared/setup-cancel.js';
import { discoveryPlan } from './support/discovery-plans.js';

const TOKENS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'];
const tmp = (n: string) => mkdtempSync(path.join(os.tmpdir(), `localonly-${n}-`));

/** A fake gh (an .exe shim on Windows) that appends each call to `log` and fails, first on PATH; tokens and gh's config stripped. */
function fakeGhEnv(root: string): { env: NodeJS.ProcessEnv; log: string } {
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = path.join(root, 'gh-calls.log');
  writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nprocess.stderr.write('fake gh: refused\\n');\nprocess.exit(1);\n`);
  runnable(path.join(bin, 'gh'));
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, GH_CONFIG_DIR: path.join(root, 'gh-config'), GIT_AUTHOR_NAME: 'Probe', GIT_AUTHOR_EMAIL: 'probe@localhost', GIT_COMMITTER_NAME: 'Probe', GIT_COMMITTER_EMAIL: 'probe@localhost' };
  for (const k of TOKENS) delete env[k];
  return { env, log };
}
const ghCalls = (log: string) => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);

test('a local-only migration is set up with no GitHub repository, no gh call, its origin on this machine, and Discovery as a local file for the team', async () => {
  const root = tmp('setup');
  try {
    const { env, log } = fakeGhEnv(root);
    const projects = path.join(root, 'projects');
    const cfg: WizardConfig = { toolkitDir: path.join(root, 'toolkit'), bash: 'bash', mendixDir: path.join(root, 'Mendix'), org: 'Test-Org', adminTokenFile: path.join(root, 'no-token') };
    const commands: { cmd: string; args: string[] }[] = [];
    // The office's own runner for gh (the repo step's lookup and create): recorded, and it would refuse.
    const run = async (cmd: string, args: string[], _o: RunOptions): Promise<RunResult> => {
      commands.push({ cmd, args });
      throw new Error(`${cmd} must not run in a local-only setup`);
    };
    const adopted: { repo: string; dir: string; local?: boolean }[] = [];
    const hires: { role: string; task?: string }[] = [];
    const deps: SetupDeps = {
      cfg,
      env,
      run,
      projectsDir: () => projects,
      floorOf: () => undefined,
      addFloor: async () => 'addFloor clones from GitHub: never in a local-only setup',
      adoptFloor: (repo, dir, _by, local) => (adopted.push({ repo, dir, local }), { id: 'pack-track', dir }),
      queue: () => 'unused',
      hired: () => false,
      known: () => false,
      hire: async (_f, role, _by, _a, task) => void hires.push({ role, task }),
    };
    const steps = setupSteps(deps);
    const plan = discoveryPlan('migration', { localOnly: true, roles: ['chief-analyst'], sourceFolder: { path: path.join(root, 'legacy', 'shop-app'), name: 'shop-app', files: 3, bytes: 300 } });
    const job: JobState = newJob(plan, 'Probe');
    const io = { log: () => undefined };

    const repo = await steps.repo(job, io);
    const bare = localBareOf(projects, 'Test-Org', 'pack-track');
    assert.equal(repo.status, 'done');
    assert.match(String(repo.detail), /local only, nothing on GitHub/);
    assert.ok(existsSync(path.join(bare, 'HEAD')), 'a bare repository in the projects home');
    assert.equal(repo.provenance, undefined, 'nothing for Cancel & undo to delete on GitHub');

    const clone = await steps.clone(job, io);
    assert.equal(clone.status, 'done');
    const dir = path.join(projects, 'Test-Org', 'pack-track');
    assert.equal(job.dir, dir);
    assert.deepEqual(adopted, [{ repo: 'Test-Org/pack-track', dir, local: true }]);
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8' }).trim();
    assert.equal(path.resolve(origin), path.resolve(bare), 'origin is the bare repository, not GitHub');
    assert.doesNotMatch(execFileSync('git', ['remote', '-v'], { cwd: dir, encoding: 'utf8' }), /github\.com/);

    const settings = await steps.settings(job, io);
    assert.equal(settings.status, 'done');
    const saved = JSON.parse(readFileSync(path.join(dir, 'agent-office.project.json'), 'utf8')) as { localOnly?: boolean };
    assert.equal(saved.localOnly, true, 'recorded in agent-office.project.json');
    const claude = readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /Never push to GitHub/);
    assert.match(claude, /gh pr create/);
    const brief = readFileSync(path.join(dir, ...DISCOVERY_FILE.split('/')), 'utf8');
    assert.match(brief, /run the toolkit's migration track/);
    assert.match(brief, /Local only: this project is not on GitHub/);
    assert.ok(brief.includes(`${dir.replace(/\\/g, '/')}/sources/legacy/shop-app`), 'the absolute legacy source path');

    const issue = await steps.issue(job, io);
    assert.equal(issue.status, 'done');
    assert.equal(job.issue, undefined, 'no GitHub issue');
    assert.equal(job.discoveryFile, DISCOVERY_FILE);

    const commit = await steps.commit(job, io);
    assert.equal(commit.status, 'done');
    const pushed = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' });
    assert.match(pushed, /docs\/discovery-brief\.md/, 'pushed to the bare repository on this machine');
    assert.match(pushed, /agent-office\.project\.json/);

    assert.ok(handsDiscoveryToAnalyst(job));
    const team = await steps.team(job, io);
    assert.equal(team.status, 'done');
    assert.equal(hires[0].role, 'chief-analyst');
    assert.match(String(hires[0].task), /read `docs\/discovery-brief\.md`/);
    assert.doesNotMatch(String(hires[0].task), /gh issue view/);
    const queue = await steps.queue(job, io);
    assert.equal(queue.status, 'skipped', 'it went to the Chief Analyst');

    assert.deepEqual(commands, [], 'the office ran no gh');
    assert.deepEqual(ghCalls(log), [], 'the fake gh was never called');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('without the Chief Analyst on the team, the local Discovery brief goes on the queue with no issue number', () => {
  const job = Object.assign(newJob(discoveryPlan('migration', { localOnly: true }), 'Probe'), { dir: 'C:\\p\\x', discoveryFile: DISCOVERY_FILE });
  const t = discoveryTask(job)!;
  assert.equal(t.issue, undefined);
  assert.match(t.prompt, /C:\/p\/x\/docs\/discovery-brief\.md/);
  assert.equal(t.prompt.includes('\n'), false, 'one line for the terminal');
  const gitHub = discoveryTask(Object.assign(newJob(discoveryPlan('migration'), 'Probe'), { issue: 7 }))!;
  assert.equal(gitHub.issue, 7);
  assert.match(gitHub.prompt, /gh issue view 7/);
});

test('the choice is a new project’s only, and CLAUDE.md gets the rule once', () => {
  const raw = { kind: 'new', owner: 'Test-Org', name: 'pack-track', entry: 'migration', mendix: '11.12.4', localOnly: true, sourceFolder: { path: 'C:\\evil', name: 'x', files: 1, bytes: 1 } };
  const p = cleanPlan(raw, ['11.12.4'], 'Test-Org');
  assert.ok(typeof p !== 'string');
  assert.equal(p.localOnly, true);
  assert.equal(p.sourceFolder, undefined, 'a source folder never comes from the page');
  const c = cleanPlan({ ...raw, kind: 'change', entry: 'existing-app-change' }, ['11.12.4'], 'Test-Org');
  assert.ok(typeof c !== 'string');
  assert.equal(c.localOnly, undefined);
  const rules = localOnlyRules('C:\\p\\.local-git\\o\\n.git');
  const once = withRules('# Project\n', rules);
  assert.equal(withRules(once, rules), once);
  assert.equal(once.split('Local only: this project is not on GitHub').length, 2);
});

test('the office’s GitHub calls for a local-only project say "not on GitHub" and never start gh; a hire is told the rule', async () => {
  const root = tmp('gh');
  const before = { PATH: process.env.PATH, GH_CONFIG_DIR: process.env.GH_CONFIG_DIR, tokens: TOKENS.map((k) => process.env[k]) };
  try {
    const { env, log } = fakeGhEnv(root);
    process.env.PATH = env.PATH;
    process.env.GH_CONFIG_DIR = env.GH_CONFIG_DIR;
    for (const k of TOKENS) delete process.env[k];
    const local = path.join(root, 'local');
    const other = path.join(root, 'other');
    mkdirSync(local);
    mkdirSync(other);
    writeFileSync(path.join(local, 'agent-office.project.json'), JSON.stringify({ repo: 'Test-Org/pack-track', localOnly: true }));
    writeFileSync(path.join(other, 'agent-office.project.json'), JSON.stringify({ repo: 'Test-Org/other' }));
    forgetLocalOnly();
    assert.equal(localOnlyAt(local), true);
    assert.equal(localOnlyAt(other), false);
    for (const args of [['issue', 'list'], ['pr', 'list'], ['pr', 'checks', '1'], ['api', 'repos/Test-Org/pack-track/commits/main/check-runs']]) await assert.rejects(gh(args, local), (e: Error) => e.message === LOCAL_ONLY_TEXT);
    assert.deepEqual(ghCalls(log), [], 'gh never started for the local-only project');
    // The same fake gh does run for any other project (so the check above means something).
    await assert.rejects(gh(['issue', 'list'], other));
    assert.equal(ghCalls(log).length, 1);
    const line = await withLocalOnlyLine(Promise.resolve(undefined), local);
    assert.equal(line?.line, LOCAL_ONLY_HIRE_LINE);
    assert.ok(LOCAL_ONLY_HIRE_LINE.length <= 300);
    assert.equal(await withLocalOnlyLine(Promise.resolve(undefined), other), undefined, 'another project’s hire is unchanged');
    const both = await withLocalOnlyLine(Promise.resolve({ line: 'Brain: ROUTING.md', record: async () => undefined }), local);
    assert.equal(both?.line, `Brain: ROUTING.md ${LOCAL_ONLY_HIRE_LINE}`);
  } finally {
    process.env.PATH = before.PATH;
    if (before.GH_CONFIG_DIR === undefined) delete process.env.GH_CONFIG_DIR;
    else process.env.GH_CONFIG_DIR = before.GH_CONFIG_DIR;
    TOKENS.forEach((k, i) => before.tokens[i] !== undefined && (process.env[k] = before.tokens[i]));
    rmSync(root, { recursive: true, force: true });
  }
});

test('the Overview says "Local only: not on GitHub" instead of a GitHub link', () => {
  const rows = detailRows({ repo: 'Test-Org/pack-track', dir: 'C:\\projects\\Test-Org\\pack-track', localOnly: true });
  assert.deepEqual(rows[0], { label: 'Repository', value: LOCAL_ONLY_LABEL, sub: 'C:\\projects\\Test-Org\\pack-track' });
  assert.equal(rows.some((r) => r.href?.includes('github.com')), false);
  assert.equal(detailRows({ repo: 'Test-Org/x' })[0].href, 'https://github.com/Test-Org/x', 'other projects unchanged');
});

test('Cancel & undo never offers to delete a GitHub repository for a local-only project', () => {
  const made = madeBySetup([{ id: 'repo', status: 'done', detail: 'local only, nothing on GitHub: a local bare repository at C:\p\.local-git\o\n.git' }]);
  assert.equal(made.offline, true);
  assert.equal(made.repoByHand, false);
  assert.equal(made.repo, false);
});

test('a migration with a source folder defaults to a private GitHub repository: Keep off GitHub is unticked, and Public is never kept', () => {
  const plan = { kind: 'new', entry: 'migration', private: false, localOnly: true } as never as Parameters<typeof defaultLocalOnly>[0];
  defaultLocalOnly(plan, { source: { path: 'C:/src/shop-app', name: 'shop-app', files: 3, bytes: 300 } } as never);
  assert.equal(plan.localOnly, false, 'off GitHub only when someone ticks it');
  assert.equal(plan.private, true, 'a source folder always means a private repository');
  const plain = { kind: 'new', entry: 'migration', private: false } as never as Parameters<typeof defaultLocalOnly>[0];
  defaultLocalOnly(plain, null);
  assert.equal(plain.private, false, 'without a source folder the visibility is the person’s');
});
