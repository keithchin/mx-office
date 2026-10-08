// Interruptions: the office's own messages never replace an agent's task (the resume line, roster/
// resume.ts), never go into a turn under way (roster/deliver.ts), an agent that stops with its task open
// is nudged back to it (roster/back-to-work.ts), the Project Manager's check before interrupting busy
// agents (shared/roster/interrupt.ts), no catch-up standup on a new team's first day, and a decision a
// waiting agent needs wakes it at once.
//
// The regression scenario replays the live floor of 2026-10-08 with fake agents: Leads mid-task get a
// standup, an autonomy change and approvals. It fails if any agent ends idle with its task open and no
// escalation open, or if an office message was typed into a turn under way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { RoleId } from '../src/shared/roster/roles.js';
import type { MemberView } from '../src/shared/roster/types.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { assignmentFrom, finishedWhy, resumeLine, reviveAssignment, RESUME_HEAD, withResume } from '../src/server/roster/resume.js';
import { BACK_GRACE_MS, BACK_PER_WINDOW, BACK_WINDOW_MS, backToWorkDue, type BackLook } from '../src/server/roster/back-to-work.js';
import { newTeam } from '../src/server/roster/standup.js';
import { COLLECT_MS } from '../src/server/roster/standup-run.js';
import { DECISION_WAKE_MS } from '../src/server/roster/relays.js';
import { DEFAULT_SCHEDULE } from '../src/shared/roster/schedule.js';
import { cleanChoices, choicesFor, resolveChoices, teamRows, workingFor } from '../src/shared/roster/interrupt.js';
import { collectNeeds, IDLE_TASK_MS } from '../src/shared/needsyou.js';
import type { RosterView } from '../src/shared/roster/types.js';

const MIN = 60_000;
const H = 60 * MIN;
// Wednesday 2026-10-07, 09:00 in Singapore is 01:00 UTC; the live floor was hired at 14:17.
const WED_0900 = Date.UTC(2026, 9, 7, 1, 0);
const WED_1417 = WED_0900 + 5 * H + 17 * MIN;

// ---- The resume line --------------------------------------------------------------------------------

test('a task is what someone gave an agent to do: not a short reply, a question or a slash command', () => {
  const a = assignmentFrom('Work on GitHub issue #1 (Discovery): kick off with the client', 'Keith', 5);
  assert.deepEqual(a, { text: 'Work on GitHub issue #1 (Discovery): kick off with the client', at: 5, by: 'Keith', issue: 1 });
  assert.equal(assignmentFrom('yes, go ahead', 'Keith', 5), undefined, 'a reply');
  assert.equal(assignmentFrom("What's blocking the team right now? Tell me who it affects?", 'Keith', 5), undefined, 'a question');
  assert.equal(assignmentFrom('/compact', 'Keith', 5), undefined);
  assert.equal(assignmentFrom(42, 'Keith', 5), undefined);
  // A hire's task counts however short; the first line of a long brief is what it carries on with.
  assert.equal(assignmentFrom('Set up e2e', 'Keith', 5, true)?.text, 'Set up e2e');
  assert.equal(assignmentFrom('## Build the Orders module\n\nDetails…\n- issue 12', 'Keith', 5)?.text, 'Build the Orders module');
  assert.equal(assignmentFrom('## Build the Orders module\n\nDetails…\n- issue 12', 'Keith', 5)?.issue, 12);
  assert.equal(assignmentFrom(`Do ${'x'.repeat(400)}`, 'K', 5)!.text.length, 160);
  assert.equal(reviveAssignment({ text: 'Do it', at: 1, by: 'K', issue: 'x' })?.issue, undefined);
  assert.equal(reviveAssignment({ text: '', at: 1 }), undefined);
});

