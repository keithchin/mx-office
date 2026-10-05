// The Lead review loop against a fake floor (fake workers, no Claude sessions, no GitHub): the
// escalation thresholds per autonomy level, raising, answering and relaying escalations to the
// Project Manager, the review nudge's rules, the Lead PR team label, and the "CTO" → "Project
// Manager" wording in everything the office writes for the agents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RosterAlert, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { AUTONOMY, CRITICAL_TRIGGERS, ESCALATION_TRIGGERS, REVIEW_POLICY, autonomyBrief, isFyi, reviewBrief, reviewTable, shouldEscalate, type AutonomyLevel, type EscalationTrigger } from '../src/shared/roster/autonomy.js';
import { escalationOrder, isAlarming, makeEscalation, readEscalationAsk, type Escalation } from '../src/shared/roster/escalation.js';
import { ROLES, ROLE_BY_ID } from '../src/shared/roster/roles.js';
import { Roster } from '../src/server/roster/index.js';
import { NUDGE_GAP_MS, NUDGE_GRACE_MS, nudgeDue, type NudgeLook } from '../src/server/roster/nudge.js';
import { playbook, subagentFile } from '../src/server/roster/playbooks.js';
import * as prompts from '../src/server/roster/prompts.js';
import { reviveRoster } from '../src/server/roster/store.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { forgetSubagents, noteSubagentHook } from '../src/server/workers/subagents.js';
import { handleMcp, parseArgs } from '../bin/office-workers.js';

const LEVELS: AutonomyLevel[] = [1, 2, 3, 4];

// ---- The threshold table -------------------------------------------------------------------------

test('the escalation thresholds per level: Directive escalates plan/scope/design, Autonomous only critical', () => {
  const row = (t: EscalationTrigger) => LEVELS.map((l) => shouldEscalate(l, t));
  assert.deepEqual(row('plan'), [true, false, false, false]);
  assert.deepEqual(row('scope'), [true, true, false, false]);
  assert.deepEqual(row('design'), [true, true, false, false]);
  assert.deepEqual(row('architecture'), [true, true, false, false]);
  assert.deepEqual(row('revisions-exhausted'), [true, true, false, false]);
  assert.deepEqual(row('blocked'), [true, true, false, false]);
  assert.deepEqual(row('milestone'), [true, false, true, false]);
  assert.deepEqual(row('repeated-failure'), [true, false, true, false]);
  assert.deepEqual(row('budget-risk'), [true, false, true, false]);
  for (const t of CRITICAL_TRIGGERS) assert.deepEqual(row(t), [true, true, true, true], `${t} escalates at every level`);
  assert.deepEqual(LEVELS.map((l) => REVIEW_POLICY[l].askBeforeNextStep), [true, false, false, false]);
  assert.deepEqual(LEVELS.map((l) => REVIEW_POLICY[l].maxRevisions), [2, 2, 3, 3]);
  assert.deepEqual(LEVELS.map((l) => REVIEW_POLICY[l].minUrgency), ['info', 'important', 'urgent', 'critical']);
  for (const t of ESCALATION_TRIGGERS) assert.ok(LEVELS.some((l) => shouldEscalate(l, t)), `${t} escalates somewhere`);
});

test('below the threshold an escalation is FYI, never refused; critical is never FYI', () => {
  assert.equal(isFyi(2, 'important', 'design'), false);
  assert.equal(isFyi(4, 'urgent', 'design'), true, 'Autonomous: a design change is the team’s');
  assert.equal(isFyi(4, 'info', 'security'), false, 'a critical trigger always counts');
  assert.equal(isFyi(4, 'critical'), false);
  assert.equal(isFyi(3, 'important'), true, 'no trigger: judged by urgency');
  assert.equal(isFyi(3, 'urgent'), false);
  assert.equal(isFyi(1, 'info'), false, 'Directive hears everything');
  assert.equal(isFyi(2, 'info'), true);
});

