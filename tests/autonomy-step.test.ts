// The New project flow's required autonomy step (shared/roster/autonomy-step.ts, roster/autonomy-choice.ts):
// the preview copy is generated from the gate tables (a snapshot per level), the organisation policy limits or
// fixes the level (fixed needs the acknowledgement), the office refuses a New project plan without a valid
// answer and records older callers as the default, the team step applies and records the choice (audited),
// a budget level no longer changes autonomy on such a project while an existing one is unchanged, a later
// change is noted with who and when, and raising the level never approves what is already waiting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUTONOMY, CRITICAL_TRIGGERS, DEFAULT_AUTONOMY, teamMayDecide, type AutonomyLevel } from '../src/shared/roster/autonomy.js';
import {
  ALWAYS_REACH,
  HELD_FOOTER,
  RECOMMENDED,
  STEP_REQUIRED,
  allowedLevels,
  askProblem,
  changeLine,
  choiceLine,
  cleanPolicy,
  levelPreview,
  olderCallerLevel,
  outsidePolicy,
  withoutAutonomyLine,
  type AutonomyPolicy,
} from '../src/shared/roster/autonomy-step.js';
import { LEVELS as BUDGET_LEVELS } from '../src/shared/budget/levels.js';
import { applyAutonomyChoice, autonomyPolicy, autonomyRecord, autonomySeparate, forgetAutonomyFiles, levelTeamPatch, noteAutonomyChange, resolveAutonomy, setAutonomyPolicy } from '../src/server/roster/autonomy-choice.js';
import { cleanPlan } from '../src/server/wizard/plan.js';
import { withAutonomy } from '../src/server/wizard/autonomy-step.js';
import { AuditLog, onAuditEvent, useAudit } from '../src/server/audit/index.js';
import type { AuditEvent } from '../src/shared/audit.js';
import { Roster } from '../src/server/roster/index.js';
import { makeEscalation } from '../src/shared/roster/escalation.js';
import { toProposals } from '../src/server/roster/standup.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { ProjectPlan, StepId } from '../src/shared/wizard.js';
import type { JobState, StepImpl } from '../src/server/wizard/job.js';

const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));
const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ---- The copy ------------------------------------------------------------------------------------

const snap = (l: AutonomyLevel) => {
  const p = levelPreview(l);
  return { one: p.one, may: p.may.map((m) => m.text), mayNote: p.mayNote, approvals: p.approvals.map((a) => `${a.text} [${a.held}]`), turns: p.turns, alerts: p.alerts };
};

test('the preview of each level, generated from the gate tables (snapshot)', () => {
  const NEEDS = ['Spending past the budget [stops]', 'Hands-on actions only a person can do (sign-ins, keys, installs) [only-you]'];
  assert.deepEqual(snap(1), {
    one: 'You approve every piece of work before it starts.',
    may: [],
    mayNote: 'Nothing on its own: the team proposes every task and asks before each next step.',
    approvals: ['Tasks within the agreed scope [told]', 'Work outside the agreed scope [told]', 'Design and architecture changes [told]', 'Approving another team’s work [told]', 'Merging finished work into the main version [told]', 'Closing milestones, internal and client-facing [told]', ...NEEDS],
    turns: 'Each finished turn waits for your review.',
    alerts: 'Alerts you about a change to the plan, a scope change, a design change, an architecture change, work still failing review after 2 rounds, anything blocking, a milestone-level issue, repeated failures and a budget risk, as well as critical issues.',
  });
  assert.deepEqual(snap(2), {
    one: 'The team does routine work within the agreed scope; you decide changes and merges.',
    may: ['Tasks within the agreed scope'],
    mayNote: '',
    approvals: ['Work outside the agreed scope [told]', 'Design and architecture changes [told]', 'Approving another team’s work [told]', 'Merging finished work into the main version [told]', 'Closing milestones, internal and client-facing [told]', ...NEEDS],
    turns: 'Each finished turn waits for your review.',
    alerts: 'Alerts you about a scope change, a design change, an architecture change, work still failing review after 2 rounds and anything blocking, as well as critical issues.',
  });
  assert.deepEqual(snap(3), {
    one: 'Team leads approve each other’s work and design changes; you approve merges, milestones and spend.',
    may: ['Tasks within the agreed scope', 'Work outside the agreed scope', 'Design and architecture changes', 'Approving another team’s work'],
    mayNote: '',
    approvals: ['Merging finished work into the main version [told]', 'Closing milestones, internal and client-facing [told]', ...NEEDS],
    turns: 'Finished turns are quiet; what needs you arrives as an escalation.',
    alerts: 'Alerts you about a milestone-level issue, repeated failures and a budget risk, as well as critical issues.',
  });
  assert.deepEqual(snap(4), {
    one: 'The team works on its own; you approve client-facing milestones and spend.',
    may: ['Tasks within the agreed scope', 'Work outside the agreed scope', 'Design and architecture changes', 'Approving another team’s work', 'Merging finished work into the main version', 'Closing internal milestones'],
    mayNote: '',
    approvals: ['Client-facing milestones [told]', ...NEEDS],
    turns: 'Finished turns are quiet; what needs you arrives as an escalation.',
    alerts: 'Only critical issues alert you.',
  });
});

