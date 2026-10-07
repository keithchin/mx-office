// What the office has still to pass on (roster/relays.ts) against a fake floor: the Coordinator's
// escalations, proposal decisions and subagent news kept in the roster file through a restart, the
// proposing Lead told the Project Manager's decision itself, a Lead's propose-gated subagent decision
// kept for it when it couldn't hear it, a floor with no Coordinator, and relays that ask for no reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { Proposal } from '../src/shared/roster/types.js';
import { Roster } from '../src/server/roster/index.js';
import { LEAD_NOTES_DEBOUNCE_MS, reviveOutbox } from '../src/server/roster/relays.js';
import * as prompts from '../src/server/roster/prompts.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'mx-spike';
  dir = mkdtempSync(path.join(os.tmpdir(), 'relays-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string; by?: string }[] = [];
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
  wakes: { id: string; text?: string; by?: string }[] = [];
  wake(id: string, text?: string, by?: string) {
    this.wakes.push({ id, text, by });
    Object.assign(this.map.get(id)!, { status: 'starting' });
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

function setup() {
  const clock = { now: Date.UTC(2026, 9, 5, 1, 5) };
  const floor = new FakeFloor();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'relays-data-'));
  const make = () => {
    const r = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({ number: 42 }), analysis: () => '', now: () => clock.now }, 0);
    floor.roster = r;
    return r;
  };
  const t = { clock, floor, roster: make(), data: () => t.roster.data(floor.id), restart: () => {
    t.roster.stop();
    t.roster = make();
  } };
  // No scheduled standup in the middle of a test's ticks.
  t.data().settings.schedule.enabled = false;
  return t;
}

async function hireAt(t: ReturnType<typeof setup>, role: 'pm' | 'lead-developer' | 'lead-tester') {
  assert.equal(await t.roster.members.hire(t.floor, role, 'Probe'), undefined);
  const id = t.data().members[role].workerId!;
  t.floor.set(id, 'working');
  t.floor.set(id, 'done');
  t.floor.prompts.length = 0;
  return id;
}

function proposal(t: ReturnType<typeof setup>, title: string): Proposal {
  const p: Proposal = { id: `p-${title.length}`, standup: '2026-10-05', role: 'lead-developer', team: 'development', by: 'Linus', kind: 'task', title, detail: '', status: 'pending' };
  t.data().proposals.push(p);
  return p;
}

test('escalations the Coordinator hasn’t heard survive a restart and reach it once it is back at its desk', async () => {
  const t = setup();
  const pm = await hireAt(t, 'pm');
  const dev = await hireAt(t, 'lead-developer');
  t.floor.set(pm, 'needs_input');
  const e = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'urgent', trigger: 'blocked', title: 'No test DB', details: '', options: [] });
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), false, 'asking someone: never typed into its dialog');
  assert.deepEqual(t.data().outbox.escalations, [e.id], 'kept, not dropped');
  t.restart();
  assert.deepEqual(t.data().outbox.escalations, [e.id], 'read back from the roster file');
  t.floor.set(pm, 'done');
  const told = t.floor.prompts.filter((p) => p.id === pm);
  assert.equal(told.length, 1);
  assert.match(told[0].text, /“No test DB”/);
  assert.match(told[0].text, /no reply needed/);
  assert.doesNotMatch(told[0].text, /Reply `noted`/);
  assert.deepEqual(t.data().outbox.escalations, []);
});

test('a decision on a proposal reaches the Lead that proposed it as a batched note, and the Coordinator after a restart', async () => {
  const t = setup();
  const pm = await hireAt(t, 'pm');
  const dev = await hireAt(t, 'lead-developer');
  t.floor.set(pm, 'needs_input');
  const a = proposal(t, 'Split Orders');
  const b = proposal(t, 'Add audit trail module');
  assert.equal(await t.roster.standups.decide(t.floor, a.id, 'approve', 'Keith'), undefined);
  assert.equal(await t.roster.standups.decide(t.floor, b.id, 'reject', 'Keith', 'Not this release'), undefined);
  assert.equal(t.roster.relays.owed(t.floor.id, 'lead-developer').length, 2);
  // Not before the minute is up, and then both in one prompt.
  t.roster.tick(t.clock.now);
  assert.equal(t.floor.prompts.filter((p) => p.id === dev).length, 0);
  t.clock.now += LEAD_NOTES_DEBOUNCE_MS;
  t.restart();
  t.roster.tick(t.clock.now);
  const notes = t.floor.prompts.filter((p) => p.id === dev);
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /“Split Orders”.*APPROVED → issue #42/);
  assert.match(notes[0].text, /“Add audit trail module”.*REJECTED: Not this release/);
  assert.match(notes[0].text, /no reply needed/);
  assert.equal(t.roster.relays.owed(t.floor.id, 'lead-developer').length, 0);
  // The Coordinator was asking someone: its outcomes waited in the file, and go out once its turn is over.
  assert.equal(t.data().outbox.decisions.length, 2);
  t.floor.set(pm, 'done');
  const outcomes = t.floor.prompts.filter((p) => p.id === pm);
  assert.equal(outcomes.length, 1);
  assert.match(outcomes[0].text, /APPROVED[\s\S]*REJECTED: Not this release/);
  assert.doesNotMatch(outcomes[0].text, /Reply `noted`/);
});

