// The incidents file stays small and cheap to read (server/incidents/store.ts, recur.ts). On the live office
// INC-12, the server-stall incident, had 246 full copies of itself (6.2 MB): every recurrence rewrote the
// whole incident with its timeline, and GET /api/incidents read and hashed the whole file on every request,
// blocking the event loop for 0.7 to 6 s, which the stall rule then recorded as another recurrence. Now a
// recurrence is a small 'recur' line folded on read, the chain is verified once in the background and kept
// (extended by this process's own appends, verified again only when the file changed some other way), the
// route never hashes, old full-copy files still read and verify, and an edited line is still found.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { IncidentStore, raise, useIncidents } from '../src/server/incidents/index.js';
import { RECUR_HEAD, RECUR_TAIL, trimTimeline } from '../src/server/incidents/recur.js';
import { incidentRoutes } from '../src/server/http/routes/incidents.js';
import { useAudit, AuditLog } from '../src/server/audit/index.js';
import { serverDetection } from '../src/server/perfwatch/index.js';
import type { Incident, IncidentList, TimelineEntry } from '../src/shared/incidents.js';

const T0 = Date.parse('2026-10-16T00:00:00Z');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function fresh() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'inc-store-'));
  const clock = { t: T0 };
  useAudit(new AuditLog(path.join(dir, 'audit'), { now: () => clock.t }));
  const store = new IncidentStore(path.join(dir, 'incidents'), () => clock.t);
  useIncidents(store, () => clock.t);
  return { dir, clock, store };
}

/** A file the way release 50 wrote it: a full copy of the incident per change, hash-chained. */
function oldFormatFile(file: string, copies: number, noteChars = 900): Incident {
  const base: Incident = { id: 'inc-stall', number: 12, title: 'The office server stalled for 1279 ms', severity: 'sev3', status: 'open', detectedAt: T0, detectedBy: { kind: 'rule', name: 'Incident rules', rule: 'serverStall' }, floors: [], summary: "The server's event loop was blocked.", impact: {}, timeline: [], actions: [], auditIds: [], workers: [], dedupeKey: 'serverStall:_office', occurrences: 1, lastSeenAt: T0, createdAt: T0, updatedAt: T0 };
  const lines: string[] = [];
  let i = base;
  for (let n = 0; n < copies; n++) {
    const e: TimelineEntry = n % 9 === 4 ? { at: T0 + n, by: 'Performance watch', text: `CPU profile: ${'x'.repeat(noteChars)}`, kind: 'note' } : { at: T0 + n, by: 'Incident rules', text: `Stalled again: ${1000 + n} ms`, kind: 'recurrence' };
    i = { ...i, occurrences: n + 1, lastSeenAt: T0 + n, updatedAt: T0 + n, timeline: [...i.timeline, e].slice(-200) };
    const body = { at: T0 + n, op: n ? 'update' : 'create', by: 'Incident rules', incident: i, prev: lines.length ? sha(lines[lines.length - 1]) : '' };
    lines.push(JSON.stringify({ ...body, hash: sha(JSON.stringify(body)) }));
  }
  writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
  return i;
}

/** The route's answer, and how long its handler held the event loop (it's synchronous). */
function getList(store: IncidentStore, query = 'floor=all'): { body: IncidentList; ms: number } {
  let out = '';
  const res = { writeHead: () => res, end: (s: string) => void (out = s) } as never;
  const ctx = { meOf: () => ({ admin: true }) } as never;
  useIncidents(store);
  const t = performance.now();
  void incidentRoutes.list.handle(ctx, { res, url: new URL(`http://x/api/incidents?${query}`), session: { account: { id: 'a', name: 'Keith' } } } as never);
  const ms = performance.now() - t;
  return { body: JSON.parse(out) as IncidentList, ms };
}

/** The longest the event loop was late for a 5 ms timer while `p` ran. */
async function longestBlock<T>(p: () => Promise<T>): Promise<{ value: T; worst: number }> {
  let worst = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last - 5);
    last = now;
  }, 5);
  const value = await p();
  clearInterval(timer);
  return { value, worst };
}

test('a recurrence appends a small line (not the whole incident), the chain holds, and the fold read back is the same incident', async () => {
  const { store, clock } = fresh();
  const first = raise({ ...serverDetection(1279), at: T0 })!;
  const sizeAfterCreate = statSync(store.file).size;
  for (let n = 1; n <= 300; n++) {
    clock.t = T0 + n * 60_000;
    raise({ ...serverDetection(1000 + n), at: clock.t });
  }
  const lines = readFileSync(store.file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 301);
  const recurs = lines.slice(1).map((l) => JSON.parse(l));
  assert.ok(recurs.every((l) => l.op === 'recur' && l.id === first.id && !l.incident));
  const biggest = Math.max(...lines.slice(1).map((l) => l.length));
  assert.ok(biggest < 1000, `a recurrence line is ${biggest} bytes`);
  // Linear, small growth: 300 recurrences are well under what one release-50 full copy of INC-12 was (47 KB).
  assert.ok(statSync(store.file).size - sizeAfterCreate < 300 * 1000);
  const now = store.get(first.id)!;
  assert.equal(now.occurrences, 301);
  assert.equal(now.timeline.filter((e) => e.kind === 'recurrence').length, RECUR_HEAD + RECUR_TAIL);
  assert.equal(now.timeline.at(-1)?.text, 'Stalled again: 1300 ms');
  // Read back fresh: the same incident.
  assert.deepEqual(new IncidentStore(store.dir).get(first.id), now);
  assert.deepEqual(await new IncidentStore(store.dir).verified(), { ok: true });
});

