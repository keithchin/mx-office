// The performance guard's big-data fixture (scripts/perf/fixture.ts) has to be data the office really
// reads: generated small here, then loaded through the office's own loaders (the roster file, the chatter,
// the budget store, the incidents, the audit log, the analysis runs, the queue, workers.json and
// floors.json), none of which may drop a row as malformed. It must come out the same for the same seed,
// and hold nothing from anyone's real office.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateFixture, MAIN_FLOOR, SMALL_FLOOR, type Fixture } from '../scripts/perf/fixture.js';
import { RosterFile } from '../src/server/roster/store.js';
import { ChatterFile } from '../src/server/chatter/store.js';
import { BudgetStore } from '../src/server/budget/store.js';
import { IncidentStore } from '../src/server/incidents/store.js';
import { AuditLog } from '../src/server/audit/log.js';
import { RunStore } from '../src/server/analysis/store.js';
import { TaskQueue, type QueueEvents, type QueueWorkers } from '../src/server/queue.js';
import { restoreWorkers } from '../src/server/workers/persist.js';
import { Building } from '../src/server/building.js';
import { TranscriptReader } from '../src/server/convo/transcript.js';
import type { Worker } from '../src/server/workers/types.js';

const root = path.join(os.tmpdir(), `test-offices-perf-fixture-${process.pid}`);
after(() => rmSync(root, { recursive: true, force: true }));

const lines = (file: string) => readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length;
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

let fx: Fixture;
test('generates a small office', async () => {
  fx = await generateFixture({ out: path.join(root, 'a'), seed: 7, scale: 1 });
  assert.equal(fx.mainFloor, MAIN_FLOOR);
  assert.deepEqual(fx.floors.map((f) => f.id), [MAIN_FLOOR, SMALL_FLOOR]);
  assert.equal(fx.liveWorkerIds.length, 6);
});

test('floors.json loads through the Building, every floor in it', () => {
  const b = new Building(fx.dataDir, path.join(root, 'projects'));
  assert.deepEqual(b.list().map((f) => f.id), [MAIN_FLOOR, SMALL_FLOOR]);
  for (const f of b.list()) assert.equal(statSync(path.join(f.dir, '.git')).isDirectory(), true, `${f.id} is a git repo`);
});

test('the roster file loads whole: nothing dropped, nothing renamed, nothing saved again', () => {
  const file = path.join(fx.dataDir, 'roster', `${MAIN_FLOOR}.json`);
  const raw = readJson(file);
  const before = readFileSync(file, 'utf8');
  const d = new RosterFile(path.join(fx.dataDir, 'roster'), MAIN_FLOOR).data;
  for (const k of ['standups', 'proposals', 'escalations', 'subagentActions', 'subagentRuns', 'held'] as const) assert.equal(d[k].length, raw[k].length, k);
  assert.ok(d.escalations.length > 0 && d.escalations.some((e) => e.status === 'open') && d.escalations.some((e) => e.resolution));
  assert.equal(Object.keys(d.subagents).length, Object.keys(raw.subagents).length);
  for (const [k, rec] of Object.entries(d.subagents)) assert.equal(rec.runs.length, raw.subagents[k].runs.length, `${k} runs`);
  assert.deepEqual(d.subagentNames, raw.subagentNames);
  assert.equal(d.outbox.escalations.length, raw.outbox.escalations.length);
  assert.equal(d.settings.jeff.waiting, 'off', "Jeff stays off: he'd ask a real model");
  const active = Object.values(d.members).filter((m) => m.phase === 'active');
  assert.equal(active.length, 5);
  assert.equal(readFileSync(file, 'utf8'), before, 'loading it changed nothing');
});

test('the chatter, the budget, the incidents, the audit log and the analysis runs load every row', () => {
  const chat = path.join(fx.dataDir, 'chatter', `${MAIN_FLOOR}.jsonl`);
  assert.equal(new ChatterFile(fx.dataDir, MAIN_FLOOR, Infinity).messages().length, lines(chat));
  assert.equal(new ChatterFile(fx.dataDir, MAIN_FLOOR).messages().length, 1000, 'the office keeps its newest 1000');

  const budget = new BudgetStore(fx.dataDir);
  const saved = readJson(path.join(fx.dataDir, 'budget', `${MAIN_FLOOR}.json`));
  const f = budget.floor(MAIN_FLOOR);
  assert.equal(f.ledger.rows.length, saved.ledger.rows.length);
  assert.ok(f.ledger.rows.length > 100, 'hundreds of ledger rows');
  assert.equal(Object.keys(f.ledger.days).length, 60);
  assert.ok(f.settings.total! > Object.values(f.ledger.days).reduce((s, x) => s + x.cost, 0), 'under budget: never paused by it');
  assert.equal(budget.office().fx.currency, 'SGD');

  const inc = new IncidentStore(path.join(fx.dataDir, 'incidents'));
  assert.equal(inc.list().length, fx.counts.incidents);
  assert.equal(inc.verify().ok, true, 'the incidents chain verifies');

  const log = new AuditLog(path.join(fx.dataDir, 'audit'));
  for (const key of [MAIN_FLOOR, SMALL_FLOOR, '_office']) {
    assert.equal(log.events(key).length, lines(path.join(fx.dataDir, 'audit', `${key}.jsonl`)), `${key} events`);
    assert.equal(log.verify(key).ok, true, `${key}'s audit chain verifies`);
  }
  assert.equal(log.events(MAIN_FLOOR).length, fx.counts.audit);

  const runs = new RunStore(fx.dataDir).all();
  assert.equal(runs.length, lines(path.join(fx.dataDir, 'analysis', 'runs.jsonl')));
  assert.ok(runs.some((r) => r.floor === SMALL_FLOOR));
});

