// Start from another app (server/adopt-from/, wizard/adopt-step.ts, shared/adopt-from.ts): a new project of a client
// takes its design system version, toolkit pin and role skill selections from one of the client's apps, and its
// client's company brain, each through the office's own mechanism, and what was adopted is recorded. Neutral
// synthetic data only; no office is started, nothing reaches GitHub, no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdoptService, type AdoptDeps } from '../src/server/adopt-from/service.js';
import { withAdopt, type AdoptSetup } from '../src/server/wizard/adopt-step.js';
import { withDesign } from '../src/server/wizard/design-step.js';
import { cleanPlan } from '../src/server/wizard/plan.js';
import { adoptFromRoutes } from '../src/server/http/routes/adopt-from.js';
import { adoptSummary, cleanPlanAdopt, recordHeadline, type AdoptItem, type AdoptSource } from '../src/shared/adopt-from.js';
import { SETUP_STEPS, type ProjectPlan, type StepId } from '../src/shared/wizard.js';
import type { StepImpl } from '../src/server/wizard/job.js';
import type { RoleId } from '../src/shared/roster/roles.js';
import type { SkillOverrides } from '../src/shared/roster/skills.js';
import { appDir, designWorld, published } from './design-helpers.js';

const ACME = 'pfl_01JA0000000000000000000001';
const GLOBEX = 'pfl_01JA0000000000000000000002';
const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'adopt-from-'));

interface World {
  svc: AdoptService;
  deps: AdoptDeps;
  audits: string[];
  bindings: Map<string, { systemId: string; name: string; n: number; digest: string }>;
  skills: Map<string, Partial<Record<RoleId, SkillOverrides>>>;
  pins: Map<string, string>;
}

/** Acme Logistics (with a brain): Fleet Tracker (design v2, a pin, role skills) and Depot Checks (nothing); Globex Retail: Store Audit. */
function world(over: Partial<AdoptDeps> = {}): World {
  const floors = [
    { id: 'fleet-tracker', name: 'Fleet Tracker', dir: '/p/fleet' },
    { id: 'depot-checks', name: 'Depot Checks', dir: '/p/depot' },
    { id: 'store-audit', name: 'Store Audit', dir: '/p/store' },
    { id: 'loose', name: 'On its own', dir: '/p/loose' },
  ];
  const clientOfFloor: Record<string, string> = { 'fleet-tracker': ACME, 'depot-checks': ACME, 'store-audit': GLOBEX };
  const clients: Record<string, { id: string; label: string; brain: boolean }> = { [ACME]: { id: ACME, label: 'Acme Logistics', brain: true }, [GLOBEX]: { id: GLOBEX, label: 'Globex Retail', brain: false } };
  const bindings = new Map([['fleet-tracker', { systemId: 'ds_acme', name: 'Acme Design System', n: 2, digest: 'f'.repeat(64) }], ['store-audit', { systemId: 'ds_globex', name: 'Globex Look', n: 1, digest: 'e'.repeat(64) }]]);
  const skills = new Map<string, Partial<Record<RoleId, SkillOverrides>>>([['fleet-tracker', { 'lead-developer': { escalate: { gate: 'tell' } }, 'lead-tester': { report: { enabled: false } } }]]);
  const pins = new Map([['/p/fleet', SHA]]);
  const audits: string[] = [];
  const deps: AdoptDeps = {
    dataDir: tmp(),
    floors: () => floors,
    clientOf: (f) => (clientOfFloor[f] ? { id: clientOfFloor[f], label: clients[clientOfFloor[f]].label } : undefined),
    client: (id) => clients[id],
    binding: (f) => bindings.get(f),
    design: async (f) => {
      const b = bindings.get(f);
      return b ? { ...b, kind: 'branded', status: 'approved', compat: { studioPro: '11.12.4', mxcli: 'nightly-test' }, gaps: ['logo'], swatch: ['#264ae5'], verified: true } : undefined;
    },
    toolkit: (f) => (pins.get(f.dir) ? { sha: pins.get(f.dir)! } : undefined),
    skills: (f) => skills.get(f) ?? {},
    roleTitle: (r) => ({ 'lead-developer': 'Lead Developer', 'lead-tester': 'Lead Tester' })[r as string] ?? r,
    audit: (e) => void audits.push(`${e.action}: ${e.summary}`),
    now: () => Date.UTC(2026, 9, 20, 10),
    ...over,
  };
  return { svc: new AdoptService(deps), deps, audits, bindings, skills, pins };
}