test('the resume line names the task, or says what to do without one, and a message gets it once', () => {
  assert.equal(resumeLine('issue #1 (Discovery).'), "When you've done this, carry on with: issue #1 (Discovery).");
  assert.match(resumeLine(undefined), /no task yet\. Tell the Coordinator what you will do next, or escalate/);
  assert.match(resumeLine(undefined, true), /no task yet\. Say in one line what you will do next/);
  const once = withResume('Standup 2026-10-07.', resumeLine('issue #1'));
  assert.equal(once, "Standup 2026-10-07.\n\nWhen you've done this, carry on with: issue #1.");
  assert.equal(withResume(once, resumeLine('other')), once, 'not twice');
});

test('a task is finished when its issue closed, its PR is no longer open, or the agent said task done', () => {
  const task = { text: 'issue #1', at: 0, by: 'K', issue: 1 };
  assert.equal(finishedWhy({ task }), undefined);
  assert.equal(finishedWhy({ task, closed: new Set([1]) }), 'issue #1 closed');
  assert.equal(finishedWhy({ task, closed: new Set([2]) }), undefined);
  assert.equal(finishedWhy({ task, pr: { number: 9, open: false } }), 'PR #9 is no longer open');
  assert.equal(finishedWhy({ task, pr: { number: 9, open: undefined } }), undefined, "the list isn't loaded: not a reason");
  assert.equal(finishedWhy({ task, lastWords: 'Task done: the BRD is in docs/brd.md.' }), 'it said task done');
  assert.equal(finishedWhy({ task: { ...task, doneAt: 3, doneWhy: 'issue #1 closed' } }), 'issue #1 closed');
});

// ---- The back-to-work nudge's rules ----------------------------------------------------------------------

const look = (o: Partial<BackLook> = {}): BackLook => ({ enabled: true, level: 2, phase: 'active', status: 'done', viewers: 0, task: 'issue #1', escalated: false, inStandup: false, studio: false, queued: 0, idleAt: 0, nudges: [], now: BACK_GRACE_MS, ...o });

test('the back-to-work nudge: once per stop, after the grace, a couple per task an hour', () => {
  assert.equal(backToWorkDue(look()), 'nudge');
  assert.equal(backToWorkDue(look({ now: BACK_GRACE_MS - 1 })), 'grace');
  assert.equal(backToWorkDue(look({ nudgedIdleAt: 0 })), 'already-nudged');
  const two = Array.from({ length: BACK_PER_WINDOW }, (_, i) => i * MIN);
  assert.equal(backToWorkDue(look({ nudges: two, idleAt: 10 * MIN, now: 11 * MIN })), 'rate-limited');
  assert.equal(backToWorkDue(look({ nudges: two, idleAt: BACK_WINDOW_MS + 2 * MIN, now: BACK_WINDOW_MS + 3 * MIN })), 'nudge', 'an hour on, again');
});

test('the back-to-work nudge is never sent to a member that is busy, waiting, away, paused, benched or done', () => {
  const cases: [Partial<BackLook>, string][] = [
    [{ enabled: false }, 'off'],
    [{ level: 1 }, 'level-1'],
    [{ phase: 'benched' }, 'not-active'],
    [{ phase: 'benching' }, 'not-active'],
    [{ paused: 'This floor is paused (⏸ Pause project, for a safe restart)' }, 'paused'],
    [{ paused: "This floor's daily team cap is spent" }, 'paused'],
    [{ status: 'needs_input' }, 'needs-you'],
    [{ status: 'exited' }, 'asleep'],
    [{ status: 'working', idleAt: undefined }, 'busy'],
    [{ status: 'starting' }, 'busy'],
    [{ task: undefined }, 'no-task'],
    [{ finished: 'issue #1 closed' }, 'finished'],
    [{ escalated: true }, 'escalated'],
    [{ inStandup: true }, 'standup'],
    [{ studio: true }, 'studio'],
    [{ viewers: 1 }, 'viewer'],
    [{ queued: 1 }, 'queued'],
  ];
  for (const [o, why] of cases) assert.equal(backToWorkDue(look(o)), why, JSON.stringify(o));
});

// ---- The Project Manager's check -------------------------------------------------------------------------

const member = (role: RoleId, status: MemberView['status'], extra: Partial<MemberView> = {}): MemberView => ({ role, title: role, team: 'analysis', icon: '•', name: role, model: 'sonnet', status, ...extra }) as MemberView;

