// Release 82, team flow #1: the docked chat addresses any Lead directly (the Coordinator stays the default), and
// each message's delivery is shown per recipient from what the office itself did (typed, held, not delivered),
// never from an agent's claim (server/roster/interrupts.ts `to`, server/roster/delivery-log.ts,
// shared/roster/delivery.ts). Fake agents only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Roster } from '../src/server/roster/index.js';
import type { HireAsk, TeamFloor } from '../src/server/roster/types.js';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { atRecipient, deliveryWords, latestPerRecipient, recipientsOf, type DeliveryRecord } from '../src/shared/roster/delivery.js';
import { deliveriesOf, forgetDeliveries, noteDelivery } from '../src/server/roster/delivery-log.js';

class FakeFloor implements TeamFloor {
  id = `cr-${Math.random().toString(36).slice(2, 8)}`;
  name = 'chat-test';
  dir = mkdtempSync(path.join(os.tmpdir(), 'chat-floor-'));
  map = new Map<string, WorkerInfo>();
  typed: { id: string; text: string }[] = [];
  changes = 0;
  roster!: Roster;
  private n = 0;
  workers = () => [...this.map.values()];
  worker = (id: string) => this.map.get(id);
  async hire(ask: HireAsk): Promise<WorkerInfo> {
    const id = `w${++this.n}`;
    const w = { id, kind: 'agent', provider: 'claude', deskId: 'd', name: ask.name, color: '#fff', status: 'starting', acked: true, createdBy: ask.by, createdAt: Date.now(), cols: 80, rows: 24, viewers: [], viewerIds: [] } as unknown as WorkerInfo;
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
  changed = () => void this.changes++;
  activity = () => {};
  set(id: string, status: WorkerStatus) {
    Object.assign(this.map.get(id)!, { status });
    this.roster.onWorker(this, this.map.get(id)!);
  }
}

test('a message to a Lead goes to it directly, not the Coordinator, and its delivery is recorded per recipient', async () => {
  forgetDeliveries();
  const floor = new FakeFloor();
  const roster = new Roster({ dataDir: mkdtempSync(path.join(os.tmpdir(), 'chat-data-')), floors: () => [floor], makeIssue: async () => ({ number: 1 }), analysis: () => '', now: () => Date.now() }, 0);
  floor.roster = roster;
  assert.equal(await roster.members.hire(floor, 'pm', 'Pat'), undefined);
  assert.equal(await roster.members.hire(floor, 'lead-developer', 'Pat'), undefined);
  const d = roster.data(floor.id);
  const pm = d.members.pm.workerId!;
  const dev = d.members['lead-developer'].workerId!;
  floor.set(pm, 'idle');
  floor.set(dev, 'idle');
  floor.typed.length = 0;
  assert.equal(await roster.interrupts.tell(floor, 'Please rebuild row 12 with the new layout.', 'Pat', 'now', {}, undefined, undefined, undefined, 'lead-developer'), undefined);
  assert.equal(floor.typed.length, 1);
  assert.equal(floor.typed[0].id, dev, 'typed to the Lead Developer, not the Coordinator');
  assert.match(floor.typed[0].text, /rebuild row 12/);
  // The default stays the Coordinator.
  assert.equal(await roster.interrupts.tell(floor, 'Status update please.', 'Pat', 'now'), undefined);
  assert.equal(floor.typed.at(-1)!.id, pm);
  const recs = deliveriesOf(floor.id);
  assert.deepEqual(recs.map((r) => [r.to.name, r.state, r.via]), [[d.members['lead-developer'].name, 'typed', 'person'], [d.members.pm.name, 'typed', 'person']]);
  assert.ok(floor.changes > 0, 'the roster is refreshed for the chat');
  // It's on the roster's view for the chat; a member mid-turn with "after" is held, honestly.
  floor.set(dev, 'working');
  assert.equal(await roster.interrupts.tell(floor, 'And row 13 after that.', 'Pat', 'after', {}, undefined, undefined, undefined, 'lead-developer'), undefined);
  const view = roster.view(floor, true);
  const last = latestPerRecipient(view.deliveries);
  assert.equal(last[0].to.workerId, dev);
  assert.equal(last[0].state, 'held');
  assert.match(deliveryWords(last[0]), /Held for after .*'s turn \(not typed yet\)/);
  // Its turn ends: the held message goes in and the line says typed.
  floor.set(dev, 'idle');
  // The durable dispatch is marked in flight on disk before it's typed: a moment later.
  for (let i = 0; i < 100 && latestPerRecipient(roster.view(floor, true).deliveries)[0].state !== 'typed'; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(latestPerRecipient(roster.view(floor, true).deliveries)[0].state, 'typed');
  assert.match(floor.typed.at(-1)!.text, /row 13 after that/);
  // A Lead not at work: refused, nothing recorded as delivered.
  assert.match((await roster.interrupts.tell(floor, 'Hello', 'Pat', 'now', {}, undefined, undefined, undefined, 'lead-tester')) ?? '', /isn't at work/);
});

test('a relay the office refused shows as not delivered with why, whatever the relay claims', () => {
  forgetDeliveries();
  const log = noteDelivery('f1', { at: 1, from: 'Avery', via: 'relay', to: { name: 'Blake', role: 'Lead Developer', workerId: 'w2' }, excerpt: 'Please rebuild row 12' });
  log.settle({ status: 'refused', why: 'Spend cap reached' });
  const [r] = deliveriesOf('f1');
  assert.equal(r.state, 'refused');
  assert.equal(deliveryWords(r), '✗ Avery → Not delivered to Blake (Lead Developer): Spend cap reached');
});

test('recipients: the lead first and default, benched and unhired left out; @Name picks one', () => {
  const members = [
    { role: 'lead-developer', name: 'Blake', title: 'Lead Developer', status: 'idle', workerId: 'w2' },
    { role: 'pm', name: 'Avery', title: 'Project Coordinator', status: 'working', workerId: 'w1' },
    { role: 'lead-tester', name: 'Casey', title: 'Lead Tester', status: 'benched' },
    { role: 'lead-designer', name: 'Drew', title: 'Lead Designer', status: 'not-hired' },
  ];
  const rs = recipientsOf(members, 'pm');
  assert.deepEqual(rs.map((r) => [r.role, r.lead, r.ok]), [['pm', true, true], ['lead-developer', false, true]]);
  assert.deepEqual(atRecipient('@Blake please rebuild row 12', rs), { role: 'lead-developer', rest: 'please rebuild row 12' });
  assert.deepEqual(atRecipient('@lead-developer: row 12', rs), { role: 'lead-developer', rest: 'row 12' });
  assert.equal(atRecipient('@Nobody hi', rs), undefined);
  const recs: DeliveryRecord[] = [
    { id: 'a', at: 1, from: 'Pat', via: 'person', to: { name: 'Blake', workerId: 'w2' }, state: 'held', excerpt: 'x' },
    { id: 'b', at: 2, from: 'Pat', via: 'person', to: { name: 'Blake', workerId: 'w2' }, state: 'typed', typedAt: 2, excerpt: 'y' },
    { id: 'c', at: 3, from: 'Avery', via: 'relay', to: { name: 'Casey', workerId: 'w3' }, state: 'woke', excerpt: 'z' },
  ];
  assert.deepEqual(latestPerRecipient(recs).map((r) => r.id), ['c', 'b']);
});
