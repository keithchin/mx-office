// A worker's open background work (shared/roster/background-work.ts): a Monitor or a background command
// it left running after its turn, heard from its PostToolUse hook and read off its transcript (shapes as
// Claude Code 2.1 writes them, no real content), open until its <task-notification> says it ended or its
// session ends; past its stated expiry it's "status unknown", never running. The member reads "Waiting on
// background work" on the Overview's Team card and the Team tab, the fact block names what it waits on,
// and the floor counts it as busy, not idle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { applyBg, bgNextTick, bgRows, bgState, factsBackground, GRACE_MS, COMMAND_STALE_MS, UNKNOWN_SHOWN_MS, WAITING_BG, type BgItem } from '../src/shared/roster/background-work.js';
import { BackgroundTranscript, bgNotification } from '../src/server/roster/background-transcript.js';
import { applyBackground, backgroundOf, backgroundOpen, noteBackgroundHook, onBackgroundChange, tickBackground } from '../src/server/workers/background-work.js';
import { teamRows } from '../src/client/ui/portal/overview-logic.js';
import { VIA_SUBAGENT } from '../src/shared/roster/member-subagents.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import { subagentBusy, subagentBusyMoved } from '../src/server/roster/subagent-busy.js';
import { useProjectRunFile } from '../src/server/project-run/store.js';

const T0 = new Date(2026, 9, 17, 0, 27).getTime();
const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();
const line = (o: unknown) => `${JSON.stringify(o)}\n`;

// ---- The transcript's shapes ------------------------------------------------------------------------

const monitorUse = (at: number, id: string, input: Record<string, unknown>) => line({ type: 'assistant', timestamp: iso(at), message: { content: [{ type: 'tool_use', id, name: 'Monitor', input }] } });
const bashUse = (at: number, id: string, input: Record<string, unknown>) => line({ type: 'assistant', timestamp: iso(at), message: { content: [{ type: 'tool_use', id, name: 'Bash', input }] } });
const result = (at: number, id: string, content: string, toolUseResult: unknown) => line({ type: 'user', timestamp: iso(at), message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }] }, toolUseResult });
const monitorStarted = (at: number, id: string, task: string, timeoutMs = 900_000) => result(at, id, `Monitor started (task ${task}, expires in ${timeoutMs / MIN}m unless the source ends first; …)`, { taskId: task, timeoutMs, persistent: false });
const note = (at: number, body: string, queued = false) => (queued ? line({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(at), content: `<task-notification>\n${body}\n</task-notification>` }) : line({ type: 'user', timestamp: iso(at), message: { role: 'user', content: `<task-notification>\n${body}\n</task-notification>` } }));