test('the review table and brief render every level, mark the current one, and say how to escalate', () => {
  for (const l of LEVELS) {
    const table = reviewTable(l);
    assert.equal(table.split('\n').length, 6);
    assert.match(table, new RegExp(`\\*\\*→ ${l} ${AUTONOMY[l].name}\\*\\*`));
    const brief = reviewBrief(l, 'docs/team/development.md');
    assert.match(brief, /— Review: <subagent> · <task>/);
    assert.match(brief, /Verdict: accept \| revise \| escalate/);
    assert.match(brief, /office-workers escalate --urgency/);
    assert.match(brief, /Never leave a subagent's lane idle/);
    assert.ok(brief.includes(REVIEW_POLICY[l].rule));
  }
  assert.match(reviewBrief(1, 'x'), /ask the Project Manager before dispatching/);
  assert.match(reviewBrief(3, 'x'), /dispatch that subagent's next step immediately/);
});

// ---- Escalations, pure -----------------------------------------------------------------------------

test('an escalation request is read and checked', () => {
  assert.match(String(readEscalationAsk({})), /title/);
  assert.match(String(readEscalationAsk({ title: 'x', urgency: 'meh' })), /urgency/);
  assert.match(String(readEscalationAsk({ title: 'x', trigger: 'vibes' })), /trigger/);
  const ok = readEscalationAsk({ title: '  Split   Orders\nmodule ', urgency: 'urgent', trigger: 'architecture', details: 'a\r\nb', options: ['A', ' ', 'B'], recommend: 'A' });
  assert.deepEqual(ok, { urgency: 'urgent', trigger: 'architecture', title: 'Split Orders module', details: 'a\nb', options: ['A', 'B'], recommendation: 'A' });
  assert.equal((readEscalationAsk({ title: 't' }) as { urgency: string }).urgency, 'important', 'important by default');
  assert.deepEqual((readEscalationAsk({ title: 't', options: 'A | B' }) as { options: string[] }).options, ['A', 'B']);
});

test('escalations order loudest open first, FYI last among the open, then answered newest first', () => {
  const mk = (id: string, urgency: 'info' | 'urgent' | 'critical', at: number, fyi = false, resolvedAt?: number): Escalation => ({ ...makeEscalation({ urgency, title: id, details: '', options: [] }, { workerId: 'w', by: 'Ada' }, 2, id, at), fyi, ...(resolvedAt ? { status: 'resolved' as const, resolution: { verdict: 'reply' as const, text: 'x', by: 'P', at: resolvedAt, delivered: true } } : {}) });
  const list = [mk('a', 'info', 1), mk('b', 'critical', 2), mk('c', 'urgent', 3, true), mk('d', 'urgent', 4), mk('e', 'urgent', 0, false, 10), mk('f', 'urgent', 0, false, 20)];
  assert.deepEqual(list.sort(escalationOrder).map((e) => e.id), ['b', 'd', 'a', 'c', 'f', 'e']);
  assert.equal(isAlarming(mk('x', 'urgent', 1)), true);
  assert.equal(isAlarming(mk('x', 'urgent', 1, true)), false);
});

// ---- A fake floor ------------------------------------------------------------------------------------

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'mx-spike';
  dir = mkdtempSync(path.join(os.tmpdir(), 'review-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string }[] = [];
  wakes: { id: string; text?: string }[] = [];
  hires: HireAsk[] = [];
  toasts: string[] = [];
  alerts: RosterAlert[] = [];
  feed: string[] = [];
  pulls: { number: number; title: string; url: string; headRefName: string; labels?: { name: string }[] }[] = [];
  labelled: { n: number; team: string }[] = [];
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
  wake(id: string, text?: string) {
    if (!this.map.has(id)) return 'No such worker';
    this.wakes.push({ id, text });
    this.set(id, 'starting');
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => this.pulls;
  toast = (text: string) => void this.toasts.push(text);
  changed = (alert?: RosterAlert) => void (alert && this.alerts.push(alert));
  activity = (text: string) => void this.feed.push(text);
  set(id: string, status: WorkerStatus, patch: Partial<WorkerInfo> = {}) {
    Object.assign(this.map.get(id)!, { status, ...patch });
    this.roster.onWorker(this, this.map.get(id)!);
  }
}

function setup(level: AutonomyLevel = 2) {
  const clock = { now: Date.UTC(2026, 9, 5, 1, 5) };
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'review-data-')), floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => clock.now }, 0);
  floor.roster = roster;
  roster.data(floor.id).settings.autonomy = level;
  return { clock, floor, roster, data: () => roster.data(floor.id) };
}