test('the preview is the gate table: every kind once, on the side AUTONOMY says; spending is held by auto-pause only when it is on', () => {
  for (const l of [1, 2, 3, 4] as const) {
    const p = levelPreview(l);
    assert.deepEqual(p.approvals.flatMap((a) => a.kinds).sort(), [...AUTONOMY[l].approves].sort(), `level ${l}: approvals`);
    assert.deepEqual(p.may.flatMap((m) => m.kinds).sort(), teamMayDecide(l).sort(), `level ${l}: may`);
    assert.equal(levelPreview(l, { autoPause: false }).approvals.find((a) => a.kinds.includes('budget'))!.held, 'told', 'no auto-pause: only an alert');
  }
  // The footer's "always reach you" are critical triggers, and it says what isn't held and that agents never deploy.
  for (const t of ALWAYS_REACH) assert.ok(CRITICAL_TRIGGERS.includes(t), t);
  assert.match(HELD_FOOTER, /merges are only blocked if your main branch is protected on GitHub/);
  assert.match(HELD_FOOTER, /security, data-loss and budget-overrun issues always reach you/);
  assert.match(HELD_FOOTER, /agents are told never to deploy/);
  assert.equal(RECOMMENDED, DEFAULT_AUTONOMY, 'the badge is the office’s own default');
  // The quiet turns line and the roster agree: one function.
  assert.match(src('src/server/roster/index.ts'), /return quietTurns\(this\.data\(floorId\)\.settings\.autonomy\)/);
});

// ---- The policy ------------------------------------------------------------------------------------

test('the policy limits or fixes the level; fixed needs the acknowledgement; off by default', () => {
  assert.deepEqual(cleanPolicy(undefined), { mode: 'none' });
  assert.deepEqual(cleanPolicy({ mode: 'limit', allowed: [1, 2, 3, 4] }), { mode: 'none' }, 'all four is no limit');
  assert.deepEqual(cleanPolicy({ mode: 'limit', allowed: [3, 9, 1] }).allowed, [1, 3]);
  assert.deepEqual(cleanPolicy({ mode: 'fixed', level: 7 }), { mode: 'none' });
  const limit: AutonomyPolicy = { mode: 'limit', allowed: [1, 2, 3] };
  const fixed: AutonomyPolicy = { mode: 'fixed', level: 2, name: 'Delivery rules' };
  assert.deepEqual(allowedLevels(undefined), [1, 2, 3, 4]);
  assert.deepEqual(allowedLevels(fixed), [2]);
  assert.equal(askProblem(undefined, undefined), STEP_REQUIRED);
  assert.equal(askProblem({ level: 4 }, undefined), undefined);
  assert.match(askProblem({ level: 4 }, limit)!, /isn’t allowed by your organisation’s policy/);
  assert.equal(askProblem({ level: 3 }, limit), undefined);
  assert.match(askProblem({ level: 2 }, fixed)!, /^Confirm you understand the team will work at 2 Guided/);
  assert.equal(askProblem({ level: 2, ack: true }, fixed), undefined);
  assert.match(askProblem({ level: 3, ack: true }, fixed)!, /fixes the level at 2 Guided/);
  assert.equal(askProblem({ level: 2, byStage: true }, undefined), undefined, 'by stage offered below Delegated');
  assert.match(askProblem({ level: 3, byStage: true }, undefined)!, /isn’t offered/);
  assert.match(askProblem({ level: 2, byStage: true }, { mode: 'limit', allowed: [1, 2] })!, /under your organisation’s policy/);
  assert.deepEqual(olderCallerLevel(undefined), { level: 2, source: 'default' });
  assert.deepEqual(olderCallerLevel({ mode: 'limit', allowed: [3, 4] }), { level: 3, source: 'policy' });
  assert.deepEqual(olderCallerLevel({ mode: 'fixed', level: 4 }), { level: 4, source: 'policy' });
  // A later change on the Team settings stays inside it; a project already outside can still save the rest.
  assert.match(outsidePolicy(limit, { autonomy: 4 }, { autonomy: 2 })!, /Level 4 Autonomous: .*Up to|Level 4 Autonomous: .*Only 1 Directive, 2 Guided and 3 Delegated/);
  assert.equal(outsidePolicy(limit, { autonomy: 4, idleMinutes: 5 }, { autonomy: 4 }), undefined);
  assert.match(outsidePolicy(limit, { autonomy: 2, autonomyByStage: { enabled: true, early: 2, build: 4 } }, { autonomy: 2 })!, /by stage/);
  assert.equal(outsidePolicy({ mode: 'none' }, { autonomy: 4 }, { autonomy: 1 }), undefined);
});