test("the transcript's shapes: a Monitor's launch, its events, its end; a background command, asked for or moved there; a sidechain ignored", () => {
  const p = new BackgroundTranscript();
  const text =
    monitorUse(T0, 'toolu_m1', { command: 'until curl …; do sleep 10; done', description: 'fresh app start for supervisor walk', timeout_ms: 900_000 }) +
    monitorStarted(T0 + 20_000, 'toolu_m1', 'bt1eq2ttl') +
    bashUse(T0 + 30_000, 'toolu_b1', { command: './run-local.sh', description: 'restart the app', run_in_background: true }) +
    result(T0 + 31_000, 'toolu_b1', 'Command running in background with ID: bk7. Output is being written to: …', { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bk7' }) +
    bashUse(T0 + 40_000, 'toolu_b2', { command: 'npm test' }) +
    result(T0 + 160_000, 'toolu_b2', 'Command did not complete within its 120s timeout and was moved to the background (ID: bxo5). …', { stdout: '', backgroundTaskId: 'bxo5', timedOutAfterMs: 120_000 }) +
    line({ type: 'assistant', isSidechain: true, timestamp: iso(T0 + 50_000), message: { content: [{ type: 'tool_use', id: 'toolu_side', name: 'Monitor', input: {} }] } }) +
    line({ type: 'user', isSidechain: true, timestamp: iso(T0 + 51_000), message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_side', content: '' }] }, toolUseResult: { taskId: 'side', timeoutMs: 1000 } }) +
    note(T0 + 3 * MIN, '<task-id>bt1eq2ttl</task-id>\n<summary>Monitor event: "app"</summary>\n<event>still starting</event>') +
    note(T0 + 5 * MIN, '<task-id>bt1eq2ttl</task-id>\n<tool-use-id>toolu_m1</tool-use-id>\n<output-file>…</output-file>\n<status>completed</status>\n<summary>Monitor "fresh app start" stream ended</summary>', true);
  const cut = text.length - 30;
  const sigs = [...p.feed(text.slice(0, cut)), ...p.feed(text.slice(cut))];
  assert.deepEqual(sigs.map((s) => s.kind), ['launched', 'launched', 'launched', 'event', 'closed']);
  assert.deepEqual(sigs[0], { kind: 'launched', at: T0 + 20_000, tool: 'monitor', toolUseId: 'toolu_m1', taskId: 'bt1eq2ttl', label: 'fresh app start for supervisor walk', timeoutMs: 900_000 });
  assert.deepEqual(sigs[1], { kind: 'launched', at: T0 + 31_000, tool: 'command', toolUseId: 'toolu_b1', taskId: 'bk7', label: 'restart the app' });
  assert.deepEqual(sigs[2], { kind: 'launched', at: T0 + 160_000, tool: 'command', toolUseId: 'toolu_b2', taskId: 'bxo5' }, 'moved to the background: known by its result alone');
  assert.deepEqual(sigs[4], { kind: 'closed', at: T0 + 5 * MIN, taskIds: ['bt1eq2ttl'], toolUseId: 'toolu_m1' });
  // A Monitor's expiry, a killed task, and the orphans a new session reports for the old one close them all.
  assert.equal(bgNotification('<task-notification>\n<task-id>bx</task-id>\n<event>[Monitor expired after 15m with no events delivered. Re-arm it…]</event>\n</task-notification>', T0)[0].kind, 'closed');
  assert.equal(bgNotification('<task-notification><task-id>bx</task-id><status>killed</status></task-notification>', T0)[0].kind, 'closed');
  const orphans = bgNotification('<task-notification>\n<task-id>b1</task-id>\n<task-id>b2</task-id>\n<task-id>__orphan_summary__:shell</task-id>\n<status>stopped</status>\n</task-notification>', T0);
  assert.deepEqual(orphans, [{ kind: 'closed', at: T0, taskIds: ['b1', 'b2'] }]);
  assert.deepEqual(bgNotification('<task-notification><task-id>b1</task-id><status>running</status></task-notification>', T0)[0].kind, 'event');
  assert.deepEqual(bgNotification('no notification here', T0), []);
});

// ---- The model: open, closed, expired, unknown --------------------------------------------------------

test('a monitor is open from its launch: "12 min left", as of when it was last heard; its notification closes it', () => {
  const items: BgItem[] = [];
  assert.equal(applyBg(items, { kind: 'launched', at: T0, tool: 'monitor', taskId: 'bt1', toolUseId: 'toolu_m1', label: 'app start', timeoutMs: 15 * MIN }), true);
  assert.equal(applyBg(items, { kind: 'launched', at: T0 + 100, tool: 'monitor', taskId: 'bt1', toolUseId: 'toolu_m1', label: 'app start', timeoutMs: 15 * MIN }), false, 'the same launch from the other source changes nothing');
  const rows = bgRows(items, T0 + 3 * MIN);
  assert.deepEqual(rows.map((r) => [r.state, r.line, r.label, r.asOf]), [['open', 'monitor · 12 min left', 'app start', 'as of 00:27']]);
  assert.deepEqual([rows[0].head, rows[0].when], ['Monitor', '12 min left'], 'the two parts a narrow row shows');
  assert.equal(bgNextTick(items, T0 + 3 * MIN), MIN + 50, 'drawn again in a minute');
  // An event: still running, heard of later.
  assert.equal(applyBg(items, { kind: 'event', at: T0 + 4 * MIN, taskIds: ['bt1'] }), true);
  assert.equal(bgRows(items, T0 + 5 * MIN)[0].asOf, 'as of 00:31');
  assert.equal(applyBg(items, { kind: 'closed', at: T0 + 6 * MIN, taskIds: [], toolUseId: 'toolu_m1' }), true);
  assert.equal(bgState(items[0], T0 + 6 * MIN), 'gone');
  assert.deepEqual(bgRows(items, T0 + 6 * MIN), []);
  assert.equal(applyBg(items, { kind: 'launched', at: T0 + 7 * MIN, tool: 'monitor', taskId: 'bt1' }), false, 'a late echo of its launch does not open it again');
});

test('past its expiry a monitor is "status unknown since", never running; then it goes', () => {
  const items: BgItem[] = [];
  applyBg(items, { kind: 'launched', at: T0, tool: 'monitor', taskId: 'bt2', timeoutMs: 15 * MIN });
  assert.equal(bgRows(items, T0 + 15 * MIN + 30_000)[0].line, 'monitor · expiring', 'its notice is due: still open within the margin');
  const later = T0 + 15 * MIN + GRACE_MS + 1;
  assert.equal(bgState(items[0], later), 'unknown');
  assert.equal(bgRows(items, later)[0].line, 'background work (status unknown since 00:42)');
  assert.deepEqual([bgRows(items, later)[0].head, bgRows(items, later)[0].when], ['Background work', 'status unknown since 00:42']);
  assert.equal(factsBackground(items, later, false), 'background work of unknown status since 00:42');
  assert.equal(bgState(items[0], T0 + 15 * MIN + GRACE_MS + UNKNOWN_SHOWN_MS), 'gone');
  // No timeout named: Claude Code's default of 5 minutes.
  const d: BgItem[] = [];
  applyBg(d, { kind: 'launched', at: T0, tool: 'monitor', taskId: 'b3' });
  assert.equal(d[0].expiresAt, T0 + 5 * MIN);
});

test('a background command: "started 3 min ago" until its notification; with no word for hours its status is unknown', () => {
  const items: BgItem[] = [];
  applyBg(items, { kind: 'launched', at: T0, tool: 'command', taskId: 'bk7', label: 'restart the app' });
  assert.equal(bgRows(items, T0 + 20_000)[0].line, 'background command · just started');
  assert.equal(bgRows(items, T0 + 3 * MIN)[0].line, 'background command · started 3 min ago');
  assert.equal(bgState(items[0], T0 + COMMAND_STALE_MS + 1), 'unknown');
  const two: BgItem[] = [];
  applyBg(two, { kind: 'launched', at: T0, tool: 'command', taskId: 'c1' });
  applyBg(two, { kind: 'launched', at: T0, tool: 'monitor', taskId: 'm1', timeoutMs: 10 * MIN });
  assert.equal(factsBackground(two, T0 + MIN, false, { count: 1, who: 'Maya' }), 'waiting on background work: monitor, background command, 1 subagent (Maya)');
  assert.equal(factsBackground(two, T0 + MIN, true), 'with background work: monitor, background command');
  applyBg(two, { kind: 'reset', at: T0 + 2 * MIN });
  assert.equal(two.length, 0, 'a new session: nothing of the old one runs on');
});

// ---- The hooks ----------------------------------------------------------------------------------------

test('the hooks: a Monitor started and a command sent to the background open them; a fresh session clears them; other tools are nothing', () => {
  const heard: string[] = [];
  const stop = onBackgroundChange((id) => heard.push(id));
  try {
    assert.equal(noteBackgroundHook('w-hook', 'PostToolUse', { tool_name: 'Monitor', tool_use_id: 'toolu_m', tool_input: { description: 'wait for app on 8181', timeout_ms: 900_000 }, tool_response: { taskId: 'bhoz', timeoutMs: 900_000, persistent: false } }, T0), true);
    assert.equal(noteBackgroundHook('w-hook', 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_b', tool_input: { command: 'npm run dev', run_in_background: true }, tool_response: { stdout: '', backgroundTaskId: 'bdev' } }, T0 + 1000), true);
    assert.equal(noteBackgroundHook('w-hook', 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: 'a' } }, T0), false);
    assert.equal(noteBackgroundHook('w-hook', 'PostToolUse', { tool_name: 'Read', tool_input: {}, tool_response: { taskId: 'x' } }, T0), false);
    assert.deepEqual(backgroundOf('w-hook', T0 + MIN).map((i) => [i.kind, i.taskId, i.label, i.expiresAt]), [['monitor', 'bhoz', 'wait for app on 8181', T0 + 15 * MIN], ['command', 'bdev', 'npm run dev', undefined]]);
    assert.equal(backgroundOpen('w-hook', T0 + MIN), true);
    assert.deepEqual(heard, ['w-hook', 'w-hook']);
    assert.equal(noteBackgroundHook('w-hook', 'SessionStart', { source: 'compact' }, T0 + 2000), false, 'a compaction is the same session');
    assert.equal(backgroundOf('w-hook', T0 + MIN).length, 2);
    assert.equal(noteBackgroundHook('w-hook', 'SessionStart', { source: 'resume' }, T0 + 3000), true);
    assert.deepEqual(backgroundOf('w-hook', T0 + MIN), []);
  } finally {
    stop();
  }
});

test('the once-a-minute look tells when a monitor turns unknown and when it goes, and nothing in between', () => {
  applyBackground('w-tick', [{ kind: 'launched', at: T0, tool: 'monitor', taskId: 'bt', timeoutMs: 5 * MIN }]);
  assert.equal(tickBackground(['w-tick'], T0 + 3 * MIN), false);
  assert.equal(tickBackground(['w-tick'], T0 + 5 * MIN + GRACE_MS + 30_000), true, 'open → unknown');
  assert.equal(tickBackground(['w-tick'], T0 + 5 * MIN + GRACE_MS + 90_000), false);
  assert.equal(tickBackground(['w-tick'], T0 + 5 * MIN + GRACE_MS + UNKNOWN_SHOWN_MS + 30_000), true, 'unknown → gone');
  assert.deepEqual(backgroundOf('w-tick', T0 + 60 * MIN), []);
});

// ---- Through the roster: the views, the fact block, the floor's count ------------------------------------

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'Sample Project';
  dir = mkdtempSync(path.join(os.tmpdir(), 'bg-floor-'));
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
  transcript = (w: WorkerInfo) => (w.id === this.sophie ? this.file : undefined);
  sophie = '';
}

function setup() {
  useProjectRunFile(undefined);
  const clock = { now: T0 };
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'bg-data-')), floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => clock.now }, 0);
  const d = roster.data(floor.id);
  const kath = `w-kath-${floor.id}`;
  const soph = `w-soph-${floor.id}`;
  floor.sophie = soph;
  const worker = (id: string, name: string, status: string) => floor.map.set(id, { id, kind: 'agent', provider: 'claude', deskId: 'desk-1', name, color: '#fff', status, acked: true, createdBy: 'k', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo);
  worker(kath, 'Katherine', 'idle');
  worker(soph, 'Sophie', 'idle');
  d.members.pm = { ...d.members.pm, name: 'Katherine', phase: 'active', workerId: kath };
  d.members['lead-developer'] = { ...d.members['lead-developer'], name: 'Sophie', phase: 'active', workerId: soph };
  d.subagentNames['lead-developer/tester'] = 'Maya';
  floor.file = path.join(floor.dir, 'sophie.jsonl');
  const sophie = () => roster.view(floor, true).members.find((m) => m.role === 'lead-developer')!;
  const rows = () => {
    const v = roster.view(floor, true);
    return teamRows(v.members, 'pm', (id) => floor.map.get(id), (role) => v.subagentRuns?.filter((r) => r.lead === role && r.status === 'working').length ?? 0, (role) => (v.members.find((m) => m.role === role)?.background ?? []).filter((i) => bgState(i, clock.now) === 'open').length);
  };
  return { clock, floor, roster, d, kath, soph, sophie, rows, worker };
}