test("workers.json and queue.json load: every worker at its desk, the live ones cut off mid-turn, the queue paused", () => {
  const main = fx.floors[0].dir;
  const file = path.join(main, '.agent-office', 'workers.json');
  const workers = new Map<string, Worker>();
  restoreWorkers(file, workers, 'claude', () => false);
  assert.equal(workers.size, readJson(file).length);
  const live = [...workers.values()].filter((w) => w.interrupted);
  assert.deepEqual(live.map((w) => w.info.id).sort(), [...fx.liveWorkerIds].sort());
  for (const w of live) assert.ok(w.info.sessionId && w.info.kind === 'agent' && !w.info.worktree, 'carries on its session, in the checkout');
  assert.ok([...workers.values()].every((w) => (w.info.usage?.cost ?? 0) > 0), 'each shows what it spent');
  for (const id of fx.liveWorkerIds) {
    const r = new TranscriptReader();
    r.feed(readFileSync(fx.transcripts[id], 'utf8'));
    assert.ok(r.messages.some((m) => m.kind === 'agent') && r.messages.some((m) => m.kind === 'tool' && m.status === 'ok'), 'its transcript reads as a conversation');
  }

  const fakeWorkers: QueueWorkers = { defaultProvider: 'claude', list: () => [], deskOccupied: () => false, spawn: () => 'no', kill: async () => ({}) };
  const events: QueueEvents = { update() {}, toast() {}, claimIssue: async () => undefined, refreshGitHub() {}, hiringPaused: () => undefined, emptied() {} };
  const q = new TaskQueue(path.join(main, '.agent-office'), fakeWorkers, false, events, { reconcileMs: 60_000 });
  try {
    const st = q.state();
    assert.equal(st.tasks.length, readJson(path.join(main, '.agent-office', 'queue.json')).tasks.length);
    assert.equal(st.maxWorkers, 0, 'paused: nothing is hired by itself');
    for (const s of ['queued', 'running', 'done'] as const) assert.ok(st.tasks.some((t) => t.status === s), `has ${s} tasks`);
  } finally {
    q.shutdown();
  }
});

test('the same seed gives the same bytes; another seed does not', async () => {
  const b = await generateFixture({ out: path.join(root, 'b'), seed: 7, scale: 1 });
  const c = await generateFixture({ out: path.join(root, 'c'), seed: 8, scale: 1 });
  for (const rel of [['roster', `${MAIN_FLOOR}.json`], ['chatter', `${MAIN_FLOOR}.jsonl`], ['audit', `${MAIN_FLOOR}.jsonl`], ['budget', `${MAIN_FLOOR}.json`], ['incidents', 'incidents.jsonl']]) {
    assert.equal(readFileSync(path.join(b.dataDir, ...rel), 'utf8'), readFileSync(path.join(fx.dataDir, ...rel), 'utf8'), rel.join('/'));
  }
  // workers.json names where its transcripts are, inside the fixture's own folder: the same but for that.
  const own = (fix: Fixture, file: string) => readFileSync(file, 'utf8').split(JSON.stringify(path.dirname(fix.officeDir)).slice(1, -1)).join('<out>');
  assert.equal(own(b, path.join(b.floors[0].dir, '.agent-office', 'workers.json')), own(fx, path.join(fx.floors[0].dir, '.agent-office', 'workers.json')));
  assert.equal(readFileSync(b.transcripts[b.liveWorkerIds[0]], 'utf8').split(b.floors[0].dir.replaceAll('\\', '/')).join('<out>'), readFileSync(fx.transcripts[fx.liveWorkerIds[0]], 'utf8').split(fx.floors[0].dir.replaceAll('\\', '/')).join('<out>'));
  assert.notEqual(readFileSync(path.join(c.dataDir, 'roster', `${MAIN_FLOOR}.json`), 'utf8'), readFileSync(path.join(fx.dataDir, 'roster', `${MAIN_FLOOR}.json`), 'utf8'));
});

test('nothing in it comes from a real office', () => {
  const bad = /mx-spike|travel-approval|z00556et|siemens|keithchin|AI-Taskforce/i;
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  // The fixture's own folder (in the temp dir, under the user's profile) is the one real thing allowed.
  const own = [root, root.replaceAll('\\', '/'), JSON.stringify(root).slice(1, -1)];
  for (const file of walk(path.join(root, 'a'))) {
    let text = readFileSync(file, 'utf8');
    for (const p of own) text = text.split(p).join('<root>');
    assert.equal(bad.test(text), false, `${path.relative(root, file)} names something real`);
  }
});
