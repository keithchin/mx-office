// Server work the performance guard found blocking the event loop on a big floor (2026-10-07): every
// page of the Audit log hashed the whole of each floor's log again (a quarter of a second at 20,000
// lines), and every look at the ranking (the Workers tab, Home, the Budget tab) worked it all out again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditLog, FULL_VERIFY_MS } from '../src/server/audit/log.js';
import { RANKING_STALE_MS, RANKING_TTL_MS, rankingReport } from '../src/server/ranking/index.js';
import { startWarmup } from '../src/server/warmup.js';
import { BudgetStore } from '../src/server/budget/store.js';
import { RunStore } from '../src/server/analysis/store.js';

const T0 = Date.UTC(2026, 9, 7, 8, 0);

function logWith(n: number) {
  let now = T0;
  const log = new AuditLog(path.join(mkdtempSync(path.join(os.tmpdir(), 'perf-audit-')), 'audit'), { now: () => now });
  for (let i = 0; i < n; i++) log.append({ floor: 'big', actor: { kind: 'human', name: 'Keith' }, action: 'worker.hire', summary: `event ${i}`, at: T0 + i });
  return { log, file: path.join(log.dir, 'big.jsonl'), advance: (ms: number) => (now += ms) };
}

test('the audit chain: an unchanged file is not read again, and one that grew has only its new lines checked', () => {
  const { log, file, advance } = logWith(2000);
  assert.deepEqual(log.verify('big'), { ok: true });
  const t = performance.now();
  for (let i = 0; i < 50; i++) log.verify('big');
  assert.ok(performance.now() - t < 50, 'fifty looks at an unchanged file are near free');
  log.append({ floor: 'big', actor: { kind: 'human', name: 'Keith' }, action: 'worker.hire', summary: 'one more' });
  assert.deepEqual(log.verify('big'), { ok: true }, 'the new line fits the chain');
  // A line added that doesn't fit is caught at once.
  appendFileSync(file, `${JSON.stringify({ id: 'x', at: T0 + 9999, floor: 'big', prev: 'nope', hash: 'nope' })}\n`);
  assert.equal(log.verify('big').ok, false);
  advance(1);
});

test('…and the whole file is still hashed again once FULL_VERIFY_MS has passed, so an edit in the middle is caught', () => {
  const { log, file, advance } = logWith(500);
  assert.equal(log.verify('big').ok, true);
  // Someone edits an old line (same length) and the log grows past it.
  const text = readFileSync(file, 'utf8').replace('"event 10"', '"event X0"');
  writeFileSync(file, text);
  log.append({ floor: 'big', actor: { kind: 'human', name: 'Keith' }, action: 'worker.hire', summary: 'later' });
  advance(FULL_VERIFY_MS + 1);
  const r = log.verify('big');
  assert.equal(r.ok, false);
  assert.equal(r.brokenFloor, 'big');
});

test('the ranking is worked out once per RANKING_TTL_MS, whoever asks', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'perf-rank-'));
  const ctx = { cfg: { dataDir }, floors: new Map() } as unknown as Parameters<typeof rankingReport>[0];
  const a = rankingReport(ctx, 'f1', T0);
  assert.equal(rankingReport(ctx, 'f1', T0 + RANKING_TTL_MS - 1), a, 'the same report within the TTL');
  assert.notEqual(rankingReport(ctx, 'f2', T0), a, 'per floor');
  assert.notEqual(rankingReport(ctx, 'f1', T0 + RANKING_STALE_MS + 1), a, 'worked out again, there and then, once it is too old');
});

test('past its TTL the ranking is given at once and worked out again in the background (stale-while-revalidate)', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'perf-rank-swr-'));
  const ctx = { cfg: { dataDir }, floors: new Map() } as unknown as Parameters<typeof rankingReport>[0];
  const now = Date.now();
  const a = rankingReport(ctx, 'f1', now);
  assert.equal(rankingReport(ctx, 'f1', now + RANKING_TTL_MS + 1), a, 'the stale one, without waiting');
  await new Promise((r) => setImmediate(r));
  const b = rankingReport(ctx, 'f1', Date.now());
  assert.notEqual(b, a, 'the fresh one, worked out meanwhile');
});

