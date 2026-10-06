import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { interviewModeOf, SETUP_STEPS, type ProjectPlan, type ProjectRole, type StepId } from '../src/shared/wizard.js';
import { JobBook, newJob, type JobState } from '../src/server/wizard/job.js';
import { defaultMendix, type WizardConfig } from '../src/server/wizard/config.js';
import { appNameOf, cleanAppId, MENDIX_IGNORES, withMendixIgnores } from '../src/server/wizard/mendix-app.js';
import { cleanPlan } from '../src/server/wizard/plan.js';
import { recordDecisions } from '../src/server/wizard/register.js';
import type { RunOptions, RunResult } from '../src/server/wizard/run.js';
import { decisionsOf, intakeAnswersOf, setupSteps, type SetupDeps } from '../src/server/wizard/steps.js';

const plan = (over: Partial<ProjectPlan> = {}): ProjectPlan => ({
  kind: 'new',
  owner: 'Test-Org',
  name: 'travel-approval',
  description: 'A demo',
  private: true,
  mendix: '11.12.4',
  entry: 'greenfield',
  tier: 'small',
  interview: 'steering',
  execApproval: 'auto',
  intake: [],
  clients: ['Acme'],
  operators: ['Probe'],
  roles: ['pm', 'lead-developer', 'chief-analyst'],
  discovery: { issue: true, queue: true, model: 'opus' },
  createdByHand: false,
  ...over,
});

const tmp = (name: string) => mkdtempSync(path.join(os.tmpdir(), `wizard-${name}-`));
const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

interface Call {
  cmd: string;
  args: string[];
}

/** A fake command runner standing in for mx and mxcli: it records each call and makes what the real one would. */
function fakeRun(calls: Call[], act: (cmd: string, args: string[]) => string = () => '') {
  return async (cmd: string, args: string[], opts: RunOptions): Promise<RunResult> => {
    calls.push({ cmd, args });
    const stdout = act(cmd, args);
    opts.onLine?.(`ran ${path.basename(cmd)} ${args[0]}`);
    return { code: 0, tail: [], stdout };
  };
}

/** A Studio Pro install with a modeler folder, and mx in it unless `noMx`. */
function studioPro(root: string, version: string, noMx = false) {
  const modeler = path.join(root, version, 'modeler');
  mkdirSync(modeler, { recursive: true });
  writeFileSync(path.join(modeler, exe('mxbuild')), '');
  if (!noMx) writeFileSync(path.join(modeler, exe('mx')), '');
}

function setup(over: Partial<SetupDeps> & { cfg: WizardConfig }) {
  const deps: SetupDeps = {
    projectsDir: () => over.cfg.toolkitDir,
    floorOf: () => undefined,
    addFloor: async () => 'unused',
    adoptFloor: () => 'unused',
    queue: () => 'unused',
    hired: () => false,
    known: () => false,
    hire: async () => 'unused',
    ...over,
  };
  return setupSteps(deps);
}

const jobIn = (dir: string, p: ProjectPlan): JobState => Object.assign(newJob(p, 'Probe'), { dir, floor: 'travel-approval' });
const io = { log: () => undefined };

test('the default Studio Pro is the newest 11.12 installed, else 11.6.4, else the newest', () => {
  assert.equal(defaultMendix(['11.6.4', '11.12.2', '11.12.4', '11.12.0', '10.24.15.93102']), '11.12.4');
  assert.equal(defaultMendix(['11.12.10', '11.12.4']), '11.12.10', 'by number, not by spelling');
  assert.equal(defaultMendix(['11.10.0', '11.6.4', '10.24.21.108016']), '11.6.4');
  assert.equal(defaultMendix(['11.10.0', '11.9.1']), '11.10.0');
  assert.equal(defaultMendix([]), '');
});

