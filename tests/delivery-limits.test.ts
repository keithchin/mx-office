// Escalation hygiene, delivery and limits, against a fake floor (fake workers, no Claude sessions):
// nothing is typed into an agent while a dialog may be up (an escalation's answer, a +1's, a tell, a
// decision), it's held and typed once the turn is over; the review loop's revision rounds and the
// review nudge are bounded, and so is `office-workers tell` per pair; the daily spend cap holds the
// office's own prompts but not a person's; and a reworded escalation joins the open one it repeats when
// Jeff says so (the nine CI-secret escalations mx-spike raised, with a stubbed judge).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RosterAlert, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { AutonomyLevel } from '../src/shared/roster/autonomy.js';
import type { EscalationAsk } from '../src/shared/roster/escalation.js';
import type { SubagentRecord } from '../src/shared/roster/subagents.js';
import { Roster } from '../src/server/roster/index.js';
import { mayType } from '../src/server/roster/deliver.js';
import { sameAsk } from '../src/server/roster/jeff-ask.js';
import { readSame, SAME_AT, SAME_PER_HOUR, SameAsk, sameQuestions, sameState } from '../src/server/roster/jeff-same.js';
import { NUDGE_GRACE_MS, NUDGE_GAP_MS, NUDGE_STREAK_MAX, nudgeDue, type NudgeLook } from '../src/server/roster/nudge.js';
import { countRound, roundsLine } from '../src/server/roster/review-rounds.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { TELL_MAX, TELL_WINDOW_MS, TellLimit } from '../src/server/hooks/tell-limit.js';
import { Judge } from '../src/server/judge/index.js';
import type { Questions, Verdict } from '../src/server/judge/pure.js';
import { forgetSubagents, noteSubagentHook } from '../src/server/workers/subagents.js';

