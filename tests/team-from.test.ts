// Start from a team (shared/team-from.ts, server/wizard/team-from.ts, team-from-office.ts): what a copy takes
// (shape, roles, models, budget level) and what it never takes (the budget amount, permissions, connections,
// the source project's work); cleanPlan refusing a source project or profile the office doesn't know; the
// team step without a source exactly as before; and the same agents, a free profile hired at once and one on
// another project only through a confirmed Move, with a restart mid-setup never hiring anyone twice. A Roster
// on fake floors (tests/profiles-world.ts): no Claude, no GitHub, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkTeamFrom, cleanTeamFrom, copiedLines, copyTeam, NOT_COPIED, type KnownSource, type TeamSource } from '../src/shared/team-from.js';
import { cleanPlan } from '../src/server/wizard/plan.js';
import { setupSteps, type SetupDeps } from '../src/server/wizard/steps.js';
import { newJob, type JobState } from '../src/server/wizard/job.js';
import { knownOf, sourcesOf, teamFromDepsOf } from '../src/server/wizard/team-from-office.js';
import { setShape } from '../src/server/roster/coverage.js';
import { everHired } from '../src/server/roster/store.js';
import { cleanChoice } from '../src/shared/budget/levels.js';
import type { ProjectPlan, ProjectRole } from '../src/shared/wizard.js';
import { benchWithHandoff, until, world, type World } from './profiles-world.js';

const VERSIONS = ['11.12.4'];
const raw = (over: Record<string, unknown> = {}) => ({ kind: 'new', owner: 'Test-Org', name: 'welcome-desk', mendix: '11.12.4', entry: 'greenfield', tier: 'small', roles: ['chief-analyst', 'lead-developer'], shape: 'startup', discovery: { issue: false, queue: false, model: 'opus' }, budget: cleanChoice({ level: 'balanced', total: 180 }), ...over });
const PRF = 'prf_01JAAAAAAAAAAAAAAAAAAAAAAA';
const PRF2 = 'prf_01JBBBBBBBBBBBBBBBBBBBBBBB';

const source = (over: Partial<TeamSource> = {}): TeamSource => ({ floor: 'fa', project: 'Travel approval', shape: 'startup', roles: ['chief-analyst', 'lead-developer'], models: { 'chief-analyst': 'opus', 'lead-developer': 'sonnet' }, level: 'fast', agents: [], ...over });

// ---- What a copy takes, and what it never takes ------------------------------------------------------

test('a copy takes the shape, the roles, each role’s model and the budget level; nothing else', () => {
  const c = copyTeam(source());
  assert.deepEqual(c, { shape: 'startup', roles: ['lead-developer', 'chief-analyst'], customTeam: false, level: 'fast', models: { 'chief-analyst': 'opus', 'lead-developer': 'sonnet' } });
  // Roles that make no one shape exactly: picked by hand (Customize), shape as they add up.
  const odd = copyTeam(source({ shape: 'enterprise', roles: ['pm', 'lead-developer'], models: { pm: 'sonnet', 'lead-developer': 'opus' } }));
  assert.equal(odd.customTeam, true);
  assert.deepEqual(odd.roles, ['pm', 'lead-developer']);
  // A manual budget has no level to copy; a bad model string isn't copied.
  const manual = copyTeam(source({ level: 'manual', models: { 'chief-analyst': 'opus; rm -rf', 'lead-developer': 'sonnet' } }));
  assert.equal(manual.level, undefined);
  assert.deepEqual(manual.models, { 'lead-developer': 'sonnet' });
  assert.match(copiedLines(source(), manual, (r) => r).at(-1)!, /not copied/);
  // The "Not copied" list says each thing that never comes across.
  const nc = NOT_COPIED.join(' ').toLowerCase();
  for (const w of ['permission', 'connections', 'tokens', 'budget amount', 'transcripts', 'handoffs', 'journals', 'documents', 'brief', 'lessons']) assert.ok(nc.includes(w), `Not copied names ${w}`);
});

