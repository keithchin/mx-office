// A worker update that lands back in the roster while it's still handling the last one. The real
// worker manager announces a worker again the moment anything is typed into it (WorkerManager.prompt
// → emitUpdate → floors.ts workerChanged → Roster.onWorker), so whatever the roster types from inside
// onWorker comes straight back to it before its sender has noted it was sent. Handled there and then,
// the same prompt went again and again until the stack ran out ("project team on travel-approval:
// Maximum call stack size exceeded"): a Lead nudged about a flagged subagent, held prompts typed once
// a turn is over, a Lead's notes. Each must go exactly once, and the echo still be handled after.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { Roster } from '../src/server/roster/index.js';
import { NUDGE_GRACE_MS } from '../src/server/roster/nudge.js';
import { LEAD_NOTES_DEBOUNCE_MS } from '../src/server/roster/relays.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';

/** A floor whose prompt announces the worker again at once, as the real worker manager does. */
class EchoFloor implements TeamFloor {
  id = `f${Math.random().toString(36).slice(2, 8)}`;
  name = 'travel-approval';
  dir = mkdtempSync(path.join(os.tmpdir(), 'reentry-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string }[] = [];
  updates = 0;
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
  async stop() {}
  prompt(id: string, text: string) {
    const w = this.map.get(id);
    if (!w || w.status === 'exited' || w.status === 'offline') return 'Worker is not running';
    this.prompts.push({ id, text });
    if (this.prompts.length > 50) throw new Error('prompted over and over');
    this.emit(w); // WorkerManager.prompt → emitUpdate, status unchanged
    return undefined;
  }
  wake(id: string) {
    Object.assign(this.map.get(id)!, { status: 'starting' });
    this.emit(this.map.get(id)!);
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => {};
  changed = () => {};
  emit(w: WorkerInfo) {
    this.updates++;
    this.roster.onWorker(this, w);
  }
  set(id: string, status: WorkerStatus) {
    Object.assign(this.map.get(id)!, { status });
    this.emit(this.map.get(id)!);
  }
}

async function setup() {
  const clock = { now: Date.UTC(2026, 9, 7, 2, 55) };
  const floor = new EchoFloor();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'reentry-data-'));
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => clock.now }, 0);
  floor.roster = roster;
  const d = roster.data(floor.id);
  d.settings.schedule.enabled = false;
  assert.equal(await roster.members.hire(floor, 'lead-developer', 'Probe'), undefined);
  const id = d.members['lead-developer'].workerId!;
  floor.set(id, 'working');
  floor.set(id, 'done');
  floor.prompts.length = 0;
  return { clock, floor, roster, d, id };
}

const settle = () => new Promise((r) => setImmediate(r));

test('a Lead is nudged about its flagged subagent once, though the nudge brings its update straight back', async () => {
  const t = await setup();
  const rec = { name: 'developer', lead: 'lead-developer' as const, state: 'active' as const, warnings: [], runs: [], flaggedAt: t.clock.now - 1000 };
  t.d.subagents['lead-developer/developer'] = rec;
  t.clock.now += NUDGE_GRACE_MS + 1000;
  t.floor.set(t.id, 'idle');
  await settle();
  assert.equal(t.floor.prompts.filter((p) => p.text.includes('underperforming')).length, 1);
  assert.equal(rec.nudgedAt, t.clock.now, 'noted as nudged');
  t.floor.set(t.id, 'idle');
  await settle();
  assert.equal(t.floor.prompts.length, 1, 'not again for the same finding');
  t.roster.stop();
});

test('a prompt held behind a dialog is typed once when the turn is over', async () => {
  const t = await setup();
  t.floor.set(t.id, 'needs_input');
  const w = t.floor.worker(t.id)!;
  let sent = 0;
  assert.equal(t.roster.delivery.send(t.floor, w, 'Held for after the dialog', { origin: 'office', hold: true, onSent: () => sent++ }).status, 'held');
  t.floor.set(t.id, 'done');
  await settle();
  assert.deepEqual(t.floor.prompts.map((p) => p.text), ['Held for after the dialog']);
  assert.equal(sent, 1);
  assert.equal(t.roster.delivery.heldFor(t.id), 0);
  t.roster.stop();
});

test("a Lead's notes go once, and the update the prompt brought back is still handled after", async () => {
  const t = await setup();
  t.roster.relays.noteLead(t.floor, 'lead-developer', 'Your proposal was approved');
  t.clock.now += LEAD_NOTES_DEBOUNCE_MS + 1000;
  const before = t.floor.updates;
  t.floor.set(t.id, 'done');
  assert.equal(t.floor.prompts.length, 1);
  assert.deepEqual(t.roster.relays.owed(t.floor.id, 'lead-developer'), []);
  // The echo of that prompt waited for the first update to finish, then went through on its own.
  const handled = t.roster.idleSince(t.id);
  await settle();
  assert.equal(t.floor.updates, before + 2);
  assert.equal(t.roster.idleSince(t.id), handled);
  assert.equal(t.floor.prompts.length, 1);
  t.roster.stop();
});
