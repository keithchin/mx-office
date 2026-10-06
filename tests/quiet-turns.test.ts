// The quieter office, in the pieces that decide it (the worker manager's own restart tests are in
// workers.test.ts): a turn the office started itself ends without flagging anyone, a project team
// member's routine turns at autonomy 3 and up neither, a restart wakes only who it cut off mid-turn,
// and the turn it carries on is told its escalations are still open rather than to ask again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import { OFFICE_BY, dozesOnStart, notePromptBy } from '../src/server/workers/lifecycle.js';
import { CARRY_ON_PROMPT, carryOnPrompt } from '../src/server/workers/tasks.js';
import type { Worker } from '../src/server/workers/types.js';

const info = (more: Partial<WorkerInfo> = {}) => ({ id: 'w1', kind: 'agent', status: 'offline', ...more }) as WorkerInfo;

test('a prompt from the office marks the turn as its own; a person’s, or their keys, make it theirs', () => {
  const w: Pick<Worker, 'info' | 'officeTurn'> = { info: info() };
  notePromptBy(w, OFFICE_BY, 5);
  assert.equal(w.officeTurn, true);
  assert.deepEqual(w.info.lastInput, { by: OFFICE_BY, at: 5 });
  // A prompt with no sender (typed in once the session is up) belongs to the turn it was for.
  notePromptBy(w, undefined, 6);
  assert.equal(w.officeTurn, true);
  notePromptBy(w, 'Keith', 7);
  assert.equal(w.officeTurn, false);
  assert.deepEqual(w.info.lastInput, { by: 'Keith', at: 7 });
});

test('as the office starts, only an agent cut off mid-turn gets back to work; the rest stay asleep', () => {
  const at = (more: Partial<Worker> & { kind?: 'agent' | 'shell' }) => dozesOnStart({ info: info({ kind: more.kind ?? 'agent' }), interrupted: more.interrupted, pty: more.pty, dsh: more.dsh });
  assert.equal(at({ interrupted: true }), false, 'mid-turn: carries on');
  assert.equal(at({}), true, 'finished, idle or asleep: stays asleep');
  assert.equal(at({ kind: 'shell' }), false, 'a shell costs nothing: back as before');
  assert.equal(at({ pty: {} as Worker['pty'] }), false, 'picked back up running: nothing to wake');
});

test('the turn a restart cut off is told its escalations are still open, by name, not to ask again', () => {
  assert.doesNotMatch(CARRY_ON_PROMPT, /ask again\.?$/);
  assert.match(CARRY_ON_PROMPT, /still open[\s\S]*don't raise it again/);
  assert.equal(carryOnPrompt([]), CARRY_ON_PROMPT);
  const named = carryOnPrompt(['No test DB', 'Which SSO?']);
  assert.ok(named.startsWith(CARRY_ON_PROMPT));
  assert.match(named, /Your open escalations: “No test DB”; “Which SSO\?”\./);
  assert.match(carryOnPrompt(Array.from({ length: 10 }, (_, i) => `t${i}`)), /and 2 more\.$/);
});

// ---- The project team's side -------------------------------------------------------------------

class FakeFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'p';
  dir = mkdtempSync(path.join(os.tmpdir(), 'quiet-'));
  map = new Map<string, WorkerInfo>();
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk) {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', name: ask.name, status: 'idle', acked: true, createdAt: 0, viewers: [], viewerIds: [] } as unknown as WorkerInfo;
    this.map.set(id, w);
    mkdirSync(this.cwdOf(w), { recursive: true });
    return w;
  }
  async stop() {}
  prompt = () => undefined;
  wake = () => undefined;
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
}

test('a team member’s finished turns are routine at autonomy 3 and up; anyone else’s, and lower levels, still flag', async () => {
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'quiet-data-')), floors: () => [floor], makeIssue: async () => ({}), analysis: () => '', now: () => 0 }, 0);
  floor.roster = roster;
  assert.equal(await roster.members.hire(floor, 'lead-developer', 'Keith'), undefined);
  const dev = roster.data(floor.id).members['lead-developer'].workerId!;
  for (const [level, quiet] of [[1, false], [2, false], [3, true], [4, true]] as const) {
    roster.data(floor.id).settings.autonomy = level;
    assert.equal(roster.routineTurn(floor.id, dev), quiet, `level ${level}`);
    assert.equal(roster.routineTurn(floor.id, 'someone-else'), false);
  }
  assert.equal(roster.isMember(floor.id, dev), true);
  assert.equal(roster.isMember(floor.id, 'someone-else'), false);
  // What it has open with the Project Manager: its own, and those it +1'd.
  const w = floor.worker(dev)!;
  roster.escalations.raise(floor, w, { urgency: 'important', title: 'Which SSO?', details: '', options: [] });
  const other = { ...w, id: 'x9', name: 'Other' };
  floor.map.set('x9', other);
  const theirs = roster.escalations.raise(floor, other, { urgency: 'important', title: 'No test DB', details: '', options: [] });
  (theirs.also ??= []).push({ workerId: dev, by: 'Keith', at: 0 });
  roster.escalations.raise(floor, other, { urgency: 'important', title: 'Not ours', details: '', options: [] });
  assert.deepEqual(roster.openAsks(floor.id, dev), ['Which SSO?', 'No test DB']);
});
