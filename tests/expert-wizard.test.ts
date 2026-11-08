// Expert mode's New project wizard (shared/expert-setup.ts, server/expert/create.ts, server/wizard/expert-step.ts):
// the form's defaults and checks, the plan it makes (mode 'expert', Team Server with no GitHub mirror, no team, no
// Discovery), the setup's Expert steps round the usual ones (marked Expert on the office, the brief as a file, the
// model, demo users and budget saved, no gates, issue or team), the session started on the chosen model with no
// prompt, and the routes' refusals. Team Server and the Mendix Portal are never called: the inner steps are fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETUP_STEPS, type ProjectPlan, type StepId } from '../src/shared/wizard.js';
import { blankExpertForm, cleanExpertPlan, DEFAULT_EXPERT_MODEL, EXPERT_BRIEF_FILE, EXPERT_BRIEF_MAX, expertFormProblem, expertSetupGroups, oneParagraph, type ExpertForm } from '../src/shared/expert-setup.js';
import { expertPlanOf, readForm } from '../src/server/expert/create.js';
import { cleanPlan } from '../src/server/wizard/plan.js';
import { newJob, type JobState, type StepImpl } from '../src/server/wizard/job.js';
import { withExpert, withMxcliVersion, type ExpertStepDeps } from '../src/server/wizard/expert-step.js';
import { expertSettingsOf, sessionModelOf } from '../src/server/expert/settings.js';
import { ensureSession } from '../src/server/expert/session-worker.js';
import { expertCreateRoutes } from '../src/server/http/routes/expert-create.js';
import { Building, type FloorDef } from '../src/server/building.js';

const VERSIONS = ['10.24.0', '11.12.4', '11.15.0'];
const APP_ID = '1a2b3c4d-1111-2222-3333-444455556666';
const tmp = (n: string) => mkdtempSync(path.join(os.tmpdir(), `expert-wizard-${n}-`));
const form = (over: Partial<ExpertForm> = {}): ExpertForm => ({ ...blankExpertForm(VERSIONS, '11.15.0'), name: 'Order Desk', ...over });
const online = { versions: VERSIONS, org: 'Test-Org', offline: false, mendixToken: true };

test('the form starts on Mendix 11.12.4, Sonnet, the latest pins, demo users on locally and an $800 budget', () => {
  const f = blankExpertForm(VERSIONS, '11.15.0');
  assert.equal(f.mendix, '11.12.4');
  assert.equal(f.model, DEFAULT_EXPERT_MODEL);
  assert.equal(f.model, 'sonnet');
  assert.deepEqual([f.toolkit, f.mxcli, f.app, f.demoUsers, f.budget], ['latest', 'latest', 'create', true, 800]);
  // Without 11.12.4 on the machine, the Team wizard's own default.
  assert.equal(blankExpertForm(['11.15.0'], '11.15.0').mendix, '11.15.0');
});

