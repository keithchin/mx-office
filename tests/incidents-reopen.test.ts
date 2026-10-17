// A rule firing again after someone resolved its incident (server/incidents/index.ts raise): within the
// dedupe window the resolved one comes back (same number, "came back after … resolved it at …", a full
// 'reopen' line that keeps the hash chain and that an office from before reads as an update); later, a new
// one that says which it follows. Page freezes keep one incident per view per project (perfwatch), and an
// open incident from before views were part of the key still takes their recurrences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditLog, readAudit, useAudit } from '../src/server/audit/index.js';
import { IncidentStore, createIncident, dedupeKeyOf, raise, sameIncident, updateIncident, useIncidents, type Detection } from '../src/server/incidents/index.js';
import { pageDetection } from '../src/server/perfwatch/index.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 9, 16, 7, 0);
const ME = { kind: 'human' as const, name: 'Keith', id: 'acc1' };

function fresh() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'incidents-reopen-'));
  const clock = { t: T0 };
  useAudit(new AuditLog(path.join(dir, 'audit'), { now: () => clock.t }));
  const store = new IncidentStore(path.join(dir, 'incidents'), () => clock.t);
  useIncidents(store, () => clock.t);
  return { clock, store };
}

const lines = (store: IncidentStore) =>
  readFileSync(store.file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { op: string; incident?: { id: string; status: string } });

const freeze = (view: string, ms = 900, floor = 'sample-checksheet-demo'): Detection => pageDetection({ view, ms, floor, stack: ['1243 ms FrameRequestCallback perfwatch-on.js@365576'], url: `/lite?floor=${floor}&tab=command` }, 'Someone', true);

test('a freeze after the person resolved it reopens the same incident, says who resolved it when, and keeps the chain', async () => {
  const { clock, store } = fresh();
  const a = raise(freeze('lite › command'))!;
  assert.equal(a.number, 1);
  clock.t += 20 * MIN;
  updateIncident(a.id, { status: 'resolved' }, ME);
  clock.t += 5 * MIN;
  const back = raise(freeze('lite › command', 1272))!;
  assert.equal(back.id, a.id, 'the same incident, not a new number');
  assert.equal(back.number, 1);
  assert.equal(back.status, 'open');
  assert.equal(back.resolvedAt, undefined);
  assert.equal(back.reopens, 1);
  assert.equal(back.occurrences, 2);
  const came = back.timeline.find((t) => t.kind === 'recurrence')!;
  assert.match(came.text, /^Came back after Keith resolved it at 16 Oct \d\d:\d\d: Froze again: lite › command, 1272 ms/);
  assert.ok(back.timeline.some((t) => t.kind === 'status' && t.text === 'Status resolved → open'));
  assert.equal(store.list().length, 1);
  // One full 'reopen' line, after the resolve; the next freeze is a small 'recur' line again (release 51's format).
  clock.t += MIN;
  raise(freeze('lite › command', 800));
  assert.deepEqual(lines(store).map((l) => l.op), ['create', 'resolve', 'reopen', 'recur']);
  assert.equal(lines(store)[2].incident?.status, 'open');
  assert.deepEqual(await store.verified(), { ok: true });
  // Read back fresh it's open and counted; an office from before reads the 'reopen' line as the incident it carries.
  const again = new IncidentStore(store.dir).get(a.id)!;
  assert.equal(again.status, 'open');
  assert.equal(again.occurrences, 3);
  const audit = readAudit({ limit: 50, actions: ['incident.updated'] }).events.find((e) => e.details?.reopened);
  assert.ok(audit, 'the reopen is in the audit log');
  assert.match(audit!.summary, /INC-1 came back after it was resolved/);
});

test('past the window after the resolve a new incident opens, and it says which one it follows', () => {
  const { clock } = fresh();
  const a = raise(freeze('lite › command'))!;
  updateIncident(a.id, { status: 'resolved' }, ME);
  clock.t += 25 * HOUR;
  const b = raise(freeze('lite › command'))!;
  assert.notEqual(b.id, a.id);
  assert.equal(b.number, 2);
  assert.deepEqual(b.follows, { id: a.id, number: 1 });
  assert.ok(b.timeline.some((t) => /Seen before as INC-1/.test(t.text)));
});

test('page freezes: one open incident per view per project; the same view folds into it', () => {
  const { store } = fresh();
  const cmd = raise(freeze('lite › command'))!;
  assert.equal(cmd.dedupeKey, 'pageStall:sample-checksheet-demo:lite › command');
  assert.equal(raise(freeze('lite › command', 1500))!.id, cmd.id);
  const q = raise(freeze('lite › questions'))!;
  assert.notEqual(q.id, cmd.id, 'another view: its own incident');
  assert.notEqual(raise(freeze('lite › command', 900, 'travel'))!.id, cmd.id, 'another project');
  assert.equal(store.list().filter((i) => i.status === 'open').length, 3);
  assert.equal(store.get(cmd.id)!.occurrences, 2);
});

test('an incident kept before views were in the key: open, it takes every view; resolved, only its own', () => {
  const { store } = fresh();
  // As release 53 kept it: pageStall:<floor>.
  const old = createIncident({ title: 'A page froze for 766 ms (lite › command)', severity: 'sev3', floors: ['sample-checksheet-demo'], dedupeKey: 'pageStall:sample-checksheet-demo', detectedBy: { kind: 'rule', name: 'Incident rules', rule: 'pageStall' } }, { kind: 'office', name: 'Incident rules' })!;
  assert.equal(raise(freeze('lite › teams'))!.id, old.id, 'open: folds in');
  updateIncident(old.id, { status: 'resolved' }, ME);
  assert.equal(raise(freeze('lite › command'))!.id, old.id, 'resolved: its own view brings it back');
  updateIncident(old.id, { status: 'resolved' }, ME);
  assert.notEqual(raise(freeze('lite › questions'))!.id, old.id, "resolved: another view's freeze is a new one");
  assert.equal(store.list().length, 2);
  assert.equal(sameIncident({ dedupeKey: 'pageStall:sample-checksheet-demo', status: 'resolved', title: 'A page froze for 1 ms (lite › board)' }, { rule: 'pageStall', floor: 'sample-checksheet-demo', place: 'lite › board' }), true);
  assert.equal(dedupeKeyOf({ rule: 'crashLoop', floor: 'alpha' }), 'crashLoop:alpha', 'a rule without places keeps its key');
});