test('an admin sets the policy (audited); a bad one is refused', (t) => {
  const dir = tmp('ao-policy-');
  const log = new AuditLog(path.join(dir, 'audit'));
  useAudit(log);
  const seen: AuditEvent[] = [];
  const off = onAuditEvent((e) => seen.push(e));
  t.after(() => (off(), useAudit(undefined), forgetAutonomyFiles()));
  assert.deepEqual(autonomyPolicy(dir), { mode: 'none' });
  assert.match(setAutonomyPolicy(dir, { mode: 'limit', allowed: [] }, { name: 'Alex Lee' }) as string, /Tick at least one/);
  assert.match(setAutonomyPolicy(dir, { mode: 'fixed' }, { name: 'Alex Lee' }) as string, /Pick the level/);
  const p = setAutonomyPolicy(dir, { mode: 'fixed', level: 2, name: 'Delivery rules' }, { name: 'Alex Lee', id: 'u1' }, 1000);
  assert.deepEqual(p, { mode: 'fixed', level: 2, name: 'Delivery rules', by: 'Alex Lee', at: 1000 });
  forgetAutonomyFiles();
  assert.equal(autonomyPolicy(dir).level, 2, 'kept on disk');
  const e = seen.find((x) => x.action === 'settings.change')!;
  assert.equal(e.target?.id, 'autonomy.policy');
  assert.match(e.summary, /"Fixed at 2 Guided" \(was "None: every level may be chosen"\)/);
});

// ---- At /api/wizard/start ------------------------------------------------------------------------

const BRIEF = { draftId: 'd-abc123-0a1b2c' } as ProjectPlan['brief'];