test("the check lists who's ready and who's working (on what, for how long), and resolves each busy one's choice", () => {
  const now = WED_1417;
  const members = [member('pm', 'idle', { workerId: 'w1' }), member('chief-analyst', 'working', { workerId: 'w2', activity: 'Discovery BRD' }), member('lead-developer', 'needs-you', { workerId: 'w3' }), member('lead-tester', 'benched')];
  const workers = new Map([['w2', { workingSince: now - 12 * MIN } as WorkerInfo]]);
  const rows = teamRows(members, (id) => workers.get(id));
  assert.deepEqual(rows.map((r) => [r.role, r.state, r.what ?? '']), [['pm', 'ready', ''], ['chief-analyst', 'working', 'Discovery BRD'], ['lead-developer', 'asking', ''], ['lead-tester', 'away', '']]);
  assert.equal(workingFor(rows[1].since, now), 'working 12 min');
  assert.equal(workingFor(now - 75 * MIN, now), 'working 1 h 15 min');
  // Nothing picked: after their current turn. Picked per person, or the same for all.
  assert.deepEqual(resolveChoices(rows, {}), { 'chief-analyst': 'after', 'lead-developer': 'after' });
  assert.deepEqual(resolveChoices(rows, { 'chief-analyst': 'interrupt' }), { 'chief-analyst': 'interrupt', 'lead-developer': 'after' });
  assert.deepEqual(resolveChoices(rows, { 'chief-analyst': 'interrupt' }, 'journal'), { 'chief-analyst': 'journal', 'lead-developer': 'journal' });
  // Only a standup may read a journal instead; what's sent is checked the same way.
  assert.deepEqual(choicesFor('ask'), ['interrupt', 'after']);
  assert.deepEqual(cleanChoices({ 'chief-analyst': 'journal', 'lead-developer': 'interrupt', bogus: 'after', pm: 'loud' }, 'ask'), { 'lead-developer': 'interrupt' });
  assert.deepEqual(cleanChoices({ 'chief-analyst': 'journal' }, 'standup'), { 'chief-analyst': 'journal' });
  // Only the roles it reaches: a standup's Leads.
  assert.deepEqual(teamRows(members, () => undefined, ['chief-analyst']).map((r) => r.role), ['chief-analyst']);
});

// ---- No catch-up standup on a new team's first day -------------------------------------------------------

test("a team hired after today's slot gets no catch-up standup; its first is the next slot", () => {
  const s = DEFAULT_SCHEDULE;
  assert.equal(newTeam(WED_1417 + 3 * MIN, s, [WED_1417, WED_1417 + MIN, undefined]), true, 'hired at 14:17, the 09:00 slot was before it');
  assert.equal(newTeam(WED_0900 + 24 * H + MIN, s, [WED_1417]), false, "Thursday 09:01: it's due");
  assert.equal(newTeam(WED_1417, s, [WED_0900 - H, WED_1417]), false, 'someone was on the team at 09:00');
  assert.equal(newTeam(WED_1417, s, [undefined]), false, 'nobody hired: nothing to skip');
});

// ---- Needs you: idle with an open task ---------------------------------------------------------------------

test('Needs you shows a member idle 10 minutes with an open task and nothing escalated, with a Nudge', () => {
  const now = WED_1417;
  const r = { floor: 'f', admin: true, escalations: [], approvals: [], settings: {}, members: [member('chief-analyst', 'idle', { name: 'Katherine', task: 'issue #1 (Discovery)', idleSince: now - IDLE_TASK_MS }), member('lead-developer', 'idle', { name: 'Grace', task: 'Orders', idleSince: now - IDLE_TASK_MS, waitingOnPm: true }), member('lead-designer', 'idle', { name: 'Ken', task: 'Wireframes', idleSince: now - IDLE_TASK_MS + 1 }), member('lead-tester', 'idle', { name: 'Linus', idleSince: now - H })] } as unknown as RosterView;
  const items = collectNeeds({ floor: 'f', workers: [], roster: r, pulls: [], floors: [], now }).filter((i) => i.kind === 'idle');
  assert.deepEqual(items.map((i) => [i.text, i.action, i.target]), [['Katherine is idle with an open task: issue #1 (Discovery)', 'Nudge', { to: 'nudge', role: 'chief-analyst' }]]);
  assert.equal(items[0].level, 'warn', "a nudge, not a red item: Teams isn't posted it");
});

