// Team shapes and team coverage (shared/roster/coverage.ts): the defaults (every project before shapes is
// Enterprise with each team covering itself), routing through coverage (relays and the standup page to
// whoever covers Management, subagents to whoever covers their team, skills as the union with the
// strictest gate, deliverables per covered team), the wizard's recommendation and its plan per shape,
// the budget per shape and level, and an Enterprise regression suite that runs today's flows unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { Roster } from '../src/server/roster/index.js';
import { freshRoster, reviveRoster } from '../src/server/roster/store.js';
import { setShape } from '../src/server/roster/coverage.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { playbook, type PlaybookContext } from '../src/server/roster/playbooks.js';
import { deliverablesBrief } from '../src/server/roster/deliverables-brief.js';
import { primePrompt } from '../src/server/roster/prompts.js';
import { alsoCovers, cleanCoverage, coveredBy, coveredNote, defaultCoverage, isIdentity, managerOf, ownerOfSubagent, SHAPES, shapeForRoles, standupRoles, subagentDefsOf, TEAM_OWNER, writerOf } from '../src/shared/roster/coverage.js';
import { ROLE_BY_ID, ROLES, standupPath, type RoleId } from '../src/shared/roster/roles.js';
import { effectiveSkill, skillsFor } from '../src/shared/roster/skills.js';
import { breadthOf, driverOf, integrationsOf, recommendShape, smeOf } from '../src/shared/roster/recommend.js';
import { estimateFor, generatePlan, planTotal } from '../src/shared/budget/plan.js';
import { shapeCards } from '../src/shared/budget/shape-cards.js';
import { cleanPlan } from '../src/server/wizard/plan.js';
import { discoveryRole, setupSteps, type SetupDeps } from '../src/server/wizard/steps.js';
import { newJob, type JobState } from '../src/server/wizard/job.js';
import type { IntakeAnswer, ProjectPlan, ProjectRole } from '../src/shared/wizard.js';

// ---- A fake floor (no real agents: hiring makes a WorkerInfo) ------------------------------------

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'travel-approval';
  dir = mkdtempSync(path.join(os.tmpdir(), 'shapes-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string }[] = [];
  hires: HireAsk[] = [];
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk) {
    this.hires.push(ask);
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', model: ask.model, deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: 0, prompt: ask.prompt, cols: 80, rows: 24, viewers: [], viewerIds: [], worktree: { path: `wt/${id}`, branch: `agent/${id}` } } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.map.delete(id);
    this.roster.onWorkerGone(this, id);
  }
  prompt(id: string, text: string) {
    const w = this.map.get(id);
    if (!w || w.status === 'exited' || w.status === 'offline') return 'Worker is not running';
    this.prompts.push({ id, text });
    return undefined;
  }
  wake() {
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  set(id: string, status: WorkerStatus) {
    Object.assign(this.map.get(id)!, { status });
    this.roster.onWorker(this, this.map.get(id)!);
  }
}

function setup(shape?: 'solo' | 'startup' | 'enterprise') {
  const clock = { now: Date.UTC(2026, 9, 6, 9, 0) };
  const floor = new FakeFloor();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'shapes-data-'));
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({ number: 42 }), analysis: () => 'runs: 3', now: () => clock.now }, 0);
  floor.roster = roster;
  const data = () => roster.data(floor.id);
  data().settings.schedule.enabled = false;
  if (shape) setShape(roster, floor, shape, 'Probe');
  return { clock, floor, roster, data };
}

type T = ReturnType<typeof setup>;
async function hireAt(t: T, role: RoleId) {
  assert.equal(await t.roster.members.hire(t.floor, role, 'Probe'), undefined);
  const id = t.data().members[role].workerId!;
  t.floor.set(id, 'working');
  t.floor.set(id, 'done');
  t.floor.prompts.length = 0;
  return id;
}
const tick = () => new Promise((r) => setImmediate(r));

