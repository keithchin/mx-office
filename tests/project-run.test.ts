// ▶ Resume project and ⏸ Pause project against a fake floor: fake workers instead of Claude sessions,
// a fake clock, and the real workflow engine checkpointing into a temp folder (so a "restart" is a new
// engine on the same folder). The work-waiting sources, the safety checks, the order and pacing, the
// resume brief, the pause holding the office's prompts but not a person's, never typing into a
// question, carrying a run on after a restart, and the audit events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GhIssue, GhPull, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import { chosen, cleanPacing, estimateLine, PAUSED_HIRES, pauseLine } from '../src/shared/project-run.js';
import { floorLedger } from '../src/server/roster/pause.js';
import type { Ledger } from '../src/server/usage.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { FlowEngine } from '../src/server/flow/engine.js';
import { FileStore } from '../src/server/flow/store.js';
import { audit } from '../src/server/audit/index.js';
import { ProjectRuns } from '../src/server/project-run/index.js';
import { issueRefs, noFacts, workWaiting } from '../src/server/project-run/work.js';
import { assess, okProbe, type Probe } from '../src/server/project-run/safety.js';
import { waitBeforeNext, wakeOrder } from '../src/server/project-run/order.js';
import { handoffPrompt, resumeBrief, SLEPT_MAX, sleptPart } from '../src/server/project-run/brief.js';
import { hireHoldOf, overrideHold, projectPause, projectPauseOf, setProjectPause, useProjectRunFile } from '../src/server/project-run/store.js';
import type { RunFloor } from '../src/server/project-run/types.js';
import { noteWorkerStatus, turnsStarted } from '../src/server/project-run/turns.js';
import { HANDOFF_START_MS } from '../src/server/roster/bench.js';