test("the app's name, its Portal id and the Mendix .gitignore lines", () => {
  assert.equal(appNameOf('travel-approval'), 'TravelApproval');
  assert.equal(appNameOf('3d-shop'), 'App3dShop');
  assert.equal(cleanAppId(' 0F8FAD5B-D9CB-469F-A165-70867728950E '), '0f8fad5b-d9cb-469f-a165-70867728950e');
  assert.equal(cleanAppId('not-a-guid'), undefined);
  const once = withMendixIgnores('/.claude/toolkit.env\n/deployment/\n');
  assert.equal(withMendixIgnores(once), once, 'nothing is added twice');
  assert.equal(once.split('\n').filter((l) => l === '/deployment/').length, 1);
  for (const l of ['/.mendix-cache/', '*.mpr.lock', '/theme-cache/', '/mprcontents/mprjournal*']) assert.ok(once.includes(`\n${l}\n`), l);
  assert.ok(once.startsWith('/.claude/toolkit.env\n'), "the project's own lines stay first");
  assert.equal(withMendixIgnores(''), `# Mendix project (written by the agent-office new-project wizard)\n${MENDIX_IGNORES.join('\n')}\n`);
});

test("the app step makes the .mpr at the repository's root with Studio Pro's mx, once, and ignores Mendix's output", async () => {
  const root = tmp('app');
  try {
    const mendixDir = path.join(root, 'Mendix');
    studioPro(mendixDir, '11.12.4');
    const dir = path.join(root, 'repo');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'README.md'), '# travel-approval\n');
    const calls: Call[] = [];
    const run = fakeRun(calls, (cmd, args) => {
      const out = args[args.indexOf('--output-dir') + 1];
      writeFileSync(path.join(out, `${args[args.indexOf('--app-name') + 1]}.mpr`), '');
      mkdirSync(path.join(out, 'theme'), { recursive: true });
      return 'Done.';
    });
    const cfg: WizardConfig = { toolkitDir: root, bash: 'bash', mendixDir, org: 'Test-Org', adminTokenFile: path.join(root, 'none'), mxcli: path.join(root, 'mxcli') };
    const steps = setup({ cfg, run });
    const job = jobIn(dir, plan({ sprintrAppId: '0f8fad5b-d9cb-469f-a165-70867728950e' }));
    const r = await steps.app(job, io);
    assert.equal(r.status, 'done');
    assert.match(r.detail ?? '', /TravelApproval\.mpr with Studio Pro 11\.12\.4's mx create-project/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, path.join(mendixDir, '11.12.4', 'modeler', exe('mx')));
    assert.deepEqual(calls[0].args, ['create-project', '--app-name', 'TravelApproval', '--output-dir', dir, '--sprintr-app-id', '0f8fad5b-d9cb-469f-a165-70867728950e']);
    assert.ok(existsSync(path.join(dir, 'TravelApproval.mpr')));
    assert.equal(readFileSync(path.join(dir, 'README.md'), 'utf8'), '# travel-approval\n');
    assert.match(readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\/deployment\/$/m);

    // A retry finds the app and runs nothing.
    const again = await steps.app(job, io);
    assert.equal(again.status, 'skipped');
    assert.match(again.detail ?? '', /already there \(TravelApproval\.mpr\)/);
    assert.equal(calls.length, 1);

    // Without a Portal id, no --sprintr-app-id.
    rmSync(path.join(dir, 'TravelApproval.mpr'));
    await steps.app(jobIn(dir, plan()), io);
    assert.ok(!calls[1].args.includes('--sprintr-app-id'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('with no mx in that Studio Pro, the app step falls back to mxcli new and moves the app in, keeping the README', async () => {
  const root = tmp('app-mxcli');
  try {
    const mendixDir = path.join(root, 'Mendix');
    studioPro(mendixDir, '11.12.4', true);
    const dir = path.join(root, 'repo');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'README.md'), 'ours\n');
    const calls: Call[] = [];
    const run = fakeRun(calls, (_cmd, args) => {
      const out = args[args.indexOf('--output-dir') + 1];
      mkdirSync(path.join(out, 'theme'), { recursive: true });
      writeFileSync(path.join(out, 'TravelApproval.mpr'), 'model');
      writeFileSync(path.join(out, 'theme', 'main.scss'), '');
      writeFileSync(path.join(out, 'README.md'), 'theirs\n');
      return '';
    });
    const mxcli = path.join(root, exe('mxcli'));
    const cfg: WizardConfig = { toolkitDir: root, bash: 'bash', mendixDir, org: 'Test-Org', adminTokenFile: path.join(root, 'none'), mxcli };
    const r = await setup({ cfg, run }).app(jobIn(dir, plan()), io);
    assert.equal(r.status, 'done');
    assert.match(r.detail ?? '', /mxcli new/);
    assert.equal(calls[0].cmd, mxcli);
    assert.deepEqual(calls[0].args.slice(0, 4), ['new', 'TravelApproval', '--version', '11.12.4']);
    assert.ok(calls[0].args.includes('--skip-init'), "the toolkit's wire-agents runs mxcli init itself");
    assert.equal(readFileSync(path.join(dir, 'TravelApproval.mpr'), 'utf8'), 'model');
    assert.ok(existsSync(path.join(dir, 'theme', 'main.scss')));
    assert.equal(readFileSync(path.join(dir, 'README.md'), 'utf8'), 'ours\n');

    // Neither tool: a failure that says so, for a Retry once one is installed.
    rmSync(path.join(dir, 'TravelApproval.mpr'));
    await assert.rejects(setup({ cfg: { ...cfg, mxcli: undefined }, run }).app(jobIn(dir, plan()), io), /Neither Studio Pro's mx/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("for an existing app the app step creates nothing: it reads the .mpr's Studio Pro version and says when it differs", async () => {
  const root = tmp('app-change');
  try {
    const mendixDir = path.join(root, 'Mendix');
    studioPro(mendixDir, '11.12.4');
    const dir = path.join(root, 'repo');
    mkdirSync(path.join(dir, 'app'), { recursive: true });
    writeFileSync(path.join(dir, 'app', 'Legacy.mpr'), '');
    const calls: Call[] = [];
    const run = fakeRun(calls, () => 'Mx Toolset v11.12.4\n11.6.4\n');
    const cfg: WizardConfig = { toolkitDir: root, bash: 'bash', mendixDir, org: 'Test-Org', adminTokenFile: path.join(root, 'none') };
    const r = await setup({ cfg, run }).app(jobIn(dir, plan({ kind: 'change', entry: 'existing-app-change' })), io);
    assert.equal(r.status, 'skipped');
    assert.match(r.detail ?? '', /Legacy\.mpr, last saved with Studio Pro 11\.6\.4 \(not the 11\.12\.4 picked/);
    assert.deepEqual(calls.map((c) => c.args[0]), ['show-version']);
    assert.ok(!existsSync(path.join(dir, '.gitignore')), "an existing app's .gitignore is left alone");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the app step runs before init (so init-project.sh names the .mpr) and the team is hired after the push', () => {
  const ids = SETUP_STEPS.map((s) => s.id);
  const at = (id: StepId) => ids.indexOf(id);
  assert.ok(at('env') < at('app') && at('app') < at('init'));
  assert.ok(at('commit') < at('team') && at('issue') < at('team') && at('team') < at('queue'));
});

test('the team step hires the ticked roles once each, and hands the Discovery issue to the Chief Analyst', async () => {
  const root = tmp('team');
  try {
    const cfg: WizardConfig = { toolkitDir: root, bash: 'bash', mendixDir: root, org: 'Test-Org', adminTokenFile: path.join(root, 'none') };
    const on = new Set<ProjectRole>();
    const hires: { role: ProjectRole; by: string; account?: string; task?: string; model?: string }[] = [];
    const queued: string[] = [];
    let refuse: ProjectRole | undefined = 'lead-developer';
    const steps = setup({
      cfg,
      hired: (_floor, role) => on.has(role),
      hire: async (_floor, role, by, account, task, model) => {
        if (role === refuse) return 'The floor is paused';
        hires.push({ role, by, account, task, model });
        on.add(role);
        return undefined;
      },
      queue: (_floor, prompt) => (queued.push(prompt), undefined),
    });
    const job = Object.assign(jobIn(root, plan()), { issue: 7, account: 'acct-1' });

    // One refused: the step fails saying who was hired so far, and a Retry carries on without hiring them again.
    await assert.rejects(steps.team(job, io), /Couldn't hire the Lead Developer: The floor is paused \(hired so far: Project Coordinator\)/);
    refuse = undefined;
    const r = await steps.team(job, io);
    assert.equal(r.status, 'done');
    assert.equal(r.detail, 'hired Lead Developer, Chief Analyst / Consultant; already there: Project Coordinator');
    assert.deepEqual(hires.map((h) => h.role), ['pm', 'lead-developer', 'chief-analyst'], 'each once, in the roster order');
    assert.ok(hires.every((h) => h.by === 'Probe' && h.account === 'acct-1'));
    assert.match(hires[2].task ?? '', /issue #7/);
    assert.equal(hires[2].model, 'opus', "the Chief Analyst is hired on the wizard's Discovery model for it");
    assert.equal(hires[0].task, undefined);
    assert.equal(hires[0].model, undefined, "every other role on its own model");

    const again = await steps.team(job, io);
    assert.equal(again.status, 'skipped');
    assert.equal(hires.length, 3, 'nobody is hired twice');

    const q = await steps.queue(job, io);
    assert.equal(q.status, 'skipped');
    assert.match(q.detail ?? '', /went to the Chief Analyst/);
    assert.deepEqual(queued, []);

    // No Chief Analyst on the team: the issue is queued for a worker as before.
    const other = Object.assign(jobIn(root, plan({ roles: ['pm'] })), { issue: 8 });
    await steps.team(other, io);
    await steps.queue(other, io);
    assert.equal(queued.length, 1);

    // Nothing ticked, or the offline test office: nobody is hired.
    assert.equal((await steps.team(jobIn(root, plan({ roles: [] })), io)).status, 'skipped');
    const offline = setup({ cfg: { ...cfg, offlineDir: root }, hire: async () => assert.fail('hired offline') });
    assert.match((await offline.team(job, io)).detail ?? '', /offline/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Chief Analyst handed the Discovery issue is hired on the Discovery dropdown's model", async () => {
  const root = tmp('model');
  try {
    const cfg: WizardConfig = { toolkitDir: root, bash: 'bash', mendixDir: root, org: 'Test-Org', adminTokenFile: path.join(root, 'none') };
    const hires: { role: ProjectRole; model?: string }[] = [];
    const steps = setup({ cfg, hire: async (_f, role, _by, _acct, _task, model) => (hires.push({ role, model }), undefined) });
    await steps.team(Object.assign(jobIn(root, plan({ discovery: { issue: true, queue: true, model: 'sonnet' } })), { issue: 3 }), io);
    assert.deepEqual(hires, [{ role: 'pm', model: undefined }, { role: 'lead-developer', model: undefined }, { role: 'chief-analyst', model: 'sonnet' }]);
    // Not handed the issue (not asked to queue it): the Chief Analyst is on its role's own model too.
    hires.length = 0;
    await steps.team(Object.assign(jobIn(root, plan({ roles: ['chief-analyst'], discovery: { issue: true, queue: false, model: 'haiku' } })), { issue: 3 }), io);
    assert.deepEqual(hires, [{ role: 'chief-analyst', model: undefined }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('editing the answers hires only the roles ticked since, and never one the floor has had in any state', async () => {
  const root = tmp('edit');
  try {
    const cfg: WizardConfig = { toolkitDir: root, bash: 'bash', mendixDir: root, org: 'Test-Org', adminTokenFile: path.join(root, 'none') };
    const book = new JobBook(path.join(root, 'jobs'));
    // On the floor: the Project Coordinator at work, the Lead Designer benched, the Lead Tester sent home.
    const known = new Set<ProjectRole>(['pm', 'lead-designer', 'lead-tester']);
    const hires: { role: ProjectRole; task?: string; model?: string }[] = [];
    let refuse: ProjectRole | undefined;
    const steps = setup({
      cfg,
      hired: (_f, role) => role === 'pm',
      known: (_f, role) => known.has(role),
      hire: async (_f, role, _by, _acct, task, model) => {
        if (role === refuse) return 'The floor is paused';
        hires.push({ role, task, model });
        known.add(role);
        return undefined;
      },
    });
    const job = Object.assign(jobIn(root, plan({ roles: ['pm'] })), { issue: 7 });
    book.add(job);
    for (const s of SETUP_STEPS) job.steps[s.id] = { status: 'done' };

    // Nothing added: the team step isn't run again.
    book.edit(job, plan({ roles: ['pm'], clients: ['Other'] }), ['intake']);
    assert.deepEqual(job.addRoles, []);
    assert.equal(job.steps.team.status, 'done');
    assert.equal(job.steps.intake.status, 'pending');

    // Added: the Lead Developer and Chief Analyst (new), the Lead Designer and Lead Tester (the floor has had them).
    book.edit(job, plan({ roles: ['pm', 'lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst'] }), ['intake']);
    assert.deepEqual(job.addRoles, ['lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst']);
    assert.equal(job.steps.team.status, 'pending');
    refuse = 'chief-analyst';
    await assert.rejects(steps.team(job, io), /Couldn't hire the Chief Analyst/);
    assert.deepEqual(job.addRoles, ['lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst'], 'kept for the Retry');
    refuse = undefined;
    const r = await steps.team(job, io);
    assert.equal(r.status, 'done');
    assert.equal(r.detail, 'hired Chief Analyst / Consultant; already on the floor: Lead Designer, Lead Developer, Lead Tester');
    assert.deepEqual(hires.map((h) => h.role), ['lead-developer', 'chief-analyst'], 'each once, nobody the floor had');
    assert.ok(hires.every((h) => h.task === undefined && h.model === undefined), "an edit doesn't hand the Discovery issue out again");
    assert.deepEqual(job.addRoles, []);

    // A role ticked and then unticked again before the team step hired it is dropped.
    book.edit(job, plan({ roles: ['pm', 'lead-designer'] }), []);
    assert.deepEqual(job.addRoles, [], 'the Lead Designer was ticked before');
    book.edit(job, plan({ roles: ['pm', 'lead-designer', 'lead-developer'] }), []);
    assert.deepEqual(job.addRoles, ['lead-developer']);
    job.steps.team = { status: 'failed' };
    book.edit(job, plan({ roles: ['pm', 'lead-designer'] }), []);
    assert.deepEqual(job.addRoles, [], 'unticked again before it was hired');

    // A setup whose team step never finished hires everything ticked, as it would have.
    const fresh = Object.assign(jobIn(root, plan({ roles: ['pm'] })), { issue: 9 });
    book.add(fresh);
    book.edit(fresh, plan({ roles: ['pm', 'lead-developer'] }), ['intake']);
    assert.equal(fresh.addRoles, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("interview mode is the toolkit's word (steering, assist, auto), and the old attended/unattended read as steering/auto", () => {
  assert.equal(interviewModeOf('attended'), 'steering');
  assert.equal(interviewModeOf('unattended'), 'auto');
  assert.equal(interviewModeOf('assist'), 'assist');
  assert.equal(interviewModeOf('loud'), 'steering', 'anything unknown asks too much, as the toolkit does');
  const p = cleanPlan({ name: 'good', entry: 'greenfield', mendix: '11.12.4', interview: 'unattended' }, ['11.12.4'], 'Org');
  assert.ok(typeof p !== 'string');
  assert.equal(p.interview, 'auto');

  const job = newJob(plan({ interview: 'auto' }), 'Probe');
  const q9 = intakeAnswersOf(job).find((a) => a.n === 9)!;
  assert.match(q9.text, /^unattended — Interview mode: auto \(/, 'Q9 asks attended or unattended, so the answer says which as well');
  assert.match(intakeAnswersOf(newJob(plan({ interview: 'assist' }), 'Probe')).find((a) => a.n === 9)!.text, /^attended — Interview mode: assist/);
  assert.deepEqual(decisionsOf(job).flat.find(([k]) => k === 'Interview mode'), ['Interview mode', 'auto']);
});

const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const resolver = path.join(os.homedir(), 'agent-spike', 'mxcli-project-toolkit', 'bin', 'interview-mode.sh');
test("the toolkit's interview-mode.sh reads the register line the wizard writes", { skip: !existsSync(resolver) || (process.platform === 'win32' && !existsSync(bash)) ? 'no toolkit clone here' : false }, () => {
  const dir = tmp('mode');
  try {
    for (const mode of ['steering', 'assist', 'auto'] as const) {
      const md = recordDecisions('# PROJECT.md\n\nExec approval: auto\n\n## Decisions\n', decisionsOf(newJob(plan({ interview: mode }), 'Probe')).flat, []);
      writeFileSync(path.join(dir, 'PROJECT.md'), md);
      const out = execFileSync(bash, [resolver, dir.replace(/\\/g, '/'), '--explain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_INTERVIEW_MODE: '' } });
      assert.match(out, new RegExp(`mode:\\s+${mode}\\b`));
      assert.match(out, /from:\s+PROJECT\.md/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("offline: the new app goes up with the scaffold in one commit, through the toolkit's mxbuild gate, its build output ignored", { skip: process.platform === 'win32' && !existsSync(bash) ? 'no Git Bash' : false }, async () => {
  const root = tmp('app-commit');
  try {
    const projects = path.join(root, 'projects');
    const cfg: WizardConfig = { toolkitDir: root, bash, mendixDir: path.join(root, 'Mendix'), org: 'Test-Org', adminTokenFile: path.join(root, 'none'), offlineDir: path.join(root, 'github') };
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'Probe', GIT_AUTHOR_EMAIL: 'p@x', GIT_COMMITTER_NAME: 'Probe', GIT_COMMITTER_EMAIL: 'p@x' };
    const steps = setup({ cfg, env: gitEnv, projectsDir: () => projects, adoptFloor: (_repo, d) => ({ id: 'travel-approval', dir: d }) });
    const job = newJob(plan({ discovery: { issue: false, queue: false, model: 'opus' } }), 'Probe');
    const io2 = { log: (l: string) => logged.push(l) };
    const logged: string[] = [];
    for (const id of ['repo', 'clone'] as StepId[]) await steps[id](job, io2);
    const dir = job.dir!;
    // What mx create-project and init-project.sh leave: the app, its build output, and the gate's scripts.
    writeFileSync(path.join(dir, 'TravelApproval.mpr'), 'model');
    mkdirSync(path.join(dir, 'deployment', 'model'), { recursive: true });
    writeFileSync(path.join(dir, 'deployment', 'model', 'x.mda'), '');
    mkdirSync(path.join(dir, 'bin'));
    writeFileSync(path.join(dir, 'bin', 'model-stamp.sh'), 'exit 1\n');
    writeFileSync(path.join(dir, 'bin', 'verify-model.sh'), 'echo "gate with $MXBUILD_PATH" > "$(dirname "$0")/../verified.txt"\necho "mxbuild: 0 errors"\n');
    const app = await steps.app(job, io2);
    assert.match(app.detail ?? '', /already there \(TravelApproval\.mpr\); \.gitignore updated/);
    const commit = await steps.commit(job, io2);
    assert.equal(commit.detail, 'committed, pushed');
    assert.match(readFileSync(path.join(dir, 'verified.txt'), 'utf8'), /gate with .*11\.12\.4.*mxbuild/, "the gate ran with the picked Studio Pro's mxbuild");
    const bare = path.join(cfg.offlineDir!, 'Test-Org', 'travel-approval.git');
    const pushed = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' });
    assert.match(pushed, /^TravelApproval\.mpr$/m);
    assert.match(pushed, /^\.gitignore$/m);
    assert.doesNotMatch(pushed, /^deployment\//m);
    assert.match(execFileSync('git', ['--git-dir', bare, 'log', '-1', '--format=%s', 'main'], { encoding: 'utf8' }), /^Toolkit scaffold and Mendix app/);

    // Once it's committed, nothing runs the gate again.
    rmSync(path.join(dir, 'verified.txt'));
    writeFileSync(path.join(dir, 'notes.md'), 'more');
    await steps.commit(job, io2);
    assert.ok(!existsSync(path.join(dir, 'verified.txt')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