test('the form is checked the same way on the page and in the office', () => {
  assert.equal(expertFormProblem(form(), VERSIONS), undefined);
  assert.match(String(expertFormProblem(form({ name: '' }), VERSIONS)), /name/);
  assert.match(String(expertFormProblem(form({ name: '!!' }), VERSIONS)), /Project name/);
  assert.match(String(expertFormProblem(form({ mendix: '9.0.0' }), VERSIONS)), /isn't installed/);
  assert.match(String(expertFormProblem(form({ app: 'connect' }), VERSIONS)), /App ID/);
  assert.equal(expertFormProblem(form({ app: 'connect', appId: APP_ID }), VERSIONS), undefined);
  assert.match(String(expertFormProblem(form({ budget: 0 }), VERSIONS)), /budget/);
  assert.match(String(expertFormProblem(form({ budget: Number.NaN }), VERSIONS)), /budget/);
  assert.match(String(expertFormProblem(form({ toolkit: 'main; rm' }), VERSIONS)), /toolkit/);
  assert.match(String(expertFormProblem(form({ mxcli: 'nightly' }), VERSIONS)), /mxcli/);
  assert.equal(expertFormProblem(form({ toolkit: 'abc1234', mxcli: 'v0.21.0' }), VERSIONS), undefined);
  assert.match(String(expertFormProblem(form({ model: 'haiku' as never }), VERSIONS)), /Sonnet or Opus/);
  assert.match(String(expertFormProblem(form({ brief: 'x'.repeat(EXPERT_BRIEF_MAX + 1) }), VERSIONS)), /one paragraph/);
  assert.equal(oneParagraph('  An app.\n\nFor people.  '), 'An app. For people.');
});

test('Create makes an Expert plan on Team Server with no GitHub mirror, no team and no Discovery; cleanPlan keeps it', () => {
  const plan = expertPlanOf({ ...form({ model: 'opus', brief: 'Orders for a small warehouse. Pickers see what to pack.' }), roles: ['pm'], discovery: { issue: true } }, online, 'Sam') as ProjectPlan;
  assert.equal(typeof plan, 'object');
  assert.equal(plan.mode, 'expert');
  assert.equal(plan.name, 'order-desk');
  assert.equal(plan.owner, 'Test-Org');
  assert.deepEqual(plan.teamServer, { mirror: false });
  assert.equal(plan.localOnly, true, 'Team Server alone: no GitHub');
  assert.deepEqual(plan.roles, [], 'no team, whatever the request said');
  assert.deepEqual([plan.discovery.issue, plan.discovery.queue], [false, false]);
  assert.equal(plan.description, 'Orders for a small warehouse.');
  assert.deepEqual(plan.expert, { model: 'opus', toolkit: 'latest', mxcli: 'latest', demoUsers: true, budget: 800, brief: 'Orders for a small warehouse. Pickers see what to pack.', title: 'Order Desk' });
  const again = cleanPlan(plan, VERSIONS, 'Test-Org') as ProjectPlan;
  assert.equal(again.mode, 'expert');
  assert.deepEqual(again.expert, plan.expert);
  assert.deepEqual(again.teamServer, { mirror: false });
  assert.equal(again.localOnly, true);
  // A Team plan never picks Expert fields up from half a request.
  assert.equal((cleanPlan({ ...plan, mode: 'team' }, VERSIONS, 'Test-Org') as ProjectPlan).expert, undefined);
  assert.equal(cleanExpertPlan({ toolkit: 'latest', mxcli: 'latest', budget: -1 }), undefined);
});

test('Connect existing uses the pasted App ID; no Mendix account refuses; a test office never calls the Portal', () => {
  const linked = expertPlanOf(form({ app: 'connect', appId: `  ${APP_ID.toUpperCase()} ` }), online, 'Sam') as ProjectPlan;
  assert.deepEqual(linked.teamServer, { mirror: false, projectId: APP_ID });
  assert.match(String(expertPlanOf(form(), { ...online, mendixToken: false }, 'Sam')), /Connect your Mendix account/);
  const offline = expertPlanOf(form(), { ...online, offline: true, mendixToken: false }, 'Sam') as ProjectPlan;
  assert.equal(offline.teamServer, undefined);
  assert.equal(offline.localOnly, undefined);
  assert.equal(offline.mode, 'expert');
  assert.match(String(expertPlanOf({ name: 'x' }, online, 'Sam')), /Project name/);
  assert.equal(readForm({ model: undefined }).model, 'sonnet', 'no model sent: Sonnet');
});

/** Fake inner steps: each records that it ran and says done; clone puts the project at `dir` as floor `f1`. */
function fakeSteps(dir: string, ran: StepId[]): Record<StepId, StepImpl> {
  const out = {} as Record<StepId, StepImpl>;
  for (const s of SETUP_STEPS) {
    out[s.id] = async (job) => {
      ran.push(s.id);
      if (s.id === 'clone') Object.assign(job, { dir, floor: 'f1' });
      if (s.id === 'env') {
        mkdirSync(path.join(dir, '.claude'), { recursive: true });
        writeFileSync(path.join(dir, '.claude', 'toolkit.env'), 'MXBUILD_PATH=C:/mx\nMXCLI_VERSION=nightly\n');
      }
      if (s.id === 'settings') writeFileSync(path.join(dir, 'agent-office.project.json'), JSON.stringify({ repo: 'Test-Org/order-desk', roles: [] }));
      return { status: 'done', detail: `inner ${s.id}` };
    };
  }
  return out;
}

test('the Expert steps mark the project Expert mode, pin the tools, save the brief, model, demo users and budget, and hire nobody', async () => {
  const root = tmp('steps');
  try {
    const dir = path.join(root, 'order-desk');
    mkdirSync(dir, { recursive: true });
    const ran: StepId[] = [];
    const calls: string[] = [];
    const deps: ExpertStepDeps = {
      setMode: (f, title) => void calls.push(`mode ${f} ${title}`),
      setBudget: (f, total, by) => void calls.push(`budget ${f} ${total} ${by}`),
      pinToolkit: async (sha) => (calls.push(`pin ${sha}`), { sha, dir: path.join(root, 'pins', sha) }),
      mxcliLatest: async () => 'v0.21.0',
    };
    const steps = withExpert(deps, fakeSteps(dir, ran));
    const plan = expertPlanOf(form({ toolkit: 'abc1234def', brief: 'Orders for a small warehouse.\nPickers see what to pack.' }), online, 'Sam') as ProjectPlan;
    const job: JobState = newJob(plan, 'Sam');
    const io = { log: () => undefined };
    const results: Record<string, { status: string; detail?: string }> = {};
    for (const s of SETUP_STEPS) results[s.id] = await steps[s.id](job, io);

    assert.deepEqual(ran, ['repo', 'clone', 'env', 'app', 'init', 'hooks', 'settings', 'commit'], 'the same create, connect, commit and push as Team mode; no intake answers, decisions, gates, issue, team or queue');
    for (const s of ['decisions', 'gates', 'issue', 'team', 'queue'] as const) assert.equal(results[s].status, 'skipped', `${s} skipped`);
    assert.ok(calls.includes('mode f1 Order Desk'), 'marked Expert mode once cloned, titled as typed');
    assert.ok(calls.includes('pin abc1234def'), 'the picked toolkit commit pinned before init');
    assert.equal(job.toolkit?.sha, 'abc1234def');
    assert.match(readFileSync(path.join(dir, '.claude', 'toolkit.env'), 'utf8'), /^MXCLI_VERSION=v0\.21\.0$/m, 'latest mxcli: the office release, written for the toolkit');
    const brief = readFileSync(path.join(dir, ...EXPERT_BRIEF_FILE.split('/')), 'utf8');
    assert.match(brief, /^# Order Desk\n\nOrders for a small warehouse\. Pickers see what to pack\.\n/);
    assert.match(brief, /never sends it to the session/);
    const saved = JSON.parse(readFileSync(path.join(dir, 'agent-office.project.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(saved.mode, 'expert');
    assert.deepEqual(saved.expert, { model: 'sonnet', demoUsers: true, mxcli: 'v0.21.0', title: 'Order Desk' });
    assert.equal(saved.repo, 'Test-Org/order-desk', 'the usual settings kept');
    assert.deepEqual(calls.filter((c) => c.startsWith('budget')), ['budget f1 800 Sam'], 'the budget set once');
    // A Retry runs settings again: the budget isn't set twice; the brief isn't rewritten.
    await steps.settings(job, io);
    assert.equal(calls.filter((c) => c.startsWith('budget')).length, 1);
    assert.equal((await steps.intake(job, io)).status, 'skipped');
    // The session starts on the model the wizard saved.
    assert.equal(expertSettingsOf(dir).model, 'sonnet');
    assert.equal(sessionModelOf(dir), 'sonnet');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a Team plan goes through the Expert wrapper untouched', async () => {
  const root = tmp('team');
  try {
    const ran: StepId[] = [];
    const deps: ExpertStepDeps = { setMode: () => assert.fail('no mode for a Team plan'), setBudget: () => assert.fail('no budget here'), pinToolkit: async () => assert.fail('no pin'), mxcliLatest: async () => assert.fail('no mxcli') };
    const steps = withExpert(deps, fakeSteps(root, ran));
    const plan = cleanPlan({ name: 'travel-approval', entry: 'greenfield', mendix: '11.12.4', roles: ['pm'] }, VERSIONS, 'Test-Org') as ProjectPlan;
    const job = newJob(plan, 'Sam');
    for (const s of SETUP_STEPS) await steps[s.id](job, { log: () => undefined });
    assert.deepEqual(ran, SETUP_STEPS.map((s) => s.id));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no brief: nothing is written and the step says the session asks what it needs; MXCLI_VERSION replaced in place', async () => {
  const root = tmp('nobrief');
  try {
    const steps = withExpert({ setMode: () => undefined, setBudget: () => undefined, pinToolkit: async (sha) => ({ sha, dir: root }), mxcliLatest: async () => undefined }, fakeSteps(root, []));
    const job = Object.assign(newJob(expertPlanOf(form(), online, 'Sam') as ProjectPlan, 'Sam'), { dir: root, floor: 'f1' });
    const r = await steps.intake(job, { log: () => undefined });
    assert.equal(r.status, 'skipped');
    assert.match(String(r.detail), /session asks/);
    assert.equal(existsSync(path.join(root, 'docs')), false);
    assert.equal(withMxcliVersion('A=1\nMXCLI_VERSION=nightly\nB=2\n', 'v0.22.0'), 'A=1\nMXCLI_VERSION=v0.22.0\nB=2\n');
    assert.equal(withMxcliVersion('', 'v0.22.0'), 'MXCLI_VERSION=v0.22.0\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the session starts on the saved model with no prompt (the brief is never typed into it); an attached folder keeps the person’s default', async () => {
  const root = tmp('session');
  try {
    writeFileSync(path.join(root, 'agent-office.project.json'), JSON.stringify({ mode: 'expert', expert: { model: 'opus', demoUsers: false } }));
    const spawned: unknown[][] = [];
    const worker = { id: 'w1', status: 'starting' } as Record<string, unknown>;
    const floor = {
      plan: { wing: 0 },
      workers: {
        list: () => [],
        deskOccupied: () => false,
        spawn: async (...args: unknown[]) => (spawned.push(args), worker),
        rename: () => undefined,
      },
    } as never;
    const r = await ensureSession(floor, 'Sam', 'acct-1', sessionModelOf(root));
    assert.equal(r, worker);
    assert.equal(spawned.length, 1);
    const [, by, prompt, worktree, kind, provider, model] = spawned[0];
    assert.deepEqual([by, prompt, worktree, kind, provider, model], ['Sam', undefined, false, 'agent', 'claude', 'opus']);
    assert.equal(worker.session, true);
    assert.equal(expertSettingsOf(root).demoUsers, false);
    const bare = tmp('bare');
    assert.equal(sessionModelOf(bare), undefined, 'no wizard settings: no --model');
    rmSync(bare, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the building marks a project Expert mode and keeps it after a restart', () => {
  const root = tmp('building');
  try {
    const dataDir = path.join(root, '.agent-office');
    const dir = path.join(root, 'p', 'order-desk');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dataDir, 'floors.json'), JSON.stringify([{ id: 'order-desk', name: 'order-desk', dir, palette: 0, addedBy: 'Sam', addedAt: 1 }]));
    const b = new Building(dataDir, root);
    const def = b.setMode('order-desk', 'expert', 'Order Desk') as FloorDef;
    assert.deepEqual([def.mode, def.name], ['expert', 'Order Desk'], 'titled as typed in the wizard');
    assert.match(String(b.setMode('nope', 'expert')), /No such project/);
    assert.deepEqual([new Building(dataDir, root).list()[0].mode, new Building(dataDir, root).list()[0].name], ['expert', 'Order Desk']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the progress shows the Expert setup in its own words: Team Server app, toolkit and mxcli, the session; no team', () => {
  const plan = expertPlanOf(form(), online, 'Sam') as ProjectPlan;
  const steps = SETUP_STEPS.map((s) => ({ id: s.id, label: s.label, status: (['repo', 'clone'].includes(s.id) ? 'done' : s.id === 'env' ? 'running' : 'pending') as never }));
  const groups = expertSetupGroups({ steps, status: 'running', plan });
  assert.deepEqual(groups.map((g) => g.name), ['Team Server app', 'Mendix app', 'Toolkit and mxcli', 'Settings and first push', 'Session']);
  assert.deepEqual(groups.map((g) => g.status), ['done', 'running', 'pending', 'pending', 'pending']);
  assert.match(groups[0].say, /Create the app on Team Server/);
  assert.match(groups[4].say, /No team is hired/);
  assert.deepEqual(groups[0].steps.map((s) => s.label), ['Create the app on Team Server', 'Clone it here'], 'no GitHub in the words');
  assert.match(expertSetupGroups({ steps, status: 'running', plan: { ...plan, teamServer: { mirror: false, projectId: APP_ID } } })[0].say, /Connect the existing app/);
});

test('Create is for admins, from the office’s own pages', async () => {
  const call = async (admin: boolean, origin: string) => {
    let status = 0;
    const res = { writeHead: (s: number) => (status = s), end: () => undefined } as never;
    const req = { headers: { origin, host: 'office.test' } } as never;
    const ctx = { cfg: { dataDir: tmp('route') }, meOf: () => ({ admin }) } as never;
    await expertCreateRoutes.create.handle(ctx, { req, res, session: {} } as never);
    return status;
  };
  assert.equal(await call(true, 'http://elsewhere.test'), 403);
  assert.equal(await call(false, 'http://office.test'), 403);
});