const basePlan = (over: Partial<ProjectPlan> = {}): ProjectPlan => ({ kind: 'new', owner: 'acme', name: 'yard-planner', description: '', private: true, mendix: '11.12.4', entry: 'greenfield', tier: 'standard', interview: 'steering', execApproval: 'auto', intake: [], clients: [], operators: [], roles: ['pm', 'lead-developer'], discovery: { issue: false, queue: false, model: 'opus' }, createdByHand: false, ...over });

// ---- Which apps, and what each offers ---------------------------------------------------------------

test('sources: the client’s own apps only by default, with what each offers; an app without a design system or skills says so', async () => {
  const { svc } = world();
  const v = await svc.sources(ACME, { all: false, admin: false });
  assert.deepEqual(v.sources.map((s) => s.name), ['Depot Checks', 'Fleet Tracker']);
  assert.deepEqual(v.clientBrain, { client: 'Acme Logistics', connected: true });
  const fleet = v.sources.find((s) => s.floor === 'fleet-tracker')!;
  assert.equal(fleet.design?.name, 'Acme Design System');
  assert.equal(fleet.design?.n, 2);
  assert.deepEqual(fleet.design?.compat, { studioPro: '11.12.4', mxcli: 'nightly-test' });
  assert.equal(fleet.toolkit?.sha, SHA);
  assert.deepEqual(fleet.roleSkills, [{ role: 'lead-developer', title: 'Lead Developer', changes: 1 }, { role: 'lead-tester', title: 'Lead Tester', changes: 1 }]);
  assert.equal(fleet.crossClient, false);
  const depot = v.sources.find((s) => s.floor === 'depot-checks')!;
  assert.equal(depot.design, undefined, 'no design system');
  assert.equal(depot.toolkit, undefined);
  assert.deepEqual(depot.roleSkills, []);
});

test('sources: other clients’ apps only for an admin who asks (all); an empty client has nothing to adopt', async () => {
  const { svc } = world();
  const notAdmin = await svc.sources(ACME, { all: true, admin: false });
  assert.equal(notAdmin.all, false);
  assert.ok(notAdmin.sources.every((s) => !s.crossClient));
  const admin = await svc.sources(ACME, { all: true, admin: true });
  assert.deepEqual(admin.sources.map((s) => `${s.name}${s.crossClient ? ' (other)' : ''}`), ['Depot Checks', 'Fleet Tracker', 'Store Audit (other)'], 'the client’s own first; a project in no client never');
  const empty = world({ floors: () => [] });
  const v = await empty.svc.sources(ACME, { all: false, admin: true });
  assert.deepEqual(v.sources, []);
  assert.equal((await empty.svc.sources(undefined, { all: false, admin: true })).sources.length, 0, 'no client, nothing');
});

test('route: all=1 is refused (403) for someone who isn’t an admin; the record route wants a project', async () => {
  let status = 0;
  let body = '';
  const res = { writeHead: (s: number) => (status = s), end: (b: string) => (body = b) } as never;
  const ctx = { cfg: { dataDir: tmp() }, meOf: () => ({ admin: false }), floors: new Map() } as never;
  await adoptFromRoutes.sources.handle(ctx, { res, url: new URL(`http://x/api/adopt-from/sources?client=${ACME}&all=1`), session: {} } as never);
  assert.equal(status, 403);
  assert.match(JSON.parse(body).error, /Only an admin can start from another client’s app/);
  await adoptFromRoutes.record.handle(ctx, { res, url: new URL('http://x/api/adopt-from/record?floor=nope'), session: {} } as never);
  assert.equal(status, 404);
});

// ---- The plan --------------------------------------------------------------------------------------

test('cleanPlan: a project created under a client keeps its adoption (source and three yes/no choices); without a client it’s dropped; never the page’s resolved facts', () => {
  const raw = { ...basePlan(), portfolio: ACME, adopt: { source: 'fleet-tracker', design: true, toolkit: true, roleSkills: true, resolved: { sourceName: 'forged', toolkit: { sha: 'deadbeef' } } } };
  const plan = cleanPlan(raw, ['11.12.4'], 'acme');
  assert.ok(typeof plan !== 'string');
  assert.equal(plan.portfolio, ACME, 'created under the client');
  assert.deepEqual(plan.adopt, { source: 'fleet-tracker', design: true, toolkit: true, roleSkills: true });
  const none = cleanPlan({ ...raw, portfolio: undefined }, ['11.12.4'], 'acme');
  assert.ok(typeof none !== 'string' && !none.adopt);
  assert.equal(cleanPlanAdopt({ source: '../x' }), undefined);
});

