// Release 82, team flow #5: when a Lead finishes a batch and the build plan has next rows for its role, the office
// hands them over itself (server/roster/handoff.ts, shared/roster/handoff.ts), respecting pause, the budget and
// spend cap, checkpoints and the autonomy level, and records it. Fake agents and a fake plan; no git, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { handoffDue, type HandoffLook } from '../src/server/roster/handoff.js';
import { handoffPrompt, handoffRows, nextRows, rowsWords, teamOfOwner } from '../src/shared/roster/handoff.js';
import { setProjectPause } from '../src/server/project-run/store.js';

const PLAN = `# Build plan — Sample leave app

### Phase 2 — Requests
| # | Kind | Step | Produces / Proves | Depends on | State |
| --- | --- | --- | --- | --- | --- |
| 10 | BUILD | Request entity | domain | | built |
| 11 | BUILD | Request form page | page | 10 | not built |
| 12 | BUILD | Request list page | page | 11 | not built |
| 13 | PROVE | Journey: submit a request | J-01 | 12 | not built |
| 14 | BUILD | Approve microflow | logic | | not built |
| 15 | BUILD | Reject microflow | logic | | blocked |

### Phase 3 — Approvals
| # | Kind | Step | Depends on | State |
| --- | --- | --- | --- | --- |
| 16 | CHECKPOINT | Project Manager review of phase 2 | | |
| 17 | BUILD | Manager dashboard | 16 | |
`;

test('the plan: next rows by role, a batch per phase, never past a checkpoint, blocked rows skipped', () => {
  const rows = handoffRows(PLAN);
  assert.equal(rows.length, 8);
  assert.equal(rows.find((r) => r.n === 13)?.team, 'testing');
  assert.equal(rows.find((r) => r.n === 16)?.checkpoint, true);
  const dev = nextRows(rows, new Set([10]), ['development']);
  assert.deepEqual(dev.rows.map((r) => r.n), [11, 12, 14], 'row 15 is blocked, row 13 is the tester’s');
  const after = nextRows(rows, new Set([10, 11, 12, 13, 14]), ['development']);
  assert.deepEqual(after.rows, []);
  assert.equal(after.stoppedAt?.n, 16);
  assert.equal(after.stoppedAt?.why, 'checkpoint');
  const tester = nextRows(rows, new Set([10]), ['testing']);
  assert.deepEqual(tester.rows, [], 'its dependency (row 12) is not done');
  assert.equal(tester.stoppedAt?.why, 'depends');
  assert.equal(teamOfOwner('Lead Developer'), 'development');
  assert.equal(teamOfOwner('QA'), 'testing');
  assert.equal(rowsWords([11, 12, 14]), 'rows 11, 12 and 14');
  assert.match(handoffPrompt(dev.rows, 2), /Next in architecture\/build-plan\.md for you: rows 11, 12 and 14/);
});

const base = (o: Partial<HandoffLook> = {}): HandoffLook => ({ enabled: true, level: 2, phase: 'active', status: 'done', viewers: 0, studio: false, escalated: false, inStandup: false, queued: 0, busyBehind: false, taskRows: [], done: new Set(), recent: 0, ...o });

test('the rules: off, level 1, paused, busy, waiting on the PM and mid-batch never hand over', () => {
  assert.equal(handoffDue(base()), 'go');
  assert.equal(handoffDue(base({ enabled: false })), 'off');
  assert.equal(handoffDue(base({ level: 1 })), 'level-1');
  assert.equal(handoffDue(base({ paused: 'Paused by Pat' })), 'paused');
  assert.equal(handoffDue(base({ status: 'working' })), 'busy');
  assert.equal(handoffDue(base({ busyBehind: true })), 'busy');
  assert.equal(handoffDue(base({ escalated: true })), 'escalated');
  assert.equal(handoffDue(base({ task: 'build rows 11-12', taskRows: [11, 12], done: new Set([11]) })), 'mid-batch');
  assert.equal(handoffDue(base({ task: 'build rows 11-12', taskRows: [11, 12], done: new Set([11, 12]) })), 'go');
  assert.equal(handoffDue(base({ task: 'tidy the README' })), 'has-task');
  assert.equal(handoffDue(base({ recent: 4 })), 'rate-limited');
});