const names = Object.fromEntries(ROLES.map((r) => [r.id, r.title.split(' ')[0]])) as Record<RoleId, string>;
const ctx = (over: Partial<PlaybookContext> = {}): PlaybookContext => ({ project: 'travel-approval', name: 'Sam', level: 2, lessons: '.ai-context/skills/project-lessons/SKILL.md', names, earlyDrafts: true, ...over });

// ---- Coverage defaults ---------------------------------------------------------------------------

test('a roster from before shapes is Enterprise with every team covering itself', () => {
  const fresh = freshRoster(() => 0.3);
  assert.equal(fresh.shape, 'enterprise');
  assert.deepEqual(fresh.coverage, TEAM_OWNER);
  const old = reviveRoster({ settings: {}, members: { pm: { name: 'Ada', model: 'sonnet', phase: 'active' } } });
  assert.equal(old.shape, 'enterprise');
  assert.ok(isIdentity(old.coverage));
  assert.equal(old.members['solo-lead'].phase, 'none', 'the new role is there, never hired');
  // A saved coverage with a bad entry keeps the rest and gets the shape's default for that team.
  const odd = cleanCoverage({ design: 'nobody', testing: 'lead-developer' }, 'enterprise');
  assert.equal(odd.design, 'lead-designer');
  assert.equal(odd.testing, 'lead-developer');
});

test('each shape covers every team, with one writer and one member covering Management', () => {
  assert.deepEqual(defaultCoverage('solo'), { management: 'solo-lead', design: 'solo-lead', development: 'solo-lead', testing: 'solo-lead', analysis: 'solo-lead' });
  const s = defaultCoverage('startup');
  assert.equal(managerOf(s), 'chief-analyst');
  assert.deepEqual(coveredBy(s, 'chief-analyst'), ['management', 'analysis', 'design']);
  assert.deepEqual(coveredBy(s, 'lead-developer'), ['development', 'testing']);
  assert.equal(writerOf(s), 'lead-developer');
  assert.equal(writerOf(defaultCoverage('solo')), 'solo-lead');
  assert.deepEqual(standupRoles(defaultCoverage('enterprise')), ['lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst']);
  assert.deepEqual(standupRoles(s), ['lead-developer', 'chief-analyst']);
  assert.deepEqual(standupRoles(defaultCoverage('solo')), ['solo-lead']);
  for (const shape of ['solo', 'startup', 'enterprise'] as const) assert.deepEqual([...new Set(Object.values(defaultCoverage(shape)))].sort(), [...SHAPES[shape].roles].sort(), `${shape}: its roles cover everything`);
});

test('subagents belong to whoever covers their team', () => {
  const s = defaultCoverage('startup');
  assert.deepEqual(subagentDefsOf(s, 'chief-analyst').map((x) => x.id), ['business-analyst', 'data-analyst', 'ui-ux-designer']);
  assert.deepEqual(subagentDefsOf(s, 'lead-developer').map((x) => x.id), ['developer', 'tester']);
  assert.equal(ownerOfSubagent(s, 'tester'), 'lead-developer');
  assert.equal(ownerOfSubagent(s, 'ui-ux-designer'), 'chief-analyst');
  const solo = defaultCoverage('solo');
  assert.deepEqual(subagentDefsOf(solo, 'solo-lead').map((x) => x.id).sort(), ['business-analyst', 'data-analyst', 'developer', 'tester', 'ui-ux-designer']);
  assert.equal(ownerOfSubagent(solo, 'developer'), 'solo-lead');
  assert.deepEqual(subagentDefsOf(TEAM_OWNER, 'lead-tester'), ROLE_BY_ID.get('lead-tester')!.subagents, 'Enterprise: its own');
});

