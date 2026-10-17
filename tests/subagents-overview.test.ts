// A member's subagents at work show under it in the 1D team lists (shared/roster/member-subagents.ts,
// ui/subagents/member-subs.ts): the run under its member with its name, type, task and how long; the
// member reads "Working (via subagent)" while it waits on it; a finished run says "done · 4 min" for a
// minute and then folds into the day's count; the office's fact block and the floor's working count
// count it; and the Coordinator's own subagents show at work too (with no track record).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { LiveRun } from '../src/shared/roster/subagent-live.js';
import { busyWorkers, DONE_SHOWN_MS, factsSubagents, memberSubagents, subRowLine, todayWords, VIA_SUBAGENT } from '../src/shared/roster/member-subagents.js';
import { teamRows } from '../src/client/ui/portal/overview-logic.js';
import { Roster } from '../src/server/roster/index.js';
import type { TeamFloor } from '../src/server/roster/types.js';
import { subagentBusyMoved } from '../src/server/roster/subagent-busy.js';
import { useProjectRunFile } from '../src/server/project-run/store.js';

const T0 = new Date(2026, 9, 16, 10, 0).getTime();
const MIN = 60_000;
const NAMES = { 'chief-analyst/business-analyst': 'Elsa' };

const run = (over: Partial<LiveRun>): LiveRun => ({ id: 'toolu_1', lead: 'chief-analyst', workerId: 'w-kath', name: 'business-analyst', task: 'Draft the BRD for the check-sheet app', status: 'working', startedAt: T0, seenAt: T0, source: 'hooks', ...over });

test('a running subagent shows under its member: name, type, task and how long, to the minute', () => {
  const s = memberSubagents([run({})], NAMES, 'chief-analyst', T0 + 3 * MIN);
  assert.equal(s.rows.length, 1);
  const [r] = s.rows;
  assert.deepEqual([r.first, r.role, r.type, r.state, r.key], ['Elsa', 'Business Analyst', 'business-analyst', 'working', 'chief-analyst/business-analyst']);
  assert.equal(subRowLine(r, T0 + 3 * MIN), 'Draft the BRD for the check-sheet app · 3 min');
  assert.equal(subRowLine(r, T0 + 20_000), 'Draft the BRD for the check-sheet app · just started');
  assert.equal(memberSubagents([run({})], NAMES, 'lead-tester', T0).rows.length, 0, "another member's run isn't under this one");
});

test('a finished run says "done · 4 min" for a minute, then folds into the day\'s count', () => {
  const done = run({ status: 'done', endedAt: T0 + 4 * MIN, durationMs: 4 * MIN });
  const just = memberSubagents([done], NAMES, 'chief-analyst', T0 + 4 * MIN + 10_000);
  assert.equal(just.rows.length, 1);
  assert.equal(subRowLine(just.rows[0], T0), 'done · 4 min');
  assert.equal(just.foldAt, T0 + 4 * MIN + DONE_SHOWN_MS);
  assert.equal(just.today, 0);
  const later = memberSubagents([done, run({ id: 'toolu_0', status: 'done', startedAt: T0 - 60 * MIN, endedAt: T0 - 50 * MIN })], NAMES, 'chief-analyst', T0 + 6 * MIN);
  assert.equal(later.rows.length, 0);
  assert.equal(later.today, 2);
  assert.equal(todayWords(later), '2 subagent runs today');
  assert.equal(later.foldAt, undefined);
  const both = memberSubagents([done, run({ id: 'toolu_2', startedAt: T0 + 5 * MIN })], NAMES, 'chief-analyst', T0 + 6 * MIN);
  assert.equal(todayWords(both), '+1 earlier run today');
  // Yesterday's runs aren't today's.
  assert.equal(memberSubagents([run({ status: 'done', startedAt: T0 - 24 * 60 * MIN, endedAt: T0 - 24 * 60 * MIN + MIN })], NAMES, 'chief-analyst', T0).today, 0);
});

