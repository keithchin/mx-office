// The Leads' subagents as workers: their runs tracked live from the hooks (start, stop, failure,
// background launches, more than one run of a subagent at once), from the Lead's transcript when the
// hooks didn't say (shapes as Claude Code writes them, no real content), the floor's history bounded
// and kept across a restart, the cards the Workers tab draws (with who hired each), and where the 2D
// view seats them beside their Lead's desk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import { applyLive, expireLive, trimLive, type LiveSignal, type LiveWho } from '../src/server/roster/subagent-runs.js';
import { SubagentTranscript } from '../src/server/roster/subagent-transcript.js';
import { reviveLiveRuns } from '../src/server/roster/subagent-store.js';
import { LIVE_KEPT, LIVE_STALE_MS, type LiveRun } from '../src/shared/roster/subagent-live.js';
import { cardNow, floorHelpers, subagentCards } from '../src/shared/roster/subagent-cards.js';
import { chatting, CHAT_M, idleSpot, Walks, wayBetween, type LifeSpot } from '../src/client/pixel/helper-life.js';
import { breakAt } from '../src/client/pixel/breaks.js';
import { scoreSubagent } from '../src/shared/roster/subagents.js';
import { noteSubagentDispatch, noteSubagentHook, noteSubagentLifecycle, onSubagentEvent } from '../src/server/workers/subagents.js';
import { stoolSpot, STOOLS } from '../src/client/pixel/stools.js';
import { DESKS, DESK_SIZE, deskSeat } from '../src/shared/layout.js';

const T0 = Date.UTC(2026, 9, 6, 6, 0);
const who: LiveWho = { lead: 'lead-tester', workerId: 'w-hedy', source: 'hooks' };
const fromTranscript: LiveWho = { ...who, source: 'transcript' };

function feed(runs: LiveRun[], signals: LiveSignal[], w = who) {
  return signals.map((s) => applyLive(runs, w, s));
}

// ---- Run tracking from the hooks ------------------------------------------------------------------

test('a foreground run: dispatched, started, stopped and answered is one run, done, with its task and how long it took', () => {
  const runs: LiveRun[] = [];
  const changed = feed(runs, [
    { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'Run the e2e suite on #38', model: 'sonnet' },
    { kind: 'start', at: T0 + 500, agentId: 'a1', agent: 'tester' },
    { kind: 'stop', at: T0 + 90_000, agentId: 'a1', agent: 'tester' },
    { kind: 'result', at: T0 + 90_400, toolUseId: 'toolu_1', agent: 'tester', failed: false, durationMs: 89_800 },
  ]);
  assert.deepEqual(changed, [true, false, true, false], 'the start only links the agent id; the answer after the stop changes nothing');
  assert.equal(runs.length, 1);
  const [r] = runs;
  assert.equal(r.status, 'done');
  assert.equal(r.name, 'tester');
  assert.equal(r.task, 'Run the e2e suite on #38');
  assert.equal(r.model, 'sonnet');
  assert.equal(r.agentId, 'a1');
  assert.equal(r.durationMs, 90_000);
});

test("a run whose call failed is failed, even when its SubagentStop came first", () => {
  const runs: LiveRun[] = [];
  feed(runs, [
    { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'developer', task: 'Draft MDL' },
    { kind: 'start', at: T0 + 100, agentId: 'a1', agent: 'developer' },
    { kind: 'stop', at: T0 + 5000, agentId: 'a1', agent: 'developer' },
  ]);
  assert.equal(runs[0].status, 'done');
  assert.equal(applyLive(runs, who, { kind: 'result', at: T0 + 5100, toolUseId: 'toolu_1', failed: true }), true);
  assert.equal(runs[0].status, 'failed');
  // Straight to a failed answer, with no lifecycle hooks at all.
  const other: LiveRun[] = [];
  feed(other, [{ kind: 'dispatch', at: T0, toolUseId: 'toolu_2', agent: 'tester' }, { kind: 'result', at: T0 + 2000, toolUseId: 'toolu_2', failed: true }]);
  assert.equal(other[0].status, 'failed');
  assert.equal(other[0].durationMs, 2000);
});