class FakeFloor implements TeamFloor {
  id = 'f1';
  name = 'Probe';
  dir = mkdtempSync(path.join(os.tmpdir(), 'hygiene-floor-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string; by?: string }[] = [];
  wakes: { id: string; text?: string }[] = [];
  toasts: string[] = [];
  feed: string[] = [];
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk) {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', model: ask.model, deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: 0, prompt: ask.prompt, cols: 80, rows: 24, viewers: [], viewerIds: [], worktree: { path: `wt/${id}`, branch: `agent/${id}` } } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  /** A worker that isn't on the team: any agent on the floor. */
  add(name: string, status: WorkerStatus = 'done') {
    const id = `x${++this.n}`;
    this.map.set(id, { id, kind: 'agent', provider: 'claude', deskId: 'd', name, color: '#fff', status, acked: true, createdBy: 'k', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo);
    return id;
  }
  async stop(id: string) {
    this.map.delete(id);
    this.roster.onWorkerGone(this, id);
  }
  prompt(id: string, text: string, by?: string) {
    const w = this.map.get(id);
    if (!w || w.status === 'exited' || w.status === 'offline') return 'Worker is not running';
    this.prompts.push({ id, text, by });
    return undefined;
  }
  wake(id: string, text?: string) {
    if (!this.map.has(id)) return 'No such worker';
    this.wakes.push({ id, text });
    Object.assign(this.map.get(id)!, { status: 'starting' });
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = (text: string) => void this.toasts.push(text);
  changed = (_alert?: RosterAlert) => {};
  activity = (text: string) => void this.feed.push(text);
  set(id: string, status: WorkerStatus, patch: Partial<WorkerInfo> = {}) {
    Object.assign(this.map.get(id)!, { status, ...patch });
    this.roster.onWorker(this, this.map.get(id)!);
  }
  to = (id: string) => this.prompts.filter((p) => p.id === id);
}

type JudgeFn = (text: string, q: Questions) => Promise<Verdict | undefined>;

function setup(level: AutonomyLevel = 2, judge?: JudgeFn) {
  const clock = { now: Date.UTC(2026, 9, 5, 1, 5) };
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'hygiene-data-')), floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => clock.now, ...(judge ? { judge } : {}) }, 0);
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

const ask = (title: string, details = '', extra: Partial<EscalationAsk> = {}): EscalationAsk => ({ urgency: 'important', trigger: 'blocked', title, details, options: [], ...extra });

/** Spends past the floor's cap: a $5 cap at its level, and a worker that spent $6 today. */
function capOut(t: ReturnType<typeof setup>, id: string) {
  t.data().settings.costCaps = { [t.data().settings.autonomy]: 5 };
  t.floor.set(id, t.floor.worker(id)!.status, { usage: { cost: 6 } } as Partial<WorkerInfo>);
  assert.ok(t.roster.pauseOf(t.data()), 'the cap is reached');
}

// ---- 1. Never typed into a dialog ----------------------------------------------------------------

test('a prompt is never typed while a dialog may be up: asking a question, or booting', () => {
  assert.equal(mayType('needs_input'), false);
  assert.equal(mayType('starting'), false);
  for (const s of ['idle', 'done', 'working'] as WorkerStatus[]) assert.equal(mayType(s), true, s);
});

test("an answer to a raiser with a permission dialog open waits, isn't marked delivered, and goes in once the turn is over", async () => {
  const t = setup(2);
  const dev = await hireAt(t, 'lead-developer');
  const e = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, ask('Approve the schema change?'));
  t.floor.set(dev, 'needs_input');
  assert.equal(t.roster.escalations.resolve(t.floor, e.id, 'approve', 'Go ahead.', 'Keith'), undefined);
  assert.equal(t.floor.to(dev).length, 0, 'nothing typed into the dialog');
  assert.equal(t.data().escalations[0].resolution?.delivered, false);
  assert.match(t.floor.feed.at(-1)!, /question open in its terminal: the answer goes in once that's answered/);
  // The dialog answered, it works on, its turn ends: the answer goes in, once.
  t.floor.set(dev, 'working');
  assert.equal(t.floor.to(dev).length, 0, 'not while it is working on the dialog');
  t.floor.set(dev, 'done');
  assert.equal(t.floor.to(dev).length, 1);
  assert.match(t.floor.to(dev)[0].text, /“Approve the schema change\?”: APPROVED — Go ahead\./);
  assert.equal(t.data().escalations[0].resolution?.delivered, true);
  t.floor.set(dev, 'working');
  t.floor.set(dev, 'done');
  assert.equal(t.floor.to(dev).length, 1, 'not again');
});

test("a +1's raiser and an agent off the team, both in a dialog, hear the answer once their turns are over", async () => {
  const t = setup(2);
  const ada = t.floor.add('Ada');
  const bob = t.floor.add('Bob');
  const first = t.roster.escalations.raiseOrJoin(t.floor, t.floor.worker(ada)!, ask('Set repo secret E2E_PASSWORD'));
  t.roster.escalations.raiseOrJoin(t.floor, t.floor.worker(bob)!, ask('Set repo secret E2E_PASSWORD.'));
  t.floor.set(ada, 'needs_input');
  t.floor.set(bob, 'starting');
  assert.equal(t.roster.escalations.resolve(t.floor, first.escalation.id, 'reply', 'Done, re-run CI.', 'Keith'), undefined);
  assert.equal(t.floor.prompts.length, 0);
  assert.equal(t.data().escalations[0].also?.[0].pending, true);
  t.floor.set(bob, 'idle');
  assert.equal(t.floor.to(bob).length, 1);
  assert.match(t.floor.to(bob)[0].text, /Done, re-run CI\./);
  assert.equal(t.data().escalations[0].also?.[0].pending, undefined);
  t.floor.set(ada, 'done');
  assert.equal(t.floor.to(ada).length, 1);
  assert.equal(t.data().escalations[0].resolution?.delivered, true);
});

test('held prompts go in together as one message once the turn is over; an asleep agent is woken with them', () => {
  const t = setup(2);
  const x = t.floor.add('Ada', 'needs_input');
  const tf = t.floor;
  const sent: string[] = [];
  assert.equal(t.roster.delivery.send(tf, tf.worker(x)!, 'First note', { origin: 'agent', by: 'Bob', hold: true, onSent: () => sent.push('1') }).status, 'held');
  assert.equal(t.roster.delivery.send(tf, tf.worker(x)!, 'Second note', { origin: 'agent', by: 'Cy', hold: true, onSent: () => sent.push('2') }).status, 'held');
  assert.equal(t.roster.delivery.send(tf, tf.worker(x)!, 'Not held', { origin: 'office' }).status, 'refused');
  assert.equal(t.roster.delivery.heldFor(x), 2);
  assert.equal(tf.prompts.length, 0);
  tf.set(x, 'done');
  assert.equal(tf.prompts.length, 1, 'one message, not two pastes racing their Enters');
  assert.match(tf.prompts[0].text, /First note\n\n---\n\nSecond note/);
  assert.deepEqual(sent, ['1', '2']);
  assert.equal(t.roster.delivery.heldFor(x), 0);
  // Held, then it exits: woken with it.
  tf.set(x, 'needs_input');
  t.roster.delivery.send(tf, tf.worker(x)!, 'Third note', { origin: 'agent', hold: true });
  tf.set(x, 'exited');
  assert.equal(tf.wakes.at(-1)?.text, 'Third note');
  // Gone: nothing held for it any more.
  tf.set(x, 'needs_input');
  t.roster.delivery.send(tf, tf.worker(x)!, 'Lost', { origin: 'agent', hold: true });
  void tf.stop(x);
  assert.equal(t.roster.delivery.heldFor(x), 0);
});

test("the Project Coordinator's relay and a Lead's decision wait while a dialog is up", async () => {
  const t = setup(2);
  const pm = await hireAt(t, 'pm');
  const dev = await hireAt(t, 'lead-developer');
  t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, ask('No test DB', '', { urgency: 'urgent' }));
  t.floor.set(pm, 'starting');
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), false, 'booting: maybe the trust dialog');
  t.floor.set(pm, 'needs_input');
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), false);
  t.floor.set(pm, 'done');
  assert.equal(t.floor.to(pm).length, 1, 'relayed once it is back');
  // A proposal decided while the Lead is asking something: told after.
  const d = t.data();
  d.subagentActions.push({ id: 'a1', at: 0, lead: 'lead-developer', by: d.members['lead-developer'].name, op: 'warn', name: 'developer', gate: 'propose', status: 'pending', reason: 'sloppy' });
  t.floor.set(dev, 'needs_input');
  assert.equal(t.roster.subagents.decide(t.floor, 'a1', false, 'Keith', 'Not yet'), undefined);
  assert.equal(t.floor.to(dev).length, 0);
  t.floor.set(dev, 'done');
  assert.equal(t.floor.to(dev).length, 1);
  assert.match(t.floor.to(dev)[0].text, /Keith/);
});