test("Sophie's turn ended with a monitor, a background restart and an async subagent running: waiting on background work, not idle, until each reports", () => {
  const t = setup();
  // Her async subagent (the Agent tool, run in the background) from the hooks, as release 52 tracks it.
  t.roster.subagents.onEvent(t.floor, t.soph, { kind: 'dispatch', at: T0 - 2 * MIN, toolUseId: 'toolu_a', agent: 'tester', task: 'Walk the supervisor flow', background: true });
  t.roster.subagents.onEvent(t.floor, t.soph, { kind: 'result', at: T0 - 2 * MIN + 500, toolUseId: 'toolu_a', agent: 'tester', failed: false, background: true, async: true, agentId: 'a1' });
  writeFileSync(
    t.floor.file!,
    monitorUse(T0, 'toolu_m1', { command: 'until …', description: 'fresh app start for supervisor walk', timeout_ms: 900_000 }) +
      monitorStarted(T0 + 1000, 'toolu_m1', 'bt1eq2ttl') +
      bashUse(T0 + 2000, 'toolu_b1', { command: './run-local.sh', description: 'restart the app', run_in_background: true }) +
      result(T0 + 2500, 'toolu_b1', 'Command running in background with ID: bk7.', { stdout: '', backgroundTaskId: 'bk7' }),
  );
  t.clock.now = T0 + 3 * MIN;
  t.roster.subagents.live.scan(t.floor, t.clock.now);
  const m = t.sophie();
  assert.equal(m.status, 'idle', "the roster's own status is unchanged");
  assert.deepEqual(bgRows(m.background, t.clock.now).map((r) => r.line), ['monitor · 12 min left', 'background command · started 3 min ago']);
  const row = t.rows().find((r) => r.role === 'lead-developer')!;
  assert.deepEqual([row.dot, row.status], ['work', WAITING_BG]);
  assert.match(t.roster.awareness.facts(t.floor, t.soph), /Agents working: Sophie \(you\) — waiting on background work: monitor, background command, 1 subagent \(Maya\); awake and idle: Katherine \(Project Coordinator\)/);
  assert.ok(subagentBusy(t.d, t.clock.now).has(t.soph), "the floor's working count counts her");
  assert.ok(t.floor.changes > 0, 'the browsers were told');

  // The monitor and the command report in: only the subagent is left, as release 52 shows it.
  appendFileSync(t.floor.file!, note(T0 + 5 * MIN, '<task-id>bt1eq2ttl</task-id>\n<tool-use-id>toolu_m1</tool-use-id>\n<status>completed</status>') + note(T0 + 6 * MIN, '<task-id>bk7</task-id>\n<status>completed</status>\n<summary>Background command "./run-local.sh" completed (exit code 0)</summary>'));
  t.clock.now = T0 + 7 * MIN;
  t.roster.subagents.live.scan(t.floor, t.clock.now);
  assert.equal(t.sophie().background, undefined);
  assert.equal(t.rows().find((r) => r.role === 'lead-developer')!.status, VIA_SUBAGENT);
  // Maya finishes too: back to idle, and the fact block says nobody's working.
  appendFileSync(t.floor.file!, note(T0 + 8 * MIN, '<task-id>a1</task-id>\n<tool-use-id>toolu_a</tool-use-id>\n<status>completed</status>\n<summary>Agent "Walk" finished</summary>'));
  t.clock.now = T0 + 9 * MIN;
  t.roster.subagents.live.scan(t.floor, t.clock.now);
  assert.deepEqual(t.rows().find((r) => r.role === 'lead-developer')!.status, 'Ready');
  assert.match(t.roster.awareness.facts(t.floor, t.soph), /Agents working: nobody; awake and idle: Katherine \(Project Coordinator\), Sophie \(you\)/);
  assert.equal(subagentBusy(t.d, t.clock.now).has(t.soph), false);
});