// ---- The regression scenario: the live floor of 2026-10-08, with fake agents ---------------------------------

interface Typed {
  id: string;
  text: string;
  by?: string;
  /** Its status when it was typed: an office message must never land on 'working'. */
  status: WorkerStatus;
}

/**
 * A floor of fake agents. Each behaves as the live ones did: it works its task; a message that arrives
 * between turns starts a turn, and when that turn is over it carries on only if the message told it to
 * (the resume line, a nudge), else it stops right there, as Katherine did after the standup. A standup
 * ask writes a standup entry with proposals to its journal.
 */
class FakeFloor implements TeamFloor {
  id = `int-${Math.random().toString(36).slice(2, 8)}`;
  name = 'equipment-loan-desk-test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'interrupt-floor-'));
  map = new Map<string, WorkerInfo>();
  typed: Typed[] = [];
  wakes: { id: string; text?: string }[] = [];
  inbox = new Map<string, string[]>();
  lastWords?: (w: WorkerInfo) => string | undefined;
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo> {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: this.roster.deps.now(), cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.map.delete(id);
    this.roster.onWorkerGone(this, id);
  }
  prompt(id: string, text: string, by?: string) {
    const w = this.map.get(id);
    if (!w || w.status === 'exited' || w.status === 'offline') return 'Worker is not running';
    this.typed.push({ id, text, by, status: w.status });
    this.inbox.set(id, [...(this.inbox.get(id) ?? []), text]);
    return undefined;
  }
  wake(id: string, text?: string) {
    if (!this.map.has(id)) return 'No such worker';
    this.wakes.push({ id, text });
    Object.assign(this.map.get(id)!, { status: 'starting' });
    if (text) this.inbox.set(id, [...(this.inbox.get(id) ?? []), text]);
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = () => {};
  set(id: string, status: WorkerStatus) {
    const w = this.map.get(id)!;
    Object.assign(w, { status, ...(status === 'working' ? { workingSince: this.roster.deps.now() } : {}) });
    this.roster.onWorker(this, w);
  }
  /** Every agent with something in its inbox takes it: a turn starts, and ends unless it was told to carry on. */
  react() {
    for (const [id, texts] of [...this.inbox]) {
      this.inbox.delete(id);
      const w = this.map.get(id);
      if (!w) continue;
      this.set(id, 'working');
      for (const t of texts) if (/^Standup \d/.test(t)) this.standupEntry(w, t);
      const carryOn = texts.some((t) => t.includes(RESUME_HEAD) || t.startsWith('You stopped with'));
      if (!carryOn) this.set(id, 'done');
    }
  }
  private standupEntry(w: WorkerInfo, ask: string) {
    const team = /docs\/team\/(\w+)\.md/.exec(ask)?.[1] ?? 'analysis';
    const heading = /## (.+? — Standup)/.exec(ask)?.[1] ?? 'Standup';
    const file = path.join(this.cwdOf(w), 'docs', 'team', `${team}.md`);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `\n## ${heading}\n### Done\n- kickoff\n### Next\n- BRD\n### Blockers\n- none\n### Proposals\n- [client-milestone] Discovery PR lands at Stage 4 confirmation — so the client signs once\n`);
  }
  /** Office messages typed into a turn under way: none, ever. */
  officeMidTurn = () => this.typed.filter((t) => (t.by === undefined || t.by === 'Agent Office') && (t.status === 'working' || t.status === 'starting'));
}