// ---- 2. Bounded loops --------------------------------------------------------------------------------

test('revision rounds: reworks in a row past the level allowance are exhausted once; an accept starts again', () => {
  const rec = { name: 'developer', lead: 'lead-developer', state: 'active', warnings: [], runs: [] } as SubagentRecord;
  assert.equal(countRound(rec, 'rework', 2, 1), 'ok');
  assert.match(roundsLine(rec, 2, 2), /Revision round 1 of 2/);
  assert.equal(countRound(rec, 'rework', 2, 2), 'ok');
  assert.equal(countRound(rec, 'rework', 2, 3), 'exhausted');
  assert.equal(rec.exhaustedAt, 3);
  assert.match(roundsLine(rec, 2, 2), /Out of revision rounds \(2 at autonomy level 2\)/);
  assert.equal(countRound(rec, 'rework', 2, 4), 'still-exhausted');
  assert.equal(countRound(rec, 'accept', 2, 5), 'ok');
  assert.equal(rec.reworks, undefined);
  assert.equal(rec.exhaustedAt, undefined);
});

test('a subagent out of revision rounds: one revisions-exhausted escalation for its Lead, no more nudges, and an answer resets it', async () => {
  const t = setup(2);
  const dev = await hireAt(t, 'lead-developer');
  const review = (verdict: 'accept' | 'rework') => {
    t.floor.set(dev, 'working');
    t.clock.now += 1000;
    noteSubagentHook(dev, { tool_name: 'Agent', tool_input: { subagent_type: 'developer', description: 'Draft the Orders microflow' } }, false, t.clock.now);
    t.roster.subagents.onEvent(t.floor, dev, { kind: 'result', at: t.clock.now, agent: 'developer', task: 'Draft the Orders microflow', failed: false, background: false });
    const r = t.roster.subagents.review(t.floor, 'lead-developer', 'developer', verdict, 'still wrong');
    assert.notEqual(typeof r, 'string');
    t.floor.set(dev, 'done');
    t.clock.now += NUDGE_GRACE_MS + NUDGE_GAP_MS;
  };
  review('rework');
  review('rework');
  assert.equal(t.data().escalations.length, 0, 'two rounds are allowed at level 2');
  assert.equal(t.roster.nudges.look(t.floor, 'lead-developer'), 'nudge');
  review('rework');
  const esc = t.data().escalations;
  assert.equal(esc.length, 1);
  assert.equal(esc[0].trigger, 'revisions-exhausted');
  assert.equal(esc[0].fyi, false, 'level 2 escalates revisions-exhausted');
  assert.equal(esc[0].role, 'lead-developer');
  assert.match(esc[0].title, /[A-Z][a-z]+ \(developer\) still fails .* review after 2 revision rounds: Draft the Orders microflow/);
  assert.match(t.roster.subagents.roundsText(t.floor, 'lead-developer', 'developer'), new RegExp(`escalated it to the Project Manager \\(${esc[0].id}\\)`));
  assert.equal(t.roster.nudges.look(t.floor, 'lead-developer'), 'exhausted');
  assert.equal(t.roster.nudges.check(t.floor, 'lead-developer'), false);
  review('rework');
  assert.equal(t.data().escalations.length, 1, 'raised once');
  assert.equal(t.roster.escalations.resolve(t.floor, esc[0].id, 'reply', 'One more round, then take it over.', 'Keith'), undefined);
  const rec = t.data().subagents['lead-developer/developer'];
  assert.equal(rec.exhaustedAt, undefined);
  assert.equal(rec.reworks, undefined);
  forgetSubagents(dev);
});