test('the budget amount is never copied: the plan keeps the new project’s own total, and a source total sent by the page is dropped', () => {
  const known = knownOf([source()]);
  const p = cleanPlan(raw({ teamFrom: { floor: 'fa', project: 'x', models: { 'lead-developer': 'opus' }, level: 'fast', budget: { total: 9999 }, total: 9999, permissions: { allow: ['*'] }, tokens: 'secret' } }), VERSIONS, 'Test-Org', known) as ProjectPlan;
  assert.equal(typeof p, 'object');
  assert.equal(p.budget?.total, 180);
  assert.deepEqual(Object.keys(p.teamFrom!).sort(), ['floor', 'level', 'models', 'project']);
  // The name comes from the office, not the page.
  assert.equal(p.teamFrom!.project, 'Travel approval');
});

test('cleanPlan: an unknown source project or profile from the page is refused; agents needing a Move need its confirmation', () => {
  const known: Map<string, KnownSource> = knownOf([source({ agents: [{ role: 'lead-developer', profile: PRF, name: 'Zelda', where: 'working', at: { floor: 'fa', project: 'Travel approval', role: 'lead-developer' } }] })]);
  assert.match(String(cleanPlan(raw({ teamFrom: { floor: 'nope', models: {} } }), VERSIONS, 'Test-Org', known)), /isn’t in the office/);
  assert.match(String(cleanPlan(raw({ teamFrom: { floor: 'fa', models: {}, agents: [{ role: 'lead-developer', profile: PRF2 }], moveConfirmed: true } }), VERSIONS, 'Test-Org', known)), /isn’t on Travel approval’s team/);
  assert.match(String(cleanPlan(raw({ teamFrom: { floor: 'fa', models: {}, agents: [{ role: 'lead-developer', profile: PRF }] } }), VERSIONS, 'Test-Org', known)), /confirm the Move/);
  const ok = cleanPlan(raw({ teamFrom: { floor: 'fa', models: {}, agents: [{ role: 'lead-developer', profile: PRF, name: 'Mallory' }], moveConfirmed: true } }), VERSIONS, 'Test-Org', known) as ProjectPlan;
  assert.deepEqual(ok.teamFrom!.agents, [{ role: 'lead-developer', profile: PRF, name: 'Zelda' }]);
  assert.equal(ok.teamFrom!.moveConfirmed, true);
  // An agent for a role the plan doesn't have is dropped; a bad profile id never gets as far as the check.
  assert.equal(cleanTeamFrom({ floor: 'fa', agents: [{ role: 'pm', profile: PRF }, { role: 'lead-developer', profile: 'prf_x' }] }, ['lead-developer'])!.agents, undefined);
  // Another client's project: its name stays out of the new project's files.
  const other = knownOf([source()], new Map([['fa', { id: 'pfl_01JCCCCCCCCCCCCCCCCCCCCCCC', label: 'Acme' }]]));
  assert.equal((checkTeamFrom({ floor: 'fa', project: 'fa', models: {} }, other) as { confidential?: boolean }).confidential, true);
  assert.equal((checkTeamFrom({ floor: 'fa', project: 'fa', models: {} }, other, 'pfl_01JCCCCCCCCCCCCCCCCCCCCCCC') as { confidential?: boolean }).confidential, undefined);
});

test('without a team source the plan is exactly as before, with or without the office’s list', () => {
  const known = knownOf([source()]);
  const before = cleanPlan(raw(), VERSIONS, 'Test-Org');
  assert.deepEqual(cleanPlan(raw(), VERSIONS, 'Test-Org', known), before);
  assert.equal(JSON.stringify(cleanPlan(raw(), VERSIONS, 'Test-Org', known)), JSON.stringify(before));
  // Sent without the office's list (an edit, a saved plan): the team source is dropped rather than trusted.
  assert.equal((cleanPlan(raw({ teamFrom: { floor: 'fa', models: {} } }), VERSIONS, 'Test-Org') as ProjectPlan).teamFrom, undefined);
});

// ---- The team step ---------------------------------------------------------------------------------