test('two runs of the same subagent at once are two workers: each start and stop goes to its own run', () => {
  const runs: LiveRun[] = [];
  feed(runs, [
    { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'Specs for #55' },
    { kind: 'dispatch', at: T0 + 1000, toolUseId: 'toolu_2', agent: 'tester', task: 'Specs for #57' },
    { kind: 'start', at: T0 + 1100, agentId: 'a1', agent: 'tester' },
    { kind: 'start', at: T0 + 1200, agentId: 'a2', agent: 'tester' },
  ]);
  assert.deepEqual(runs.map((r) => [r.task, r.agentId, r.status]), [['Specs for #55', 'a1', 'working'], ['Specs for #57', 'a2', 'working']]);
  applyLive(runs, who, { kind: 'stop', at: T0 + 60_000, agentId: 'a2', agent: 'tester' });
  assert.deepEqual(runs.map((r) => r.status), ['working', 'done']);
  applyLive(runs, who, { kind: 'result', at: T0 + 60_100, toolUseId: 'toolu_2', failed: false });
  applyLive(runs, who, { kind: 'stop', at: T0 + 120_000, agentId: 'a1', agent: 'tester' });
  assert.deepEqual(runs.map((r) => r.status), ['done', 'done']);
  // Another Lead's run of the same name is its own.
  feed(runs, [{ kind: 'dispatch', at: T0, toolUseId: 'toolu_9', agent: 'tester' }], { ...who, workerId: 'w-other', lead: 'lead-developer' });
  applyLive(runs, who, { kind: 'stop', at: T0 + 130_000, agent: 'tester' });
  assert.equal(runs.find((r) => r.toolUseId === 'toolu_9')!.status, 'working');
});

test('a background run carries on after its call comes back, ends at its SubagentStop, and works again when resumed', () => {
  const runs: LiveRun[] = [];
  feed(runs, [
    { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'Fix the pickOwner flake' },
    { kind: 'launched', at: T0 + 3000, toolUseId: 'toolu_1', agentId: 'a42', model: 'claude-sonnet' },
  ]);
  assert.equal(runs[0].status, 'working');
  assert.equal(runs[0].background, true);
  assert.equal(runs[0].agentId, 'a42');
  assert.equal(applyLive(runs, who, { kind: 'start', at: T0 + 3100, agentId: 'a42', agent: 'tester' }), false);
  applyLive(runs, who, { kind: 'stop', at: T0 + 600_000, agentId: 'a42', agent: 'tester' });
  assert.equal(runs[0].status, 'done');
  assert.equal(runs[0].durationMs, 600_000);
  // A SendMessage to it later: at work again, timed from then.
  assert.equal(applyLive(runs, who, { kind: 'start', at: T0 + 4_000_000, agentId: 'a42', agent: 'tester' }), true);
  assert.equal(runs[0].status, 'working');
  applyLive(runs, who, { kind: 'stop', at: T0 + 4_003_000, agentId: 'a42', agent: 'tester' });
  assert.equal(runs[0].durationMs, 3000);
  assert.equal(runs.length, 1);
});

test('an answer with nothing before it (an older Claude Code) is a finished run of its own; one with no subagent named is general-purpose', () => {
  const runs: LiveRun[] = [];
  applyLive(runs, who, { kind: 'result', at: T0 + 10_000, agent: 'tester', task: 'Smoke test', failed: false, durationMs: 8000 });
  assert.deepEqual([runs[0].status, runs[0].startedAt, runs[0].durationMs], ['done', T0 + 2000, 8000]);
  applyLive(runs, who, { kind: 'dispatch', at: T0, toolUseId: 'toolu_x', task: 'Look around' });
  assert.equal(runs[1].name, 'general-purpose');
});

test('the hooks name a subagent run: dispatch, a background launch with its agent id, start and stop', () => {
  const seen: unknown[] = [];
  const off = onSubagentEvent((id, ev) => seen.push([id, ev.kind, (ev as { toolUseId?: string }).toolUseId, (ev as { async?: boolean }).async, (ev as { agentId?: string }).agentId]));
  try {
    assert.equal(noteSubagentDispatch('w', { tool_name: 'Read', tool_input: {} }), false);
    assert.equal(noteSubagentDispatch('w', { tool_name: 'Agent', tool_use_id: 'toolu_1', tool_input: { subagent_type: 'tester', description: 'Prove PR #46', prompt: '…' } }, T0), true);
    noteSubagentHook('w', { tool_name: 'Agent', tool_use_id: 'toolu_1', tool_input: { subagent_type: 'tester', description: 'Prove PR #46' }, tool_response: { isAsync: true, status: 'async_launched', agentId: 'a7d9', resolvedModel: 'claude-sonnet' } }, false, T0 + 3000);
    noteSubagentLifecycle('w', 'SubagentStop', { agent_id: 'a7d9', agent_type: 'tester' }, T0 + 9000);
  } finally {
    off();
  }
  assert.deepEqual(seen, [['w', 'dispatch', 'toolu_1', undefined, undefined], ['w', 'result', 'toolu_1', true, 'a7d9'], ['w', 'stop', undefined, undefined, 'a7d9']]);
});

// ---- History: bounded, lost runs, kept across a restart -------------------------------------------