test('at Autonomous the office still raises it, as FYI', async () => {
  const t = setup(4);
  const dev = await hireAt(t, 'lead-developer');
  for (let i = 0; i < 4; i++) t.roster.subagents.review(t.floor, 'lead-developer', 'developer', 'rework');
  const esc = t.data().escalations;
  assert.equal(esc.length, 1, 'three rounds at level 4, then exhausted');
  assert.equal(esc[0].fyi, true);
  assert.equal(t.floor.toasts.filter((x) => /waiting on you/.test(x)).length, 0, 'no alarm for an FYI');
  void dev;
});

test('the review nudge stops after a few in a row without a review verdict, and a verdict lets it go on', async () => {
  const base: NudgeLook = { enabled: true, hasTeam: true, phase: 'active', status: 'done', idleAt: 1000, turnAt: 500, subagentAt: 800, inStandup: false, now: 1000 + NUDGE_GRACE_MS };
  assert.equal(nudgeDue({ ...base, streak: NUDGE_STREAK_MAX - 1 }), 'nudge');
  assert.equal(nudgeDue({ ...base, streak: NUDGE_STREAK_MAX }), 'unheeded');
  assert.equal(nudgeDue({ ...base, exhausted: true }), 'exhausted');

  const t = setup(2);
  const dev = await hireAt(t, 'lead-developer');
  const turn = () => {
    t.floor.set(dev, 'working');
    t.clock.now += 1000;
    noteSubagentHook(dev, { tool_name: 'Agent', tool_input: { subagent_type: 'developer' } }, false, t.clock.now);
    t.floor.set(dev, 'done');
    t.clock.now += NUDGE_GRACE_MS + NUDGE_GAP_MS;
    return t.roster.nudges.check(t.floor, 'lead-developer');
  };
  for (let i = 0; i < NUDGE_STREAK_MAX; i++) assert.equal(turn(), true, `nudge ${i + 1}`);
  assert.equal(turn(), false, 'the Lead never records a verdict: stop');
  assert.match(t.floor.feed.at(-1)!, /Stopped nudging .*3 review nudges in a row without a review verdict/);
  assert.equal(turn(), false);
  assert.equal(t.floor.feed.filter((x) => /Stopped nudging/.test(x)).length, 1, 'said once');
  t.roster.subagents.review(t.floor, 'lead-developer', 'developer', 'accept');
  assert.equal(turn(), true, 'a verdict: nudged again');
  forgetSubagents(dev);
});