test("a file release 50 wrote (full copies with long timelines) still reads and verifies, and recurrences append onto it", async () => {
  const { store, clock } = fresh();
  const { mkdirSync } = await import('node:fs');
  mkdirSync(store.dir, { recursive: true });
  const last = oldFormatFile(store.file, 60);
  const s1 = new IncidentStore(store.dir, () => clock.t);
  useIncidents(s1, () => clock.t);
  assert.deepEqual(s1.get('inc-stall'), last);
  assert.deepEqual(await s1.verified(), { ok: true });
  clock.t = T0 + 1000;
  raise({ ...serverDetection(2000), at: clock.t });
  // Its own append extended the kept state: no re-verification needed, and it's right.
  assert.deepEqual(s1.verify(), { ok: true });
  assert.equal(s1.get('inc-stall')?.occurrences, 61);
  assert.deepEqual(await new IncidentStore(store.dir).verified(), { ok: true });
  assert.equal(new IncidentStore(store.dir).get('inc-stall')?.occurrences, 61);
});

test('an edited line is still found, by the background verification, with when it was written', async () => {
  const { store } = fresh();
  const { mkdirSync } = await import('node:fs');
  mkdirSync(store.dir, { recursive: true });
  oldFormatFile(store.file, 30);
  assert.deepEqual(await store.verified(), { ok: true });
  const lines = readFileSync(store.file, 'utf8').split('\n');
  lines[10] = lines[10].replace('Stalled again', 'Stalled AGAIN');
  writeFileSync(store.file, lines.join('\n'));
  assert.equal(store.verify().checking, true);
  const r = await store.verified();
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, T0 + 10);
  assert.deepEqual(store.verify(), { ok: false, brokenAt: T0 + 10 });
});

test('GET /api/incidents never verifies on the request: it returns the kept state, and a 6 MB file stays under 50 ms', async () => {
  const { store } = fresh();
  const { mkdirSync } = await import('node:fs');
  mkdirSync(store.dir, { recursive: true });
  // Shaped like the live file: ~250 full copies of an incident whose timeline grew to 200 entries with CPU-profile notes.
  oldFormatFile(store.file, 250, 2000);
  const size = statSync(store.file).size;
  assert.ok(size > 5_000_000, `fixture is ${size} bytes`);
  store.list(); // the office reads it once at start (incidents/office.ts)
  // Cold: the first answer doesn't wait for a verification, it says one is running.
  const cold = getList(store);
  assert.equal(cold.body.chain.checking, true);
  assert.ok(cold.ms < 50, `cold GET held the loop ${cold.ms.toFixed(1)} ms`);
  // The background verification lets the event loop breathe (slices between turns).
  const { value, worst } = await longestBlock(() => store.verified());
  assert.deepEqual(value, { ok: true });
  assert.ok(worst < 100, `the verification blocked the loop ${worst.toFixed(1)} ms at worst`);
  // Warm: no hashing, the kept answer, fast, every time.
  let calls = 0;
  const real = store.verified.bind(store);
  store.verified = () => (calls++, real());
  const times: number[] = [];
  for (let n = 0; n < 20; n++) {
    const r = getList(store);
    assert.deepEqual(r.body.chain, { ok: true });
    times.push(r.ms);
  }
  assert.equal(calls, 0, 'no verification started while the file is unchanged');
  times.sort((a, b) => a - b);
  assert.ok(times[10] < 50, `warm GET median ${times[10].toFixed(1)} ms`);
  assert.equal(getList(store, 'floor=_office').body.incidents[0].number, 12);
});

test('the timeline cap keeps every note, the first and last few recurrences, and the newest 200 in all', () => {
  const rec = (n: number): TimelineEntry => ({ at: n, by: 'r', text: `again ${n}`, kind: 'recurrence' });
  const note = (n: number): TimelineEntry => ({ at: n, by: 'p', text: `note ${n}`, kind: 'note' });
  const t = [note(0), ...Array.from({ length: 100 }, (_, n) => rec(n + 1)), note(101)];
  const kept = trimTimeline(t);
  assert.equal(kept.filter((e) => e.kind === 'note').length, 2);
  assert.deepEqual(kept.filter((e) => e.kind === 'recurrence').map((e) => e.at), [1, 2, 3, 4, 5, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);
  assert.equal(trimTimeline(Array.from({ length: 300 }, (_, n) => note(n))).length, 200);
});