test('a monitor that outlives its expiry with no word reads "status unknown", and the member is not claimed to be waiting on it', () => {
  const t = setup();
  writeFileSync(t.floor.file!, monitorUse(T0, 'toolu_m', { command: 'until …', description: 'wait for app', timeout_ms: 300_000 }) + monitorStarted(T0 + 1000, 'toolu_m', 'bq', 300_000));
  t.clock.now = T0 + MIN;
  t.roster.subagents.live.scan(t.floor, t.clock.now);
  assert.equal(t.rows().find((r) => r.role === 'lead-developer')!.status, WAITING_BG);
  t.clock.now = T0 + 5 * MIN + GRACE_MS + 5_000;
  t.roster.tick(t.clock.now);
  const m = t.sophie();
  assert.deepEqual(bgRows(m.background, t.clock.now).map((r) => [r.state, r.line]), [['unknown', 'background work (status unknown since 00:32)']]);
  assert.equal(t.rows().find((r) => r.role === 'lead-developer')!.status, 'Ready', 'never claimed running');
  assert.match(t.roster.awareness.facts(t.floor, t.soph), /awake and idle: Katherine \(Project Coordinator\), Sophie \(you\) — background work of unknown status since 00:32/);
  assert.equal(subagentBusy(t.d, t.clock.now).has(t.soph), false);
});