test('office-workers tell: a few per pair in ten minutes, then refused with what to do instead', () => {
  const clock = { now: 0 };
  const lim = new TellLimit(() => clock.now);
  const a = { id: 'a', name: 'Anita' };
  const b = { id: 'b', name: 'Hedy' };
  for (let i = 0; i < TELL_MAX; i++) assert.equal(lim.take(a, b), undefined);
  const no = lim.take(a, b);
  assert.match(String(no), /told Hedy 5 times in the last 10 minutes/);
  assert.match(String(no), /team journal|escalate/);
  assert.equal(lim.take(b, a), undefined, 'the other way is its own pair');
  clock.now += TELL_WINDOW_MS;
  assert.equal(lim.take(a, b), undefined, 'the window moved on');
});

// ---- 3. The spend cap holds the office's prompts --------------------------------------------------------

test("past the spend cap the office's prompts are held and a person's go through", async () => {
  const t = setup(2);
  const pm = await hireAt(t, 'pm');
  const dev = await hireAt(t, 'lead-developer');
  const x = t.floor.add('Ada', 'done');
  capOut(t, dev);
  const tf = t.floor;
  assert.match(String(t.roster.pauseOf(t.data())), /no new hires, and the office sends no prompts of its own/);
  const cap = t.roster.view(tf, true).approvals.find((a) => a.kind === 'cap')!;
  assert.equal(cap.title, 'Spend cap reached: office prompts paused; agents finish their current turn');
  // The office's and another agent's: refused.
  assert.match(String(t.roster.delivery.prompt(tf, tf.worker(dev)!, 'Office says hi')), /^Spend cap reached/);
  assert.equal(t.roster.delivery.send(tf, tf.worker(x)!, 'Agent says hi', { origin: 'agent', hold: true }).status, 'refused');
  assert.equal(t.roster.delivery.send(tf, tf.worker(x)!, 'Wake up', { origin: 'office', wake: true }).status, 'refused');
  // The review nudge isn't sent.
  tf.set(dev, 'working');
  t.clock.now += 1000;
  noteSubagentHook(dev, { tool_name: 'Agent', tool_input: { subagent_type: 'developer' } }, false, t.clock.now);
  tf.set(dev, 'done');
  t.clock.now += NUDGE_GRACE_MS;
  assert.equal(t.roster.nudges.check(tf, 'lead-developer'), false);
  // The relay to the Coordinator waits.
  t.roster.escalations.raise(tf, tf.worker(dev)!, ask('Need a decision', '', { urgency: 'urgent' }));
  assert.equal(t.roster.escalations.flushCoordinator(tf), false);
  // A scheduled standup asks nobody (journals only); a new autonomy level isn't told.
  const s = t.roster.standups.run(tf, 'schedule');
  assert.notEqual(typeof s, 'string');
  assert.deepEqual(typeof s === 'string' ? [] : s.waiting, []);
  assert.equal(t.roster.members.settings(tf, { ...t.data().settings, autonomy: 3, costCaps: { 3: 5 } }), undefined);
  assert.equal(tf.to(dev).length + tf.to(pm).length, 0, 'no office prompt reached anyone');
  // The person's answer goes through.
  const e = t.data().escalations[0];
  assert.equal(t.roster.escalations.resolve(tf, e.id, 'reply', 'Do it.', 'Keith'), undefined);
  assert.equal(tf.to(dev).length, 1);
  assert.equal(t.data().escalations[0].resolution?.delivered, true);
  assert.equal(t.roster.delivery.send(tf, tf.worker(x)!, 'From a person', { origin: 'person' }).status, 'sent');
  forgetSubagents(dev);
});