async function hireAt(t: ReturnType<typeof setup>, role: 'pm' | 'lead-developer' | 'lead-tester') {
  assert.equal(await t.roster.members.hire(t.floor, role, 'Probe'), undefined);
  const id = t.data().members[role].workerId!;
  t.floor.set(id, 'working');
  t.floor.set(id, 'done');
  t.floor.prompts.length = 0;
  return id;
}

// ---- Escalations through the roster ----------------------------------------------------------------

test('an urgent escalation above the threshold is toasted, alerted, queued for approval, and the answer goes back as a prompt', async () => {
  const t = setup(2);
  const dev = await hireAt(t, 'lead-developer');
  const ask = readEscalationAsk({ title: 'Split Orders into its own module', urgency: 'urgent', trigger: 'architecture', details: 'Orders is 60% of the domain.', options: ['Split now', 'After the sprint'], recommendation: 'Split now' });
  assert.notEqual(typeof ask, 'string');
  const e = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, ask as Exclude<typeof ask, string>);
  assert.equal(e.fyi, false);
  assert.equal(e.role, 'lead-developer');
  assert.equal(e.team, 'development');
  assert.match(t.floor.toasts.at(-1)!, /Urgent escalation from .*Split Orders/);
  assert.equal(t.floor.alerts.length, 1);
  assert.equal(t.floor.alerts[0].urgency, 'urgent');
  assert.match(t.floor.feed.at(-1)!, /escalated to the Project Manager \(urgent\)/);
  const view = t.roster.view(t.floor, true);
  assert.equal(view.escalations[0].id, e.id);
  assert.equal(view.approvals[0].kind, 'escalation');
  assert.equal(view.approvals[0].escalationId, e.id);

  assert.match(String(t.roster.escalations.resolve(t.floor, e.id, 'reply', '  ', 'Keith')), /Write your reply/);
  assert.match(String(t.roster.escalations.resolve(t.floor, e.id, 'reject', '', 'Keith')), /why/);
  assert.equal(t.roster.escalations.resolve(t.floor, e.id, 'reply', 'Split after the demo on Friday.', 'Keith'), undefined);
  const told = t.floor.prompts.find((p) => p.id === dev)!;
  assert.match(told.text, /The Project Manager \(Keith\) answered your escalation “Split Orders into its own module”: REPLIED/);
  assert.match(told.text, /Split after the demo on Friday\./);
  assert.equal(t.data().escalations[0].status, 'resolved');
  assert.equal(t.data().escalations[0].resolution?.delivered, true);
  assert.match(String(t.roster.escalations.resolve(t.floor, e.id, 'approve', '', 'Keith')), /Already answered/);
  assert.equal(t.roster.view(t.floor, true).approvals.filter((a) => a.kind === 'escalation').length, 0);
});