test('a member covering several roles has the union of their skills, the strictest gate winning', () => {
  const s = defaultCoverage('startup');
  const also = alsoCovers(s, 'chief-analyst');
  assert.deepEqual(also.sort(), ['lead-designer', 'pm']);
  const keys = skillsFor('chief-analyst', also).map((k) => k.key);
  assert.ok(keys.includes('nudge-lead'), "the Coordinator's managing-down");
  assert.ok(keys.includes('bench'), 'its own subagents');
  assert.ok(keys.includes('craft:design-artifacts'), "the Designer's craft");
  assert.equal(new Set(keys).size, keys.length, 'each skill once');
  // reassign-lead (pm) and swap-model (lead) both start at ask: still ask; a role whose gate is stricter wins.
  assert.equal(effectiveSkill('chief-analyst', 1, 'swap-model', {}, also)?.gate, 'ask');
  // The Solo Lead keeps its own short craft list rather than every role's.
  const solo = skillsFor('solo-lead', alsoCovers(defaultCoverage('solo'), 'solo-lead')).filter((k) => k.group === 'craft');
  assert.deepEqual(solo.map((k) => k.title), ROLE_BY_ID.get('solo-lead')!.toolkitSkills);
});

// ---- Routing through coverage on a fake floor ------------------------------------------------------

test('Startup: a Lead Developer escalation is relayed to the Chief Analyst, who covers Management', async () => {
  const t = setup('startup');
  const ca = await hireAt(t, 'chief-analyst');
  const dev = await hireAt(t, 'lead-developer');
  const e = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'urgent', trigger: 'blocked', title: 'No test DB', details: '', options: [] });
  assert.deepEqual(t.data().outbox.escalations, [e.id], 'queued for the member covering Management, not dropped');
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), true);
  const told = t.floor.prompts.filter((p) => p.id === ca);
  assert.equal(told.length, 1);
  assert.match(told[0].text, /“No test DB”/);
});

test('Solo: the Solo Lead is not relayed its own escalations, and a proposal decision is its note only', async () => {
  const t = setup('solo');
  const solo = await hireAt(t, 'solo-lead');
  t.roster.escalations.raise(t.floor, t.floor.worker(solo)!, { urgency: 'urgent', trigger: 'blocked', title: 'Which SSO?', details: '', options: [] });
  assert.deepEqual(t.data().outbox.escalations, []);
  t.data().proposals.push({ id: 'p1', standup: '2026-10-06', role: 'solo-lead', team: 'development', by: 'Sam', kind: 'task', title: 'Add audit trail', detail: '', status: 'pending' });
  assert.equal(await t.roster.standups.decide(t.floor, 'p1', 'approve', 'Keith'), undefined);
  assert.deepEqual(t.data().outbox.decisions, [], 'not relayed to itself as the Coordinator');
  assert.equal(t.roster.relays.owed(t.floor.id, 'solo-lead').length, 1, 'its own note says it');
});