const MON_0905 = Date.UTC(2026, 9, 5, 1, 5);
const SEC = 1000;

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'mx-spike';
  dir = mkdtempSync(path.join(os.tmpdir(), 'prun-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string; by?: string }[] = [];
  wakes: { id: string; text?: string; by?: string; at: number }[] = [];
  slept: string[] = [];
  stopped: string[] = [];
  roster!: Roster;
  clock!: { now: number };
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo | string> {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', model: ask.model, deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: this.clock.now, prompt: ask.prompt, cols: 80, rows: 24, viewers: [], viewerIds: [] } as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop(id: string) {
    this.stopped.push(id);
    this.map.delete(id);
    this.roster.onWorkerGone(this, id);
  }
  prompt(id: string, text: string, by?: string) {
    const w = this.map.get(id);
    if (!w || w.status === 'exited' || w.status === 'offline') return 'Worker is not running';
    this.prompts.push({ id, text, by });
    return undefined;
  }
  wake(id: string, text?: string, by?: string) {
    if (!this.map.has(id)) return 'No such worker';
    this.wakes.push({ id, text, by, at: this.clock.now });
    this.set(id, 'starting', { startedAt: this.clock.now } as Partial<WorkerInfo>);
    return undefined;
  }
  rename(id: string, name: string) {
    const w = this.map.get(id);
    if (w) w.name = name;
  }
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => undefined;
  changed = () => undefined;
  set(id: string, status: WorkerStatus, patch: Partial<WorkerInfo> = {}) {
    const w = this.map.get(id)!;
    Object.assign(w, { status, ...patch });
    // As the office hears every status change (office/floors.ts workerChanged).
    noteWorkerStatus(w);
    this.roster.onWorker(this, w);
  }
  /** A plain worker (not on the team). */
  add(name: string, status: WorkerStatus, patch: Partial<WorkerInfo> = {}): WorkerInfo {
    const id = `x${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', deskId: 'd', name, color: '#fff', status, acked: true, createdBy: 'k', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [], sessionId: 's', ...patch } as WorkerInfo;
    this.map.set(id, w);
    return w;
  }
}

interface World {
  floor: FakeFloor;
  roster: Roster;
  clock: { now: number };
  runs: ProjectRuns;
  dir: string;
  run: RunFloor;
  probes: Map<string, Probe>;
  cut: Set<string>;
  pulls: GhPull[];
  issues: GhIssue[];
  /** A woken worker's session comes up this long after it was woken. */
  bootDelay: number;
  /** Makes another ProjectRuns on the same flows folder: what the office does after a restart. */
  restart(): ProjectRuns;
}

function world(o: { hang?: (w: World) => boolean } = {}): World {
  const clock = { now: MON_0905 };
  const floor = new FakeFloor();
  floor.clock = clock;
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'prun-data-')), floors: () => [floor], makeIssue: async () => ({ number: 1, url: 'u' }), analysis: () => '', now: () => clock.now }, 0);
  floor.roster = roster;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'prun-flows-'));
  const w = { floor, roster, clock, dir, probes: new Map(), cut: new Set(), pulls: [], issues: [], bootDelay: 20 * SEC } as unknown as World;
  w.run = {
    team: floor,
    base: 'main',
    pulls: () => w.pulls,
    issues: () => w.issues,
    cutOff: (id) => w.cut.has(id),
    sleep: (id) => {
      floor.slept.push(id);
      floor.set(id, 'exited');
      return undefined;
    },
    studioOpen: () => false,
    chatter: () => [],
    probe: async (x) => w.probes.get(x.id) ?? okProbe(),
    merges: async () => ['Merge PR #7: login fix'],
  };
  // The world moves on while a step waits: woken sessions come up after bootDelay.
  const sleep = async (ms: number, signal: AbortSignal) => {
    if (o.hang?.(w)) return new Promise<void>(() => undefined);
    if (signal.aborted) throw new Error('cancelled');
    clock.now += ms;
    for (const x of floor.workers()) if (x.status === 'starting' && clock.now - ((x as { startedAt?: number }).startedAt ?? 0) >= w.bootDelay) floor.set(x.id, 'idle');
    await new Promise((r) => setImmediate(r));
  };
  const make = () => new ProjectRuns({ roster, engine: new FlowEngine({ store: new FileStore(dir), now: () => clock.now }), floor: (id) => (id === floor.id ? w.run : undefined), now: () => clock.now, sleep, pollMs: 1000, bootMs: 5 * 60 * SEC, turnsStarted });
  w.runs = make();
  w.restart = make;
  return w;
}

/** Hires every role and puts them to sleep; returns their worker ids by role. */
async function team(w: World, roles: ('pm' | 'lead-developer' | 'lead-tester' | 'lead-designer')[]) {
  const ids: Record<string, string> = {};
  for (const r of roles) {
    assert.equal(await w.roster.members.hire(w.floor, r, 'Keith'), undefined);
    const id = w.roster.data(w.floor.id).members[r].workerId!;
    w.floor.set(id, 'exited', { sessionId: `s-${r}` });
    ids[r] = id;
  }
  return ids;
}

const answered = (role: string, workerId: string, title: string, at: number): Escalation =>
  ({ id: `e${Math.random()}`, title, details: '', urgency: 'normal', fyi: false, status: 'resolved', by: 'x', role, workerId, at, resolution: { verdict: 'approve', text: 'go', by: 'Keith', at } }) as unknown as Escalation;

async function until(cond: () => boolean, label: string, n = 2000) {
  for (let i = 0; i < n && !cond(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(cond(), label);
}

// ---- Pure parts ---------------------------------------------------------------------------------

test('work waiting: one reason per source, none means nothing to do', () => {
  assert.deepEqual(workWaiting(noFacts()), []);
  const f = { ...noFacts(), owed: ['- a', '- b'], held: 1, outbox: ['n'], cutOff: true, failingPrs: [{ number: 9, title: 't' }], issues: [{ number: 12, title: 'i' }], standup: '2026-10-05' };
  assert.deepEqual(
    workWaiting(f).map((r) => r.kind),
    ['owed', 'held', 'outbox', 'cut-off', 'failing-pr', 'issue', 'standup'],
  );
  assert.match(workWaiting(f)[0].text, /2 escalation answers owed/);
  assert.match(workWaiting(f)[4].text, /PR #9/);
  assert.deepEqual(issueRefs('Fix issue #12', 'see (#7) and a#3', undefined), [12, 7]);
});

test('safety checks: missing worktree, merged branch, behind and uncommitted, no session', () => {
  assert.deepEqual(assess(okProbe(), true), { checks: [], options: ['wake'] });
  const gone = assess({ ...okProbe(), worktree: false }, true);
  assert.deepEqual(gone.options, ['rehire']);
  assert.match(gone.checks[0].text, /re-hire/);
  assert.deepEqual(assess({ ...okProbe(), worktree: false }, false).options, []);
  const merged = assess({ ...okProbe(), merged: true, base: 'origin/main' }, true);
  assert.deepEqual(merged.options, ['send-home', 'wake']);
  assert.match(merged.checks[0].text, /merged into origin\/main: send it home/);
  const behind = assess({ ...okProbe(), behind: 3, dirty: 2 }, false);
  assert.deepEqual(behind.checks.map((c) => c.kind), ['behind', 'dirty']);
  assert.match(behind.checks[0].text, /3 commits behind/);
  assert.deepEqual(assess({ ...okProbe(), resumable: false }, true).options, ['rehire']);
  assert.deepEqual(assess({ ...okProbe(), resumable: false }, false).options, ['wake']);
});

test('order: the Coordinator first, then the most blocking Leads, then everyone else', () => {
  const a = (key: string, role: string | undefined, owed = 0, openPrs = 0, jeff = 0) => ({ key, name: key, role: role as never, owed, openPrs, jeff });
  const got = wakeOrder([a('w', undefined, 9), a('t', 'lead-tester', 0, 1), a('d', 'lead-developer', 2), a('p', 'pm'), a('g', 'lead-designer', 0, 1, 0.9)]).map((x) => x.key);
  assert.deepEqual(got, ['p', 'd', 'g', 't', 'w']);
});

test('pacing: at most N booting at once, a gap apart, a slot freed by a live session or a timeout', () => {
  const p = { concurrent: 2, gapMs: 45 * SEC, bootMs: 300 * SEC };
  assert.equal(waitBeforeNext(0, [], undefined, p), 0);
  assert.equal(waitBeforeNext(10 * SEC, [{ key: 'a', at: 0 }], 0, p), 35 * SEC);
  assert.equal(waitBeforeNext(45 * SEC, [{ key: 'a', at: 0 }], 0, p), 0);
  // Two booting: wait (a poll), however long ago the last went.
  assert.ok(waitBeforeNext(100 * SEC, [{ key: 'a', at: 0 }, { key: 'b', at: 45 * SEC }], 45 * SEC, p) > 0);
  // One timed out: its slot is free.
  assert.equal(waitBeforeNext(301 * SEC, [{ key: 'a', at: 0 }, { key: 'b', at: 45 * SEC }], 45 * SEC, p), 0);
  assert.deepEqual(cleanPacing({ concurrent: 99, gapSec: 1 }), { concurrent: 6, gapSec: 5 });
  assert.deepEqual(cleanPacing('x'), { concurrent: 2, gapSec: 45 });
});

test('the resume brief: what happened, open asks, branch state, owed answers, a plan at low autonomy, and a capped length', () => {
  const base = { name: 'Hedy', autonomy: 2, by: 'Keith', merges: ['Merge #7'], base: 'origin/main', escalations: ['“Secret”: approve — set'], chatter: ['Ada → Hedy: rebase please'], open: ['CI secret'], behind: 4, dirty: 1, cutOff: true, owed: ['- “Secret”: Approved — set (Keith)'], notes: ['- PM approved your proposal'], reasons: [{ kind: 'failing-pr' as const, text: 'Failing checks on PR #9' }] };
  const b = resumeBrief(base);
  assert.match(b, /Keith resumed the project/);
  assert.match(b, /cut off mid-turn/);
  assert.match(b, /Merged on origin\/main: Merge #7/);
  assert.match(b, /don't raise these again[\s\S]*“CI secret”/);
  assert.match(b, /4 commits behind origin\/main: rebase first and re-run the checks/);
  assert.match(b, /1 uncommitted change/);
  assert.match(b, /Answers to your escalations:\n- “Secret”/);
  assert.match(b, /Notes for you/);
  assert.match(b, /Failing checks on PR #9/);
  assert.match(b, /post a 2-line plan/);
  assert.doesNotMatch(resumeBrief({ ...base, autonomy: 3 }), /2-line plan/);
  const long = sleptPart({ merges: Array.from({ length: 40 }, (_, i) => `Merge PR #${i}: ${'x'.repeat(100)}`), escalations: [], chatter: [], base: 'origin/main' });
  assert.ok(long.length <= SLEPT_MAX, `${long.length} chars`);
  assert.match(long, /- …$/);
  assert.match(handoffPrompt('Keith', 'lead-developer', '2026-10-05 09:05'), /docs\/team\/development\.md[\s\S]*Handoff/);
});

test('the shared helpers: estimate, choices, the pause line', () => {
  assert.equal(estimateLine(3), 'Wakes 3 agents ≈ 3 turns');
  assert.equal(estimateLine(0), 'Wakes nobody: nothing to do');
  const agents = [
    { workerId: 'a', name: 'A', title: '', state: 'asleep' as const, reasons: [], checks: [], action: 'wake' as const, options: ['wake' as const, 'skip' as const], order: 0 },
    { workerId: 'b', name: 'B', title: '', state: 'asleep' as const, reasons: [], checks: [], action: 'skip' as const, options: ['wake' as const, 'skip' as const], order: 1 },
    { role: 'lead-tester' as const, name: 'C', title: '', state: 'benched' as const, reasons: [], checks: [], action: 'skip' as const, options: ['rehire' as const, 'skip' as const], order: 2 },
  ];
  assert.deepEqual(chosen({ agents }, { mode: 'work' }).map((x) => x.agent.name), ['A']);
  assert.deepEqual(chosen({ agents }, { mode: 'all' }).map((x) => `${x.agent.name}:${x.action}`), ['A:wake', 'B:wake', 'C:rehire']);
  assert.deepEqual(chosen({ agents }, { mode: 'pick', picks: { b: 'wake', 'role:lead-tester': 'send-home' } }).map((x) => x.agent.name), ['B']);
  assert.equal(pauseLine({ by: 'Keith', at: 0, why: 'person', waiting: ['Ada', 'Bo'] }, () => '14:05'), '⏸ Paused by Keith at 14:05 · 2 waiting on you');
});

// ---- Against a fake floor ----------------------------------------------------------------------

test('the preview: work from each source, the spend cap blocks, nothing is woken', async () => {
  useProjectRunFile(undefined);
  const w = world();
  const ids = await team(w, ['pm', 'lead-developer', 'lead-tester']);
  const plain = w.floor.add('Plain-worker', 'offline', { title: 'Fix #12', pr: { number: 9, url: 'u' } });
  const idle = w.floor.add('Idle', 'offline');
  w.floor.add('Busy', 'working');
  const d = w.roster.data(w.floor.id);
  d.escalations.push(answered('lead-developer', ids['lead-developer'], 'Secret', w.clock.now));
  d.outbox.leads['lead-tester'] = { lines: ['- decided'], at: 0 };
  d.outbox.escalations.push('e1');
  w.cut.add(ids['lead-tester']);
  w.pulls = [{ number: 9, title: 'login', state: 'OPEN', checks: 'fail', headRefName: 'x' } as GhPull];
  w.issues = [{ number: 12, title: 'Bug', state: 'OPEN', labels: [], assignees: [] } as unknown as GhIssue];
  w.probes.set(idle.id, { ...okProbe(), merged: true });
  const p = await w.runs.preview(w.floor.id);
  assert.ok(typeof p !== 'string');
  const by = Object.fromEntries(p.agents.map((a) => [a.name, a]));
  const name = (r: string) => d.members[r as 'pm'].name;
  assert.deepEqual(p.agents.map((a) => a.name).slice(0, 1), [name('pm')]);
  assert.deepEqual(by[name('pm')].reasons.map((r) => r.kind), ['outbox']);
  assert.deepEqual(by[name('lead-developer')].reasons.map((r) => r.kind), ['owed']);
  assert.deepEqual(by[name('lead-tester')].reasons.map((r) => r.kind), ['outbox', 'cut-off']);
  assert.deepEqual(by['Plain-worker'].reasons.map((r) => r.kind), ['failing-pr', 'issue']);
  assert.equal(by.Idle.action, 'skip');
  assert.deepEqual(by.Idle.options, ['send-home', 'wake', 'skip']);
  assert.deepEqual(p.awake, ['Busy']);
  assert.equal(p.blocked, undefined);
  assert.equal(w.floor.wakes.length, 0);
  // The spend cap reached: blocked, and resume says so.
  d.settings.costCaps = { 2: 1 };
  d.spend.usd = 5;
  const capped = await w.runs.preview(w.floor.id);
  assert.ok(typeof capped !== 'string' && /daily team cap/.test(capped.blocked ?? ''));
  assert.match(String(await w.runs.resume(w.floor.id, { mode: 'work' }, 'Keith')), /daily team cap/);
  assert.equal(plain.status, 'offline');
});

test('a resume wakes those with work, Coordinator first, two at a time 45 s apart, each with its brief as a person’s turn; audited', async () => {
  useProjectRunFile(undefined);
  const events: { action: string; summary: string }[] = [];
  const record = audit.record;
  audit.record = (e) => (events.push(e), undefined);
  try {
    const w = world();
    w.bootDelay = 100 * SEC;
    const ids = await team(w, ['pm', 'lead-developer', 'lead-tester', 'lead-designer']);
    const d = w.roster.data(w.floor.id);
    for (const r of ['pm', 'lead-developer', 'lead-tester'] as const) d.escalations.push(answered(r, ids[r], `Q ${r}`, w.clock.now));
    // The developer is owed more: it blocks more, so it goes before the tester.
    d.escalations.push(answered('lead-developer', ids['lead-developer'], 'Q2', w.clock.now));
    w.floor.add('Nobody', 'offline');
    setProjectPause(w.floor.id, { by: 'Ada', at: 0, why: 'person', waiting: [] });
    const r = await w.runs.resume(w.floor.id, { mode: 'work' }, 'Keith');
    assert.ok(typeof r !== 'string');
    assert.equal(r.agents.length, 3);
    await until(() => w.runs.latest(w.floor.id)?.status === 'done', 'the run finishes');
    assert.equal(projectPause(w.floor.id), undefined, 'the pause is lifted');
    const wakes = w.floor.wakes;
    assert.deepEqual(wakes.map((x) => x.id), [ids.pm, ids['lead-developer'], ids['lead-tester']]);
    // Two start 45 s apart; the third waits for one of them to come up (100 s after its wake).
    assert.equal(wakes[1].at - wakes[0].at, 45 * SEC);
    assert.equal(wakes[2].at - wakes[0].at, 100 * SEC);
    assert.ok(wakes.every((x) => x.by === 'Keith'));
    assert.match(wakes[1].text ?? '', /Keith resumed the project[\s\S]*Answers to your escalations:\n- “Q lead-developer”/);
    assert.ok(d.escalations.every((e) => e.resolution?.delivered), 'owed answers are marked told');
    const done = w.runs.view(w.floor.id, true).run!;
    assert.deepEqual(done.agents.map((a) => a.status), ['woken', 'woken', 'woken']);
    const actions = events.map((e) => e.action);
    assert.equal(actions.filter((a) => a === 'agent.woken').length, 3);
    assert.ok(actions.includes('resume.started') && actions.includes('resume.finished'));
  } finally {
    audit.record = record;
  }
});

test('a paused floor holds the office’s prompts, but a person’s go through and wake only that agent', async () => {
  useProjectRunFile(undefined);
  const w = world();
  const ids = await team(w, ['pm', 'lead-developer']);
  w.floor.set(ids['lead-developer'], 'idle');
  setProjectPause(w.floor.id, { by: 'Keith', at: 0, why: 'person', waiting: [] });
  assert.match(projectPauseOf(w.floor.id) ?? '', /paused/);
  const dev = w.floor.worker(ids['lead-developer'])!;
  const pm = w.floor.worker(ids.pm)!;
  const office = w.roster.delivery.send(w.floor, dev, 'nudge', { origin: 'office' });
  assert.equal(office.status, 'refused');
  assert.equal(w.roster.delivery.send(w.floor, dev, 'tell', { origin: 'agent' }).status, 'refused');
  assert.ok(w.roster.delivery.paused(w.floor));
  assert.equal(w.roster.delivery.send(w.floor, dev, 'hi from Keith', { origin: 'person', by: 'Keith' }).status, 'sent');
  // The Coordinator's relays wait (it's "away" while the floor is paused): it isn't woken for them.
  w.roster.data(w.floor.id).outbox.escalations.push('e1');
  assert.equal(w.roster.relays.wakeCoordinator(w.floor), false);
  assert.equal(w.roster.delivery.send(w.floor, pm, 'answer', { origin: 'person', by: 'Keith', wake: true }).status, 'woke');
  assert.deepEqual(w.floor.wakes.map((x) => x.id), [ids.pm]);
  setProjectPause(w.floor.id, undefined);
  assert.equal(w.roster.delivery.send(w.floor, dev, 'nudge', { origin: 'office' }).status, 'sent');
});

test('a pause lets turns finish, asks for a handoff, sleeps them, and never types into a question', async () => {
  useProjectRunFile(undefined);
  const w = world();
  const ids = await team(w, ['pm', 'lead-developer', 'lead-tester']);
  w.floor.set(ids.pm, 'idle');
  w.floor.set(ids['lead-developer'], 'working');
  w.floor.set(ids['lead-tester'], 'needs_input');
  const r = w.runs.pause(w.floor.id, 'Keith');
  assert.ok(typeof r !== 'string');
  await until(() => w.floor.prompts.length >= 1, 'the idle one is asked for its handoff');
  assert.equal(w.floor.prompts[0].id, ids.pm);
  assert.match(w.floor.prompts[0].text, /pausing the project[\s\S]*handoff/);
  assert.equal(w.floor.prompts[0].by, 'Keith');
  assert.ok(projectPause(w.floor.id));
  // The Coordinator writes it; the developer finishes its turn and is asked in turn.
  w.floor.set(ids.pm, 'working');
  w.floor.set(ids.pm, 'done');
  w.floor.set(ids['lead-developer'], 'done');
  await until(() => w.floor.prompts.some((p) => p.id === ids['lead-developer']), 'the developer is asked once its turn is over');
  w.floor.set(ids['lead-developer'], 'working');
  w.floor.set(ids['lead-developer'], 'idle');
  await until(() => w.runs.latest(w.floor.id)?.status === 'done', 'the pause finishes');
  assert.deepEqual(w.floor.slept.sort(), [ids.pm, ids['lead-developer']].sort());
  assert.ok(!w.floor.prompts.some((p) => p.id === ids['lead-tester']), 'nothing typed into the question');
  const tester = w.roster.data(w.floor.id).members['lead-tester'].name;
  assert.deepEqual(projectPause(w.floor.id)?.waiting, [tester]);
  assert.deepEqual(w.runs.view(w.floor.id, true).run!.agents.find((a) => a.name === tester)?.status, 'waiting-on-you');
});

test('a handoff turn shorter than a look still counts: the pause sleeps the agent at once, not after HANDOFF_START_MS', async () => {
  useProjectRunFile(undefined);
  const w = world();
  const ids = await team(w, ['pm']);
  w.floor.set(ids.pm, 'idle');
  const start = w.clock.now;
  assert.ok(typeof w.runs.pause(w.floor.id, 'Keith') !== 'string');
  await until(() => w.floor.prompts.length >= 1, 'it is asked for its handoff');
  // The whole handoff turn, well under a second, between two of the pause's looks (one a second here).
  w.floor.set(ids.pm, 'working');
  w.floor.set(ids.pm, 'done');
  await until(() => w.runs.latest(w.floor.id)?.status === 'done', 'the pause finishes');
  assert.deepEqual(w.floor.slept, [ids.pm]);
  const took = w.clock.now - start;
  assert.ok(took < 10 * SEC, `it waited ${Math.round(took / SEC)} s (HANDOFF_START_MS is ${HANDOFF_START_MS / SEC} s)`);
});

test('a resume cut off by a restart carries on from its checkpoint without waking anyone twice', async () => {
  useProjectRunFile(undefined);
  let hang = false;
  const w = world({ hang: () => hang });
  const ids = await team(w, ['pm', 'lead-developer']);
  const d = w.roster.data(w.floor.id);
  for (const r of ['pm', 'lead-developer'] as const) d.escalations.push(answered(r, ids[r], `Q ${r}`, w.clock.now));
  w.bootDelay = 10 * SEC;
  const r = await w.runs.resume(w.floor.id, { mode: 'work' }, 'Keith');
  assert.ok(typeof r !== 'string');
  // The Coordinator is woken; then the office "stops" while the next waits for its slot.
  await until(() => w.floor.wakes.length === 1, 'the first wake');
  hang = true;
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(w.floor.wakes.length, 1);
  hang = false;
  const again = w.restart();
  assert.equal(again.latest(w.floor.id)?.status, 'interrupted');
  again.carryOn();
  await until(() => again.latest(w.floor.id)?.status === 'done', 'the carried-on run finishes');
  assert.deepEqual(w.floor.wakes.map((x) => x.id), [ids.pm, ids['lead-developer']]);
});

// ---- Follow-ups: a pause blocks hires, team issues with nobody assigned, the Coordinator's relays --

test('a paused floor hires nobody (the queue, meetings, desks and the roster see it as hiringPaused), unless a person overrides one hire', async () => {
  useProjectRunFile(undefined);
  const w = world();
  const ledger = floorLedger({ hiringPaused: undefined } as unknown as Ledger, w.floor.id);
  assert.equal(ledger.hiringPaused, undefined);
  setProjectPause(w.floor.id, { by: 'Keith', at: 0, why: 'person', waiting: [] });
  assert.equal(ledger.hiringPaused, PAUSED_HIRES, 'the floor ledger the worker manager, queue and meetings read');
  assert.equal(floorLedger({ hiringPaused: undefined } as unknown as Ledger, 'another-floor').hiringPaused, undefined, 'only this floor');
  assert.equal(await w.roster.members.hire(w.floor, 'lead-developer', 'Keith'), PAUSED_HIRES, 'a roster hire (and so the Firm’s and an answer’s rehire)');
  assert.equal(w.floor.workers().length, 0);
  // The Team tab's "Hire anyway": this one hire goes ahead, and the hold is back afterwards.
  assert.equal(await overrideHold(w.floor.id, () => w.roster.members.hire(w.floor, 'lead-developer', 'Keith')), undefined);
  assert.equal(w.floor.workers().length, 1);
  assert.equal(hireHoldOf(w.floor.id), PAUSED_HIRES);
  assert.equal(ledger.hiringPaused, PAUSED_HIRES);
  setProjectPause(w.floor.id, undefined);
  assert.equal(ledger.hiringPaused, undefined);
});

test('a Lead’s work waiting counts its team’s open issues with nobody assigned too, and never another team’s', async () => {
  useProjectRunFile(undefined);
  const w = world();
  const ids = await team(w, ['lead-developer', 'lead-tester']);
  const issue = (number: number, team: string, assignees: string[] = []) => ({ number, title: `i${number}`, state: 'OPEN', labels: [{ name: `team:${team}`, color: '' }], assignees }) as unknown as GhIssue;
  w.issues = [issue(1, 'development'), issue(2, 'development', ['ken']), issue(3, 'testing'), { ...issue(4, 'development'), state: 'CLOSED' }];
  const p = await w.runs.preview(w.floor.id);
  assert.ok(typeof p !== 'string');
  const dev = p.agents.find((a) => a.workerId === ids['lead-developer'])!;
  const tester = p.agents.find((a) => a.workerId === ids['lead-tester'])!;
  assert.equal(dev.reasons.find((r) => r.kind === 'issue')?.text, 'Open issue #2 assigned; team issue #1 with nobody assigned');
  assert.equal(tester.reasons.find((r) => r.kind === 'issue')?.text, 'Open team issue #3 with nobody assigned');
  assert.deepEqual(workWaiting({ ...noFacts(), issues: [{ number: 9, title: 't' }] })[0].text, 'Open issue #9 assigned');
});

test('the Coordinator hears what the outbox held for it in its resume brief: one message, and the outbox is emptied', async () => {
  useProjectRunFile(undefined);
  const w = world();
  const ids = await team(w, ['pm']);
  const d = w.roster.data(w.floor.id);
  d.escalations.push({ id: 'e9', title: 'CI secret', details: '', urgency: 'urgent', fyi: false, status: 'open', by: 'Ada', role: 'lead-tester', workerId: 'x', at: w.clock.now, options: [] } as unknown as Escalation);
  d.outbox.escalations.push('e9');
  d.outbox.news.push('- Ada benched subagent tester');
  const r = await w.runs.resume(w.floor.id, { mode: 'work' }, 'Keith');
  assert.ok(typeof r !== 'string');
  await until(() => w.runs.latest(w.floor.id)?.status === 'done', 'the run finishes');
  assert.equal(w.floor.wakes.length, 1);
  assert.equal(w.floor.wakes[0].id, ids.pm);
  assert.match(w.floor.wakes[0].text ?? '', /Relayed while you were asleep:[\s\S]*“CI secret”[\s\S]*Ada benched subagent tester/);
  assert.deepEqual([d.outbox.escalations, d.outbox.news], [[], []]);
  assert.equal(w.floor.prompts.length, 0, 'no second message');
});