class FakeFloor implements TeamFloor {
  id = `ho-${Math.random().toString(36).slice(2, 8)}`;
  name = 'leave-app-test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'handoff-floor-'));
  map = new Map<string, WorkerInfo>();
  typed: { id: string; text: string }[] = [];
  lines: string[] = [];
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
  }
  prompt(id: string, text: string) {
    this.typed.push({ id, text });
    return undefined;
  }
  wake() {
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  activity = (t: string) => void this.lines.push(t);
  set(id: string, status: WorkerStatus) {
    Object.assign(this.map.get(id)!, { status });
    this.roster.onWorker(this, this.map.get(id)!);
  }
}

function office(done: number[]) {
  const clock = { now: Date.UTC(2026, 9, 28, 10) };
  const floor = new FakeFloor();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'handoff-data-'));
  const plan = { done };
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => clock.now, buildPlan: async () => ({ plan: PLAN, done: plan.done }) }, 0);
  floor.roster = roster;
  return { clock, floor, roster, plan, dataDir };
}

test('a Lead whose batch is done gets the next rows once, recorded; paused and level 1 get none', async () => {
  const { floor, roster, plan, dataDir } = office([10]);
  assert.equal(await roster.members.hire(floor, 'lead-developer', 'Pat', undefined, 'Build rows 10-10'), undefined);
  const id = roster.data(floor.id).members['lead-developer'].workerId!;
  floor.set(id, 'working');
  floor.set(id, 'done');
  floor.typed.length = 0;
  const r = await roster.handoff.check(floor, 'lead-developer');
  assert.deepEqual(r, { did: 'handed', rows: [11, 12, 14] });
  assert.equal(floor.typed.length, 1);
  assert.match(floor.typed[0].text, /rows 11, 12 and 14/);
  assert.match(floor.lines.at(-1)!, /Handed .* the build plan's next rows 11, 12 and 14/);
  const rec = JSON.parse(readFileSync(path.join(dataDir, 'handoff', `${floor.id}.json`), 'utf8'));
  assert.deepEqual(rec.roles['lead-developer'].handed[0].rows, [11, 12, 14]);
  // Its new task names those rows: mid-batch until they have evidence; then the next look stops at the checkpoint.
  floor.set(id, 'working');
  floor.set(id, 'done');
  assert.deepEqual(await roster.handoff.check(floor, 'lead-developer'), { did: 'nothing', why: 'mid-batch' });
  plan.done = [10, 11, 12, 13, 14];
  const stop = await roster.handoff.check(floor, 'lead-developer');
  assert.equal(stop.did, 'stopped');
  assert.equal(floor.typed.length, 1, 'nothing typed past the checkpoint');
  // Paused: nothing.
  plan.done = [10];
  const fresh = office([10]);
  await fresh.roster.members.hire(fresh.floor, 'lead-developer', 'Pat');
  const fid = fresh.roster.data(fresh.floor.id).members['lead-developer'].workerId!;
  fresh.floor.set(fid, 'working');
  fresh.floor.set(fid, 'done');
  setProjectPause(fresh.floor.id, { by: 'Pat', at: fresh.clock.now } as never);
  try {
    const p = await fresh.roster.handoff.check(fresh.floor, 'lead-developer');
    assert.equal(p.did, 'nothing');
    assert.equal((p as { why: string }).why, 'paused');
  } finally {
    setProjectPause(fresh.floor.id, undefined);
  }
  fresh.roster.members.settings(fresh.floor, { autonomy: 1 }, 'Pat');
  assert.deepEqual(await fresh.roster.handoff.check(fresh.floor, 'lead-developer'), { did: 'nothing', why: 'level-1' });
});