test('past the cap, held prompts from people go in at the end of the turn; the office\'s wait', () => {
  const t = setup(2);
  const x = t.floor.add('Ada', 'needs_input');
  const tf = t.floor;
  t.roster.delivery.send(tf, tf.worker(x)!, 'From the office', { origin: 'office', hold: true });
  t.roster.delivery.send(tf, tf.worker(x)!, 'From a person', { origin: 'person', hold: true });
  t.data().settings.costCaps = { 2: 5 };
  tf.set(x, 'needs_input');
  tf.set(x, 'needs_input', { usage: { cost: 6 } } as Partial<WorkerInfo>);
  tf.set(x, 'done');
  assert.equal(tf.prompts.length, 1);
  assert.equal(tf.prompts[0].text, 'From a person');
  assert.equal(t.roster.delivery.heldFor(x), 1, "the office's waits for the cap to lift");
});

// ---- 4. A reworded escalation joins the one it repeats (Jeff) ---------------------------------------------

/**
 * The CI-secret escalations mx-spike raised (roster/mx-spike.json, sanitized: no values, no paths, the
 * org and accounts renamed). Five for E2E_DEMO_USER_PASSWORD, four for E2E_DEMO_ADMIN_PASSWORD, each
 * worded so differently that the title rule joined none of them.
 */
const SECRET_ASKS: { by: string; title: string; details: string }[] = [
  { by: 'Anita', title: "Set repo secret E2E_DEMO_USER_PASSWORD and give demo_user's password to Hedy (task 5 PR #30 CI is blocked on it)", details: "At Production, e2e has to log in. Hedy's login helper reads demo_user's password from the Actions secret E2E_DEMO_USER_PASSWORD. Agents can't set repo secrets (the token gets 403)." },
  { by: 'Anita', title: "One command to set the e2e secret: demo_user's new password is ready (PRs #30, #31, #35, #38 wait on it)", details: 'demo_user has a new random password, kept in a local file. The agent token cannot create repo secrets, so please run gh secret set E2E_DEMO_USER_PASSWORD from this laptop.' },
  { by: 'Anita', title: "The e2e secret still isn't set: please run the one gh command (CI re-run at 02:20 UTC still sees an empty password)", details: 'The CI re-runs of #30, #31 and #35 still stop with "E2E_PASSWORD is not set". Please run: gh secret set E2E_DEMO_USER_PASSWORD -R example-org/mx-spike < the password file.' },
  { by: 'Anita', title: 'The command to set the e2e secret (paste into a terminal on this laptop)', details: 'Run ONE of these on this laptop; each reads the password from the file. Git Bash: gh secret set E2E_DEMO_USER_PASSWORD -R example-org/mx-spike < the password file.' },
  { by: 'Anita', title: 'Secret 404: your gh token lacks the Secrets permission; set it in the GitHub web page instead (2 min)', details: 'The 404 comes from the token gh uses. Easiest fix, the web UI: Settings, Secrets and variables, Actions, New repository secret, Name: E2E_DEMO_USER_PASSWORD.' },
  { by: 'Keith', title: "Set repo secret E2E_DEMO_ADMIN_PASSWORD (Hedy's #40 CI needs it)", details: 'Anita set the new demo_administrator password. Her token cannot set repo secrets (403), so a person with repo admin must set E2E_DEMO_ADMIN_PASSWORD.' },
  { by: 'Hedy', title: "Set repo secret E2E_DEMO_ADMIN_PASSWORD and merge PR #40 — #30's CI goes red without it", details: 'A repo admin needs to set the secret E2E_DEMO_ADMIN_PASSWORD to the value in the local admin password file; the Administrator half of roles.spec.ts is never skipped.' },
  { by: 'Hedy', title: "Secret E2E_DEMO_ADMIN_PASSWORD reaches CI empty — Administrator role tests on #30/#38 can't sign in", details: 'The e2e step prints E2E_ADMIN_PASSWORD with an empty value, while E2E_DEMO_USER_PASSWORD prints ***. All 5 Administrator role tests fail at sign-in.' },
  { by: 'Hedy', title: "Blocked: CI still can't see E2E_DEMO_ADMIN_PASSWORD (details in 6bfff55042)", details: 'After your answer I re-ran #30 and #38, and CI still receives an empty E2E_ADMIN_PASSWORD. Please check the secret is named exactly E2E_DEMO_ADMIN_PASSWORD.' },
];
/** Asks of the same days that are something else. */
const OTHER_ASKS = [
  { by: 'Hedy', title: 'Merge PR #46 (e2e spec fix) — CI green, it gates a clean CI on #30 → #38', details: 'PR #46 changes tests and docs only. CI is green: unit 12, e2e 30 passed.' },
];

