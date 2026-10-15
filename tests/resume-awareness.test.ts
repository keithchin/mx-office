// After a pause and a resume, nobody goes on believing "the project is paused" (roster/awareness.ts):
// every resume tells whoever covers Management (and nobody else), an agent that slept through the
// pause hears once that it's over with its next message, and the Project Manager's questions to the
// Coordinator carry the real run state. A fake floor, a fake clock and the real workflow engine in a
// temp folder: no Claude sessions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { Escalation } from '../src/shared/roster/escalation.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { FlowEngine } from '../src/server/flow/engine.js';
import { FileStore } from '../src/server/flow/store.js';
import { ProjectRuns } from '../src/server/project-run/index.js';
import { okProbe } from '../src/server/project-run/safety.js';
import { lastResume, noteResumed, noteSlept, resumeOwed, setProjectPause, useProjectRunFile } from '../src/server/project-run/store.js';
import type { RunFloor } from '../src/server/project-run/types.js';
import { noteWorkerStatus, turnsStarted } from '../src/server/project-run/turns.js';
import { coordinatorNote, resumedNote, resumeWhy, whenIn } from '../src/server/roster/awareness.js';
import { TranscriptReader } from '../src/server/convo/transcript.js';

// Sat 10 Oct 2026, 13:20 in Singapore (the default standup time zone).
const SAT_1320 = Date.UTC(2026, 9, 10, 5, 20);
const SEC = 1000;

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'travel-approval';
  dir = mkdtempSync(path.join(os.tmpdir(), 'aware-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string; by?: string }[] = [];
  wakes: { id: string; text?: string; by?: string }[] = [];
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
    this.map.delete(id);
  }
  prompt(id: string, text: string, by?: string) {
    const w = this.map.get(id);
    if (!w || w.status === 'exited' || w.status === 'offline') return 'Worker is not running';
    this.prompts.push({ id, text, by });
    return undefined;
  }
  wake(id: string, text?: string, by?: string) {
    if (!this.map.has(id)) return 'No such worker';
    this.wakes.push({ id, text, by });
    this.set(id, 'starting', { startedAt: this.clock.now } as Partial<WorkerInfo>);
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => undefined;
  changed = () => undefined;
  set(id: string, status: WorkerStatus, patch: Partial<WorkerInfo> = {}) {
    const w = this.map.get(id)!;
    Object.assign(w, { status, ...patch });
    noteWorkerStatus(w);
    this.roster.onWorker(this, w);
  }
  /** Everything typed into or woken with `id`, in order. */
  said = (id: string) => [...this.wakes.filter((x) => x.id === id).map((x) => x.text ?? ''), ...this.prompts.filter((x) => x.id === id).map((x) => x.text)];
}

function world() {
  useProjectRunFile(undefined);
  const clock = { now: SAT_1320 };
  const floor = new FakeFloor();
  floor.clock = clock;
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'aware-data-')), floors: () => [floor], makeIssue: async () => ({ number: 1, url: 'u' }), analysis: () => '', now: () => clock.now }, 0);
  floor.roster = roster;
  const run: RunFloor = {
    team: floor,
    base: 'main',
    pulls: () => [],
    issues: () => [],
    cutOff: () => false,
    sleep: (id) => (floor.set(id, 'exited'), undefined),
    studioOpen: () => false,
    chatter: () => [],
    probe: async () => okProbe(),
    merges: async () => [],
  };
  const sleep = async (ms: number, signal: AbortSignal) => {
    if (signal.aborted) throw new Error('cancelled');
    clock.now += ms;
    // A woken session comes up 10 s after its wake.
    for (const x of floor.workers()) if (x.status === 'starting' && clock.now - ((x as { startedAt?: number }).startedAt ?? 0) >= 10 * SEC) floor.set(x.id, 'idle');
    await new Promise((r) => setImmediate(r));
  };
  const runs = new ProjectRuns({ roster, engine: new FlowEngine({ store: new FileStore(mkdtempSync(path.join(os.tmpdir(), 'aware-flows-'))), now: () => clock.now }), floor: (id) => (id === floor.id ? run : undefined), now: () => clock.now, sleep, pollMs: 1000, bootMs: 5 * 60 * SEC, turnsStarted });
  return { floor, roster, clock, runs };
}