const cfg = (root: string) => ({ toolkitDir: root, bash: 'bash', mendixDir: root, org: 'Test-Org', adminTokenFile: path.join(root, 'none') });

function fakeSteps(order: string[], over: Partial<SetupDeps> = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'team-from-'));
  const deps = {
    cfg: cfg(root),
    projectsDir: () => root,
    floorOf: () => undefined,
    addFloor: async () => 'unused',
    adoptFloor: () => 'unused',
    queue: () => 'unused',
    hired: () => false,
    known: () => false,
    hire: async (_f: string, role: ProjectRole) => void order.push(`hire:${role}`),
    setShape: (_f: string, s: string) => void order.push(`shape:${s}`),
    applyBudget: (_f: string, c: { level: string; total: number }) => (order.push(`budget:${c.level}:$${c.total}`), []),
    setRoleModel: (_f: string, role: ProjectRole, m: string) => void order.push(`model:${role}:${m}`),
    ...over,
  };
  return { steps: setupSteps(deps as SetupDeps), root };
}

test('the team step without a team source runs exactly as before: shape, budget, then the hires', async () => {
  const order: string[] = [];
  const { steps, root } = fakeSteps(order);
  const plan = cleanPlan(raw(), VERSIONS, 'Test-Org') as ProjectPlan;
  const r = await steps.team(Object.assign(newJob(plan, 'Probe'), { dir: root, floor: 'welcome-desk' }), { log: () => undefined });
  assert.equal(r.status, 'done');
  assert.deepEqual(order, ['shape:startup', 'budget:balanced:$180', 'hire:lead-developer', 'hire:chief-analyst']);
});

test('the team step with a team source: shape, the new project’s budget, the copied models on top, then the hires; a Retry applies the budget once', async () => {
  const order: string[] = [];
  const { steps, root } = fakeSteps(order);
  const plan = cleanPlan(raw({ budget: cleanChoice({ level: 'fast', total: 260 }), teamFrom: { floor: 'fa', models: { 'chief-analyst': 'opus', 'lead-developer': 'sonnet', pm: 'haiku' }, level: 'fast' } }), VERSIONS, 'Test-Org', knownOf([source()])) as ProjectPlan;
  const lines: string[] = [];
  const job = Object.assign(newJob(plan, 'Probe'), { dir: root, floor: 'welcome-desk' });
  await steps.team(job, { log: (l) => lines.push(l) });
  assert.deepEqual(order, ['shape:startup', 'budget:fast:$260', 'model:chief-analyst:opus', 'model:lead-developer:sonnet', 'shape:startup', 'hire:lead-developer', 'hire:chief-analyst']);
  assert.ok(lines.some((l) => /team set up from Travel approval/.test(l)));
  order.length = 0;
  await steps.team(job, { log: () => undefined });
  assert.equal(order.filter((o) => o.startsWith('budget')).length, 0);
});

// ---- The same agents, over a real Roster and agent profiles ----------------------------------------

function worldSteps(w: World) {
  const floor = (id: string) => w.floors.find((f) => f.id === id);
  const deps = {
    cfg: cfg(w.dataDir),
    projectsDir: () => w.dataDir,
    floorOf: () => undefined,
    addFloor: async () => 'unused',
    adoptFloor: () => 'unused',
    queue: () => 'unused',
    hired: (f: string, role: ProjectRole) => {
      const m = w.roster.data(f).members[role];
      return (m.phase === 'active' || m.phase === 'benching') && !!w.roster.workerOf(floor(f)!, m);
    },
    known: (f: string, role: ProjectRole) => everHired(w.roster.data(f).members[role]),
    hire: (f: string, role: ProjectRole, by: string, acct?: string, task?: string, model?: string) => w.roster.members.hire(floor(f)!, role, by, acct, task, model),
    setShape: (f: string, s: 'startup', by: string) => setShape(w.roster, floor(f)!, s, by),
    ...teamFromDepsOf({ svc: w.svc, roster: () => w.roster, floor }),
  };
  return setupSteps(deps as unknown as SetupDeps);
}

