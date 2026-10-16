// The desktop app's connection to its office (desktop/src/core/connection.ts): running, disconnected,
// signed out or unknown; counts the last look couldn't confirm are marked stale, never shown as fresh;
// a reconnection doesn't notify again; and "Start the office here" never starts a second office.
import test from 'node:test';
import assert from 'node:assert/strict';
import { afterLook, countLine, decideStartHere, freshStatus, initialConn, lookOf, nextConn, type ConnState, type Look } from '../desktop/src/core/connection.ts';
import { emptySeen, tooltipFor, type Need, type OfficeStatus, type SeenState } from '../desktop/src/core/needs.ts';

const need = (id: string): Need => ({ id, floor: 'f1', project: 'Travel', who: 'Ana', summary: `Item ${id}`, urgency: 'URGENT', level: 'block', path: `lite?floor=f1&item=${id}` });
const status = (...ids: string[]): OfficeStatus => ({ needs: ids.map(need), working: 1 });
const ok = (...ids: string[]): Look => ({ kind: 'ok', status: status(...ids) });
const T0 = Date.UTC(2026, 9, 16, 12, 5);
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** The app's poll loop over a run of looks, as main.ts does it: the connection, the seen store, the notifications. */
function run(looks: Look[], start: { conn?: ConnState; seen?: SeenState } = {}) {
  let conn = start.conn ?? initialConn();
  let seen = start.seen ?? emptySeen();
  const notes: string[] = [];
  const lines: string[] = [];
  looks.forEach((l, i) => {
    const r = afterLook({ conn, seen }, l, T0 + i * 30_000);
    conn = r.conn;
    if (r.seen) seen = r.seen;
    notes.push(...r.notes.map((n) => n.id ?? n.body));
    lines.push(countLine(conn, hhmm));
  });
  return { conn, seen, notes, lines };
}

test('a look: the status answering is running, 401 is signed out, nothing answering is down, the rest unreadable', () => {
  assert.equal(lookOf({ healthy: true, code: 200, status: status('a') }).kind, 'ok');
  // Health failing on its own doesn't matter when the status answers.
  assert.equal(lookOf({ healthy: false, code: 200, status: status() }).kind, 'ok');
  assert.equal(lookOf({ healthy: true, code: 401 }).kind, 'signed-out');
  assert.equal(lookOf({ healthy: false, code: 401 }).kind, 'signed-out');
  assert.equal(lookOf({ healthy: false }).kind, 'down');
  assert.equal(lookOf({ healthy: true }).kind, 'unreadable');
  assert.equal(lookOf({ healthy: false, code: 502 }).kind, 'unreadable');
  assert.equal(lookOf({ healthy: true, code: 200 }).kind, 'unreadable', 'a 200 that is not a status');
});

test('the attached office disappearing: disconnected, its last counts kept as stale with when they were confirmed', () => {
  const r = run([ok('a', 'b'), { kind: 'down' }]);
  assert.equal(r.conn.conn, 'disconnected');
  assert.equal(r.conn.checkedAt, T0);
  assert.equal(r.conn.seenAt, T0);
  assert.equal(r.conn.failures, 1);
  assert.equal(r.lines[0], '2 need you');
  assert.equal(r.lines[1], '2 need you · as of 12:05, office not answering');
  assert.equal(freshStatus(r.conn), undefined, 'the badge never shows stale counts');
  assert.match(tooltipFor({ state: 'disconnected', line: r.lines[1], build: 'release 54, not answering', attached: true }), /^Mx Office: 2 need you · as of 12:05, office not answering\nattached, release 54, not answering$/);
  // Down from the start: nothing to show as of anything.
  assert.equal(run([{ kind: 'down' }]).lines[0], 'office not answering');
  assert.equal(run([ok(), { kind: 'down' }]).lines[1], 'nothing needed you · as of 12:05, office not answering');
});

test('a temporary failure recovers without notifying again; an item new while it was down still notifies once', () => {
  // Primed (an earlier look already showed the first items).
  const primed = run([ok('a')]);
  assert.deepEqual(primed.notes, ['1 needs you.'], 'the very first look: one summary');
  const r = run([ok('a', 'b'), { kind: 'down' }, { kind: 'down' }, ok('a', 'b'), ok('a', 'b')], { seen: primed.seen });
  assert.deepEqual(r.notes, ['b'], 'b once, nothing replayed after the reconnection');
  assert.equal(r.conn.conn, 'running');
  assert.equal(r.conn.failures, 0);
  assert.deepEqual(r.lines, ['2 need you', '2 need you · as of 12:05, office not answering', '2 need you · as of 12:05, office not answering', '2 need you', '2 need you']);
  const c = run([{ kind: 'down' }, ok('a', 'c')], { seen: primed.seen });
  assert.deepEqual(c.notes, ['c']);
  // The seen state is untouched by failed looks.
  const down = afterLook({ conn: initialConn(), seen: primed.seen }, { kind: 'down' }, T0);
  assert.equal(down.seen, undefined);
  assert.deepEqual(down.notes, []);
});

test('401: signed out, the counts dropped (not kept as if confirmed), and signing in again doesn\'t replay', () => {
  const primed = run([ok('a')]).seen;
  const r = run([ok('a'), { kind: 'signed-out' }], { seen: primed });
  assert.equal(r.conn.conn, 'signed-out');
  assert.equal(r.conn.status, undefined);
  assert.equal(r.conn.checkedAt, T0, 'the last confirmed check is still recorded');
  assert.equal(r.lines[1], 'sign in to see what needs you');
  assert.equal(freshStatus(r.conn), undefined);
  const back = run([{ kind: 'signed-out' }, ok('a')], { seen: primed });
  assert.deepEqual(back.notes, []);
  // A 401 is the office answering: never "disconnected".
  assert.equal(nextConn(initialConn(), { kind: 'signed-out' }, T0).seenAt, T0);
});

test('stale counts are never shown as freshly confirmed', () => {
  const states: ConnState[] = [];
  let c = initialConn();
  for (const l of [ok('a', 'b', 'c'), { kind: 'unreadable' } as Look, { kind: 'down' } as Look, { kind: 'signed-out' } as Look]) states.push((c = nextConn(c, l, T0)));
  assert.equal(freshStatus(states[0])?.needs.length, 3);
  for (const s of states.slice(1)) {
    assert.equal(freshStatus(s), undefined, s.conn);
    assert.doesNotMatch(countLine(s, hhmm), /^3 need you$/, s.conn);
  }
  assert.equal(countLine(states[1], hhmm), "3 need you · as of 12:05, couldn't check");
  assert.equal(countLine(initialConn()), 'checking what needs you…');
  assert.equal(countLine({ conn: 'unknown', failures: 1 }), "the office answers, but couldn't say what needs you");
});

test('Start the office here: attach when it answers again, report a held port, start only on a free one', () => {
  const h = { ok: true as const, release: 54 };
  assert.deepEqual(decideStartHere({ health: h, portOpen: true }), { kind: 'attach', health: h });
  assert.deepEqual(decideStartHere({ portOpen: true }), { kind: 'busy' });
  assert.deepEqual(decideStartHere({ portOpen: false }), { kind: 'start' });
});

test('the tray says disconnected and unknown in words of their own', () => {
  assert.equal(tooltipFor({ state: 'disconnected' }), 'Mx Office: office not answering');
  assert.equal(tooltipFor({ state: 'unknown' }), 'Mx Office: checking what needs you…');
  assert.equal(tooltipFor({ state: 'running', count: 2 }), 'Mx Office: 2 need you');
});