type World = ReturnType<typeof world>;
type Role = 'pm' | 'lead-developer' | 'lead-tester' | 'lead-designer';

/** Hires the roles, all idle (awake between turns); their worker ids by role. */
async function team(w: World, roles: Role[]) {
  const ids = {} as Record<Role, string>;
  for (const r of roles) {
    assert.equal(await w.roster.members.hire(w.floor, r, 'Keith'), undefined);
    ids[r] = w.roster.data(w.floor.id).members[r].workerId!;
    w.floor.set(ids[r], 'idle', { sessionId: `s-${r}` });
  }
  return ids;
}

async function until(cond: () => boolean, label: string, n = 4000) {
  for (let i = 0; i < n && !cond(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(cond(), label);
}

/** Pauses the floor and lets every handoff turn run, till everyone's asleep. */
async function pauseAll(w: World, why: 'person' | 'restart' | 'budget' = 'person') {
  assert.ok(typeof w.runs.pause(w.floor.id, why === 'person' ? 'Keith' : 'The office', undefined, why) !== 'string');
  for (let i = 0; i < 50 && w.runs.latest(w.floor.id)?.status !== 'done'; i++) {
    for (const x of w.floor.workers()) if (x.status === 'idle' && w.floor.prompts.some((p) => p.id === x.id && /pausing the project/.test(p.text))) (w.floor.set(x.id, 'working'), w.floor.set(x.id, 'done'));
    await new Promise((r) => setImmediate(r));
  }
  await until(() => w.runs.latest(w.floor.id)?.status === 'done', 'the pause finishes');
  w.floor.prompts.length = 0;
  // A minute on: the resume is the floor's newest run.
  w.clock.now += 60 * SEC;
}

const owedAnswer = (role: string, workerId: string, at: number): Escalation =>
  ({ id: `e${Math.random()}`, title: `Q ${role}`, details: '', urgency: 'normal', fyi: false, status: 'resolved', by: 'x', role, workerId, at, resolution: { verdict: 'approve', text: 'go', by: 'Keith', at } }) as unknown as Escalation;

const NOTE = /^Note from the office: the project was resumed on Sat 10 Oct \d\d:\d\d — you're running; carry on with /;

// ---- Pure parts ---------------------------------------------------------------------------------

test('the notes as they read', () => {
  assert.equal(whenIn(SAT_1320, 'Asia/Singapore'), 'Sat 10 Oct 13:20');
  assert.equal(resumedNote('Sat 10 Oct 13:20', 'work on GitHub issue #4 (Login).'), "Note from the office: the project was resumed on Sat 10 Oct 13:20 — you're running; carry on with work on GitHub issue #4 (Login).");
  assert.equal(resumedNote('Sat 10 Oct 13:20', undefined), "Note from the office: the project was resumed on Sat 10 Oct 13:20 — you're running; carry on with your work.");
  assert.equal(
    coordinatorNote({ when: 'Sat 10 Oct 13:20', why: 'after a safe restart', awake: ['Sophie (Lead Developer)'], asleep: ['Max (Lead Tester)'] }),
    'The project resumed at Sat 10 Oct 13:20 (after a safe restart). Awake now: Sophie (Lead Developer). Asleep: Max (Lead Tester). Re-plan: hand out next steps to the Leads you need (wake them with office-workers / your tools), or tell the Project Manager what needs them.',
  );
  assert.equal(resumeWhy('after a safe restart', undefined, 'Keith'), 'after a safe restart');
  assert.equal(resumeWhy('the budget was raised or resumed', undefined, 'Keith'), 'after the budget was raised or resumed');
  assert.equal(resumeWhy(undefined, { why: 'person', by: 'Ada' }, 'Keith'), 'after a pause by Ada');
  assert.equal(resumeWhy(undefined, undefined, 'Keith'), 'Keith pressed ▶ Resume project');
});

test('the store: a pause marks who slept through it, a resume owes each of them the note once, a new pause takes it back', () => {
  useProjectRunFile(undefined);
  noteSlept('fl', ['a', 'b']);
  assert.equal(resumeOwed('fl', 'a'), undefined, 'nothing owed before the resume');
  noteResumed('fl', { at: 1, why: 'after a safe restart', by: 'K' });
  assert.deepEqual(lastResume('fl')?.owed, ['a', 'b']);
  assert.ok(resumeOwed('fl', 'a'));
  // Paused again before b heard: b carries into the next pause; nothing is owed while paused.
  noteSlept('fl', ['c']);
  setProjectPause('fl', { by: 'K', at: 2, why: 'person', waiting: [] });
  assert.equal(resumeOwed('fl', 'b'), undefined);
  setProjectPause('fl', undefined);
  noteResumed('fl', { at: 3, why: 'after a pause by K', by: 'K' });
  assert.deepEqual([...(lastResume('fl')?.owed ?? [])].sort(), ['a', 'b', 'c']);
});

// ---- Against a fake floor ----------------------------------------------------------------------

test('after a safe restart the resume wakes the Leads with work, then tells the Coordinator (and no other Lead) who is awake, to re-plan', async () => {
  const w = world();
  const ids = await team(w, ['pm', 'lead-developer', 'lead-tester', 'lead-designer']);
  await pauseAll(w, 'restart');
  // Only the developer has work waiting (an answer owed): the resume wakes it alone.
  w.roster.data(w.floor.id).escalations.push(owedAnswer('lead-developer', ids['lead-developer'], w.clock.now));
  const r = await w.runs.resume(w.floor.id, { mode: 'work' }, 'Keith', undefined, 'after a safe restart');
  assert.ok(typeof r !== 'string');
  await until(() => w.runs.latest(w.floor.id)?.status === 'done', 'the resume finishes');
  assert.deepEqual(w.floor.wakes.map((x) => x.id), [ids['lead-developer'], ids.pm], 'the developer for its work, then the Coordinator for the note');
  const names = (r: Role) => w.roster.data(w.floor.id).members[r].name;
  const note = w.floor.wakes[1].text ?? '';
  assert.match(note, /^The project resumed at Sat 10 Oct \d\d:\d\d \(after a safe restart\)\. Awake now: /);
  assert.ok(note.includes(`Awake now: ${names('lead-developer')} (Lead Developer). Asleep: `), note);
  assert.ok(note.includes(`${names('lead-tester')} (Lead Tester)`) && note.includes(`${names('lead-designer')} (Lead Designer)`), note);
  assert.match(note, /Re-plan: hand out next steps to the Leads you need \(wake them with office-workers \/ your tools\), or tell the Project Manager what needs them\.$/);
  assert.doesNotMatch(note, /Note from the office/, 'no once-only note on top of it');
  assert.ok(!w.floor.wakes.some((x) => x.id === ids['lead-tester'] || x.id === ids['lead-designer']), 'the other Leads sleep on: the Coordinator decides');
  // The developer's resume brief said it resumed: it never gets the once-only note.
  w.floor.set(ids['lead-developer'], 'idle');
  assert.equal(w.roster.delivery.send(w.floor, w.floor.worker(ids['lead-developer'])!, 'Please pick up issue #4 next, the login page.', { origin: 'agent', by: 'Ada' }).status, 'sent');
  assert.doesNotMatch(w.floor.prompts.at(-1)!.text, /Note from the office/);
});

test('a Lead that slept through the pause hears once, with its next message, that the project was resumed; held messages too', async () => {
  const w = world();
  const ids = await team(w, ['pm', 'lead-developer', 'lead-tester']);
  w.roster.tasks.assign(w.floor, ids['lead-tester'], 'Work on GitHub issue #7 (e2e tests for travel requests)', 'Keith');
  await pauseAll(w);
  assert.ok(typeof (await w.runs.resume(w.floor.id, { mode: 'work' }, 'Keith')) !== 'string');
  await until(() => w.runs.latest(w.floor.id)?.status === 'done', 'the resume finishes');
  // The Coordinator wakes the tester with office-workers tell.
  const tester = w.floor.worker(ids['lead-tester'])!;
  assert.equal(w.roster.delivery.send(w.floor, tester, 'Max: please re-run the e2e suite against main.', { origin: 'agent', by: 'Ada', wake: true }).status, 'woke');
  const first = w.floor.wakes.at(-1)!;
  assert.equal(first.id, ids['lead-tester']);
  assert.match(first.text ?? '', NOTE);
  assert.match(first.text ?? '', /carry on with Work on GitHub issue #7 \(e2e tests for travel requests\)\.\n\nMax: please re-run/);
  // Said once: its next message has no note.
  w.floor.set(ids['lead-tester'], 'idle');
  w.roster.delivery.send(w.floor, tester, 'And post the results in the team chatter.', { origin: 'agent', by: 'Ada' });
  assert.doesNotMatch(w.floor.prompts.at(-1)!.text, /Note from the office/);
  // The developer, mid-turn when a message comes: it's held, and the note goes in with it at the turn's end.
  const dev = w.floor.worker(ids['lead-developer'])!;
  w.floor.wake(dev.id);
  w.floor.set(dev.id, 'working');
  assert.equal(w.roster.delivery.send(w.floor, dev, 'A standup is due when you are done.', { origin: 'office' }).status, 'held');
  w.floor.set(dev.id, 'done');
  assert.match(w.floor.prompts.at(-1)!.text, NOTE);
  assert.match(w.floor.prompts.at(-1)!.text, /A standup is due/);
});

test('the Coordinator woken by the resume for its own work hears the note in its brief: one message', async () => {
  const w = world();
  const ids = await team(w, ['pm', 'lead-developer']);
  await pauseAll(w);
  w.roster.data(w.floor.id).escalations.push(owedAnswer('pm', ids.pm, w.clock.now));
  assert.ok(typeof (await w.runs.resume(w.floor.id, { mode: 'work' }, 'Keith')) !== 'string');
  await until(() => w.runs.latest(w.floor.id)?.status === 'done', 'the resume finishes');
  assert.deepEqual(w.floor.wakes.map((x) => x.id), [ids.pm]);
  assert.match(w.floor.wakes[0].text ?? '', /Keith resumed the project[\s\S]*The project resumed at Sat 10 Oct \d\d:\d\d \(after a pause by Keith\)\. Awake now: nobody\. Asleep: .*\(Lead Developer\)\. Re-plan/);
  assert.equal(w.floor.prompts.length, 0, 'no second message');
});

test('a busy Coordinator hears the note when its turn ends, never mid-turn', async () => {
  const w = world();
  const ids = await team(w, ['pm', 'lead-developer']);
  await pauseAll(w);
  // A person woke the Coordinator during the pause; it's mid-turn when the resume comes.
  w.floor.wake(ids.pm);
  w.floor.set(ids.pm, 'working');
  w.floor.wakes.length = 0;
  assert.ok(typeof (await w.runs.resume(w.floor.id, { mode: 'work' }, 'Keith')) !== 'string');
  await until(() => w.runs.latest(w.floor.id)?.status === 'done', 'the resume finishes');
  assert.equal(w.floor.prompts.length + w.floor.wakes.length, 0, 'nothing typed into its turn');
  w.floor.set(ids.pm, 'done');
  assert.match(w.floor.prompts.at(-1)!.text, /^The project resumed at .* \(after a pause by Keith\)\. Awake now: nobody\. Asleep: /);
});

test('the budget auto-pause and its resume: the note says why, and the facts say Budget-paused while it lasts', async () => {
  const w = world();
  const ids = await team(w, ['pm', 'lead-developer']);
  await pauseAll(w, 'budget');
  const pm = w.floor.worker(ids.pm)!;
  assert.match(w.roster.awareness.facts(w.floor, pm.id), /Project: Budget-paused since Sat 10 Oct \d\d:\d\d \(its budget is reached\)\./);
  assert.ok(typeof (await w.runs.resume(w.floor.id, { mode: 'work' }, 'Keith', undefined, 'the budget was raised or resumed')) !== 'string');
  await until(() => w.runs.latest(w.floor.id)?.status === 'done', 'the resume finishes');
  assert.match(w.floor.wakes.at(-1)!.text ?? '', /^The project resumed at .* \(after the budget was raised or resumed\)\./);
  assert.equal(w.floor.wakes.at(-1)!.id, ids.pm);
});

test("the Project Manager's quick questions carry the run state: Running with the last resume, Paused by whom, who's where", async () => {
  const w = world();
  const ids = await team(w, ['pm', 'lead-developer', 'lead-tester']);
  const dev = w.roster.data(w.floor.id).members['lead-developer'].name;
  await pauseAll(w);
  // Paused: a person's question still goes in (it wakes the Coordinator), and says so.
  const STATUS = "Give me a short status update on the project: what's done, what's in progress and who's on it, and anything that needs me.";
  assert.equal(await w.roster.interrupts.tell(w.floor, STATUS, 'Keith', 'now'), undefined);
  const asked = w.floor.wakes.at(-1)!;
  assert.equal(asked.id, ids.pm);
  assert.match(asked.text ?? '', /^\[Office facts, Sat 10 Oct \d\d:\d\d\] Project: Paused by Keith since Sat 10 Oct \d\d:\d\d\. Agents working: .*\(you\)/);
  // The question, then its durable dispatch's marker line (server/dispatch/).
  assert.ok((asked.text ?? '').includes(`\n\n${STATUS}\n\n[office answer dsp_`));
  assert.match(asked.text ?? '', / · TELL-lead rev \d+\]$/);
  assert.match(asked.text ?? '', new RegExp(`asleep: [^.]*${dev} \\(Lead Developer\\)`));
  // Resumed: Running, since when and why. The Coordinator is idle; the developer is at work.
  w.floor.set(ids.pm, 'idle');
  assert.ok(typeof (await w.runs.resume(w.floor.id, { mode: 'all' }, 'Keith')) !== 'string');
  await until(() => w.runs.latest(w.floor.id)?.status === 'done', 'the resume finishes');
  w.floor.set(ids['lead-developer'], 'working');
  w.floor.set(ids.pm, 'idle');
  w.floor.prompts.length = 0;
  assert.equal(await w.roster.interrupts.tell(w.floor, "What's blocking the team right now?", 'Keith', 'now'), undefined);
  const text = w.floor.prompts.at(-1)!.text;
  assert.match(text, /^\[Office facts, [^\]]+\] Project: Running \(last resumed Sat 10 Oct \d\d:\d\d, after a pause by Keith\)\. Agents working: /);
  assert.ok(text.includes(`working: ${dev} (Lead Developer)`), text);
  assert.doesNotMatch(text, /Paused/);
  // The console's own prompts (ws worker.prompt) get the same, only for whoever covers Management.
  const pm = w.floor.worker(ids.pm)!;
  assert.match(w.roster.awareness.dress(w.floor, pm, 'Status?').text, /^\[Office facts, [^\]]+\] Project: Running[\s\S]*\n\nStatus\?$/);
  assert.equal(w.roster.awareness.dress(w.floor, w.floor.worker(ids['lead-developer'])!, 'Status?').text, 'Status?');
});

test("the console's chat shows what the Project Manager typed, not the office's notes before it", () => {
  const r = new TranscriptReader();
  const line = (text: string) => `${JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: text } })}\n`;
  const [m] = r.feed(line("[Office facts, Sat 10 Oct 13:20] Project: Running. Agents working: nobody.\n\nGive me a short status update"));
  assert.equal(m.kind === 'user' && m.text, 'Give me a short status update');
  const r2 = new TranscriptReader();
  const [n] = r2.feed(line("Note from the office: the project was resumed on Sat 10 Oct 13:20 — you're running; carry on with your work.\n\nHi"));
  assert.equal(n.kind === 'user' && n.text, 'Hi');
});