test('resolve: the source’s exact design version becomes the plan’s design, its pin and role skills are taken as they are now, the client’s brain noted', () => {
  const { svc } = world();
  const plan = basePlan({ portfolio: ACME, adopt: { source: 'fleet-tracker', design: true, toolkit: true, roleSkills: true } });
  assert.equal(svc.resolve(plan, false), undefined);
  assert.deepEqual(plan.design, { choice: 'use', systemId: 'ds_acme', n: 2 }, 'the explicit binding mechanism: an exact version');
  const r = plan.adopt!.resolved!;
  assert.equal(r.sourceName, 'Fleet Tracker');
  assert.equal(r.toolkit?.sha, SHA);
  assert.deepEqual(r.roleSkills, { 'lead-developer': { escalate: { gate: 'tell' } }, 'lead-tester': { report: { enabled: false } } });
  assert.deepEqual(r.brain, { client: 'Acme Logistics' });
  // Choices not taken are not resolved; an app without a design system gives none (and the plan's design stays as it was).
  const p2 = basePlan({ portfolio: ACME, design: { choice: 'keep' }, adopt: { source: 'depot-checks', design: true, toolkit: true, roleSkills: true } });
  svc.resolve(p2, false);
  assert.deepEqual(p2.design, { choice: 'keep' });
  assert.equal(p2.adopt!.resolved!.design, undefined);
  assert.equal(p2.adopt!.resolved!.toolkit, undefined);
  assert.equal(p2.adopt!.resolved!.roleSkills, undefined);
});

test('resolve: another client’s app is an admin’s only; an app no longer in the office is refused', () => {
  const { svc } = world();
  const cross = () => basePlan({ portfolio: ACME, adopt: { source: 'store-audit', design: true } });
  assert.equal(svc.resolve(cross(), false), 'Only an admin can start from another client’s app');
  const ok = cross();
  assert.equal(svc.resolve(ok, true), undefined);
  assert.equal(ok.adopt!.resolved!.sourceClient?.label, 'Globex Retail');
  assert.deepEqual(ok.design, { choice: 'use', systemId: 'ds_globex', n: 1 });
  assert.match(svc.resolve(basePlan({ portfolio: ACME, adopt: { source: 'gone' } }), true)!, /isn’t in the office any more/);
});

// ---- The setup ------------------------------------------------------------------------------------

function fakeSteps(log: string[]): Record<StepId, StepImpl> {
  return Object.fromEntries(
    SETUP_STEPS.map((s) => [
      s.id,
      async (job: Parameters<StepImpl>[0]) => {
        // The init step pins the newest toolkit unless the job already has one (steps.ts).
        if (s.id === 'init') job.toolkit ??= { sha: 'newest0000000', dir: '/pins/newest' };
        log.push(`${s.id}${s.id === 'init' ? ` on ${job.toolkit?.sha.slice(0, 7)}` : ''}`);
        return { status: 'done' as const, detail: 'ok' };
      },
    ]),
  ) as Record<StepId, StepImpl>;
}

function setupOf(w: World, over: Partial<AdoptSetup> = {}) {
  const calls: string[] = [];
  const copied = new Map<string, Partial<Record<RoleId, SkillOverrides>>>();
  const s: AdoptSetup = {
    pin: async (sha) => (calls.push(`pin ${sha.slice(0, 7)}`), { sha, dir: `/pins/${sha.slice(0, 12)}` }),
    copySkills: (floor, map) => (copied.set(floor, map), calls.push(`skills ${floor}`), Object.values(map).reduce((n, o) => n + Object.keys(o ?? {}).length, 0)),
    bound: (f) => (f === 'yard' ? { systemId: 'ds_acme', n: 2 } : undefined),
    proposed: () => undefined,
    wired: async () => true,
    note: (floor, plan, by, items) => w.svc.note(floor, plan, by, items).then(() => undefined),
    ...over,
  };
  return { s, calls, copied };
}

