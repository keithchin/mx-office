// Server work the performance guard found blocking the event loop on a big floor (2026-10-07): every
// page of the Audit log hashed the whole of each floor's log again (a quarter of a second at 20,000
// lines), and every look at the ranking (the Workers tab, Home, the Budget tab) worked it all out again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditLog, FULL_VERIFY_MS } from '../src/server/audit/log.js';
import { RANKING_TTL_MS, rankingReport } from '../src/server/ranking/index.js';

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
  assert.notEqual(rankingReport(ctx, 'f1', T0 + RANKING_TTL_MS + 1), a, 'worked out again after it');
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