test('an asleep Coordinator is woken once with everything it’s owed, in one message, at most once a window', async () => {
  const t = setup();
  const pm = await hireAt(t, 'pm');
  const dev = await hireAt(t, 'lead-developer');
  t.floor.set(pm, 'offline');
  t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'urgent', trigger: 'blocked', title: 'No test DB', details: '', options: [] });
  assert.equal(await t.roster.standups.decide(t.floor, proposal(t, 'Split Orders').id, 'approve', 'Keith'), undefined);
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), true, 'woken');
  assert.equal(t.floor.wakes.length, 1);
  assert.match(t.floor.wakes[0].text!, /“No test DB”[\s\S]*APPROVED/);
  assert.equal(t.floor.wakes[0].by, undefined, "the office's own: its turn ends quietly");
  assert.deepEqual([t.data().outbox.escalations, t.data().outbox.decisions], [[], []]);
  assert.equal(t.roster.standups.flushPm(t.floor), false, 'nothing left to wake it for');
  // Asleep again with something new inside the window: it waits for the next one.
  t.floor.set(pm, 'offline');
  t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'urgent', trigger: 'blocked', title: 'CI is red', details: '', options: [] });
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), false);
  assert.equal(t.floor.wakes.length, 1);
  t.clock.now += 60_000;
  t.roster.tick(t.clock.now);
  assert.equal(t.floor.wakes.length, 2);
  assert.match(t.floor.wakes[1].text!, /“CI is red”/);
});

test('the spend cap holds the outbox: nothing goes while it is reached, all of it once it lifts', async () => {
  const t = setup();
  const pm = await hireAt(t, 'pm');
  const dev = await hireAt(t, 'lead-developer');
  const d = t.data();
  d.settings.costCaps = { [d.settings.autonomy]: 1 };
  d.spend.usd = 5;
  t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'urgent', trigger: 'blocked', title: 'No test DB', details: '', options: [] });
  assert.equal(await t.roster.standups.decide(t.floor, proposal(t, 'Split Orders').id, 'approve', 'Keith'), undefined);
  t.floor.set(pm, 'offline');
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), false);
  assert.equal(t.roster.standups.flushPm(t.floor), false);
  t.clock.now += LEAD_NOTES_DEBOUNCE_MS;
  t.roster.tick(t.clock.now);
  assert.equal(t.floor.prompts.length + t.floor.wakes.length, 0, 'held by the cap: no prompt, no wake');
  assert.equal(d.outbox.escalations.length, 1);
  assert.equal(d.outbox.decisions.length, 1);
  assert.equal(t.roster.relays.owed(t.floor.id, 'lead-developer').length, 1);
  // The cap lifts (a new day, or a higher cap): the next look sends it all.
  d.spend.usd = 0;
  t.roster.tick(t.clock.now);
  assert.equal(t.floor.wakes.length, 1, 'the Coordinator woken once');
  assert.equal(t.floor.prompts.filter((p) => p.id === dev).length, 1, 'the Lead’s note');
  assert.equal(d.outbox.escalations.length + d.outbox.decisions.length, 0);
});

test('the answer to an escalation is typed as the person’s, so the turn acting on it isn’t taken for the office’s', async () => {
  const t = setup();
  const dev = await hireAt(t, 'lead-developer');
  const e = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'urgent', trigger: 'blocked', title: 'No test DB', details: '', options: [] });
  assert.equal(t.roster.escalations.resolve(t.floor, e.id, 'reply', 'Use the staging DB', 'Keith'), undefined);
  assert.equal(t.floor.prompts.at(-1)!.by, 'Keith');
  // Asleep: woken with it, as Keith's.
  const e2 = t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'urgent', trigger: 'blocked', title: 'Which SSO?', details: '', options: [] });
  t.floor.set(dev, 'offline');
  assert.equal(t.roster.escalations.resolve(t.floor, e2.id, 'reply', 'Entra ID', 'Keith'), undefined);
  assert.equal(t.floor.wakes.at(-1)!.by, 'Keith');
});