test('a new session (a new transcript) or the worker going to sleep clears its background work; asleep, nothing shows', () => {
  const t = setup();
  writeFileSync(t.floor.file!, monitorUse(T0, 'toolu_m', { description: 'app', timeout_ms: 900_000 }) + monitorStarted(T0 + 1000, 'toolu_m', 'bm'));
  t.clock.now = T0 + MIN;
  t.roster.subagents.live.scan(t.floor, t.clock.now);
  assert.equal(t.sophie().background?.length, 1);
  assert.equal(subagentBusyMoved(t.floor.id, t.d, t.clock.now), true, 'the floors list goes out again');
  // A new session: a new transcript, with nothing running in it yet.
  t.floor.file = path.join(t.floor.dir, 'sophie-2.jsonl');
  writeFileSync(t.floor.file, line({ type: 'user', timestamp: iso(T0 + 2 * MIN), message: { content: 'hello' } }));
  t.roster.subagents.live.scan(t.floor, t.clock.now);
  assert.equal(t.sophie().background, undefined);
  assert.equal(subagentBusyMoved(t.floor.id, t.d, t.clock.now), true);
  // A launch in the new session, then the worker exits: its session (and the monitor) ended with it.
  appendFileSync(t.floor.file, monitorUse(T0 + 3 * MIN, 'toolu_n', { description: 'again', timeout_ms: 900_000 }) + monitorStarted(T0 + 3 * MIN, 'toolu_n', 'bn'));
  t.roster.subagents.live.scan(t.floor, t.clock.now);
  assert.equal(t.sophie().background?.length, 1);
  t.worker(t.soph, 'Sophie', 'exited');
  t.roster.onWorker(t.floor, t.floor.map.get(t.soph)!);
  assert.equal(backgroundOpen(t.soph, t.clock.now), false);
  assert.equal(t.sophie().background, undefined);
});

test('one waiting on its background work is not benched for being idle', () => {
  const t = setup();
  t.d.settings.idleMinutes = 1;
  applyBackground(t.soph, [{ kind: 'launched', at: T0, tool: 'command', taskId: 'bk' }]);
  t.roster.onWorker(t.floor, t.floor.map.get(t.soph)!);
  t.roster.onWorker(t.floor, t.floor.map.get(t.kath)!);
  t.clock.now = T0 + 10 * MIN;
  t.roster.tick(t.clock.now);
  assert.equal(t.d.members['lead-developer'].phase, 'active', 'Sophie stays: her background command runs in that session');
});