test('below the threshold it is filed as FYI: no toast, no alert, and "Noted" sends nothing', async () => {
  const t = setup(4);
  const dev = await hireAt(t, 'lead-developer');
  const e = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'urgent', trigger: 'design', title: 'Moved the save button', details: '', options: [] });
  assert.equal(e.fyi, true);
  assert.equal(t.floor.toasts.filter((x) => /escalation/i.test(x)).length, 0);
  assert.equal(t.floor.alerts.length, 0);
  assert.equal(t.roster.escalations.resolve(t.floor, e.id, 'dismiss', '', 'Keith'), undefined);
  assert.equal(t.floor.prompts.length, 0);
  // Critical still alerts at Autonomous.
  t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'important', trigger: 'data-loss', title: 'Migration drops Orders', details: '', options: [] });
  assert.equal(t.floor.alerts.length, 0, 'important + data-loss: not FYI, but only urgent/critical alert');
  t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'critical', title: 'Prod credentials in repo', details: '', options: [] });
  assert.equal(t.floor.alerts.length, 1);
});

test('an asleep raiser wakes with the answer; one that went home gets it in its next hire', async () => {
  const t = setup(2);
  const dev = await hireAt(t, 'lead-developer');
  const e1 = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'important', trigger: 'scope', title: 'Add CSV export?', details: '', options: [] });
  const e2 = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'important', trigger: 'scope', title: 'Add PDF export?', details: '', options: [] });
  t.floor.set(dev, 'exited');
  assert.equal(t.roster.escalations.resolve(t.floor, e1.id, 'approve', 'Yes, CSV only.', 'Keith'), undefined);
  assert.match(t.floor.wakes.at(-1)!.text!, /APPROVED[\s\S]*Yes, CSV only\./);
  await t.floor.stop(dev);
  assert.equal(t.roster.escalations.resolve(t.floor, e2.id, 'reject', 'Not this release.', 'Keith'), undefined);
  assert.equal(t.data().escalations.find((x) => x.id === e2.id)?.resolution?.delivered, false);
  await t.roster.members.hire(t.floor, 'lead-developer', 'Probe');
  assert.match(t.floor.hires.at(-1)!.prompt, /While you were away, the Project Manager answered your escalations:\n- “Add PDF export\?”: REJECTED — Not this release\./);
  assert.equal(t.data().escalations.find((x) => x.id === e2.id)?.resolution?.delivered, true);
});

test('the Project Coordinator is told about new escalations (not FYIs, not its own), batched', async () => {
  const t = setup(2);
  const pm = await hireAt(t, 'pm');
  const dev = await hireAt(t, 'lead-developer');
  t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'urgent', trigger: 'blocked', title: 'No test DB', details: '', options: [] });
  t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'info', title: 'FYI only', details: '', options: [] });
  t.roster.escalations.raise(t.floor, t.floor.worker(pm)!, { urgency: 'urgent', trigger: 'milestone', title: 'Coordinator’s own', details: '', options: [] });
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), true);
  const told = t.floor.prompts.filter((p) => p.id === pm);
  assert.equal(told.length, 1);
  assert.match(told[0].text, /\[urgent\] .*“No test DB”/);
  assert.doesNotMatch(told[0].text, /FYI only|Coordinator’s own/);
  assert.match(told[0].text, /Don't answer them yourself/);
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), false, 'nothing left');
});

// ---- The review nudge ------------------------------------------------------------------------------