test('a Lead busy asking someone gets its notes once its turn is over, never mid-turn', async () => {
  const t = setup();
  const dev = await hireAt(t, 'lead-developer');
  t.floor.set(dev, 'needs_input');
  assert.equal(await t.roster.standups.decide(t.floor, proposal(t, 'Use REST').id, 'approve', 'Keith'), undefined);
  t.clock.now += LEAD_NOTES_DEBOUNCE_MS;
  t.roster.tick(t.clock.now);
  assert.equal(t.floor.prompts.length, 0);
  t.floor.set(dev, 'done');
  assert.equal(t.floor.prompts.length, 1);
  assert.match(t.floor.prompts[0].text, /Notes from the office/);
});

test('with no Coordinator on the team, its relays are let go but the Lead still hears its own decision', async () => {
  const t = setup();
  const dev = await hireAt(t, 'lead-developer');
  assert.equal(await t.roster.standups.decide(t.floor, proposal(t, 'Split Orders').id, 'approve', 'Keith'), undefined);
  t.roster.escalations.raise(t.floor, t.floor.worker(dev)!, { urgency: 'urgent', trigger: 'blocked', title: 'No test DB', details: '', options: [] });
  // Their minute is up (the debounce timers are real ones, so the test flushes them itself).
  assert.equal(t.roster.standups.flushPm(t.floor), false);
  assert.equal(t.roster.escalations.flushCoordinator(t.floor), false);
  assert.equal(t.data().outbox.decisions.length, 0);
  assert.equal(t.data().outbox.escalations.length, 0);
  t.clock.now += LEAD_NOTES_DEBOUNCE_MS;
  t.roster.tick(t.clock.now);
  assert.equal(t.floor.prompts.length, 1);
  assert.match(t.floor.prompts[0].text, /“Split Orders”.*APPROVED/);
});

test('a propose-gated subagent decision the Lead couldn’t hear is kept for it, not lost', async () => {
  const t = setup();
  const dev = await hireAt(t, 'lead-developer');
  const d = t.data();
  d.members['lead-developer'].skills = { warn: { gate: 'propose' } } as never;
  const asked = t.roster.subagents.request(t.floor, 'lead-developer', t.floor.worker(dev)!, 'warn', 'developer', { reason: 'Sloppy MDL' });
  assert.equal(asked.outcome, 'proposed', asked.message);
  t.floor.set(dev, 'exited');
  assert.equal(t.roster.subagents.decide(t.floor, asked.actionId!, true, 'Keith'), undefined);
  assert.equal(t.floor.prompts.length, 0, 'asleep: not prompted');
  assert.match(t.roster.relays.owed(t.floor.id, 'lead-developer')[0], /approved your request to put on warning [A-Z][a-z]+ \(developer\)/);
  t.restart();
  t.floor.set(dev, 'done');
  t.clock.now += LEAD_NOTES_DEBOUNCE_MS;
  t.roster.tick(t.clock.now);
  assert.equal(t.floor.prompts.length, 1);
  assert.match(t.floor.prompts[0].text, /approved your request to put on warning [A-Z][a-z]+ \(developer\)/);
});

test('an outbox is read back whole: bad entries dropped, an old roster without one gets an empty one', () => {
  assert.deepEqual(reviveOutbox(undefined), { escalations: [], decisions: [], news: [], leads: {} });
  const o = reviveOutbox({ escalations: ['a', 3, ''], decisions: 'x', news: ['- n'], newsAt: 5, leads: { 'lead-tester': { lines: ['- hi'], at: 9 }, nobody: { lines: ['- x'] }, 'lead-designer': { lines: [] } } });
  assert.deepEqual(o, { escalations: ['a'], decisions: [], news: ['- n'], newsAt: 5, leads: { 'lead-tester': { lines: ['- hi'], at: 9 } } });
});

test('relays that need nothing back say so instead of asking for `noted`', () => {
  const texts = [prompts.escalationsToCoordinatorPrompt([]), prompts.outcomesPrompt([]), prompts.subagentNewsPrompt(['- x']), prompts.leadNotesPrompt(['- x']), prompts.subagentDecisionPrompt('warn x', true, 'Keith')];
  for (const text of texts) {
    assert.doesNotMatch(text, /Reply `(noted|ok)`/);
    assert.ok(text.includes(prompts.NO_REPLY));
  }
});