test("the floor keeps its newest runs, never dropping one that's still working; a run not heard of for hours is lost", () => {
  const runs: LiveRun[] = [];
  applyLive(runs, who, { kind: 'dispatch', at: T0, toolUseId: 'toolu_old', agent: 'tester', task: 'still going' });
  for (let i = 1; i <= LIVE_KEPT + 10; i++) applyLive(runs, who, { kind: 'result', at: T0 + i * 1000, agent: 'tester', failed: false, durationMs: 500 });
  trimLive(runs);
  assert.equal(runs.length, LIVE_KEPT);
  assert.ok(runs.some((r) => r.toolUseId === 'toolu_old'), 'the working run stays');
  assert.equal(Math.min(...runs.filter((r) => r.status === 'done').map((r) => r.startedAt)), T0 + 12 * 1000 - 500, 'the 11 oldest finished ones went');
  assert.equal(expireLive(runs, T0 + LIVE_STALE_MS - 1), false);
  assert.equal(expireLive(runs, T0 + LIVE_STALE_MS), true);
  assert.equal(runs.find((r) => r.toolUseId === 'toolu_old')!.status, 'lost');
});

test('saved runs come back whole, a bad one dropped', () => {
  const back = reviveLiveRuns([{ id: 'toolu_1', lead: 'lead-tester', workerId: 'w1', name: 'tester', status: 'working', startedAt: T0, seenAt: T0, source: 'transcript', task: 'x', background: true }, { id: 'y', lead: 'nobody', workerId: 'w', name: 'tester', startedAt: 1 }, { id: 'z', lead: 'lead-tester', workerId: 'w', name: '../evil', startedAt: 1 }, 'junk']);
  assert.equal(back.length, 1);
  assert.deepEqual([back[0].status, back[0].source, back[0].background, back[0].task], ['working', 'transcript', true, 'x']);
  assert.deepEqual(reviveLiveRuns(undefined), []);
});

// ---- Through the roster, with a fake floor ----------------------------------------------------------

class FakeFloor implements TeamFloor {
  id = 'f1';
  name = 'Probe';
  dir = mkdtempSync(path.join(os.tmpdir(), 'subagents-floor-'));
  map = new Map<string, WorkerInfo>();
  file?: string;
  changes = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  hire = async () => 'no hiring here';
  async stop() {}
  prompt = () => undefined;
  wake = () => undefined;
  rename() {}
  cwdOf = () => this.dir;
  openPulls = () => [];
  toast() {}
  changed = () => void this.changes++;
  transcript = () => this.file;
}

function setup(dataDir = mkdtempSync(path.join(os.tmpdir(), 'subagents-data-'))) {
  const clock = { now: T0 };
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => clock.now }, 0);
  const d = roster.data(floor.id);
  floor.map.set('w-hedy', { id: 'w-hedy', kind: 'agent', provider: 'claude', deskId: 'desk-1', name: d.members['lead-tester'].name, color: '#fff', status: 'working', acked: true, createdBy: 'k', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo);
  d.members['lead-tester'] = { ...d.members['lead-tester'], name: 'Hedy', phase: 'active', workerId: 'w-hedy' };
  return { clock, floor, roster, dataDir, data: () => roster.data(floor.id), view: () => roster.view(floor, true) };
}

test("a Lead's background run from its hooks: working on the floor's view, then done, with one record run carrying its task", () => {
  const t = setup();
  const s = t.roster.subagents;
  s.onEvent(t.floor, 'w-hedy', { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'Update e2e specs for #19', background: false });
  s.onEvent(t.floor, 'w-hedy', { kind: 'result', at: T0 + 3000, toolUseId: 'toolu_1', agent: 'tester', task: 'Update e2e specs for #19', failed: false, background: false, async: true, agentId: 'a11d' });
  s.onEvent(t.floor, 'w-hedy', { kind: 'start', at: T0 + 3100, agentId: 'a11d', agent: 'tester' });
  let runs = t.view().subagentRuns!;
  assert.equal(runs.length, 1);
  assert.deepEqual([runs[0].status, runs[0].name, runs[0].task, runs[0].lead], ['working', 'tester', 'Update e2e specs for #19', 'lead-tester']);
  assert.ok(t.floor.changes > 0, 'the browsers were told');
  assert.equal(t.data().subagents['lead-tester/tester'], undefined, 'no record run for the launch itself');
  s.onEvent(t.floor, 'w-hedy', { kind: 'stop', at: T0 + 1_200_000, agentId: 'a11d', agent: 'tester' });
  runs = t.view().subagentRuns!;
  assert.equal(runs[0].status, 'done');
  const rec = t.data().subagents['lead-tester/tester'];
  assert.equal(rec.runs.length, 1);
  assert.equal(rec.runs[0].task, 'Update e2e specs for #19');
  // The Lead's verdict links back to the live run.
  t.clock.now = T0 + 1_300_000;
  s.review(t.floor, 'lead-tester', 'tester', 'accept', 'specs green twice');
  const v = t.view().subagentRuns![0];
  assert.deepEqual([v.outcome, v.note], ['accept', 'specs green twice']);
  // A worker that isn't a Lead: not the team's.
  s.onEvent(t.floor, 'w-nobody', { kind: 'dispatch', at: T0, toolUseId: 'toolu_z', agent: 'tester', background: false });
  assert.equal(t.view().subagentRuns!.length, 1);
});

