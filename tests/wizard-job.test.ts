import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETUP_STEPS, type ProjectPlan, type StepId } from '../src/shared/wizard.js';
import { JobBook, newJob, type StepImpl } from '../src/server/wizard/job.js';
import { adminGhEnv, adminTokenConfigured, redactor } from '../src/server/wizard/admin-token.js';
import { toolkitEnv, type WizardConfig } from '../src/server/wizard/config.js';
import { setupSteps, type SetupDeps } from '../src/server/wizard/steps.js';
import { registerField } from '../src/server/wizard/register.js';

const plan = (over: Partial<ProjectPlan> = {}): ProjectPlan => ({
  kind: 'new',
  owner: 'Test-Org',
  name: 'demo-app',
  description: 'A demo',
  private: true,
  mendix: '11.6.4',
  entry: 'greenfield',
  tier: 'small',
  interview: 'attended',
  execApproval: 'auto',
  intake: [{ n: 2, kind: 'answered', text: 'A demo app.' }],
  clients: ['Acme'],
  operators: ['Probe'],
  roles: ['pm', 'chief-analyst'],
  discovery: { issue: false, queue: false, model: 'opus' },
  createdByHand: false,
  ...over,
});

const tmp = (name: string) => mkdtempSync(path.join(os.tmpdir(), `wizard-${name}-`));

/** Step implementations that record their calls; `fail` names steps that throw (once each, unless `always`). */
function fakeSteps(calls: StepId[], fail: Set<StepId> = new Set(), always = false): Record<StepId, StepImpl> {
  return Object.fromEntries(
    SETUP_STEPS.map((s) => [
      s.id,
      async (_job, io) => {
        calls.push(s.id);
        io.log(`doing ${s.id}`);
        if (fail.has(s.id)) {
          if (!always) fail.delete(s.id);
          throw new Error(`${s.id} broke`);
        }
        return { status: s.id === 'queue' ? 'skipped' : 'done' };
      },
    ]),
  ) as Record<StepId, StepImpl>;
}