/** What a stand-in for Jeff makes of it: which secret the new ask is about, and the open one about the same. */
function stubJudge(calls: string[], confidence = 0.95): JudgeFn {
  const secret = (s: string) => (/ADMIN/.test(s) ? 'admin' : /E2E_DEMO_USER_PASSWORD|demo_user|e2e secret/i.test(s) ? 'user' : undefined);
  return async (text, q) => {
    // Jeff's priority ranking asks too: not this stand-in's business.
    if (!q.same) return undefined;
    calls.push(text);
    const lines = text.split('\n');
    const mine = secret(lines.find((l) => l.startsWith('New: '))!);
    const hit = lines.find((l) => /^open-\d+: /.test(l) && mine && secret(l) === mine);
    const choice = hit ? hit.split(':')[0] : 'none';
    return { by: 'jev', model: 'stub', ms: 1, answers: { same: { type: 'choice', choice, confidence } } };
  };
}

test("the title rule misses the reworded secret asks: that's why Jeff is asked", () => {
  const user = SECRET_ASKS.slice(0, 5);
  let joined = 0;
  for (let i = 1; i < user.length; i++) if (user.slice(0, i).some((o) => sameAsk(o.title, user[i].title))) joined++;
  assert.equal(joined, 0);
});

test("nine reworded asks for two CI secrets become two escalations with +1s when Jeff judges them the same; something else stays its own", async () => {
  const calls: string[] = [];
  const t = setup(2, stubJudge(calls));
  const ids = new Map(['Anita', 'Keith', 'Hedy'].map((n) => [n, t.floor.add(n)]));
  const results = [];
  for (const a of [...SECRET_ASKS, ...OTHER_ASKS]) results.push(await t.roster.escalations.raiseOrJoinJudged(t.floor, t.floor.worker(ids.get(a.by)!)!, ask(a.title, a.details)));
  const open = t.data().escalations.filter((e) => e.status === 'open');
  assert.deepEqual(open.map((e) => e.title), [SECRET_ASKS[0].title, SECRET_ASKS[5].title, OTHER_ASKS[0].title]);
  assert.equal(results.filter((r) => r.byJeff).length, 7);
  // Anita's four rewordings join her own (no +1 from herself); Hedy +1s Keith's admin one.
  assert.deepEqual(open[1].also?.map((a) => a.by), ['Hedy']);
  assert.match(open[0].details, /\+1 from Anita: Secret 404/);
  assert.match(t.floor.feed.join('\n'), /Jeff judged it the same ask/);
  // Jeff read titles and summaries of the open ones, numbered.
  assert.match(calls[1], /^open-1: Set repo secret E2E_DEMO_USER_PASSWORD/m);
});