test('a member idle or asleep while its subagent works reads "Working (via subagent)"; asking you or benched stays so', () => {
  const members = [
    { role: 'chief-analyst', name: 'Katherine', title: 'Chief Analyst', status: 'idle', workerId: 'w-kath' },
    { role: 'lead-developer', name: 'Sophie', title: 'Lead Developer', status: 'idle', workerId: 'w-soph' },
    { role: 'lead-tester', name: 'Hedy', title: 'Lead Tester', status: 'benched' },
  ];
  const live = (id: string) => ({ status: id === 'w-kath' ? 'idle' : 'idle' });
  const subs = (role: string) => (role === 'chief-analyst' || role === 'lead-tester' ? 1 : 0);
  const rows = teamRows(members, 'chief-analyst', live, subs);
  const kath = rows.find((r) => r.role === 'chief-analyst')!;
  assert.deepEqual([kath.dot, kath.status, kath.what], ['work', VIA_SUBAGENT, 'Waiting on its subagent']);
  assert.deepEqual([rows.find((r) => r.role === 'lead-developer')!.status], ['Ready']);
  assert.equal(rows.find((r) => r.role === 'lead-tester')!.status, 'Benched');
  assert.equal(teamRows(members, 'chief-analyst', () => ({ status: 'needs_input' }), subs)[0].status, 'Asking you');
  assert.equal(teamRows(members, 'chief-analyst', () => ({ status: 'exited' }), subs)[0].status, VIA_SUBAGENT);
  assert.equal(teamRows(members, 'chief-analyst', live)[0].status, 'Ready', 'no subagents: as before');
});

test('the fact block line and the busy set name only runs at work', () => {
  assert.match(factsSubagents([run({}), run({ id: 't2', name: 'data-analyst', startedAt: T0 + 1 })], NAMES, 'w-kath') ?? '', /^2 subagents working: Elsa \(business analyst\) \+ \w+ \(data analyst\)$/);
  assert.equal(factsSubagents([run({ status: 'done' })], NAMES, 'w-kath'), undefined);
  assert.deepEqual([...busyWorkers([run({}), run({ id: 'x', workerId: 'w-other', status: 'done' })])], ['w-kath']);
});

// ---- Through the roster ---------------------------------------------------------------------------

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'Sample Project';
  dir = mkdtempSync(path.join(os.tmpdir(), 'subs-ov-floor-'));
  map = new Map<string, WorkerInfo>();
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
  changed = () => undefined;
}

function setup() {
  useProjectRunFile(undefined);
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'subs-ov-data-')), floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => T0 }, 0);
  const d = roster.data(floor.id);
  const worker = (id: string, name: string, status: string) => floor.map.set(id, { id, kind: 'agent', provider: 'claude', deskId: 'desk-1', name, color: '#fff', status, acked: true, createdBy: 'k', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo);
  worker('w-kath', 'Katherine', 'idle');
  worker('w-soph', 'Sophie', 'idle');
  d.members.pm = { ...d.members.pm, name: 'Katherine', phase: 'active', workerId: 'w-kath' };
  d.members['lead-developer'] = { ...d.members['lead-developer'], name: 'Sophie', phase: 'active', workerId: 'w-soph' };
  return { floor, roster, d };
}

test("the Coordinator's subagent is tracked at work (no record), and the fact block counts it: not \"nobody\"", () => {
  const { floor, roster, d } = setup();
  const before = roster.awareness.facts(floor, 'w-kath');
  assert.match(before, /Agents working: nobody; awake and idle: Katherine \(you\), Sophie/);
  assert.equal(subagentBusyMoved(floor.id, d), false);
  roster.subagents.onEvent(floor, 'w-kath', { kind: 'dispatch', at: T0, toolUseId: 'toolu_k', agent: 'business-analyst', task: 'Draft the BRD', background: false });
  assert.equal(d.subagentRuns.length, 1);
  assert.equal(d.subagentRuns[0].lead, 'pm');
  const after = roster.awareness.facts(floor, 'w-kath');
  assert.match(after, /Agents working: Katherine \(you\) — 1 subagent working: \w+ \(business analyst\); awake and idle: Sophie/);
  assert.equal(subagentBusyMoved(floor.id, d), true, 'the floors list goes out again');
  assert.equal(subagentBusyMoved(floor.id, d), false, 'once');
  roster.subagents.onEvent(floor, 'w-kath', { kind: 'result', at: T0 + 4 * MIN, toolUseId: 'toolu_k', agent: 'business-analyst', failed: false, background: false });
  assert.equal(d.subagentRuns[0].status, 'done');
  assert.equal(d.subagents['pm/business-analyst'], undefined, "the Coordinator's subagents keep no track record");
  assert.match(roster.awareness.facts(floor, 'w-kath'), /Agents working: nobody/);
  assert.equal(subagentBusyMoved(floor.id, d), true);
});