test('the nudge rules: once per idle period, after a grace, never busy/needing you/asleep/benched/in standup', () => {
  const base: NudgeLook = { enabled: true, hasTeam: true, phase: 'active', status: 'done', idleAt: 1000, turnAt: 500, subagentAt: 800, inStandup: false, now: 1000 + NUDGE_GRACE_MS };
  assert.equal(nudgeDue(base), 'nudge');
  assert.equal(nudgeDue({ ...base, enabled: false }), 'off');
  assert.equal(nudgeDue({ ...base, hasTeam: false }), 'no-team');
  assert.equal(nudgeDue({ ...base, phase: 'benched' }), 'not-active');
  assert.equal(nudgeDue({ ...base, phase: 'benching' }), 'not-active');
  assert.equal(nudgeDue({ ...base, status: 'needs_input' }), 'needs-you');
  assert.equal(nudgeDue({ ...base, status: 'working', idleAt: undefined }), 'busy');
  assert.equal(nudgeDue({ ...base, status: 'exited' }), 'asleep');
  assert.equal(nudgeDue({ ...base, inStandup: true }), 'standup');
  assert.equal(nudgeDue({ ...base, subagentAt: undefined }), 'nothing-new');
  assert.equal(nudgeDue({ ...base, subagentAt: 400 }), 'nothing-new', 'came back before this turn');
  assert.equal(nudgeDue({ ...base, nudgedAt: 900, nudgedIdleAt: 1000 }), 'nothing-new');
  assert.equal(nudgeDue({ ...base, nudgedAt: 700, nudgedIdleAt: 1000 }), 'already-nudged');
  assert.equal(nudgeDue({ ...base, now: 1000 + NUDGE_GRACE_MS - 1 }), 'grace');
  assert.equal(nudgeDue({ ...base, nudgedAt: 700, nudgedIdleAt: 600, now: 700 + NUDGE_GAP_MS - 1 }), 'too-soon');
});

