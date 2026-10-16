// "Resolve old incidents…" (shared/incidents-bulk.ts, server/incidents/bulk.ts, POST
// /api/incidents/bulk-resolve): which it may resolve (mitigated, or not seen for 7+ days; never an open one
// seen this week), admins only, each through the normal resolve path (one 'resolve' line and one
// incident.resolved event each, with the note), one incident.bulk-resolve event, the chain still whole,
// and pressing it twice resolves nothing more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { AuditLog, readAudit, useAudit } from '../src/server/audit/index.js';
import { IncidentStore, createIncident, updateIncident, useIncidents } from '../src/server/incidents/index.js';
import { bulkResolve } from '../src/server/incidents/bulk.js';
import { incidentBulkRoutes } from '../src/server/http/routes/incidents-bulk.js';
import { BULK_NOTE, bulkCandidates, bulkResolvable } from '../src/shared/incidents-bulk.js';

const DAY = 24 * 3_600_000;
const T0 = Date.UTC(2026, 9, 16, 9, 0);
const ME = { kind: 'human' as const, name: 'Keith', id: 'acc1' };

function fresh() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'incidents-bulk-'));
  const clock = { t: T0 - 10 * DAY };
  useAudit(new AuditLog(path.join(dir, 'audit'), { now: () => clock.t }));
  const store = new IncidentStore(path.join(dir, 'incidents'), () => clock.t);
  useIncidents(store, () => clock.t);
  // Ten days ago: an old open one and one mitigated since; this week: a recent open one, a recent mitigated one, and one resolved.
  const old = createIncident({ title: 'Old stall', severity: 'sev3', floors: ['alpha'] }, ME)!;
  const mitOld = createIncident({ title: 'Old but mitigated', severity: 'sev2' }, ME)!;
  updateIncident(mitOld.id, { status: 'mitigated' }, ME);
  clock.t = T0 - 2 * DAY;
  const recent = createIncident({ title: 'Recent freeze', severity: 'sev3', floors: ['alpha'] }, ME)!;
  const mitRecent = createIncident({ title: 'Recent but mitigated', severity: 'sev3' }, ME)!;
  updateIncident(mitRecent.id, { status: 'mitigated' }, ME);
  const done = createIncident({ title: 'Done already', severity: 'sev3' }, ME)!;
  updateIncident(done.id, { status: 'resolved' }, ME);
  clock.t = T0;
  return { clock, store, old, mitOld, recent, mitRecent, done };
}

const ops = (store: IncidentStore) =>
  readFileSync(store.file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { op: string; incident?: { id: string } });

test('the selection: mitigated, or not seen for more than 7 days; never a recent open one or a resolved one', () => {
  const now = T0;
  assert.equal(bulkResolvable({ status: 'mitigated', lastSeenAt: now - 60_000 }, now), true);
  assert.equal(bulkResolvable({ status: 'open', lastSeenAt: now - 8 * DAY }, now), true);
  assert.equal(bulkResolvable({ status: 'open', lastSeenAt: now - 6 * DAY }, now), false);
  assert.equal(bulkResolvable({ status: 'open', lastSeenAt: now - 7 * DAY }, now), false, 'exactly 7 days is not more than 7');
  assert.equal(bulkResolvable({ status: 'resolved', lastSeenAt: now - 30 * DAY }, now), false);
  const { store, old, mitOld, mitRecent } = fresh();
  assert.deepEqual(bulkCandidates(store.list(), now).map((i) => i.id), [old.id, mitOld.id, mitRecent.id], 'oldest first');
});

test('each is resolved through the normal path with the note: one resolve line and event each, one summary event, the chain whole', async () => {
  const { store, old, mitOld, recent, mitRecent, done } = fresh();
  const before = ops(store).length;
  const r = bulkResolve([old.id, mitOld.id, mitRecent.id, recent.id, done.id, 'nope'], BULK_NOTE, ME, T0);
  assert.deepEqual(r.resolved.map((x) => x.id).sort(), [old.id, mitOld.id, mitRecent.id].sort());
  assert.deepEqual(Object.fromEntries(r.skipped.map((s) => [s.id, s.why])), { [recent.id]: 'seen in the last 7 days and not mitigated', [done.id]: 'resolved already', nope: 'no such incident' });
  assert.equal(store.get(recent.id)!.status, 'open', 'a recent open one is never touched, even when asked');
  const added = ops(store).slice(before);
  assert.deepEqual(added.map((l) => l.op), ['resolve', 'resolve', 'resolve'], 'one resolve line per incident, nothing else');
  for (const id of [old.id, mitOld.id, mitRecent.id]) {
    const i = store.get(id)!;
    assert.equal(i.status, 'resolved');
    assert.equal(i.timeline.at(-1)!.text, BULK_NOTE, 'the note on its timeline, in the same line');
  }
  assert.deepEqual(await store.verified(), { ok: true });
  const resolvedEvents = readAudit({ limit: 100, actions: ['incident.resolved'] }).events.filter((e) => e.details?.bulk);
  assert.equal(resolvedEvents.length, 3);
  assert.ok(resolvedEvents.every((e) => e.details?.note === BULK_NOTE));
  const bulk = readAudit({ limit: 100, actions: ['incident.bulk-resolve'] }).events;
  assert.equal(bulk.length, 1);
  assert.equal(bulk[0].details?.count, 3);
  assert.deepEqual((bulk[0].details?.ids as string[]).sort(), [old.id, mitOld.id, mitRecent.id].sort());
  // Pressed again: nothing more resolved, written or recorded.
  const lines = ops(store).length;
  const twice = bulkResolve([old.id, mitOld.id, mitRecent.id], BULK_NOTE, ME, T0);
  assert.equal(twice.resolved.length, 0);
  assert.equal(ops(store).length, lines);
  assert.equal(readAudit({ limit: 100, actions: ['incident.bulk-resolve'] }).events.length, 1);
});

function call(body: unknown, { admin = true, origin = 'http://office' } = {}) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', headers: { origin, host: 'office' } });
  let status = 0;
  let out: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => (out = JSON.parse(b)), headersSent: false };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin }) };
  const url = new URL('http://office/api/incidents/bulk-resolve');
  return Promise.resolve((incidentBulkRoutes.resolve.handle as (...a: unknown[]) => unknown)(ctx, { req, res, url, path: url.pathname, session: { account: { id: 'acc1', name: 'Keith' } } })).then(() => ({ status, body: out as Record<string, any> }));
}

test('the route: admins only, same origin, a note and ids required', async () => {
  const { store, old, mitOld } = fresh();
  assert.equal((await call({ ids: [old.id], note: 'x' }, { admin: false })).status, 403);
  assert.equal((await call({ ids: [old.id], note: 'x' }, { origin: 'http://evil' })).status, 403);
  assert.equal((await call({ ids: [old.id], note: '  ' })).status, 400);
  assert.equal((await call({ ids: [], note: 'x' })).status, 400);
  assert.equal(store.get(old.id)!.status, 'open', 'nothing resolved by a refused call');
  const ok = await call({ ids: [old.id, mitOld.id], note: 'Old noise' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.resolved.length, 2);
  assert.equal(store.get(old.id)!.status, 'resolved');
});
