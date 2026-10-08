// Why an agent between turns still holds up a safe restart or a pause: its background helper (a subagent
// sent to run in the background) is still at work (server/restart/helpers.ts). Katherine's turn ended,
// her architect-agent ran on for 18 minutes, and the restart panel only said "handing off".
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { LiveRun } from '../src/shared/roster/subagent-live.js';
import { betweenTurns, helperFromFiles, helperFromRuns, helperNote, helpersOf, HELPER_FRESH_MS } from '../src/server/restart/helpers.js';
import { FlowEngine } from '../src/server/flow/engine.js';
import { FileStore } from '../src/server/flow/store.js';
import { ProjectRuns } from '../src/server/project-run/index.js';
import { PAUSE_FLOW } from '../src/server/project-run/flows.js';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 8, 22, 0);
const worker = (id: string, name: string, status: WorkerInfo['status']) => ({ id, name, status, kind: 'agent' }) as WorkerInfo;
const run = (o: Partial<LiveRun>): LiveRun => ({ id: 'r1', lead: 'lead-designer', workerId: 'w-kat', name: 'architect-agent', status: 'working', background: true, startedAt: NOW - 18 * MIN, seenAt: NOW, source: 'hooks', ...o }) as LiveRun;

test('the note says what helper and for how long', () => {
  assert.equal(helperNote({ agent: 'architect-agent', since: NOW - 18 * MIN }, NOW), 'background helper running (architect-agent, 18 min)');
  assert.equal(helperNote({ agent: 'subagent' }, NOW), 'background helper running (subagent)');
});

test("the roster's live runs: a background run still working, the newest; a foreground or finished one isn't a helper", () => {
  assert.deepEqual(helperFromRuns([run({})], 'w-kat'), { agent: 'architect-agent', since: NOW - 18 * MIN });
  assert.equal(helperFromRuns([run({ background: false })], 'w-kat'), undefined, 'a foreground call is the turn itself');
  assert.equal(helperFromRuns([run({ status: 'done' })], 'w-kat'), undefined);
  assert.equal(helperFromRuns([run({ workerId: 'w-other' })], 'w-kat'), undefined);
  assert.equal(helperFromRuns([run({ resumedAt: NOW - 2 * MIN })], 'w-kat')?.since, NOW - 2 * MIN, 'taken up again: from then');
});

test('the transcripts: a subagent file written to lately is a helper running, with its type from its meta file', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'helpers-'));
  try {
    const transcript = path.join(dir, 'sess.jsonl');
    writeFileSync(transcript, '{}\n');
    assert.equal(await helperFromFiles(transcript, Date.now()), undefined, 'no subagents');
    const subs = path.join(dir, 'sess', 'subagents');
    mkdirSync(subs, { recursive: true });
    writeFileSync(path.join(subs, 'agent-a1.jsonl'), '{}\n');
    writeFileSync(path.join(subs, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'architect-agent' }));
    const h = await helperFromFiles(transcript, Date.now());
    assert.equal(h?.agent, 'architect-agent');
    // Not written to for longer than HELPER_FRESH_MS: over (or stuck), not counted.
    const old = (Date.now() - HELPER_FRESH_MS - 5_000) / 1000;
    utimesSync(path.join(subs, 'agent-a1.jsonl'), old, old);
    assert.equal(await helperFromFiles(transcript, Date.now()), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only agents awake and between turns are looked at; the roster first, then the transcripts', async () => {
  assert.equal(betweenTurns(worker('a', 'A', 'idle')), true);
  assert.equal(betweenTurns(worker('a', 'A', 'working')), false, 'mid-turn is busy anyway');
  assert.equal(betweenTurns(worker('a', 'A', 'exited')), false, 'asleep: its helpers ended with its session');
  const asked: string[] = [];
  const found = await helpersOf(
    { runs: () => [run({})], transcript: (_f, w) => (asked.push(w.id), undefined) },
    [{ id: 'f', workers: [worker('w-kat', 'Katherine', 'done'), worker('w-dyl', 'Dylan', 'idle'), worker('w-ani', 'Anita', 'working')] }],
    NOW,
  );
  assert.deepEqual([...found.keys()], ['w-kat']);
  assert.deepEqual(asked, ['w-dyl'], "the roster knew Katherine's; Anita is mid-turn");
});

test("a pause's progress says why an agent it waits on is still busy", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'helpers-pause-'));
  try {
    const engine = new FlowEngine({ store: new FileStore(dir) });
    const runs = new ProjectRuns({ engine, floor: () => undefined, now: () => NOW, helperNote: (_f, id) => (id === 'w-kat' ? 'background helper running (architect-agent, 18 min)' : undefined) } as never);
    engine.create(PAUSE_FLOW, { floor: 'f', by: 'Keith', why: 'person', agents: [
      { workerId: 'w-kat', name: 'Katherine', action: 'pause', status: 'handoff' },
      { workerId: 'w-dyl', name: 'Dylan', action: 'pause', status: 'asleep' },
    ] }, { floor: 'f' });
    const agents = runs.view('f', true).run!.agents;
    assert.equal(agents[0].note, 'background helper running (architect-agent, 18 min)');
    assert.equal(agents[1].note, undefined, 'asleep: nothing to say');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