test('setup: the toolkit pin chosen as the source’s is the one init runs on; the newest when not chosen; a pin that can’t be made falls back', async () => {
  const w = world();
  const plan = basePlan({ portfolio: ACME, adopt: { source: 'fleet-tracker', toolkit: true } });
  w.svc.resolve(plan, false);
  const log: string[] = [];
  const { s, calls } = setupOf(w);
  const job = { plan, floor: 'yard', dir: '/p/yard', by: 'Ada' } as unknown as Parameters<StepImpl>[0];
  await withAdopt(s, fakeSteps(log)).init(job, { log: () => undefined });
  assert.deepEqual(calls, ['pin abcdef1']);
  assert.deepEqual(log, ['init on abcdef1'], 'init ran on the source’s pin');
  const rec = (await w.svc.record('yard'))!;
  assert.deepEqual(rec.items.find((i) => i.kind === 'toolkit'), { kind: 'toolkit', status: 'available', text: 'Toolkit pinned at abcdef1, the same as Fleet Tracker' });

  // Default: the newest toolkit, no pin asked for.
  const p2 = basePlan({ portfolio: ACME, adopt: { source: 'fleet-tracker' } });
  w.svc.resolve(p2, false);
  const log2: string[] = [];
  const two = setupOf(w);
  await withAdopt(two.s, fakeSteps(log2)).init({ plan: p2, floor: 'yard2', dir: '/p/y2', by: 'Ada' } as never, { log: () => undefined });
  assert.deepEqual(two.calls, []);
  assert.deepEqual(log2, ['init on newest0']);

  // A pin that can't be made: the newest toolkit, said, and recorded as not available.
  const lines: string[] = [];
  const three = setupOf(w, { pin: async () => Promise.reject(new Error('not even after a fetch')) });
  await withAdopt(three.s, fakeSteps([])).init({ plan, floor: 'yard3', dir: '/p/y3', by: 'Ada' } as never, { log: (l: string) => void lines.push(l) });
  assert.ok(lines.some((l) => /couldn't make Fleet Tracker's toolkit pin abcdef1 \(not even after a fetch\): the newest toolkit instead/.test(l)));
  assert.equal((await w.svc.record('yard3'))!.items.find((i) => i.kind === 'toolkit')!.status, 'failed');
});

test('setup: role skill selections are copied onto the new project before its team is hired, once; recorded', async () => {
  const w = world();
  const plan = basePlan({ portfolio: ACME, adopt: { source: 'fleet-tracker', roleSkills: true } });
  w.svc.resolve(plan, false);
  const log: string[] = [];
  const { s, calls, copied } = setupOf(w);
  const steps = withAdopt(s, fakeSteps(log));
  await steps.team({ plan, floor: 'yard', dir: '/p/yard', by: 'Ada' } as never, { log: () => undefined });
  assert.deepEqual(calls, ['skills yard']);
  assert.deepEqual(log, ['team'], 'copied first, then the team step');
  assert.deepEqual(copied.get('yard'), { 'lead-developer': { escalate: { gate: 'tell' } }, 'lead-tester': { report: { enabled: false } } });
  assert.match((await w.svc.record('yard'))!.items.find((i) => i.kind === 'role-skills')!.text, /Role skill selections from Fleet Tracker: 2 changes across 2 roles, in each Playbook/);
  // After an edit (roles added later) nothing is copied again.
  await steps.team({ plan, floor: 'yard', dir: '/p/yard', by: 'Ada', addRoles: ['lead-tester'] } as never, { log: () => undefined });
  assert.deepEqual(calls, ['skills yard']);
  // Not chosen: nothing copied.
  const p2 = basePlan({ portfolio: ACME, adopt: { source: 'fleet-tracker' } });
  w.svc.resolve(p2, false);
  const two = setupOf(w);
  await withAdopt(two.s, fakeSteps([])).team({ plan: p2, floor: 'y2', by: 'Ada' } as never, { log: () => undefined });
  assert.deepEqual(two.calls, []);
});