test("a foreground run's SubagentStop and its answer are one record run, with its task, whichever way they pair", () => {
  const t = setup();
  const s = t.roster.subagents;
  s.onEvent(t.floor, 'w-hedy', { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'Smoke the approvals page', background: false });
  s.onEvent(t.floor, 'w-hedy', { kind: 'start', at: T0 + 100, agentId: 'a1', agent: 'tester' });
  s.onEvent(t.floor, 'w-hedy', { kind: 'stop', at: T0 + 30_000, agentId: 'a1', agent: 'tester' });
  s.onEvent(t.floor, 'w-hedy', { kind: 'result', at: T0 + 30_200, toolUseId: 'toolu_1', agent: 'tester', task: 'Smoke the approvals page', failed: true, background: false, durationMs: 29_900 });
  const rec = t.data().subagents['lead-tester/tester'];
  assert.equal(rec.runs.length, 1);
  assert.deepEqual([rec.runs[0].task, rec.runs[0].outcome], ['Smoke the approvals page', 'failed']);
  assert.equal(t.data().subagentRuns[0].status, 'failed');
});

test('the runs are kept in the roster file: a restarted office still has them', async () => {
  const t = setup();
  t.roster.subagents.onEvent(t.floor, 'w-hedy', { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'Phone-width e2e', background: false });
  t.roster.stop();
  const again = setup(t.dataDir);
  const runs = again.data().subagentRuns;
  assert.equal(runs.length, 1);
  assert.deepEqual([runs[0].task, runs[0].status], ['Phone-width e2e', 'working']);
});

// ---- From the transcript, when the hooks didn't say ---------------------------------------------------

const line = (o: object) => `${JSON.stringify(o)}\n`;
const iso = (ms: number) => new Date(ms).toISOString();
const use = (at: number, id: string, input: object) => line({ type: 'assistant', isSidechain: false, timestamp: iso(at), message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input }] } });
const launched = (at: number, id: string, agentId: string) =>
  line({ type: 'user', isSidechain: false, timestamp: iso(at), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'Async agent launched successfully.' }] }] }, toolUseResult: { isAsync: true, status: 'async_launched', agentId, description: 'd', resolvedModel: 'claude-sonnet', prompt: 'p', outputFile: 'x.output', canReadOutputFile: true } });
const notified = (at: number, id: string, agentId: string, status = 'completed') =>
  line({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(at), sessionId: 's', content: `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<output-file>x.output</output-file>\n<status>${status}</status>\n<summary>Agent "d" finished</summary>\n</task-notification>` });

test("the transcript's shapes: an Agent call, its background launch, its notification; a sidechain and other tools ignored", () => {
  const p = new SubagentTranscript();
  const text =
    use(T0, 'toolu_1', { subagent_type: 'tester', description: 'Run browser checklist on #38', prompt: 'long prompt' }) +
    line({ type: 'assistant', isSidechain: true, timestamp: iso(T0 + 10), message: { content: [{ type: 'tool_use', id: 'toolu_side', name: 'Agent', input: { subagent_type: 'x' } }] } }) +
    line({ type: 'assistant', timestamp: iso(T0 + 20), message: { content: [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'ls' } }] } }) +
    launched(T0 + 2000, 'toolu_1', 'a774') +
    line({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(T0 + 3000), content: '<task-notification>\n<task-id>b9pij</task-id>\n<tool-use-id>toolu_bash</tool-use-id>\n<status>completed</status>\n</task-notification>' });
  // Fed in two pieces, cut mid-line.
  const cut = text.length - 40;
  const sigs = [...p.feed(text.slice(0, cut)), ...p.feed(text.slice(cut) + notified(T0 + 60_000, 'toolu_1', 'a774'))];
  assert.deepEqual(sigs.map((s) => s.kind), ['dispatch', 'launched', 'notified', 'notified']);
  assert.deepEqual(sigs[0], { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'Run browser checklist on #38', model: undefined });
  assert.equal((sigs[1] as { agentId?: string }).agentId, 'a774');
  // A background Bash's notification names no run of ours: applying it changes nothing.
  const runs: LiveRun[] = [];
  assert.deepEqual(feed(runs, sigs, fromTranscript), [true, true, false, true]);
  assert.equal(runs[0].status, 'done');
  // A foreground call's answer in the transcript, failed.
  const q = new SubagentTranscript();
  const r = q.feed(use(T0, 'toolu_2', { subagent_type: 'developer', description: 'Draft' }) + line({ type: 'user', timestamp: iso(T0 + 5000), message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: 'denied' }] }, toolUseResult: 'Error: denied' }));
  assert.deepEqual(r.map((s) => s.kind), ['dispatch', 'result']);
  assert.equal((r[1] as { failed: boolean }).failed, true);
});