test('Solo: the standup asks only the Solo Lead and hands it the page as its daily note', async () => {
  const t = setup('solo');
  const solo = await hireAt(t, 'solo-lead');
  const s = t.roster.standups.run(t.floor, 'Probe');
  assert.ok(typeof s !== 'string');
  assert.deepEqual(s.waiting, ['solo-lead']);
  assert.deepEqual(s.reports, [], 'no report for roles that are not on the team');
  assert.match(t.floor.prompts[0].text, /docs\/team\/development\.md/);
  assert.match(t.floor.prompts[0].text, /analyzer data/, 'it covers Analysis, so it gets the numbers');
  t.floor.prompts.length = 0;
  t.floor.set(solo, 'working');
  t.floor.set(solo, 'done');
  await tick();
  assert.equal(s.status, 'compiled');
  assert.equal(s.savedTo, standupPath(s.id));
  assert.ok(existsSync(path.join(t.floor.cwdOf(t.floor.worker(solo)!), standupPath(s.id))));
  assert.match(t.floor.prompts.find((p) => p.id === solo)?.text ?? '', /compiled today's standup/);
});

test('Startup: a subagent run is recorded under the member covering its team, who may manage it', async () => {
  const t = setup('startup');
  const ca = await hireAt(t, 'chief-analyst');
  const dev = await hireAt(t, 'lead-developer');
  t.roster.subagents.onEvent(t.floor, ca, { kind: 'stop', agent: 'ui-ux-designer', at: t.clock.now } as never);
  assert.ok(t.data().subagents['chief-analyst/ui-ux-designer'], "the designer is the Chief Analyst's");
  const r = t.roster.subagents.request(t.floor, 'lead-developer', t.floor.worker(dev)!, 'warn', 'tester', { reason: 'flaky e2e' });
  assert.ok(r.ok, r.message);
  assert.equal(t.data().subagents['lead-developer/tester'].state, 'warning');
  assert.deepEqual(t.data().outbox.news.length, 1, 'news for the Chief Analyst, who covers Management');
  const own = t.roster.subagents.request(t.floor, 'chief-analyst', t.floor.worker(ca)!, 'warn', 'ui-ux-designer', { reason: 'off-brand' });
  assert.ok(own.ok, own.message);
  assert.equal(t.data().outbox.news.length, 1, 'its own decision is nobody else’s news');
});

test('the Team tab shows the shape, its roles and the coverage; a hire is told what it covers', async () => {
  const t = setup('startup');
  const v = t.roster.view(t.floor, true);
  assert.equal(v.shape, 'startup');
  assert.deepEqual(v.members.map((m) => m.role), ['lead-developer', 'chief-analyst']);
  assert.deepEqual(v.members.find((m) => m.role === 'chief-analyst')?.covers, ['management', 'analysis', 'design']);
  await hireAt(t, 'chief-analyst');
  assert.match(t.floor.hires[0].prompt, /you cover management, analysis, design; there is no Project Coordinator: you cover Management/);
  assert.ok(v.skills['chief-analyst']?.some((s) => s.key === 'nudge-lead'));
});

test('Playbooks: the Solo Lead owns every team’s deliverables and the .mpr; the Startup analyst its covered teams', () => {
  const solo = playbook('solo-lead', ctx({ coverage: defaultCoverage('solo') }));
  assert.match(solo, /you, the Solo Lead, are the only one who runs `mxcli exec`/);
  for (const t of ['Management', 'Design', 'Development', 'Testing', 'Analysis']) assert.match(solo, new RegExp(`\\*\\*${t}\\*\\* \\(you cover it`), t);
  assert.match(solo, /there is no Project Coordinator: you cover Management/);
  assert.doesNotMatch(solo, /## Coordinating the team/, 'no Coordinator section');
  // One Playbook instead of five: at most a third more than a single Enterprise Lead's.
  const dev = playbook('lead-developer', ctx()).length;
  assert.ok(solo.length < dev * 1.3, `the Solo Playbook stays short (${solo.length} chars against the Lead Developer's ${dev})`);
  const analyst = playbook('chief-analyst', ctx({ coverage: defaultCoverage('startup') }));
  assert.match(analyst, /## Teams you cover/);
  assert.match(analyst, /design\/brand\.md/);
  assert.match(analyst, /only the Lead Developer runs/);
  assert.match(analyst, /`team:management`, `team:design`/);
  assert.match(deliverablesBrief('lead-developer', true, ['lead-tester']).join('\n'), /\*\*Testing\*\* \(you cover it.*\n.*tests\/test-plan\.md/);
});

test('a covered team says who covers it; one that covers itself says nothing', () => {
  const by = (r: RoleId) => ({ 'solo-lead': 'Sam', 'chief-analyst': 'Ada' })[r as string] ?? r;
  assert.equal(coveredNote(defaultCoverage('solo'), 'design', by), 'covered by Sam (Solo Lead)');
  assert.equal(coveredNote(defaultCoverage('startup'), 'management', by), 'covered by Ada (Chief Analyst)');
  assert.equal(coveredNote(defaultCoverage('startup'), 'analysis', by), undefined);
  assert.equal(coveredNote(TEAM_OWNER, 'testing', by), undefined);
});

// ---- The recommendation ----------------------------------------------------------------------------

const a = (n: number, text: string): IntakeAnswer => ({ n, kind: 'answered', text });

test('the answers are read for plain signals', () => {
  assert.equal(driverOf('(a) POC for the board'), 'poc');
  assert.equal(driverOf('A demo next month'), 'poc');
  assert.equal(driverOf('Licence expires 1 March: production replacement'), 'hard-date');
  assert.equal(driverOf('(c) open-ended modernisation'), 'open-ended');
  assert.equal(driverOf('something else'), 'unknown');
  assert.equal(breadthOf('one module: leave requests'), 'narrow');
  assert.equal(breadthOf('the whole application'), 'broad');
  assert.equal(breadthOf('four modules and the reports'), 'broad');
  assert.equal(integrationsOf('None'), 'none');
  assert.equal(integrationsOf('the SAP interface'), 'some');
  assert.equal(integrationsOf('SAP interface, the HR feed and the SSO login'), 'many');
  assert.equal(smeOf('No SME needed, I am the owner'), 'not-needed');
  assert.equal(smeOf('Jan, but she answers in two weeks'), 'slow');
  assert.equal(smeOf('Piet, daily'), 'available');
});

test('recommendations: Solo · Lean for a small greenfield POC, Startup · Balanced for a small dated one, Enterprise for a migration', () => {
  const poc = recommendShape({ tier: 'small', entry: 'greenfield', intake: [a(2, '(a) POC for the board demo'), a(4, 'one module'), a(5, 'None'), a(7, 'No SME needed')] });
  assert.deepEqual([poc.shape, poc.level], ['solo', 'lean']);
  assert.deepEqual(poc.why, ['small tier', 'greenfield', 'you said: POC / demo', 'one module or feature', 'no integrations must stay', 'no SME needed']);
  const dated = recommendShape({ tier: 'small', entry: 'requirements-driven', intake: [a(2, 'Production replacement, hard date: the licence expires in March'), a(4, 'The travel approval flow')] });
  assert.deepEqual([dated.shape, dated.level], ['startup', 'balanced']);
  const mig = recommendShape({ tier: 'standard', entry: 'migration', intake: [a(5, 'SAP interface, the HR feed and the SSO login')] });
  assert.deepEqual([mig.shape, mig.level], ['enterprise', 'balanced']);
  assert.ok(mig.why.includes('several integrations must stay'));
  // Nothing said: a small greenfield is still one agent's work, at the lowest cost.
  assert.deepEqual(Object.values((({ shape, level }) => ({ shape, level }))(recommendShape({ tier: 'small', entry: 'greenfield', intake: [] }))), ['solo', 'lean']);
  // A small greenfield whose integrations must stay needs a second pair of hands.
  assert.equal(recommendShape({ tier: 'small', entry: 'greenfield', intake: [a(5, 'the REST API to the HR system')] }).shape, 'startup');
  // Urgent and dated is Fast, unless the SME is slow (agents would only wait faster).
  assert.equal(recommendShape({ tier: 'standard', entry: 'requirements-driven', intake: [a(2, 'Hard date, go-live in three weeks')] }).level, 'fast');
  assert.equal(recommendShape({ tier: 'standard', entry: 'requirements-driven', intake: [a(2, 'Hard date, go-live in three weeks'), a(7, 'Jan, answers in two weeks')] }).level, 'balanced');
  assert.equal(recommendShape({ tier: 'standard', entry: 'greenfield', intake: [a(2, 'open-ended')] }).shape, 'startup');
  assert.equal(recommendShape({ tier: 'standard', entry: 'existing-app-change', intake: [] }).shape, 'enterprise');
  assert.equal(recommendShape({ tier: 'standard', entry: 'assurance', intake: [] }).shape, 'solo');
});

// ---- Budget per shape and level ----------------------------------------------------------------------

test('the estimates per shape and level: Solo · Lean is $60–100 for a small greenfield app', () => {
  const table = (tier: 'small' | 'standard', entry: 'greenfield' | 'requirements-driven') => Object.fromEntries(shapeCards(tier, entry).map((c) => [c.shape, Object.fromEntries(c.levels.map((l) => [l.id, l.budget]))]));
  assert.deepEqual(table('small', 'greenfield'), { solo: { lean: 60, balanced: 100, fast: 160 }, startup: { lean: 90, balanced: 140, fast: 220 }, enterprise: { lean: 110, balanced: 170, fast: 270 } });
  assert.deepEqual(table('small', 'requirements-driven'), { solo: { lean: 120, balanced: 180, fast: 290 }, startup: { lean: 170, balanced: 270, fast: 430 }, enterprise: { lean: 220, balanced: 330, fast: 530 } });
  const solo = shapeCards('small', 'greenfield').find((c) => c.shape === 'solo')!;
  const lean = solo.levels.find((l) => l.id === 'lean')!.budget;
  assert.ok(lean >= 60 && lean <= 100, `Solo · Lean ${lean}`);
  assert.ok(solo.days > shapeCards('small', 'greenfield').find((c) => c.shape === 'enterprise')!.days, 'one agent takes longer');
  const plan = generatePlan({ tier: 'small', entry: 'requirements-driven', shape: 'startup', start: '2026-01-05', now: 0 });
  assert.equal(plan.lines.find((l) => l.stage === '2')?.by, 'Chief Analyst');
  assert.equal(plan.lines.find((l) => l.stage === '5')?.by, 'Lead Developer');
  assert.match(plan.basis, /for a startup team/);
});

// ---- The wizard per shape ------------------------------------------------------------------------------

const plan = (over: Partial<ProjectPlan> = {}): ProjectPlan => ({ kind: 'new', owner: 'Test-Org', name: 'travel-approval', description: '', private: true, mendix: '11.12.4', entry: 'greenfield', tier: 'small', interview: 'steering', execApproval: 'auto', intake: [], clients: [], operators: [], roles: ['pm', 'lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst'], discovery: { issue: true, queue: true, model: 'opus' }, createdByHand: false, ...over });

test('a plan’s shape: the one picked, else what its roles add up to', () => {
  assert.equal(shapeForRoles(['solo-lead']), 'solo');
  assert.equal(shapeForRoles(['chief-analyst', 'lead-developer']), 'startup');
  assert.equal(shapeForRoles(['pm', 'lead-developer']), 'enterprise');
  const cleaned = cleanPlan({ ...plan(), roles: ['solo-lead'] }, ['11.12.4'], 'Test-Org') as ProjectPlan;
  assert.equal(cleaned.shape, 'solo');
  assert.equal((cleanPlan({ ...plan(), shape: 'startup', roles: ['chief-analyst', 'lead-developer'] }, ['11.12.4'], 'Test-Org') as ProjectPlan).shape, 'startup');
  assert.equal((cleanPlan(plan(), ['11.12.4'], 'Test-Org') as ProjectPlan).shape, 'enterprise');
  assert.equal(discoveryRole({ plan: plan({ shape: 'solo', roles: ['solo-lead'] }) }), 'solo-lead');
  assert.equal(discoveryRole({ plan: plan() }), 'chief-analyst');
});

for (const shape of ['solo', 'startup', 'enterprise'] as const) {
  test(`the team step for a ${shape} team sets the shape, then the budget, then hires its roles`, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), `shapes-wiz-${shape}-`));
    const order: string[] = [];
    const hires: { role: ProjectRole; task?: string }[] = [];
    const deps: SetupDeps = {
      projectsDir: () => root,
      floorOf: () => undefined,
      addFloor: async () => 'unused',
      adoptFloor: () => 'unused',
      queue: () => 'unused',
      hired: () => false,
      known: () => false,
      hire: async (_f, role, _by, _acct, task) => (order.push(`hire:${role}`), hires.push({ role, task }), undefined),
      setShape: (_f, s) => order.push(`shape:${s}`),
      applyBudget: () => (order.push('budget'), []),
    };
    const steps = setupSteps(Object.assign(deps, { cfg: { toolkitDir: root, bash: 'bash', mendixDir: root, org: 'Test-Org', adminTokenFile: path.join(root, 'none') } }) as never);
    const p = plan({ shape, roles: [...SHAPES[shape].roles] as ProjectRole[], budget: { level: 'lean', total: 60, threshold: 80, autoPause: true, settings: { leadModel: 'sonnet', discoveryModel: 'sonnet', subagentModel: 'haiku', earlyDrafts: false, autonomyByStage: { enabled: true, early: 2, build: 3 }, parallel: 'fewer', threshold: 80 } } });
    const job: JobState = Object.assign(newJob(p, 'Probe'), { dir: root, floor: 'travel-approval', issue: 5 });
    const r = await steps.team(job, { log: () => undefined });
    assert.equal(r.status, 'done');
    assert.deepEqual(order, [`shape:${shape}`, 'budget', ...SHAPES[shape].roles.map((x) => `hire:${x}`).sort((x, y) => ROLES.findIndex((q) => `hire:${q.id}` === x) - ROLES.findIndex((q) => `hire:${q.id}` === y))]);
    const analyst = shape === 'solo' ? 'solo-lead' : 'chief-analyst';
    assert.match(hires.find((h) => h.role === analyst)?.task ?? '', /issue #5/, 'Discovery goes to whoever covers Analysis');
  });
}

// ---- The Enterprise regression suite: today's flows, unchanged ---------------------------------------

test('Enterprise regression: Playbooks, first messages and skills are exactly as without coverage', () => {
  for (const r of ROLES.filter((x) => x.id !== 'solo-lead')) {
    assert.equal(playbook(r.id, ctx({ coverage: defaultCoverage('enterprise') })), playbook(r.id, ctx()), `${r.id}'s Playbook`);
    assert.deepEqual(skillsFor(r.id, alsoCovers(TEAM_OWNER, r.id)), skillsFor(r.id), `${r.id}'s skills`);
    assert.match(playbook(r.id, ctx()), r.id === 'lead-developer' ? /only the Lead Developer runs/ : /One writer per Mendix app: only the Lead Developer/);
  }
  assert.equal(primePrompt('lead-tester', 'Grace', 2), primePrompt('lead-tester', 'Grace', 2, undefined, undefined, [], undefined));
  assert.match(primePrompt('lead-tester', 'Grace', 2), /The Project Coordinator is the agent that coordinates the Leads/);
  assert.equal(estimateFor('small', 'requirements-driven'), estimateFor('small', 'requirements-driven', undefined, 'enterprise'));
  assert.equal(planTotal(generatePlan({ tier: 'standard', entry: 'migration', start: '2026-01-05', now: 0 })), planTotal(generatePlan({ tier: 'standard', entry: 'migration', shape: 'enterprise', start: '2026-01-05', now: 0 })));
  assert.equal(generatePlan({ tier: 'small', entry: 'greenfield', start: '2026-01-05', now: 0 }).lines.some((l) => l.by), false, 'no "by" on an Enterprise plan');
});

test('Enterprise regression: the Team tab, the standup and the relays go where they always did', async () => {
  const t = setup();
  assert.deepEqual(t.roster.view(t.floor, true).members.map((m) => m.role), ['pm', 'lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst']);
  // No Coordinator hired: a Lead's escalation is let go, as before.
  const dev = await hireAt(t, 'lead-developer');
  t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'urgent', trigger: 'blocked', title: 'A', details: '', options: [] });
  t.roster.escalations.flushCoordinator(t.floor);
  assert.deepEqual(t.data().outbox.escalations, []);
  assert.equal(t.floor.prompts.length, 0);
  // With one: it hears it; the standup asks the hired Leads, reads the others' journals, and hands it the page.
  const pm = await hireAt(t, 'pm');
  const tester = await hireAt(t, 'lead-tester');
  t.roster.escalations.raise(t.floor, t.floor.worker(tester)!, { urgency: 'urgent', trigger: 'blocked', title: 'B', details: '', options: [] });
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), true);
  assert.match(t.floor.prompts.find((p) => p.id === pm)?.text ?? '', /“B”/);
  t.floor.prompts.length = 0;
  const s = t.roster.standups.run(t.floor, 'Probe');
  assert.ok(typeof s !== 'string');
  assert.deepEqual(s.waiting, ['lead-developer', 'lead-tester']);
  assert.deepEqual(s.reports.map((r) => r.role).sort(), ['chief-analyst', 'lead-designer'], 'the others from their journals');
  for (const id of [dev, tester]) {
    t.floor.set(id, 'working');
    t.floor.set(id, 'done');
  }
  await tick();
  assert.equal(s.status, 'compiled');
  assert.match(t.floor.prompts.find((p) => p.id === pm)?.text ?? '', /compiled today's standup/);
  // A decision goes to the Coordinator and to the Lead that proposed it.
  t.data().proposals.push({ id: 'p9', standup: s.id, role: 'lead-developer', team: 'development', by: 'Linus', kind: 'task', title: 'Split Orders', detail: '', status: 'pending' });
  assert.equal(await t.roster.standups.decide(t.floor, 'p9', 'approve', 'Keith'), undefined);
  assert.deepEqual(t.data().outbox.decisions, ['p9']);
  assert.equal(t.roster.relays.owed(t.floor.id, 'lead-developer').length, 1);
  // Subagents stay each Lead's own; a Lead's decision is the Coordinator's news.
  const r = t.roster.subagents.request(t.floor, 'lead-developer', t.floor.worker(dev)!, 'warn', 'developer', { reason: 'r' });
  assert.ok(r.ok, r.message);
  assert.equal(t.data().outbox.news.length, 1);
  assert.match(t.roster.subagents.request(t.floor, 'lead-developer', t.floor.worker(dev)!, 'warn', 'tester', { reason: 'r' }).message, /No subagent called tester/);
});

