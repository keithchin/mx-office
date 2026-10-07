// Held prompts outlive a restart (roster/held.ts): what the office promised to type into an agent once
// its turn is over (a tell, a person's phone reply, a subagent decision) is kept in the roster file,
// goes in once the agent is next between turns (merged into one message, never into a dialog, held by
// the spend cap and ⏸ Pause project except a person's), is let go after its expiry with an activity
// line and a `delivery.expired` audit event, and the same prompt held twice goes in once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditEvent } from '../src/shared/audit.js';
import type { RosterAlert, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { AuditLog, useAudit } from '../src/server/audit/index.js';
import { Roster, flushRoster, rosterFor } from '../src/server/roster/index.js';
import { HELD_KEPT, HELD_TTL_MS, heldId, reviveHeld } from '../src/server/roster/held.js';
import { setProjectPause } from '../src/server/project-run/store.js';
import type { TeamFloor } from '../src/server/roster/types.js';

class FakeFloor implements TeamFloor {
  id = `held-${Math.random().toString(36).slice(2, 8)}`;
  name = 'Probe';
  dir = mkdtempSync(path.join(os.tmpdir(), 'held-floor-'));
  map = new Map<string, WorkerInfo>();
  prompts: { id: string; text: string; by?: string }[] = [];
  wakes: { id: string; text?: string }[] = [];
  feed: string[] = [];
  roster!: Roster;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(): Promise<WorkerInfo> {
    throw new Error('not here');
  }
  add(id: string, name: string, status: WorkerStatus) {
    this.map.set(id, { id, kind: 'agent', provider: 'claude', deskId: 'd', name, color: '#fff', status, acked: true, createdBy: 'k', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo);
    return id;
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
  wake(id: string, text?: string) {
    if (!this.map.has(id)) return 'No such worker';
    this.wakes.push({ id, text });
    Object.assign(this.map.get(id)!, { status: 'starting' });
    return undefined;
  }
  rename() {}
  cwdOf = (w: WorkerInfo) => path.join(this.dir, 'wt', w.id);
  openPulls = () => [];
  toast = () => {};
  changed = (_alert?: RosterAlert) => {};
  activity = (text: string) => void this.feed.push(text);
  set(id: string, status: WorkerStatus) {
    Object.assign(this.map.get(id)!, { status });
    this.roster.onWorker(this, this.map.get(id)!);
  }
}

const clock = { now: Date.UTC(2026, 9, 7, 9, 0) };

function office(floor: FakeFloor, dataDir = mkdtempSync(path.join(os.tmpdir(), 'held-data-'))) {
  const roster = new Roster({ dataDir, floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => clock.now }, 0);
  floor.roster = roster;
  return { roster, dataDir };
}

/** The office stops (the roster file is written) and starts again on the same data, with the same workers. */
function restart(floor: FakeFloor, o: ReturnType<typeof office>) {
  o.roster.stop();
  return office(floor, o.dataDir);
}

test('held prompts survive a restart and go in as one message once the turn is over', () => {
  const floor = new FakeFloor();
  const x = floor.add('x1', 'Ada', 'needs_input');
  let o = office(floor);
  assert.equal(o.roster.delivery.send(floor, floor.worker(x)!, 'First note', { origin: 'agent', by: 'Bob', hold: true }).status, 'held');
  assert.equal(o.roster.delivery.send(floor, floor.worker(x)!, 'Second note', { origin: 'person', by: 'Kim', hold: true }).status, 'held');
  o = restart(floor, o);
  const saved = JSON.parse(readFileSync(path.join(o.dataDir, 'roster', `${floor.id}.json`), 'utf8')) as { held: { id: string; workerId: string; text: string; expiresAt: number; createdAt: number }[] };
  assert.equal(saved.held.length, 2, 'kept in the roster file');
  assert.equal(saved.held[0].expiresAt - saved.held[0].createdAt, HELD_TTL_MS, 'a day by default');
  assert.equal(o.roster.delivery.heldFor(x), 2, 'reloaded');
  // Still in its dialog, or booting: never typed.
  floor.set(x, 'needs_input');
  floor.set(x, 'starting');
  o.roster.tick();
  assert.equal(floor.prompts.length, 0);
  floor.set(x, 'done');
  assert.equal(floor.prompts.length, 1, 'one message');
  assert.match(floor.prompts[0].text, /First note\n\n---\n\nSecond note/);
  assert.equal(floor.prompts[0].by, 'Kim', "a person's words: the turn is theirs");
  assert.equal(o.roster.delivery.heldFor(x), 0, 'acknowledged: off the list once typed');
  floor.set(x, 'idle');
  o.roster.tick();
  assert.equal(floor.prompts.length, 1, 'not again');
  o = restart(floor, o);
  assert.equal(o.roster.delivery.heldFor(x), 0, 'and not after another restart either');
  o.roster.stop();
});

test("after a restart the minute's look delivers to an agent already between turns, with no update", () => {
  const floor = new FakeFloor();
  const x = floor.add('x1', 'Ada', 'needs_input');
  let o = office(floor);
  o.roster.delivery.send(floor, floor.worker(x)!, 'Waiting for you', { origin: 'agent', by: 'Bob', hold: true });
  Object.assign(floor.worker(x)!, { status: 'idle' }); // its dialog closed while the office was down
  o = restart(floor, o);
  o.roster.tick();
  assert.deepEqual(floor.prompts.map((p) => p.text), ['Waiting for you']);
  o.roster.tick();
  assert.equal(floor.prompts.length, 1);
  o.roster.stop();
});

test('the same prompt held twice goes in once; one typed now takes its held copy with it', () => {
  const floor = new FakeFloor();
  const x = floor.add('x1', 'Ada', 'needs_input');
  const o = office(floor);
  const d = o.roster.delivery;
  let calls = 0;
  d.send(floor, floor.worker(x)!, 'Same words', { origin: 'agent', by: 'Bob', hold: true, onSent: () => calls++ });
  d.send(floor, floor.worker(x)!, 'Same words', { origin: 'agent', by: 'Bob', hold: true, onSent: () => calls++ });
  d.send(floor, floor.worker(x)!, 'Other words', { origin: 'agent', by: 'Bob', hold: true, id: 'k1' });
  d.send(floor, floor.worker(x)!, 'Other words, reworded', { origin: 'agent', by: 'Bob', hold: true, id: 'k1' });
  assert.equal(d.heldFor(x), 2);
  floor.set(x, 'done');
  assert.equal(floor.prompts.length, 1);
  assert.equal(floor.prompts[0].text, 'Same words\n\n---\n\nOther words');
  assert.equal(calls, 2, 'each sender hears once');
  // Held, then sent again with the same id while it's free: typed then, and the held copy is done.
  floor.set(x, 'needs_input');
  d.send(floor, floor.worker(x)!, 'Decision', { origin: 'person', by: 'Kim', hold: true, between: true, id: 'dec-1' });
  floor.map.get(x)!.status = 'idle';
  assert.equal(d.send(floor, floor.worker(x)!, 'Decision', { origin: 'person', by: 'Kim', id: 'dec-1' }).status, 'sent');
  assert.equal(d.heldFor(x), 0);
  floor.set(x, 'done');
  assert.equal(floor.prompts.filter((p) => p.text === 'Decision').length, 1);
  assert.equal(heldId('a', 'agent', 't', 'b'), heldId('a', 'agent', 't', 'b'));
  assert.notEqual(heldId('a', 'agent', 't', 'b'), heldId('c', 'agent', 't', 'b'));
  o.roster.stop();
});

test('a held prompt past its expiry is let go, with an activity line and a delivery.expired audit event', () => {
  const floor = new FakeFloor();
  const x = floor.add('x1', 'Ada', 'needs_input');
  const seen: AuditEvent[] = [];
  useAudit(new AuditLog(path.join(mkdtempSync(path.join(os.tmpdir(), 'held-audit-')), 'audit')), (e) => seen.push(e));
  try {
    let o = office(floor);
    o.roster.delivery.send(floor, floor.worker(x)!, 'Old news', { origin: 'agent', by: 'Bob', hold: true });
    o.roster.delivery.send(floor, floor.worker(x)!, 'Short-lived', { origin: 'agent', by: 'Cy', hold: true, ttlMs: 60_000 });
    clock.now += 2 * 60_000;
    o = restart(floor, o);
    o.roster.tick();
    assert.equal(o.roster.delivery.heldFor(x), 1);
    assert.match(floor.feed.join('\n'), /⌛ A message from Cy held for Ada was let go/);
    // Past a day it's let go too, even if its turn ends before the minute's look sees it.
    clock.now += HELD_TTL_MS;
    floor.set(x, 'done');
    assert.equal(floor.prompts.length, 0, 'never typed once expired');
    o.roster.tick();
    assert.equal(o.roster.delivery.heldFor(x), 0);
    const expired = seen.filter((e) => e.action === 'delivery.expired');
    assert.equal(expired.length, 2);
    assert.equal(expired[1].target?.id, x);
    assert.equal(expired[1].details?.by, 'Bob');
    o.roster.stop();
  } finally {
    useAudit(undefined);
  }
});

test("past the spend cap or paused, only a person's held prompts go in; the rest wait and survive a restart", () => {
  const floor = new FakeFloor();
  const x = floor.add('x1', 'Ada', 'needs_input');
  let o = office(floor);
  o.roster.delivery.send(floor, floor.worker(x)!, 'From the office', { origin: 'office', hold: true });
  o.roster.delivery.send(floor, floor.worker(x)!, 'From a person', { origin: 'person', by: 'Kim', hold: true });
  o = restart(floor, o);
  setProjectPause(floor.id, { at: clock.now, by: 'Kim' } as Parameters<typeof setProjectPause>[1]);
  try {
    assert.ok(o.roster.delivery.paused(floor));
    floor.set(x, 'done');
    assert.deepEqual(floor.prompts.map((p) => p.text), ['From a person']);
    assert.equal(o.roster.delivery.heldFor(x), 1, "the office's waits");
    o.roster.tick();
    floor.set(x, 'idle');
    assert.equal(floor.prompts.length, 1);
    o = restart(floor, o);
    assert.equal(o.roster.delivery.heldFor(x), 1);
  } finally {
    setProjectPause(floor.id, undefined);
  }
  o.roster.tick();
  assert.deepEqual(floor.prompts.map((p) => p.text), ['From a person', 'From the office'], 'resumed: it goes in');
  // The daily cap holds it the same way.
  floor.set(x, 'needs_input');
  o.roster.delivery.send(floor, floor.worker(x)!, 'Office again', { origin: 'office', hold: true });
  const d = o.roster.data(floor.id);
  d.settings.costCaps = { [d.settings.autonomy]: 5 };
  d.spend = { day: d.spend.day, usd: 6, seen: {} };
  assert.ok(o.roster.pauseOf(d));
  o.roster.tick();
  floor.set(x, 'done');
  assert.equal(floor.prompts.length, 2);
  assert.equal(o.roster.delivery.heldFor(x), 1);
  o.roster.stop();
});

test('a worker that leaves takes its held prompts with it, saved', () => {
  const floor = new FakeFloor();
  const x = floor.add('x1', 'Ada', 'needs_input');
  let o = office(floor);
  o.roster.delivery.send(floor, floor.worker(x)!, 'Lost', { origin: 'agent', hold: true });
  void floor.stop(x);
  o = restart(floor, o);
  assert.equal(o.roster.delivery.heldFor(x), 0);
  o.roster.stop();
});

test('a saved list is revived whole: bad rows dropped, repeated ids once, an old row gets an expiry, capped', () => {
  const rows = reviveHeld([
    { id: 'a', workerId: 'w', origin: 'agent', text: 'one', createdAt: 5 },
    { id: 'a', workerId: 'w', origin: 'agent', text: 'dup', createdAt: 6 },
    { id: 'b', workerId: 'w', origin: 'martian', text: 'bad origin' },
    { id: 'c', workerId: 'w', origin: 'person', text: '' },
    null,
  ]);
  assert.deepEqual(rows, [{ id: 'a', workerId: 'w', origin: 'agent', text: 'one', createdAt: 5, expiresAt: 5 + HELD_TTL_MS }]);
  assert.deepEqual(reviveHeld(undefined), []);
  const many = Array.from({ length: HELD_KEPT + 5 }, (_, i) => ({ id: `i${i}`, workerId: 'w', origin: 'office', text: 't', createdAt: i, expiresAt: i + 1 }));
  const kept = reviveHeld(many);
  assert.equal(kept.length, HELD_KEPT);
  assert.equal(kept[0].id, 'i5', 'the oldest go first');
});

// The journey test (scripts/perf/journey.mjs) found a held prompt lost by a safe restart: the roster's
// save waits half a second on an unref'd timer, and the office's shutdown never wrote it, so the
// restart's exit came first. The shutdown now writes the roster (flushRoster in server.ts).
test('a held prompt is on disk the moment the office shuts down, without waiting for the save', () => {
  const floor = new FakeFloor();
  const x = floor.add('x1', 'Ada', 'needs_input');
  const o = office(floor);
  const key = {};
  assert.equal(rosterFor(key, () => o.roster), o.roster);
  assert.equal(o.roster.delivery.send(floor, floor.worker(x)!, 'Held through the restart', { origin: 'person', by: 'Kim', hold: true }).status, 'held');
  const file = path.join(o.dataDir, 'roster', `${floor.id}.json`);
  const heldOnDisk = () => existsSync(file) && (JSON.parse(readFileSync(file, 'utf8')) as { held?: { text: string }[] }).held?.some((h) => h.text === 'Held through the restart');
  assert.ok(!heldOnDisk(), 'not yet: the save waits');
  flushRoster(key);
  assert.ok(heldOnDisk(), 'written by the shutdown');
  flushRoster({});
  o.roster.stop();
});

test("the office's shutdown writes the roster", () => {
  const src = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8');
  const shutdown = src.slice(src.indexOf('const shutdown = '), src.indexOf('};', src.indexOf('const shutdown = ')));
  assert.match(shutdown, /flushRoster\(ctx\.cfg\)/);
  assert.ok(shutdown.indexOf('flushRoster(') > shutdown.indexOf('f.shutdown(keep)'), 'after the floors stop (their workers leaving touch the roster too)');
});