test('the office refuses a New project plan without a valid answer, and records older callers as the default', () => {
  const who = { name: 'Alex Lee', id: 'u1' };
  assert.equal(resolveAutonomy({ brief: BRIEF }, { mode: 'none' }, who), STEP_REQUIRED);
  assert.equal(resolveAutonomy({ brief: BRIEF, autonomy: { level: 9 as AutonomyLevel } }, { mode: 'none' }, who), STEP_REQUIRED);
  assert.match(resolveAutonomy({ brief: BRIEF, autonomy: { level: 4 } }, { mode: 'limit', allowed: [1, 2] }, who) as string, /isn’t allowed/);
  assert.match(resolveAutonomy({ brief: BRIEF, autonomy: { level: 2 } }, { mode: 'fixed', level: 2 }, who) as string, /^Confirm/);
  assert.deepEqual(resolveAutonomy({ brief: BRIEF, autonomy: { level: 3 } }, { mode: 'none' }, who, 5), { level: 3, source: 'chosen', by: 'Alex Lee', byId: 'u1', at: 5 });
  assert.deepEqual(resolveAutonomy({ brief: BRIEF, autonomy: { level: 2, byStage: true } }, { mode: 'none' }, { name: 'Sam' }, 5), { level: 2, source: 'chosen', by: 'Sam', shared: true, at: 5, byStage: true }, 'the shared password says so');
  assert.deepEqual(resolveAutonomy({ brief: BRIEF, autonomy: { level: 2, ack: true } }, { mode: 'fixed', level: 2, name: 'Delivery rules' }, who, 5), { level: 2, source: 'policy', by: 'Alex Lee', byId: 'u1', at: 5, policy: 'Delivery rules', acknowledged: true });
  // Older callers (the classic form, scripts, the API without a brief): never refused.
  assert.deepEqual(resolveAutonomy({}, { mode: 'none' }, who, 5), { level: 2, source: 'default', by: 'Alex Lee', byId: 'u1', at: 5 });
  assert.deepEqual(resolveAutonomy({ autonomy: { level: 4 } }, { mode: 'limit', allowed: [3, 4], name: 'R' }, who, 5), { level: 3, source: 'policy', by: 'Alex Lee', byId: 'u1', at: 5, policy: 'R' });
  // cleanPlan keeps only what the page may say; the record's fields are the office's to write.
  const plan = cleanPlan({ kind: 'new', owner: 'org', name: 'travel', mendix: '11.12.4', entry: 'greenfield', roles: [], autonomy: { level: 3, ack: true, byStage: 'yes', source: 'policy', by: 'Mallory', at: 1 } }, ['11.12.4'], 'org') as ProjectPlan;
  assert.deepEqual(plan.autonomy, { level: 3, ack: true });
  // Wizard.start checks it before anything is made, and an edit keeps the setup's record.
  const w = src('src/server/wizard/index.ts');
  const start = w.slice(w.indexOf('  start(raw: unknown'), w.indexOf('  retryBlocker('));
  assert.ok(start.indexOf('resolveAutonomy(') > 0 && start.indexOf('resolveAutonomy(') < start.indexOf('newJob(plan'), 'checked before the job is made');
  assert.match(start, /if \(typeof autonomy === 'string'\) return autonomy;/);
  assert.match(w, /teamFrom: job\.plan\.teamFrom, autonomy: job\.plan\.autonomy \}/, 'an edit never changes it');
});

// ---- The team step, the budget level, later changes, pending items ------------------------------------

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'p';
  dir = tmp('ao-aut-floor-');
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string }[] = [];
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk) {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', name: ask.name, status: 'idle', acked: true, createdAt: 0, viewers: [], viewerIds: [] } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop() {}
  prompt = (id: string, text: string) => void this.prompts.push({ id, text });
  wake = () => undefined;
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = () => {};
}

function office(t: { after(fn: () => void): void }) {
  const dataDir = tmp('ao-aut-data-');
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({}), analysis: () => '', now: () => Date.UTC(2026, 9, 20), pipelineStage: () => 'early' }, 0);
  roster.data(floor.id).settings.schedule.enabled = false;
  const log = new AuditLog(path.join(dataDir, 'audit'));
  useAudit(log);
  const seen: AuditEvent[] = [];
  const off = onAuditEvent((e) => seen.push(e));
  t.after(() => (off(), useAudit(undefined), forgetAutonomyFiles()));
  const deps = { dataDir, level: () => roster.data(floor.id).settings.autonomy, settings: (p: Record<string, unknown>, by: string, id?: string) => roster.members.settings(floor, p, by, id) };
  return { dataDir, floor, roster, seen, deps, s: () => roster.data(floor.id).settings };
}

test('the team step applies a chosen level (by stage off unless ticked), records it and audits it, once', (t) => {
  const o = office(t);
  o.s().autonomyByStage = { enabled: true, early: 3, build: 4 };
  const choice = { level: 1 as const, source: 'chosen' as const, by: 'Alex Lee', byId: 'u1', at: 1000 };
  assert.match(applyAutonomyChoice(o.floor.id, choice, false, o.deps), /1 Directive \(chosen\)/);
  assert.equal(o.s().autonomy, 1);
  assert.equal(o.s().autonomyByStage.enabled, false, 'never left on from elsewhere');
  assert.deepEqual(autonomyRecord(o.dataDir, o.floor.id).choice, choice);
  const ev = o.seen.find((e) => e.action === 'autonomy.choice')!;
  assert.equal(ev.actor.name, 'Alex Lee');
  assert.deepEqual(ev.details, { level: 1, source: 'chosen' });
  assert.ok(o.seen.some((e) => e.action === 'roster.autonomy'), 'and the level change itself, as today');
  assert.equal(applyAutonomyChoice(o.floor.id, choice, false, o.deps), 'autonomy: already applied', 'a Retry applies nothing twice');
  assert.equal(choiceLine(autonomyRecord(o.dataDir, o.floor.id).choice, day), '1 Directive, chosen by Alex Lee on 1970-01-01.');
  // Ticked: rises by stage from the chosen level to Delegated.
  const o2 = office(t);
  applyAutonomyChoice(o2.floor.id, { level: 2, source: 'chosen', by: 'Sam', shared: true, at: 2, byStage: true }, false, o2.deps);
  assert.deepEqual(o2.s().autonomyByStage, { enabled: true, early: 2, build: 3 });
  assert.match(choiceLine(autonomyRecord(o2.dataDir, o2.floor.id).choice, day), /^2 Guided, chosen by Sam \(shared password\) on .*; rises to 3 Delegated once the build plan passes\.$/);
});