test('the warm-up works out the ranking, then each floor one at a time, and a floor added later too', async () => {
  const floors = new Map<string, { id: string }>([['f1', { id: 'f1' }], ['f2', { id: 'f2' }]]);
  const warmed: string[] = [];
  let busy = 0;
  let overlap = false;
  const stop = startWarmup({ floors } as never, {
    delayMs: 1,
    gapMs: 1,
    pollMs: 20,
    warm: async (f) => {
      overlap ||= busy > 0;
      busy++;
      await new Promise((r) => setTimeout(r, 5));
      warmed.push((f as { id: string } | undefined)?.id ?? '(building)');
      busy--;
    },
  });
  try {
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(warmed, ['(building)', 'f1', 'f2']);
    floors.set('f3', { id: 'f3' });
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(warmed, ['(building)', 'f1', 'f2', 'f3'], 'a floor opened since is warmed once');
    assert.equal(overlap, false, 'one step at a time');
  } finally {
    stop();
  }
});

test('the budget files are written in the background, in order, and flush() at exit still writes what is in flight', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'perf-budget-store-'));
  const store = new BudgetStore(dataDir);
  store.floor('f1').settings.total = 10;
  store.changed('f1');
  const first = store.flushSoon();
  store.floor('f1').settings.total = 20;
  store.changed('f1');
  await Promise.all([first, store.flushSoon()]);
  assert.equal(JSON.parse(readFileSync(path.join(dataDir, 'budget', 'f1.json'), 'utf8')).settings.total, 20);
  store.floor('f1').settings.total = 30;
  store.changed('f1');
  const late = store.flushSoon();
  store.flush();
  await late;
  assert.equal(JSON.parse(readFileSync(path.join(dataDir, 'budget', 'f1.json'), 'utf8')).settings.total, 30, 'the exit flush wins');
});

test("the analyzer's records are written once after a burst of puts, not once per put", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'perf-runstore-'));
  const store = new RunStore(dataDir);
  for (let i = 0; i < 300; i++) store.put({ id: `f:${i}`, floor: 'f', workerId: String(i) } as never);
  await store.settled();
  const lines = readFileSync(path.join(dataDir, 'analysis', 'runs.jsonl'), 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 300);
  assert.equal(new RunStore(dataDir).all().length, 300);
});

test("a project switch's many asks for the floor's team share one fetch", async () => {
  const { fetchRoster } = await import('../src/client/ui/roster/api.js');
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return new Response(JSON.stringify({ floor: 'f1', members: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const all = await Promise.all([fetchRoster('f1'), fetchRoster('f1'), fetchRoster('f1'), fetchRoster('f1')]);
    assert.equal(calls, 1, 'four asks, one fetch');
    assert.ok(all.every((r) => r === all[0]));
    await fetchRoster('f1');
    assert.equal(calls, 2, 'a later ask fetches afresh');
    await Promise.all([fetchRoster('f1'), fetchRoster('f2')]);
    assert.equal(calls, 4, 'per floor');
  } finally {
    globalThis.fetch = real;
  }
});

test('the setup panel view is shared for SETUP_TTL_MS and worked out afresh after a re-check', async () => {
  const { SETUP_TTL_MS } = await import('../src/server/wizard/index.js');
  assert.ok(SETUP_TTL_MS > 0 && SETUP_TTL_MS <= 10_000);
  const src = readFileSync(new URL('../src/server/wizard/index.ts', import.meta.url), 'utf8');
  const setup = src.slice(src.indexOf('  setup(floor: Floor'), src.indexOf('  private async freshSetup('));
  assert.match(setup, /now - had\.at < SETUP_TTL_MS\) return had\.view;/);
  const recheck = src.slice(src.indexOf('  recheck(floor: Floor)'));
  assert.match(recheck.slice(0, 200), /this\.setups\.delete\(floor\.id\);/);
});