test('setup: the design system version is bound by the wizard’s own design step (real design service), and the brain by the client’s wiring; provenance recorded and audited', async (t) => {
  const d = designWorld(t);
  const v = await published(d.s);
  // The source app is bound to v1 of the client's design system.
  const srcDir = appDir(d.root);
  d.floors.push({ id: 'fleet-tracker', name: 'Fleet Tracker', dir: srcDir });
  assert.equal((await d.s.setupNew('fleet-tracker', srcDir, v.id, v.n, 'Ada')).ok, true);
  const w = world({ binding: (f) => d.s.projects.binding(f) });
  const plan = basePlan({ portfolio: ACME, adopt: { source: 'fleet-tracker', design: true } });
  assert.equal(w.svc.resolve(plan, false), undefined);
  assert.deepEqual(plan.design, { choice: 'use', systemId: v.id, n: v.n });
  // The new project's setup: the design step (withDesign) applies the plan's version; adopt-step checks and records it.
  const newDir = appDir(d.root);
  d.floors.push({ id: 'yard', name: 'Yard Planner', dir: newDir });
  const { s } = setupOf(w, { bound: (f) => d.s.projects.binding(f), proposed: (f) => d.s.projects.proposal(f) });
  const steps = withAdopt(s, withDesign(d.s, fakeSteps([])));
  const job = { plan, floor: 'yard', dir: newDir, by: 'Ada' } as unknown as Parameters<StepImpl>[0];
  await steps.app(job, { log: () => undefined });
  await steps.init(job, { log: () => undefined });
  const b = d.s.projects.binding('yard')!;
  assert.equal(b.systemId, v.id);
  assert.equal(b.n, v.n);
  assert.equal(b.digest, d.s.projects.binding('fleet-tracker')!.digest, 'the same exact version as the source');
  const rec = (await w.svc.record('yard'))!;
  assert.equal(rec.source.name, 'Fleet Tracker');
  assert.equal(rec.source.client, 'Acme Logistics');
  const items = Object.fromEntries(rec.items.map((i) => [i.kind, i])) as Record<string, AdoptItem>;
  assert.equal(items.design.status, 'available');
  assert.match(items.design.text, /Acme Design System v1 \(from Fleet Tracker\): bound at setup; its guidance is available to agents/);
  assert.equal(items.brain.status, 'available');
  assert.match(items.brain.text, /Acme Logistics company brain connected: its pointer is available to agents \(the client’s own wiring, checked\)/);
  assert.doesNotMatch(JSON.stringify(rec), /\bapplied\b(?! yet)/i, 'available to agents, never "applied"');
  assert.ok(w.audits.some((a) => /^floor\.adopt-from: Started from Fleet Tracker/.test(a)));
  assert.equal(recordHeadline(rec, 'en-GB'), 'Adopted from Fleet Tracker (Acme Logistics) on 20 Oct 2026');
  const file = w.svc.store.file('yard')!;
  assert.ok(existsSync(file));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).items.length, 2);
});

test('setup: a plan without adoption runs the steps exactly as before; incomplete brain wiring is recorded as not available', async () => {
  const w = world();
  const base = fakeSteps([]);
  assert.equal(withAdopt(undefined, base), base);
  const { s } = setupOf(w, { wired: async () => false });
  const steps = withAdopt(s, base);
  const job = { plan: basePlan({ portfolio: ACME }), floor: 'x', by: 'Ada' } as never;
  assert.equal((await steps.init(job, { log: () => undefined })).status, 'done');
  assert.equal(await w.svc.record('x'), undefined, 'nothing recorded without an adoption');
  const plan = basePlan({ portfolio: ACME, adopt: { source: 'depot-checks' } });
  w.svc.resolve(plan, false);
  await steps.init({ plan, floor: 'y', by: 'Ada' } as never, { log: () => undefined });
  assert.equal((await w.svc.record('y'))!.items[0].status, 'failed');
});

test('summary: what the project will start with, in plain words', () => {
  const s: AdoptSource = { floor: 'fleet-tracker', name: 'Fleet Tracker', crossClient: false, design: { systemId: 'ds', name: 'Acme Design System', n: 3, digest: 'f'.repeat(64), kind: 'branded', gaps: [], swatch: [], verified: true }, toolkit: { sha: SHA }, roleSkills: [{ role: 'lead-developer', title: 'Lead Developer', changes: 1 }] };
  assert.deepEqual(adoptSummary({ source: 'fleet-tracker', design: true, toolkit: true, roleSkills: true }, s, { client: 'Acme Logistics', connected: true }), ['Design system Acme Design System v3 (from Fleet Tracker)', 'Acme Logistics brain connected', 'Toolkit pin same as Fleet Tracker', 'Role skills from Fleet Tracker']);
  assert.deepEqual(adoptSummary({ source: 'fleet-tracker' }, s, { client: 'Acme Logistics', connected: false }), ['Newest toolkit (default)']);
  assert.deepEqual(adoptSummary(undefined, undefined, undefined), []);
});