/** Zelda, Lead Developer on Travel approval (fa), hired and idle, with her profile. */
async function zeldaOnA(): Promise<{ w: World; id: string }> {
  const w = world();
  assert.equal(w.roster.members.rename(w.a, 'lead-developer', 'Zelda'), undefined);
  assert.equal(await w.roster.members.hire(w.a, 'lead-developer', 'Keith'), undefined);
  await w.settle();
  w.a.set(w.a.workerOf('lead-developer')!.id, 'idle');
  return { w, id: w.svc.store.ofSeat('fa', 'lead-developer')!.id };
}

const sourcesIn = (w: World) => sourcesOf({ svc: w.svc, roster: () => w.roster, floors: () => w.floors });
const live = (w: World) => w.floors.flatMap((f) => f.workers().filter((x) => x.name === 'Zelda'));
const planFor = (known: Map<string, KnownSource>, agents: unknown[], moveConfirmed?: boolean) => cleanPlan(raw({ teamFrom: { floor: 'fa', models: { 'lead-developer': 'opus' }, agents, ...(moveConfirmed ? { moveConfirmed } : {}) } }), VERSIONS, 'Test-Org', known);

test('same agents, a free one: listed as free, needs no Move, and is hired on the new project’s seat with the setup', async () => {
  const { w, id } = await zeldaOnA();
  // Her Travel approval seat was released (she was benched and the seat let go): she's on no project.
  await w.a.stop(w.a.workerOf('lead-developer')!.id);
  await w.svc.store.change((f) => void (f.seats['fa|lead-developer'] = null));
  const sources = await sourcesIn(w);
  const fa = sources.find((s) => s.floor === 'fa')!;
  assert.deepEqual(fa.agents.map((a) => [a.role, a.name, a.where]), [['lead-developer', 'Zelda', 'free']]);
  assert.equal('budget' in fa || 'total' in fa, false, 'a source carries no budget amount');
  const plan = planFor(knownOf(sources), [{ role: 'lead-developer', profile: id }]) as ProjectPlan;
  assert.equal(typeof plan, 'object', String(plan));
  const job: JobState = Object.assign(newJob(plan, 'Keith'), { dir: w.dataDir, floor: 'fb' });
  const r = await worldSteps(w).team(job, { log: () => undefined });
  assert.match(r.detail ?? '', /brought Zelda/);
  assert.equal(w.roster.data('fb').members['lead-developer'].name, 'Zelda');
  assert.equal(w.roster.data('fb').members['lead-developer'].model, 'opus', 'the copied model, from her first hire here');
  assert.equal(w.svc.store.ofSeat('fb', 'lead-developer')?.id, id);
  assert.equal(w.b.hires.filter((h) => h.name === 'Zelda').length, 1);
  assert.ok(w.b.hires.some((h) => /Chief Analyst/.test(h.prompt)), 'the other role is hired as before');
  assert.equal(live(w).length, 1);
});