test('an older caller’s default: recorded on a project the setup made, nothing on one that was already there', (t) => {
  const o = office(t);
  const d = { level: 2 as const, source: 'default' as const, by: 'an admin', shared: true, at: 3 };
  assert.match(applyAutonomyChoice(o.floor.id, d, true, o.deps), /kept at 2 \(the project was there before this setup\)/);
  assert.equal(autonomyRecord(o.dataDir, o.floor.id).choice, undefined, 'no record: it predates the step');
  assert.equal(choiceLine(undefined, day), 'No choice recorded: this project was set up before the autonomy step, or added without the New project wizard. It keeps its settings.');
  assert.match(applyAutonomyChoice(o.floor.id, d, false, o.deps), /2 Guided \(default \(older caller\)\)/);
  assert.equal(autonomyRecord(o.dataDir, o.floor.id).choice?.source, 'default');
  assert.equal(autonomySeparate(o.dataDir, o.floor.id), false, 'an older caller’s project keeps the budget level’s old way');
});

test('the setup’s team step applies the record before the budget, never on an edit, never for a plan from before the step', async () => {
  const order: string[] = [];
  const steps = { team: async () => (order.push('team'), { status: 'done' as const }) } as unknown as Record<StepId, StepImpl>;
  const wrapped = withAutonomy({ applyAutonomy: (f, c) => (order.push(`autonomy ${f} ${c.level}`), 'autonomy: ok') }, steps);
  const job = (over: Partial<JobState>) => ({ id: 'j', floor: 'f1', startedAt: 1, plan: { autonomy: { level: 3, source: 'chosen', by: 'A', at: 2 } }, ...over }) as unknown as JobState;
  const io = { log: () => {} };
  await wrapped.team(job({}), io);
  await wrapped.team(job({ addRoles: ['lead-tester'] }), io);
  await wrapped.team(job({ plan: {} as ProjectPlan }), io);
  assert.deepEqual(order, ['autonomy f1 3', 'team', 'team', 'team']);
  assert.match(src('src/server/wizard/steps.ts'), /return withAutonomy\(deps, withTeamFrom\(/, 'outermost: before the budget level and the hires');
});

test('a budget level no longer changes autonomy on a project that chose it; an existing project is unchanged', (t) => {
  const fast = BUDGET_LEVELS.find((l) => l.id === 'fast')!.settings;
  // A project from the step: Fast keeps its hands off autonomy by stage.
  const o = office(t);
  applyAutonomyChoice(o.floor.id, { level: 2, source: 'chosen', by: 'A', at: 1 }, false, o.deps);
  assert.equal(autonomySeparate(o.dataDir, o.floor.id), true);
  assert.equal(o.roster.members.settings(o.floor, levelTeamPatch(fast, 4, autonomySeparate(o.dataDir, o.floor.id)), 'A'), undefined);
  assert.equal(o.s().autonomy, 2);
  assert.equal(o.s().autonomyByStage.enabled, false);
  assert.equal(o.s().maxSubagents, 4, 'the rest of the level still applies');
  // An existing project (no record): as before, Fast turns autonomy by stage on (3 early, 4 building).
  const old = office(t);
  const before = JSON.stringify(old.s());
  assert.equal(autonomySeparate(old.dataDir, old.floor.id), false);
  old.roster.members.settings(old.floor, levelTeamPatch(fast, 4, false), 'A');
  assert.deepEqual(old.s().autonomyByStage, { enabled: true, early: 3, build: 4 });
  assert.equal(old.s().autonomy, 3, 'the old behaviour, kept for projects from before the step');
  assert.notEqual(JSON.stringify(old.s()), before);
  // The budget code takes the patch from that one function, and the cards drop the autonomy line where it no longer applies.
  assert.match(src('src/server/budget/index.ts'), /roster\.members\.settings\(tf, levelTeamPatch\(s, SUBAGENTS_AT_ONCE\[s\.parallel\], autonomySeparate\(ctx\.cfg\.dataDir, floorId\)\), by\)/);
  assert.deepEqual(withoutAutonomyLine(BUDGET_LEVELS.find((l) => l.id === 'lean')!.changes).some((c) => /autonomy/i.test(c)), false);
  assert.equal(withoutAutonomyLine(BUDGET_LEVELS.find((l) => l.id === 'lean')!.changes).length, BUDGET_LEVELS.find((l) => l.id === 'lean')!.changes.length - 1);
});

test('a later change is noted with who, when, from and to (and audited as roster.autonomy)', (t) => {
  const o = office(t);
  o.roster.members.settings(o.floor, { autonomy: 3 }, 'Alex Lee', 'u1');
  const ev = o.seen.filter((e) => e.action === 'roster.autonomy').at(-1)!;
  assert.deepEqual([ev.actor.name, ev.details], ['Alex Lee', { before: { autonomy: 2 }, after: { autonomy: 3 } }]);
  noteAutonomyChange(o.dataDir, o.floor.id, 2, 3, { name: 'Alex Lee', id: 'u1' }, 86_400_000);
  noteAutonomyChange(o.dataDir, o.floor.id, 3, 3, { name: 'Nobody' }, 1);
  assert.deepEqual(autonomyRecord(o.dataDir, o.floor.id).last, { from: 2, to: 3, by: 'Alex Lee', byId: 'u1', at: 86_400_000 });
  assert.equal(changeLine(autonomyRecord(o.dataDir, o.floor.id).last, day), 'Changed from 2 Guided to 3 Delegated by Alex Lee on 1970-01-02.');
  // The route notes it and refuses a level outside the policy.
  const r = src('src/server/http/routes/roster.ts');
  assert.match(r, /const outside = outsidePolicy\(autonomyPolicy\(ctx\.cfg\.dataDir\), body\.settings, roster\.data\(floor\.id\)\.settings\);\s+if \(outside\) return send\(res, 400/);
  assert.match(r, /if \(!error\) noteAutonomyChange\(/);
});

test('raising autonomy never approves what is already waiting: proposals, escalations and subagent actions keep their status', (t) => {
  const o = office(t);
  const d = o.roster.data(o.floor.id);
  d.proposals.push(...toProposals([{ kind: 'design', title: 'New colour scheme', detail: '' }, { kind: 'merge', title: 'Merge the login PR', detail: '' }], '2026-10-20', 'lead-designer', 'Dana', 2, 1));
  assert.deepEqual(d.proposals.map((p) => p.status), ['pending', 'pending']);
  d.escalations.push(makeEscalation({ urgency: 'important', trigger: 'design', title: 'Which layout?', details: '', options: ['A', 'B'] }, { workerId: 'w9', by: 'Dana' }, 2, 'e1', 1));
  d.subagentActions.push({ id: 's1', at: 1, lead: 'lead-developer', by: 'Keith', op: 'bench', name: 'tester', gate: 'propose', status: 'pending' });
  const waitingBefore = o.roster.view(o.floor, true).approvals.map((a) => a.id).sort();
  assert.equal(o.roster.members.settings(o.floor, { autonomy: 4 }, 'Alex Lee'), undefined);
  assert.equal(o.s().autonomy, 4);
  assert.deepEqual(d.proposals.map((p) => p.status), ['pending', 'pending'], 'still waiting at 4, where design and merge would be the team’s');
  assert.deepEqual([d.escalations[0].status, d.escalations[0].fyi, d.escalations[0].level], ['open', false, 2], 'keeps the alert it was raised with');
  assert.equal(d.subagentActions[0].status, 'pending');
  assert.deepEqual(o.roster.view(o.floor, true).approvals.map((a) => a.id).sort(), waitingBefore, 'all still in Approvals');
  // A proposal made from now on is decided at the new level.
  assert.equal(toProposals([{ kind: 'design', title: 'Another', detail: '' }], '2026-10-21', 'lead-designer', 'Dana', o.s().autonomy, 2)[0].status, 'auto');
});