/** Members idle (between turns) with an open task and no escalation open: the bug. */
function idleWithOpenTask(roster: Roster, floor: FakeFloor): string[] {
  const v = roster.view(floor, true);
  return v.members.filter((m) => m.status === 'idle' && m.task && !m.waitingOnPm).map((m) => `${m.name}: ${m.task}`);
}

function office(start: number) {
  const clock = { now: start };
  const floor = new FakeFloor();
  let issue = 0;
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'interrupt-data-')), floors: () => [floor], makeIssue: async () => ({ number: ++issue + 1 }), analysis: () => '', now: () => clock.now }, 0);
  floor.roster = roster;
  return { clock, floor, roster, d: () => roster.data(floor.id) };
}

const ROLES: [RoleId, string | undefined][] = [
  ['pm', undefined],
  ['chief-analyst', 'work on GitHub issue #1 (Discovery)'],
  ['lead-developer', 'build the Orders module (issue #5)'],
  ['lead-designer', 'wireframes for the loan desk (issue #6)'],
  ['lead-tester', 'test plan outline (issue #7)'],
];

test('regression: agents mid-task get a standup, an autonomy change and approvals, and none ends idle with its task open', async () => {
  const { clock, floor, roster, d } = office(WED_1417);
  const ids = {} as Record<RoleId, string>;
  for (const [role, task] of ROLES) {
    assert.equal(await roster.members.hire(floor, role, 'Keith', undefined, task), undefined);
    ids[role] = d().members[role].workerId!;
  }
  const back = () => {
    // The debounce after each stop, as its timer would fire it.
    clock.now += BACK_GRACE_MS + 1000;
    for (const [role] of ROLES) roster.backToWork.check(floor, role);
    floor.react();
  };
  // Everyone gets going; the Coordinator, with no task, answers and stops.
  for (const [role] of ROLES) floor.set(ids[role], 'working');
  floor.set(ids.pm, 'done');

  // 14:20: the catch-up standup the live floor ran three minutes after hiring isn't run.
  clock.now = WED_1417 + 3 * MIN;
  roster.tick();
  assert.equal(d().standups.length, 0, 'no catch-up standup on a new team’s first day');

  // The Project Manager runs a standup anyway, everyone busy, picking nothing: after their current turn.
  const s = roster.standups.run(floor, 'Keith');
  assert.ok(typeof s !== 'string');
  assert.equal(floor.typed.length, 0, 'nobody busy was interrupted');
  // And changes the autonomy level: the notice waits for each turn's end too.
  roster.members.settings(floor, { autonomy: 4 }, 'Keith');
  assert.deepEqual(floor.officeMidTurn(), []);
  // The Coordinator was between turns: it hears the notice now, and it ends with what to do (it has no task).
  assert.match(floor.typed.find((t) => t.id === ids.pm)!.text, /no task yet/);
  floor.react();

  // Katherine finishes her turn: the standup and the notice go in as one message that ends with her task.
  clock.now += 2 * MIN;
  floor.set(ids['chief-analyst'], 'done');
  const kat = floor.typed.filter((t) => t.id === ids['chief-analyst']);
  assert.equal(kat.length, 1);
  assert.match(kat[0].text, /^Standup /);
  assert.match(kat[0].text, /changed this floor's autonomy level/);
  assert.match(kat[0].text, /When you've done this, carry on with: work on GitHub issue #1 \(Discovery\)\.$/);
  floor.react();
  assert.equal(floor.worker(ids['chief-analyst'])!.status, 'working', 'she carries on with issue #1');

  // The standup compiles (she's still at work; the rest from their journals or once their turns end).
  for (const role of ['lead-developer', 'lead-designer'] as const) {
    floor.set(ids[role], 'done');
    floor.react();
  }
  clock.now += COLLECT_MS;
  roster.tick();
  const sd = d().standups.at(-1)!;
  assert.equal(sd.status, 'compiled');
  const pending = d().proposals.filter((p) => p.status === 'pending');
  assert.ok(pending.length >= 1, 'proposals to decide');

  // The Project Manager approves Katherine's proposal while she works: she hears it after this turn.
  const hers = pending.find((p) => p.role === 'chief-analyst')!;
  const before = floor.typed.length;
  assert.equal(await roster.standups.decide(floor, hers.id, 'approve', 'Keith'), undefined);
  clock.now += DECISION_WAKE_MS + 1000;
  roster.tick();
  assert.equal(floor.typed.filter((t) => t.id === ids['chief-analyst']).length, kat.length, 'not into her turn');
  floor.set(ids['chief-analyst'], 'done');
  const note = floor.typed.slice(before).find((t) => t.id === ids['chief-analyst'])!;
  assert.match(note.text, /APPROVED/);
  assert.match(note.text, /carry on with: work on GitHub issue #1/);
  floor.react();

  // Grace escalates and stops: waiting on the Project Manager, she isn't nudged and isn't "idle with a task".
  const grace = floor.worker(ids['lead-developer'])!;
  floor.set(grace.id, 'working');
  roster.escalations.raise(floor, grace, { urgency: 'important', trigger: 'blocked', title: 'Which loan period?', details: '', options: [] });
  floor.set(grace.id, 'done');
  back();
  assert.equal(floor.worker(grace.id)!.status, 'done', `escalated: left to wait (${JSON.stringify(floor.typed.filter((t) => t.id === grace.id).map((t) => t.text.slice(0, 80)))})`);
  // The answer unblocks her: typed at once (she's between turns), with her task after it.
  const esc = d().escalations.find((e) => e.status === 'open')!;
  assert.equal(roster.escalations.resolve(floor, esc.id, 'reply', '14 days', 'Keith'), undefined);
  const answer = floor.typed.at(-1)!;
  assert.equal(answer.id, grace.id);
  assert.match(answer.text, /14 days[\s\S]*carry on with: build the Orders module \(issue #5\)/);
  floor.react();

  // Now every Lead stops with its task open (the live floor's 25 quiet minutes): each is nudged once.
  for (const [role, task] of ROLES) if (task) floor.set(ids[role], 'done');
  back();
  for (const [role, task] of ROLES) if (task) assert.ok(floor.typed.some((t) => t.id === ids[role] && t.text.startsWith('You stopped with')), `${role} nudged`);

  // The verdicts the scenario exists for.
  assert.deepEqual(idleWithOpenTask(roster, floor), [], 'nobody idle with an open task and nothing escalated');
  assert.deepEqual(floor.officeMidTurn(), [], 'no office message typed into a turn under way');
  roster.stop();
});

test('regression: a scheduled standup reads busy Leads from their journals instead of interrupting them', async () => {
  const { clock, floor, roster, d } = office(WED_1417);
  for (const [role, task] of ROLES) await roster.members.hire(floor, role, 'Keith', undefined, task);
  const id = (r: RoleId) => d().members[r].workerId!;
  for (const [role] of ROLES) floor.set(id(role), 'working');
  // Ken is between turns; the others work. Thursday 09:01: the scheduled standup.
  floor.set(id('lead-designer'), 'done');
  clock.now = WED_0900 + 24 * H + MIN;
  roster.tick();
  const s = d().standups.at(-1)!;
  assert.equal(s?.by, 'schedule');
  assert.deepEqual(s.waiting, ['lead-designer'], 'only the one between turns is asked');
  assert.deepEqual(floor.officeMidTurn(), []);
  assert.match(floor.typed.at(-1)!.text, /carry on with: wireframes for the loan desk \(issue #6\)/);
  roster.stop();
});

test('a decision an asleep Lead was waiting on wakes it with the decision and its task; a nudge is rate-limited and respects pauses', async () => {
  const { clock, floor, roster, d } = office(WED_1417);
  await roster.members.hire(floor, 'chief-analyst', 'Keith', undefined, 'work on GitHub issue #1 (Discovery)');
  const id = d().members['chief-analyst'].workerId!;
  floor.set(id, 'working');
  // Her proposal, from a standup, then she goes to sleep (her process stopped).
  floor.set(id, 'done');
  const s = roster.standups.run(floor, 'Keith');
  assert.ok(typeof s !== 'string');
  floor.react();
  floor.set(id, 'done');
  clock.now += COLLECT_MS;
  roster.tick();
  floor.set(id, 'exited');
  const p = d().proposals.find((x) => x.status === 'pending')!;
  await roster.standups.decide(floor, p.id, 'approve', 'Keith');
  clock.now += DECISION_WAKE_MS + 1000;
  roster.tick();
  const woke = floor.wakes.at(-1)!;
  assert.equal(woke.id, id);
  assert.match(woke.text!, /APPROVED[\s\S]*carry on with: work on GitHub issue #1/);
  floor.react();

  // Rate limit: a couple of nudges per task an hour, whatever the stops.
  let nudges = 0;
  for (let i = 0; i < 4; i++) {
    floor.set(id, 'done');
    clock.now += BACK_GRACE_MS + 1000;
    if (roster.backToWork.check(floor, 'chief-analyst')) nudges++;
    floor.react();
  }
  assert.equal(nudges, BACK_PER_WINDOW);
  // An hour on she may be nudged again; not while the floor is paused, nor once she says it's done.
  clock.now += BACK_WINDOW_MS;
  floor.set(id, 'done');
  clock.now += BACK_GRACE_MS + 1000;
  roster.members.settings(floor, { backToWork: false }, 'Keith');
  assert.equal(roster.backToWork.look(floor, 'chief-analyst'), 'off');
  roster.members.settings(floor, { backToWork: true }, 'Keith');
  floor.lastWords = () => 'Task done: BRD v1 is in docs/brd.md';
  assert.equal(roster.backToWork.look(floor, 'chief-analyst'), 'finished');
  assert.equal(roster.view(floor, true).members.find((m) => m.role === 'chief-analyst')!.task, undefined, 'finished: no longer open');
  roster.stop();
});

test("the Project Manager's Nudge and their after-the-turn question; the Coordinator's relay waits as they chose", async () => {
  const { floor, roster, d } = office(WED_1417);
  await roster.members.hire(floor, 'pm', 'Keith');
  await roster.members.hire(floor, 'chief-analyst', 'Keith', undefined, 'work on GitHub issue #1 (Discovery)');
  const pm = d().members.pm.workerId!;
  const kat = d().members['chief-analyst'].workerId!;
  floor.set(pm, 'working');
  floor.set(kat, 'working');
  assert.match(String(roster.backToWork.nudgeNow(floor, 'chief-analyst', 'Keith')), /working already/);
  // A team question after the Coordinator's turn, and its relay to busy Katherine after hers.
  assert.equal(roster.interrupts.tell(floor, "What's blocking the team?", 'Keith', 'after', { 'chief-analyst': 'after' }), undefined);
  assert.equal(floor.typed.length, 0, 'held for its turn');
  assert.equal(d().members.pm.task, undefined, "a question isn't its task");
  floor.set(pm, 'done');
  assert.equal(floor.typed.at(-1)!.text, "What's blocking the team?");
  const opts = roster.interrupts.tellOpts(floor, pm, kat);
  assert.deepEqual(opts, { hold: true, between: true });
  assert.equal(roster.delivery.send(floor, floor.worker(kat)!, 'Katherine: any blockers on issue #1?', { origin: 'agent', by: 'Niklaus', wake: true, hold: true, ...opts }).status, 'held');
  assert.deepEqual(roster.interrupts.tellOpts(floor, kat, pm), {}, 'only the Coordinator’s relays');
  // Katherine stops: the relay goes in; then she's idle and the Project Manager presses Nudge.
  floor.set(kat, 'done');
  assert.match(floor.typed.at(-1)!.text, /any blockers/);
  assert.equal(roster.backToWork.nudgeNow(floor, 'chief-analyst', 'Keith'), undefined);
  assert.match(floor.typed.at(-1)!.text, /^You stopped with work on GitHub issue #1 \(Discovery\) open: carry on, or escalate if you're blocked\.[\s\S]*Keith pressed Nudge/);
  roster.stop();
});