test('same agents, one active elsewhere: refused without the confirmed Move; with it, moved after her handoff there, never two sessions', async () => {
  const { w, id } = await zeldaOnA();
  const known = knownOf(await sourcesIn(w));
  assert.deepEqual([...known.get('fa')!.agents.values()].map((a) => a.where), ['working']);
  // From the page without the confirmation: refused before setup starts.
  assert.match(String(planFor(known, [{ role: 'lead-developer', profile: id }])), /confirm the Move/);
  // And the step itself never moves anyone unconfirmed (a plan from before, or tampered with).
  const unconfirmed = Object.assign(newJob({ ...(planFor(known, [{ role: 'lead-developer', profile: id }], true) as ProjectPlan) }, 'Keith'), { dir: w.dataDir, floor: 'fb' });
  delete unconfirmed.plan.teamFrom!.moveConfirmed;
  await assert.rejects(worldSteps(w).team(unconfirmed, { log: () => undefined }), /Couldn't bring Zelda as the Lead Developer: .*Move wasn’t confirmed/);
  assert.equal(w.a.prompts.length, 0, 'nobody was asked to bench');
  assert.equal(w.b.hires.filter((h) => h.name === 'Zelda').length, 0);
  // Confirmed: her source is asked for its handoff; the rest of the team is hired; her seat waits for her.
  const plan = planFor(known, [{ role: 'lead-developer', profile: id }], true) as ProjectPlan;
  const job: JobState = Object.assign(newJob(plan, 'Keith'), { dir: w.dataDir, floor: 'fb' });
  const r = await worldSteps(w).team(job, { log: () => undefined });
  assert.match(r.detail ?? '', /Zelda \(joins after the handoff note on Travel approval\)/);
  assert.match(w.a.prompts.at(-1)!.text, /benching you/);
  assert.equal(w.b.hires.filter((h) => h.name === 'Zelda').length, 0);
  assert.ok(w.roster.data('fb').members['chief-analyst'].phase === 'active');
  await benchWithHandoff(w, w.a, 'lead-developer', 'development', 'Handoff written.');
  await until(() => w.b.hires.some((h) => h.name === 'Zelda'), 'her hire on the new project');
  await until(() => w.svc.store.data.moves.at(-1)!.state === 'done', 'the move to finish');
  await until(() => w.audits.some((e) => e.action === 'profile.move-done' && e.floor === 'fb'), 'the move in the new project’s log');
  assert.equal(live(w).length, 1);
});

test('a restart mid-setup never hires twice: a seat a move holds is skipped, and so is one it filled', async () => {
  const { w, id } = await zeldaOnA();
  const plan = planFor(knownOf(await sourcesIn(w)), [{ role: 'lead-developer', profile: id }], true) as ProjectPlan;
  const job: JobState = Object.assign(newJob(plan, 'Keith'), { dir: w.dataDir, floor: 'fb' });
  await worldSteps(w).team(job, { log: () => undefined });
  const moves = w.svc.store.data.moves.length;
  const hires = w.b.hires.length;
  // The office restarts while Zelda writes her handoff: the step runs again (a Retry, or the setup carried on).
  w.restart();
  await w.svc.start();
  const again = await worldSteps(w).team(job, { log: () => undefined });
  assert.equal(w.svc.store.data.moves.length, moves, 'no second move');
  assert.equal(w.b.hires.length, hires, 'nobody hired again');
  assert.match(again.detail ?? '', /Zelda: Zelda joins after the handoff note/);
  await benchWithHandoff(w, w.a, 'lead-developer', 'development', 'Handoff written.');
  await until(() => w.svc.store.data.moves.at(-1)!.state === 'done', 'the move to finish');
  // And after it's done, once more: still one Zelda.
  w.restart();
  await w.svc.start();
  await worldSteps(w).team(job, { log: () => undefined });
  assert.equal(w.b.hires.filter((h) => h.name === 'Zelda').length, 1);
  assert.equal(live(w).length, 1);
});

test('the settings step records the source in agent-office.project.json, never another client’s project name', async () => {
  const { readFileSync } = await import('node:fs');
  for (const confidential of [false, true]) {
    const { steps, root } = fakeSteps([]);
    const plan = cleanPlan(raw({ teamFrom: { floor: 'fa', models: {} } }), VERSIONS, 'Test-Org', knownOf([source()])) as ProjectPlan;
    if (confidential) plan.teamFrom!.confidential = true;
    const job = Object.assign(newJob(plan, 'Probe'), { dir: root, floor: 'welcome-desk' });
    const r = await steps.settings(job, { log: () => undefined });
    const saved = JSON.parse(readFileSync(path.join(root, 'agent-office.project.json'), 'utf8'));
    assert.deepEqual(saved.teamFrom, confidential ? { client: 'another client', copied: ['shape', 'roles', 'models', 'budget level'] } : { project: 'Travel approval', copied: ['shape', 'roles', 'models', 'budget level'] });
    assert.equal(JSON.stringify(saved).includes('Travel approval'), !confidential);
    assert.match(r.detail ?? '', /team set up from/);
    // Run again: nothing changes.
    assert.equal((await steps.settings(job, { log: () => undefined })).status, 'skipped');
  }
});