test('a Lead whose turn ends right after a subagent came back is nudged once, and not again without a new result', async () => {
  const t = setup(2);
  const dev = await hireAt(t, 'lead-developer');
  const nudges = () => t.floor.prompts.filter((p) => p.id === dev && /review protocol/.test(p.text));
  t.floor.set(dev, 'working');
  t.clock.now += 1000;
  assert.equal(noteSubagentHook(dev, { tool_name: 'Agent', tool_input: { subagent_type: 'developer', description: 'Draft the Orders microflow' } }, false, t.clock.now), true);
  assert.equal(noteSubagentHook(dev, { tool_name: 'Bash', tool_input: {} }, false), false, 'other tools are not subagents');
  assert.equal(noteSubagentHook(dev, { tool_name: 'Agent', tool_input: { run_in_background: true } }, false), false, 'a background launch has nothing to review yet');
  t.clock.now += 1000;
  t.floor.set(dev, 'done');
  assert.equal(t.roster.nudges.check(t.floor, 'lead-developer'), false, 'within the grace');
  t.clock.now += NUDGE_GRACE_MS;
  assert.equal(t.roster.nudges.check(t.floor, 'lead-developer'), true);
  assert.equal(nudges().length, 1);
  assert.match(nudges()[0].text, /Review `developer`'s last result \(“Draft the Orders microflow”\) per your Playbook's review protocol, then continue or escalate\./);
  assert.match(t.floor.feed.at(-1)!, /Nudged .* to review its developer's result/);
  assert.equal(t.roster.nudges.check(t.floor, 'lead-developer'), false, 'once per idle period');
  // The nudge's own turn ends with no new subagent result: no second nudge.
  t.floor.set(dev, 'working');
  t.clock.now += 60_000;
  t.floor.set(dev, 'done');
  t.clock.now += NUDGE_GAP_MS + NUDGE_GRACE_MS;
  assert.equal(t.roster.nudges.check(t.floor, 'lead-developer'), false);
  // A new result in a new turn: nudged again (past the gap).
  t.floor.set(dev, 'working');
  t.clock.now += 1000;
  noteSubagentHook(dev, { tool_name: 'Task', tool_input: { subagent_type: 'developer' } }, false, t.clock.now);
  t.floor.set(dev, 'done');
  t.clock.now += NUDGE_GRACE_MS;
  assert.equal(t.roster.nudges.check(t.floor, 'lead-developer'), true);
  assert.equal(nudges().length, 2);
  forgetSubagents(dev);
});

test('no nudge while the Lead needs you, is asleep or benched, when the floor turns it off, or for the Coordinator', async () => {
  const t = setup(2);
  const dev = await hireAt(t, 'lead-developer');
  const turn = (end: WorkerStatus) => {
    t.floor.set(dev, 'working');
    t.clock.now += 1000;
    noteSubagentHook(dev, { tool_name: 'Agent', tool_input: { subagent_type: 'developer' } }, false, t.clock.now);
    t.floor.set(dev, end);
    t.clock.now += NUDGE_GRACE_MS + NUDGE_GAP_MS;
  };
  turn('needs_input');
  assert.equal(t.roster.nudges.look(t.floor, 'lead-developer'), 'needs-you');
  turn('exited');
  assert.equal(t.roster.nudges.look(t.floor, 'lead-developer'), 'asleep');
  t.data().settings.reviewNudge = false;
  turn('done');
  assert.equal(t.roster.nudges.look(t.floor, 'lead-developer'), 'off');
  t.data().settings.reviewNudge = true;
  assert.equal(t.roster.nudges.look(t.floor, 'lead-developer'), 'nudge');
  // Asked for its standup: the standup turn isn't interrupted.
  t.roster.standups.run(t.floor, 'Probe');
  assert.equal(t.roster.nudges.look(t.floor, 'lead-developer'), 'standup');
  // Benching: never.
  t.data().members['lead-developer'].phase = 'benching';
  assert.equal(t.roster.nudges.look(t.floor, 'lead-developer'), 'not-active');
  const pm = await hireAt(t, 'pm');
  noteSubagentHook(pm, { tool_name: 'Agent', tool_input: {} }, false, t.clock.now);
  assert.equal(t.roster.nudges.look(t.floor, 'pm'), 'no-team');
  forgetSubagents(dev);
  forgetSubagents(pm);
});

// ---- The Lead PR label, and saved rosters --------------------------------------------------------

test("a Lead's unlabelled PR gets its team label once; a labelled one, or a floor without labelPr, is left alone", async () => {
  const t = setup(2);
  const calls: { n: number; team: string }[] = [];
  const dev = await hireAt(t, 'lead-developer');
  // No labelPr on this floor yet: nothing happens.
  t.floor.pulls = [{ number: 7, title: 'Orders', url: 'u', headRefName: `agent/${dev}` }];
  t.floor.set(dev, 'working');
  assert.equal(calls.length, 0);
  t.floor.labelPr = async (n, team) => void calls.push({ n, team });
  t.floor.pulls.push({ number: 8, title: 'Other', url: 'u', headRefName: 'someone-else' }, { number: 9, title: 'Tagged', url: 'u', headRefName: 'x', labels: [{ name: 'team:testing' }] });
  t.floor.set(dev, 'done', { pr: { number: 9, url: 'u' } } as Partial<WorkerInfo>);
  t.floor.set(dev, 'working');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [{ n: 7, team: 'development' }]);
  assert.match(t.floor.feed.at(-1)!, /Labelled .*PR #7 team:development/);
});

test('a roster saved before the review loop gets the nudge on and no escalations', () => {
  const old = reviveRoster({ settings: { autonomy: 3, idleMinutes: 10, schedule: undefined, costCaps: {}, dryRunIssues: true }, members: { pm: { name: 'Maya', model: 'sonnet', phase: 'none' } } });
  assert.equal(old.settings.reviewNudge, true);
  assert.deepEqual(old.escalations, []);
  assert.equal(old.members.pm.name, 'Maya');
  assert.equal(reviveRoster({ settings: { reviewNudge: false } }).settings.reviewNudge, false);
});

// ---- Wording: the human is the Project Manager, the agent the Project Coordinator -----------------

test('no Playbook, subagent file or prompt the office writes says "CTO"; the agent role is the Project Coordinator', () => {
  const names = Object.fromEntries(ROLES.map((r, i) => [r.id, `N${i}`])) as Record<(typeof ROLES)[number]['id'], string>;
  const texts: string[] = [];
  for (const level of LEVELS) {
    texts.push(autonomyBrief(level), prompts.autonomyPrompt(level), reviewBrief(level, 'docs/team/x.md'));
    for (const r of ROLES) {
      texts.push(playbook(r.id, { project: 'mx-spike', name: names[r.id], level, lessons: 'L.md', names }));
      texts.push(prompts.primePrompt(r.id, 'N', level, { at: 0, text: 'note' }, 'task', ['- a']), prompts.reviewNudgePrompt(r.id, { at: 0, agent: 'developer', task: 't', failed: false }, level));
      for (const s of r.subagents) texts.push(subagentFile(s, r, 'mx-spike'));
    }
  }
  const e = makeEscalation({ urgency: 'urgent', trigger: 'design', title: 'T', details: '', options: [] }, { workerId: 'w', by: 'Ada', team: 'design' }, 2, 'e1', 0);
  texts.push(prompts.benchPrompt('lead-tester', 'L.md', 's'), prompts.standupPrompt('lead-tester', 'd', 's'), prompts.standupCompiledPrompt('d', 2, [e]), prompts.outcomesPrompt([]), prompts.escalationAnswerPrompt(e, 'approve', 'ok', 'Keith'), prompts.escalationsToCoordinatorPrompt([e]));
  for (const text of texts) assert.doesNotMatch(text, /\bCTO\b/, text.slice(0, 200));
  assert.equal(ROLE_BY_ID.get('pm')!.title, 'Project Coordinator');
  const coord = playbook('pm', { project: 'mx-spike', name: 'Maya', level: 2, lessons: 'L.md', names });
  assert.match(coord, /^# 🧭 Project Coordinator — Maya$/m);
  assert.match(coord, /You are the Project Coordinator, an agent\. The Project Manager is the human/);
  assert.doesNotMatch(coord, /## The review protocol/, 'the Coordinator has no subagents to review');
  const dev = playbook('lead-developer', { project: 'mx-spike', name: 'Linus', level: 2, lessons: 'L.md', names });
  assert.match(dev, /## What needs the Project Manager/);
  assert.match(dev, /## The review protocol \(after every subagent result\)/);
  assert.match(dev, /\*\*→ 2 Guided\*\*/);
  assert.match(dev, /gh pr create --label team:development/);
  assert.match(dev, /Project Coordinator: N0/);
  assert.match(subagentFile(ROLE_BY_ID.get('lead-developer')!.subagents[0], ROLE_BY_ID.get('lead-developer')!, 'mx'), /never escalate[\s\S]*\*\*Done\*\*.*\*\*Checks\*\*.*\*\*Open\*\*.*\*\*Next\*\*/);
});

// ---- The command and the MCP tool ----------------------------------------------------------------

test('office-workers escalate and the escalate MCP tool post to /office/workers/escalate', async () => {
  assert.deepEqual(parseArgs(['escalate', '--title', 'T', '--urgency=critical', '--option', 'A', '--option', 'B', '--recommend', 'A', '--trigger', 'security']), { cmd: 'escalate', options: ['A', 'B'], title: 'T', urgency: 'critical', recommendation: 'A', trigger: 'security' });
  assert.throws(() => parseArgs(['escalate', '--urgency', 'urgent']), /--title/);
  assert.throws(() => parseArgs(['escalate', '--title', 'T', '--urgency', 'loud']), /--urgency/);
  assert.throws(() => parseArgs(['escalate', '--title', 'T', '--trigger', 'vibes']), /--trigger/);
  const sent: { url: string; body: unknown }[] = [];
  const io = {
    env: { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1', AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 't' },
    fetch: (async (url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true, escalation: { id: 'e1', urgency: 'urgent', fyi: false, title: 'T' }, note: 'Raised.' }));
    }) as unknown as typeof fetch,
  };
  const res = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'escalate', arguments: { title: 'T', urgency: 'urgent' } } }, io);
  assert.match(sent[0].url, /\/office\/workers\/escalate\?worker=w1$/);
  assert.deepEqual(sent[0].body, { title: 'T', urgency: 'urgent' });
  assert.match(res?.result.content[0].text, /Escalation e1 raised \(urgent\): T\nRaised\./);
});