test("no join without a confident yes, or when Jeff's waiting judgement is off, fails, or doesn't answer in time", async () => {
  const two = SECRET_ASKS.slice(0, 2);
  // Not sure enough.
  const low = setup(2, stubJudge([], SAME_AT - 0.1));
  const ada = low.floor.add('Anita');
  for (const a of two) await low.roster.escalations.raiseOrJoinJudged(low.floor, low.floor.worker(ada)!, ask(a.title, a.details));
  assert.equal(low.data().escalations.length, 2);
  // Off: never asked.
  const calls: string[] = [];
  const off = setup(2, stubJudge(calls));
  off.data().settings.jeff.waiting = 'off';
  const bo = off.floor.add('Anita');
  for (const a of two) await off.roster.escalations.raiseOrJoinJudged(off.floor, off.floor.worker(bo)!, ask(a.title, a.details));
  assert.equal(off.data().escalations.length, 2);
  assert.equal(calls.length, 0);
  // A failing judge.
  const bad = setup(2, async () => {
    throw new Error('down');
  });
  const cy = bad.floor.add('Anita');
  for (const a of two) await bad.roster.escalations.raiseOrJoinJudged(bad.floor, bad.floor.worker(cy)!, ask(a.title, a.details));
  assert.equal(bad.data().escalations.length, 2);
  // One that never answers: given up on after the timeout.
  const slow = new SameAsk(() => 0, 20);
  const open = [{ id: 'e1', title: two[0].title, details: two[0].details, by: 'Anita', status: 'open' }] as never;
  assert.equal(await slow.find('f1', () => new Promise(() => {}), ask(two[1].title, two[1].details), open), undefined);
  // The hourly cap.
  let n = 0;
  const capped = new SameAsk(() => 0);
  const yes = async () => (n++, { by: 'jev' as const, model: 's', ms: 1, answers: { same: { type: 'choice' as const, choice: 'open-1', confidence: 0.99 } } });
  for (let i = 0; i < SAME_PER_HOUR + 3; i++) await capped.find('f1', yes, ask('x'), open);
  assert.equal(n, SAME_PER_HOUR);
});

test("Jeff's question and what he reads: numbered open ones, a none, and the details redacted before they leave", async () => {
  const q = sameQuestions(2);
  assert.ok(q.same.type === 'choice' && Object.keys(q.same.criteria).join() === 'none,open-1,open-2');
  const open = [{ title: 'Set repo secret X', details: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked', by: 'Ada' }];
  const state = sameState({ title: 'One command to set X', details: '' }, open);
  assert.match(state, /^New: One command to set X$/m);
  assert.match(state, /^open-1: Set repo secret X \(raised by Ada\)/m);
  assert.equal(readSame({ by: 'jev', model: 's', ms: 1, answers: { same: { type: 'choice', choice: 'open-1', confidence: 0.9 } } }, open), open[0]);
  assert.equal(readSame({ by: 'jev', model: 's', ms: 1, answers: { same: { type: 'choice', choice: 'none', confidence: 0.99 } } }, open), undefined);
  // What actually leaves the office goes through the judge's redaction.
  const asked: string[] = [];
  const judge = new Judge({ key: () => undefined, haiku: { enabled: true, ask: async (_s: string, input: string) => (asked.push(input), { answers: { same: { choice: 'none', probabilities: { none: 1 } } } }) } });
  await judge.ask(state, q, { keep: 'head' });
  assert.ok(asked[0].includes('[redacted]'));
  assert.ok(!asked[0].includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'));
});