test('a setup runs its steps in order, stops at a failure, and a retry carries on from there', async () => {
  const dir = tmp('book');
  try {
    const book = new JobBook(dir);
    const job = newJob(plan(), 'Probe');
    book.add(job);
    const calls: StepId[] = [];
    await book.run(job, fakeSteps(calls, new Set<StepId>(['init'])));
    assert.deepEqual(calls, ['repo', 'clone', 'env', 'init']);
    assert.equal(job.status, 'failed');
    assert.equal(job.steps.init.status, 'failed');
    assert.equal(job.steps.init.detail, 'init broke');
    assert.ok(job.log.some((l) => l.includes('✗')));

    calls.length = 0;
    await book.run(job, fakeSteps(calls));
    assert.deepEqual(calls, SETUP_STEPS.map((s) => s.id).slice(3), 'the steps already done are not run again');
    assert.equal(job.status, 'done');
    assert.equal(job.steps.queue.status, 'skipped');

    // An edit writes the answers again, and nothing else.
    book.reset(job, ['intake', 'commit']);
    calls.length = 0;
    await book.run(job, fakeSteps(calls));
    assert.deepEqual(calls, ['intake', 'commit']);

    // Saved after every step: a new office picks it up, and one that was mid-step is marked for a retry.
    const saved = JSON.parse(readFileSync(path.join(dir, `${job.id}.json`), 'utf8'));
    saved.status = 'running';
    saved.steps.gates = { status: 'running' };
    writeFileSync(path.join(dir, `${job.id}.json`), JSON.stringify(saved));
    const again = new JobBook(dir).get(job.id)!;
    assert.equal(again.status, 'failed');
    assert.equal(again.steps.gates.status, 'failed');
    assert.match(again.steps.gates.detail ?? '', /restarted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a setup is not run twice at once', async () => {
  const dir = tmp('once');
  try {
    const book = new JobBook(dir);
    const job = newJob(plan(), 'Probe');
    const calls: StepId[] = [];
    await Promise.all([book.run(job, fakeSteps(calls)), book.run(job, fakeSteps(calls))]);
    assert.equal(calls.length, SETUP_STEPS.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the admin token goes only to the repo-create child: not process.env, not the toolkit env, not the log', async () => {
  const ADMIN = 'github_pat_ADMINSECRET0123456789abcdefABCDEF';
  const OFFICE = 'ghp_OFFICEtoken0123456789abcdefABCDEF';
  const base = { PATH: process.env.PATH, GH_TOKEN: OFFICE, GITHUB_TOKEN: OFFICE, HOME: 'x' } as NodeJS.ProcessEnv;
  const env = adminGhEnv(base, ADMIN);
  assert.equal(env.GH_TOKEN, ADMIN);
  assert.equal(env.GITHUB_TOKEN, undefined, "the office's own identity is dropped");
  assert.equal(base.GH_TOKEN, OFFICE, 'the base environment is not changed');
  assert.equal(redactor([ADMIN])(`token ${ADMIN} and ${OFFICE}`), 'token [redacted] and [redacted]');

  // A fake gh: node under another name, told by NODE_OPTIONS to run our script first.
  const dir = tmp('gh');
  try {
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    const record = path.join(dir, 'record.json');
    const fake = path.join(dir, 'fake-gh.cjs');
    writeFileSync(
      fake,
      `const args = [require('path').basename(process.argv[1]), ...process.argv.slice(2)];
       const fs = require('fs');
       if (args[0] === 'repo' && args[1] === 'view') process.exit(1);
       fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN || null }));
       console.log('created with ' + process.env.GH_TOKEN);
       process.exit(0);`,
    );
    const gh = path.join(bin, process.platform === 'win32' ? 'gh.exe' : 'gh');
    try {
      linkSync(process.execPath, gh);
    } catch {
      copyFileSync(process.execPath, gh);
    }
    const tokenFile = path.join(dir, 'admin-token');
    writeFileSync(tokenFile, `${ADMIN}\n`);
    assert.ok(adminTokenConfigured(tokenFile));
    const cfg: WizardConfig = { toolkitDir: dir, bash: 'bash', mendixDir: dir, org: 'Test-Org', adminTokenFile: tokenFile };
    const officeEnv: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_TOKEN: OFFICE, NODE_OPTIONS: `--require ${fake.replace(/\\/g, '/')}` };
    const deps: SetupDeps = {
      cfg,
      env: officeEnv,
      projectsDir: () => dir,
      floorOf: () => undefined,
      addFloor: async () => 'unused',
      adoptFloor: () => 'unused',
      queue: () => undefined,
    };
    const book = new JobBook(path.join(dir, 'jobs'));
    const job = newJob(plan(), 'Probe');
    book.add(job);
    const steps = setupSteps(deps);
    // Only the repo step: the rest are another test's.
    const only = Object.fromEntries(SETUP_STEPS.map((s) => [s.id, s.id === 'repo' ? steps.repo : async () => ({ status: 'skipped' as const })])) as Record<StepId, StepImpl>;
    await book.run(job, only);
    assert.equal(job.steps.repo.status, 'done', job.steps.repo.detail);
    const seen = JSON.parse(readFileSync(record, 'utf8'));
    assert.equal(seen.GH_TOKEN, ADMIN, 'gh repo create ran with the admin token');
    assert.equal(seen.GITHUB_TOKEN, null);
    assert.deepEqual(seen.args.slice(0, 5), ['repo', 'create', 'Test-Org/demo-app', '--private', '--add-readme']);
    const everything = [JSON.stringify(process.env), JSON.stringify(toolkitEnv(cfg, officeEnv)), job.log.join('\n'), ...readdirSync(path.join(dir, 'jobs')).map((f) => readFileSync(path.join(dir, 'jobs', f), 'utf8'))].join('\n');
    assert.ok(!everything.includes(ADMIN), 'the admin token is nowhere but in that child');
    assert.ok(job.log.some((l) => l.includes('created with [redacted]')), 'what gh echoed was redacted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('offline setup: a local bare repository, cloned, scaffold answers written, committed and pushed (stdin closed)', async () => {
  const dir = tmp('offline');
  try {
    const projects = path.join(dir, 'projects');
    const cfg: WizardConfig = { toolkitDir: dir, bash: 'bash', mendixDir: 'C:\\Mendix', org: 'Test-Org', adminTokenFile: path.join(dir, 'none'), offlineDir: path.join(dir, 'github'), python: 'C:\\py\\python.exe' };
    let adopted: string | undefined;
    const deps: SetupDeps = {
      cfg,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Probe', GIT_AUTHOR_EMAIL: 'p@x', GIT_COMMITTER_NAME: 'Probe', GIT_COMMITTER_EMAIL: 'p@x' },
      projectsDir: () => projects,
      floorOf: () => undefined,
      addFloor: async () => 'not offline',
      adoptFloor: (_repo, d) => ((adopted = d), { id: 'demo-app', dir: d }),
      queue: () => 'should not queue offline',
    };
    const book = new JobBook(path.join(dir, 'jobs'));
    const job = newJob(plan({ discovery: { issue: true, queue: true, model: 'sonnet' } }), 'Probe');
    // The toolkit's own scripts are slow and tested end to end in the office: stand in for their output here.
    const steps = setupSteps(deps);
    const scaffold: StepImpl = async (j) => {
      writeFileSync(path.join(j.dir!, 'intake.md'), '# intake\n\n## 1. Entry mode?\n\n_Not yet asked._ x\n\n## 2. What is this project?\n\n_Not yet asked._ y\n\n## 9. Interview mode?\n\n_Not yet asked._ z\n\n## 11. Exec approval?\n\n_Not yet asked._ w\n');
      writeFileSync(path.join(j.dir!, 'PROJECT.md'), '# PROJECT.md\n\n## Current stage\n\n**Stage P**\n\nExec approval: auto\n\n## Decisions\n\n| Stage | Decision | Status | Notes |\n|---|---|---|---|\n');
      writeFileSync(path.join(j.dir!, '.gitignore'), '/.claude/toolkit.env\n/.agent-office/\n');
      return { status: 'done' };
    };
    const skip: StepImpl = async () => ({ status: 'skipped' });
    await book.run(job, { ...steps, init: scaffold, hooks: skip, gates: skip });
    assert.equal(job.status, 'done', job.log.slice(-5).join('\n'));
    assert.equal(adopted, path.join(projects, 'Test-Org', 'demo-app'));
    const repoDir = job.dir!;
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    assert.equal(git('remote', 'get-url', 'origin'), 'https://github.com/Test-Org/demo-app.git', 'origin reads as GitHub, for the floor');
    assert.equal(readFileSync(path.join(repoDir, '.claude', 'toolkit.env'), 'utf8').includes('MXBUILD_PATH=C:\\Mendix'), true);
    const intake = readFileSync(path.join(repoDir, 'intake.md'), 'utf8');
    assert.match(intake, /Answered \(CONFIRMED\): greenfield/);
    assert.match(intake, /Answered \(CONFIRMED\): A demo app\./);
    assert.match(intake, /Answered \(CONFIRMED\): attended/);
    const register = readFileSync(path.join(repoDir, 'PROJECT.md'), 'utf8');
    assert.equal(registerField(register, 'Entry mode'), 'greenfield');
    assert.equal(registerField(register, 'Mendix version'), '11.6.4');
    assert.match(register, /\| P \| Size tier: small \| CONFIRMED \d{4}-\d\d-\d\d \|/);
    const settings = JSON.parse(readFileSync(path.join(repoDir, '.agent-office', 'project.json'), 'utf8'));
    assert.deepEqual(settings.roles, ['pm', 'chief-analyst']);
    assert.deepEqual(settings.clients, ['Acme']);
    // Pushed to the bare repository, without the machine-local files.
    const bare = path.join(cfg.offlineDir!, 'Test-Org', 'demo-app.git');
    const pushed = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' });
    assert.match(pushed, /^PROJECT\.md$/m);
    assert.match(pushed, /^intake\.md$/m);
    assert.doesNotMatch(pushed, /toolkit\.env|project\.json/);
    assert.match(execFileSync('git', ['--git-dir', bare, 'log', '-1', '--format=%s', 'main'], { encoding: 'utf8' }), /Toolkit scaffold/);
    assert.equal(job.issue, 1);
    assert.ok(existsSync(path.join(cfg.offlineDir!, 'Test-Org', 'demo-app.issues', '1.md')));
    assert.equal(job.steps.queue.status, 'skipped', 'nothing is queued offline');

    // Running it all again finds everything done.
    book.reset(job, SETUP_STEPS.map((s) => s.id));
    job.issue = 1;
    await book.run(job, { ...steps, init: skip, hooks: skip, gates: skip });
    assert.equal(job.status, 'done');
    for (const id of ['repo', 'env', 'intake', 'decisions', 'settings'] as StepId[]) assert.equal(job.steps[id].status, 'skipped', `${id}: ${job.steps[id].detail}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