test('the transcript fills in what the hooks missed, and the same run from both is one run', () => {
  const t = setup();
  t.floor.file = path.join(t.floor.dir, 'session.jsonl');
  // The hooks saw the call go out; the office went down before its launch came back.
  t.roster.subagents.onEvent(t.floor, 'w-hedy', { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'Prove PR #46 spec', background: false });
  writeFileSync(t.floor.file, use(T0, 'toolu_1', { subagent_type: 'tester', description: 'Prove PR #46 spec' }) + launched(T0 + 3000, 'toolu_1', 'a7d9') + use(T0 + 4000, 'toolu_2', { subagent_type: 'tester', description: 'Admin role check on #30' }));
  t.clock.now = T0 + 10_000;
  assert.equal(t.roster.subagents.live.scan(t.floor), true);
  let runs = t.data().subagentRuns;
  assert.equal(runs.length, 2, 'one run per call');
  assert.deepEqual(runs.map((r) => [r.toolUseId, r.status, r.source]), [['toolu_1', 'working', 'hooks'], ['toolu_2', 'working', 'transcript']]);
  assert.equal(runs[0].agentId, 'a7d9');
  assert.equal(t.roster.subagents.live.scan(t.floor), false, 'nothing new, nothing changes');
  // The background run reports in: no hook does that.
  appendFileSync(t.floor.file, notified(T0 + 600_000, 'toolu_1', 'a7d9'));
  assert.equal(t.roster.subagents.live.scan(t.floor), true);
  runs = t.data().subagentRuns;
  assert.deepEqual(runs.map((r) => r.status), ['done', 'working']);
  // Old calls read off the end of a long transcript for the first time aren't brought back as working.
  const u = setup();
  u.floor.file = path.join(u.floor.dir, 'old.jsonl');
  writeFileSync(u.floor.file, use(T0 - LIVE_STALE_MS - 1000, 'toolu_old', { subagent_type: 'tester', description: 'ancient' }));
  u.roster.subagents.live.scan(u.floor);
  assert.equal(u.data().subagentRuns.length, 0);
});

test("the office's timer reads the transcripts off the event loop (scanSoon): the same runs as scan()", async () => {
  const t = setup();
  t.floor.file = path.join(t.floor.dir, 'session.jsonl');
  t.roster.subagents.onEvent(t.floor, 'w-hedy', { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'Prove PR #46 spec', background: false });
  writeFileSync(t.floor.file, use(T0, 'toolu_1', { subagent_type: 'tester', description: 'Prove PR #46 spec' }) + launched(T0 + 3000, 'toolu_1', 'a7d9') + use(T0 + 4000, 'toolu_2', { subagent_type: 'tester', description: 'Admin role check on #30' }));
  t.clock.now = T0 + 10_000;
  assert.equal(await t.roster.subagents.live.scanSoon(t.floor), true);
  assert.deepEqual(t.data().subagentRuns.map((r) => [r.toolUseId, r.status, r.source]), [['toolu_1', 'working', 'hooks'], ['toolu_2', 'working', 'transcript']]);
  assert.equal(await t.roster.subagents.live.scanSoon(t.floor), false, 'nothing new, nothing changes');
  appendFileSync(t.floor.file, notified(T0 + 600_000, 'toolu_1', 'a7d9'));
  assert.equal(await t.roster.subagents.live.scanSoon(t.floor), true);
  assert.deepEqual(t.data().subagentRuns.map((r) => r.status), ['done', 'working']);
});

// ---- The cards ----------------------------------------------------------------------------------------