test('team shapes: the Discovery brief names whoever covers Analysis', async () => {
  const { discoveryBrief } = await import('../src/server/wizard/brief.js');
  const brief = (p: Partial<ProjectPlan>) => discoveryBrief(cleanPlan({ ...plan(), ...p }, ['11.12.4'], 'Test-Org') as ProjectPlan, '/toolkit');
  assert.match(brief({}), /You are the \*\*Chief Analyst \(Consultant agent\)\*\*/);
  assert.match(brief({ shape: 'startup', roles: ['chief-analyst', 'lead-developer'] }), /You are the \*\*Chief Analyst \(Consultant agent\)\*\*/);
  const solo = brief({ shape: 'solo', roles: ['solo-lead'] });
  assert.match(solo, /You are the \*\*Solo Lead, running discovery as the analyst\*\*/);
  assert.doesNotMatch(solo, /You are the \*\*Chief Analyst/);
});

test('whoever writes the model tidies the domain models the team laid out, never a person\'s arrangement', () => {
  for (const role of ['lead-developer', 'solo-lead'] as const) {
    const text = playbook(role, ctx(role === 'solo-lead' ? { coverage: defaultCoverage('solo') } : {}));
    assert.match(text, /mxcli layout -p <app>\.mpr --module <Module> --dry-run/);
    assert.match(text, /if a person arranged the module in Studio Pro/);
  }
  assert.doesNotMatch(playbook('lead-tester', ctx()), /mxcli layout/);
});