test("cards: who hired each, at work on what, idle with its last run, benched; a Lead not hired shows only subagents that ran", () => {
  const t = setup();
  const s = t.roster.subagents;
  s.onEvent(t.floor, 'w-hedy', { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'Full e2e suite on main', background: false });
  s.onEvent(t.floor, 'w-hedy', { kind: 'dispatch', at: T0 + 1000, toolUseId: 'toolu_2', agent: 'Explore', task: 'Find the locators', background: false });
  const cards = subagentCards(t.view());
  const tester = cards.find((c) => c.key === 'lead-tester/tester')!;
  assert.equal(tester.hiredBy, 'Hedy (Lead Tester)');
  const nia = t.data().subagentNames['lead-tester/tester'];
  assert.ok(nia && /^[A-Z][a-z]+$/.test(nia), 'the tester has a first name');
  assert.equal(tester.firstName, nia);
  assert.equal(tester.tag, `${nia} (Hedy's tester)`);
  assert.equal(tester.label, `${nia} · Tester (Hedy's subagent)`);
  const exploreName = t.data().subagentNames['lead-tester/Explore'];
  assert.ok(exploreName && exploreName !== nia, 'one only seen at work is named too, and differently');
  assert.equal(tester.status, 'working');
  assert.equal(tester.leadWorkerId, 'w-hedy');
  assert.equal(tester.task, 'Full e2e suite on main');
  assert.match(cardNow(tester, T0 + 4 * 60_000), /^🔨 Full e2e suite on main · 4m$/);
  // One the office has only seen at work gets a card too.
  const explore = cards.find((c) => c.key === 'lead-tester/Explore')!;
  assert.deepEqual([explore.status, explore.defined, explore.runs], ['working', false, 1]);
  // Nobody's hired as Lead Developer: its subagent with no runs has no card.
  assert.equal(cards.some((c) => c.lead === 'lead-developer'), false);
  // In the team's order, each Lead's together.
  assert.deepEqual([...new Set(cards.map((c) => c.lead))], ['lead-tester']);
  assert.deepEqual(floorHelpers(cards).map((h) => [h.tag, h.leadWorkerId, h.team, h.state, h.runId]), [[`${exploreName} (Hedy's explore)`, 'w-hedy', 'testing', 'working', 'toolu_2'], [`${nia} (Hedy's tester)`, 'w-hedy', 'testing', 'working', 'toolu_1']].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

  s.onEvent(t.floor, 'w-hedy', { kind: 'result', at: T0 + 300_000, toolUseId: 'toolu_1', agent: 'tester', failed: false, background: false, durationMs: 300_000 });
  const idle = subagentCards(t.view()).find((c) => c.key === 'lead-tester/tester')!;
  assert.equal(idle.status, 'idle');
  assert.match(cardNow(idle, T0 + 2 * 3_600_000), /^💤 Idle · last run 2h ago: Full e2e suite on main$/);
  assert.equal(s.run(t.floor, 'lead-tester', 'bench', 'tester', { reason: 'flaky specs' }, 'Keith', 'pm'), undefined);
  const benched = subagentCards(t.view()).find((c) => c.key === 'lead-tester/tester')!;
  assert.deepEqual([benched.status, benched.state, benched.benchReason], ['benched', 'benched', 'flaky specs']);
});

test('never-run subagents: hidden unless asked for, shown while at work the first time or when benched; the 2D view has only those that have run', () => {
  const t = setup();
  const s = t.roster.subagents;
  // Hedy is hired: her tester has never run.
  assert.equal(subagentCards(t.view()).length, 0);
  assert.deepEqual(subagentCards(t.view(), { includeNeverRun: true }).map((c) => [c.key, c.runs]), [['lead-tester/tester', 0]]);
  assert.deepEqual(floorHelpers(subagentCards(t.view(), { includeNeverRun: true })), [], 'nobody in the 2D view that has never run');
  // At work for the first time: it shows, and sits on its stool.
  s.onEvent(t.floor, 'w-hedy', { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'First run', background: false });
  assert.deepEqual(subagentCards(t.view()).map((c) => [c.key, c.status]), [['lead-tester/tester', 'working']]);
  s.onEvent(t.floor, 'w-hedy', { kind: 'result', at: T0 + 60_000, toolUseId: 'toolu_1', agent: 'tester', failed: false, background: false });
  // Once it's run, it stays, idle about the office.
  assert.deepEqual(floorHelpers(subagentCards(t.view())).map((h) => [h.key, h.state, h.runId]), [['lead-tester/tester', 'idle', undefined]]);
  // A benched one that never ran shows all the same (somebody decided something about it), but not in the 2D view.
  const u = setup();
  assert.equal(u.roster.subagents.run(u.floor, 'lead-tester', 'bench', 'tester', { reason: 'not yet' }, 'Keith', 'pm'), undefined);
  assert.deepEqual(subagentCards(u.view()).map((c) => [c.key, c.status, c.runs]), [['lead-tester/tester', 'benched', 0]]);
  assert.deepEqual(floorHelpers(subagentCards(u.view())), []);
});

// ---- Runs only the transcript saw end count toward the record ------------------------------------------

test("a run only the transcript says is over is an unreviewed run of the record; the Lead's verdict lands on it, and nothing counts twice", () => {
  const t = setup();
  t.floor.file = path.join(t.floor.dir, 'session.jsonl');
  const s = t.roster.subagents;
  // The hooks saw it launched in the background; no hook says when it's done.
  s.onEvent(t.floor, 'w-hedy', { kind: 'dispatch', at: T0, toolUseId: 'toolu_1', agent: 'tester', task: 'Prove PR #46 spec', background: false });
  s.onEvent(t.floor, 'w-hedy', { kind: 'result', at: T0 + 3000, toolUseId: 'toolu_1', agent: 'tester', failed: false, background: false, async: true, agentId: 'a7d9' });
  writeFileSync(t.floor.file, use(T0, 'toolu_1', { subagent_type: 'tester', description: 'Prove PR #46 spec' }) + launched(T0 + 3000, 'toolu_1', 'a7d9') + notified(T0 + 600_000, 'toolu_1', 'a7d9'));
  t.clock.now = T0 + 610_000;
  t.roster.subagents.live.scan(t.floor);
  const rec = () => t.data().subagents['lead-tester/tester'];
  assert.equal(rec().runs.length, 1);
  assert.deepEqual([rec().runs[0].id, rec().runs[0].task, rec().runs[0].outcome, rec().runs[0].durationMs], ['a7d9', 'Prove PR #46 spec', 'pending', 600_000]);
  let card = subagentCards(t.view()).find((c) => c.key === 'lead-tester/tester')!;
  assert.deepEqual([card.runs, card.unreviewed, card.grade], [1, 1, undefined]);
  assert.equal(scoreSubagent(rec().runs, rec().runs[0].model).reviewed, 0, 'an unreviewed run is no part of the grade');
  assert.equal(t.view().subagentRuns![0].outcome, 'pending', 'its live run says unreviewed');
  // A late SubagentStop for the same run: the same run, not another.
  s.onEvent(t.floor, 'w-hedy', { kind: 'stop', at: T0 + 601_000, agentId: 'a7d9', agent: 'tester' });
  assert.equal(rec().runs.length, 1);
  // Scanning again changes nothing.
  t.roster.subagents.live.scan(t.floor);
  assert.equal(rec().runs.length, 1);
  // The verdict lands on that run.
  t.clock.now = T0 + 700_000;
  const r = s.review(t.floor, 'lead-tester', 'tester', 'accept', 'green twice');
  assert.notEqual(typeof r, 'string');
  assert.equal(rec().runs.length, 1);
  assert.deepEqual([rec().runs[0].outcome, rec().runs[0].note], ['accept', 'green twice']);
  card = subagentCards(t.view()).find((c) => c.key === 'lead-tester/tester')!;
  assert.equal(card.unreviewed, 0);

  // A run the hooks ended (and recorded) isn't recorded again when the transcript's notification comes.
  s.onEvent(t.floor, 'w-hedy', { kind: 'dispatch', at: T0 + 800_000, toolUseId: 'toolu_2', agent: 'tester', task: 'Second', background: false });
  s.onEvent(t.floor, 'w-hedy', { kind: 'result', at: T0 + 803_000, toolUseId: 'toolu_2', agent: 'tester', failed: false, background: false, async: true, agentId: 'b2' });
  s.onEvent(t.floor, 'w-hedy', { kind: 'start', at: T0 + 803_100, agentId: 'b2', agent: 'tester' });
  s.onEvent(t.floor, 'w-hedy', { kind: 'stop', at: T0 + 900_000, agentId: 'b2', agent: 'tester' });
  appendFileSync(t.floor.file, use(T0 + 800_000, 'toolu_2', { subagent_type: 'tester', description: 'Second' }) + launched(T0 + 803_000, 'toolu_2', 'b2') + notified(T0 + 900_500, 'toolu_2', 'b2'));
  t.roster.subagents.live.scan(t.floor);
  assert.equal(rec().runs.length, 2);
  // A failed notification is a failed run (which the grade counts, as a hook's failure would be).
  s.onEvent(t.floor, 'w-hedy', { kind: 'dispatch', at: T0 + 950_000, toolUseId: 'toolu_3', agent: 'tester', task: 'Third', background: false });
  s.onEvent(t.floor, 'w-hedy', { kind: 'result', at: T0 + 951_000, toolUseId: 'toolu_3', agent: 'tester', failed: false, background: false, async: true, agentId: 'c3' });
  appendFileSync(t.floor.file, notified(T0 + 990_000, 'toolu_3', 'c3', 'failed'));
  t.roster.subagents.live.scan(t.floor);
  assert.deepEqual(rec().runs.map((x) => x.outcome), ['accept', 'pending', 'failed']);
});

// ---- Subagents about the office in the 2D view --------------------------------------------------------

test("an idle subagent takes a benched Lead's breaks at a spot of its own, the same in every browser", () => {
  const a = idleSpot('lead-tester/tester', 2, T0 + 12_345);
  assert.deepEqual(a, idleSpot('lead-tester/tester', 2, T0 + 12_345));
  const b = breakAt('lead-tester/tester', 2, T0 + 12_345);
  assert.deepEqual([a.act, a.walking, a.z], [b.act, b.walking, b.z]);
  // Sharing a break spot with another three along (index + 3): side by side, not on top of each other.
  const still = (i: number) => idleSpot('x', i, T0, true);
  assert.equal(still(1).act, still(4).act);
  assert.ok(Math.abs(still(1).x - still(4).x) >= 0.5);
  // With less motion asked for, it never walks.
  for (let t = 0; t < 600_000; t += 7000) assert.equal(idleSpot('lead-tester/tester', 0, T0 + t, true).walking, false);
});

test('a subagent walks back to its stool when a run starts, and away when it ends; with less motion it just goes', () => {
  const w = new Walks();
  const away: LifeSpot = { x: -3, z: 11.3, act: 'coffee', walking: false, pose: 'front', at: 0 };
  const stool: LifeSpot = { x: -12.5, z: -5.85, act: 'stool', walking: false, pose: 'front', at: 0 };
  assert.deepEqual(w.place('k', away, 0), away);
  assert.equal(w.place('k', stool, 1000).walking, true);
  const later = w.place('k', stool, 3000);
  assert.ok(later.walking && later.z < 11.3, 'on its way');
  const there = w.place('k', stool, 20_000);
  assert.deepEqual([there.x, there.z, there.walking, there.act], [stool.x, stool.z, false, 'stool']);
  assert.equal(w.place('k', away, 21_000).walking, true, 'and away again');
  assert.deepEqual(new Walks().place('j', stool, 0, true), stool);
  // Its way keeps to the aisle and the gap between the patches.
  assert.deepEqual(wayBetween(away, stool).map((p) => [p.x, p.z]), [[-3, 11.3], [-3, 8.4], [-6, 8.4], [-6, -5.85], [-12.5, -5.85]]);
  w.keep(new Set());
  assert.deepEqual(w.place('k', stool, 22_000), stool, 'forgotten: placed straight');
});

test('two standing about close together are talking; walking, on a stool or far apart they are not', () => {
  const set = chatting([
    { id: 'a', x: 0, z: 0, busy: false },
    { id: 'b', x: CHAT_M - 0.1, z: 0, busy: false },
    { id: 'c', x: 0.2, z: 0.2, busy: true },
    { id: 'd', x: 20, z: 0, busy: false },
  ]);
  assert.deepEqual([...set].sort(), ['a', 'b']);
});

// ---- The 2D view's stools ----------------------------------------------------------------------------

test("a subagent's stool is beside its Lead's desk on the open side, clear of every desk, and each one at once gets its own", () => {
  const near = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  for (const desk of DESKS) {
    const spots = Array.from({ length: STOOLS }, (_, i) => stoolSpot(desk, i, DESKS));
    for (const p of spots) {
      assert.ok(near(p, desk) < 2.6, `${desk.id}: a stool by its desk`);
      for (const d of DESKS) {
        const inside = Math.abs(p.x - d.x) < DESK_SIZE.width / 2 && Math.abs(p.z - d.z) < DESK_SIZE.depth / 2;
        assert.ok(!inside, `${desk.id}'s stool ${spots.indexOf(p)} isn't on ${d.id}`);
      }
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(near(spots[i], spots[j]) > 0.4, `${desk.id}: stools ${i} and ${j} apart`);
  }
  // desk-1 (x −11.6) has its neighbour desk-2 on its +x side: its stool is on the −x side, behind its chair, clear of the Lead.
  const d1 = DESKS.find((d) => d.id === 'desk-1')!;
  const s = stoolSpot(d1, 0, DESKS);
  assert.ok(s.x < d1.x, 'on its free side');
  assert.ok(Math.sign(s.z - d1.z) === Math.sign(Math.cos(d1.rotY)), 'on the chair side');
  for (const desk of DESKS) for (let i = 0; i < STOOLS; i++) assert.ok(near(stoolSpot(desk, i, DESKS), deskSeat(desk)) > 0.6, `${desk.id}: stool ${i} clear of the Lead's chair`);
});
