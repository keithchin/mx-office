// The Budget's ledger (server/budget/): who spent what on which model, in which stage, for which issue;
// the office's background calls; providers it can't price; never a cent the office's Ledger doesn't
// have; what's kept on disk; the back-fill; the exchange rate; and the top bar's chip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RunRecord } from '../src/shared/analysis.js';
import type { Usage, UsageState, WorkerInfo } from '../src/shared/protocol.js';
import type { StageId } from '../src/shared/budget/types.js';
import { BudgetService, localDay, type BudgetDeps } from '../src/server/budget/service.js';
import { floorView, officeView } from '../src/server/budget/view.js';
import { addDays, book, breakdowns, emptyLedger, prune, totalOf } from '../src/server/budget/ledger.js';
import { splitDelta } from '../src/server/budget/attribute.js';
import { emitSpend, meterCliResult, spendOfCliResult, withBilling, onBackgroundSpend } from '../src/server/budget/meter.js';
import { cleanFx, fetchFx, fxView } from '../src/server/budget/fx.js';
import { newTracker, scanTracker, trackerUsage, addUsage, zeroUsage } from '../src/server/usage.js';
import { officeChip, projectChip, toneOf, usd } from '../src/shared/budget/money.js';

const NOW = Date.parse('2026-10-06T10:00:00');
const u = (cost: number, calls: number, extra: Partial<Usage> = {}): Usage => ({ ...zeroUsage(), cost, calls, ...extra });

function worker(id: string, over: Partial<WorkerInfo> = {}): WorkerInfo {
  return { id, name: id[0].toUpperCase() + id.slice(1), kind: 'agent', provider: 'claude', status: 'working', deskId: 'd1', color: '#fff', createdAt: NOW + 1000, ...over } as WorkerInfo;
}

interface Fake {
  b: BudgetService;
  dir: string;
  workers: WorkerInfo[];
  added: Usage[];
  stage: { now: StageId };
  now: { t: number };
}

function fake(t: { after(fn: () => void): void }, over: Partial<BudgetDeps> = {}, runs: RunRecord[] = []): Fake {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-budget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const workers: WorkerInfo[] = [];
  const added: Usage[] = [];
  const stage = { now: '3' as StageId };
  const now = { t: NOW };
  let total = zeroUsage();
  const b = new BudgetService({
    dataDir: dir,
    now: () => now.t,
    floors: () => [{ id: 'travel', name: 'travel-approval', dir }],
    workers: () => workers,
    floorOfWorker: (id) => (workers.some((w) => w.id === id) ? 'travel' : undefined),
    roleOf: (_f, id) => (id === 'dylan' ? 'Lead Developer' : undefined),
    taskIssue: (_f, id) => (id === 'dylan' ? 12 : undefined),
    stageOf: () => stage.now,
    officeLedger: {
      add: (x) => {
        added.push(x);
        total = addUsage(total, x);
      },
      state: () => ({ total, today: total, day: localDay(now.t), pauseHiring: false }) as UsageState,
    },
    runs: () => runs,
    ...over,
  });
  return { b, dir, workers, added, stage, now };
}

test('a worker\'s spend is booked by agent, subagent (under its Lead), model, stage and issue', (t) => {
  const f = fake(t);
  const dylan = worker('dylan', { model: 'sonnet' });
  f.workers.push(dylan);
  dylan.usage = u(0, 0);
  f.b.onWorker('travel', dylan);
  dylan.usage = u(3, 6, { model: 'claude-sonnet-5', parts: { '|claude-sonnet-5': { cost: 2, calls: 4 }, 'developer|claude-haiku-4-5': { cost: 1, calls: 2 } } });
  f.b.onWorker('travel', dylan);
  const v = floorView(f.b, { id: 'travel', name: 'travel-approval', dir: f.dir }, true);
  assert.equal(v.spent, 3);
  assert.equal(v.today, 3);
  const lead = v.byAgent.find((r) => r.key === 'dylan')!;
  assert.equal(lead.cost, 3, "the Lead's row covers its own session and its subagents'");
  assert.deepEqual(lead.sub!.map((s) => [s.label, s.cost]), [['Dylan itself', 2], ['Developer', 1]]);
  assert.match(lead.sub![1].hint!, /hired by Dylan/);
  assert.deepEqual(v.byModel.map((r) => [r.label, r.cost]), [['Sonnet 5', 2], ['Haiku 4.5', 1]]);
  assert.deepEqual(v.byStage.map((r) => r.key), ['3']);
  assert.deepEqual(v.byRole.map((r) => r.label).sort(), ['Lead Developer', 'Lead Developer (subagents)']);
  assert.deepEqual(v.topWork.map((r) => r.label), ['#12']);
});

test('the stage is the one active when the spend happened', (t) => {
  const f = fake(t);
  const w = worker('ada');
  f.workers.push(w);
  w.usage = u(0, 0);
  f.b.onWorker('travel', w);
  w.usage = u(1, 1);
  f.b.onWorker('travel', w);
  f.stage.now = '4';
  w.usage = u(3, 2);
  f.b.onWorker('travel', w);
  const v = floorView(f.b, { id: 'travel', name: 't', dir: f.dir }, false);
  assert.deepEqual(v.byStage.map((r) => [r.key, r.cost]), [['3', 1], ['4', 2]]);
});

test('the split always adds up to the manager\'s own delta, even when Claude Code\'s tally corrects it', () => {
  const pieces = splitDelta({ cost: 1, calls: 2, parts: { '|opus': { cost: 1, calls: 2 } } }, u(2.5, 4, { model: 'opus', parts: { '|opus': { cost: 1.5, calls: 3 }, 'tester|haiku': { cost: 0.5, calls: 1 } } }), 'opus');
  assert.equal(Math.round(pieces.reduce((n, p) => n + p.cost, 0) * 1e9) / 1e9, 1.5);
  assert.equal(pieces.reduce((n, p) => n + p.calls, 0), 2);
  // A correction downwards (the end-of-session tally) goes to the session's own model.
  assert.deepEqual(splitDelta({ cost: 3, calls: 4 }, u(2.8, 4, { model: 'opus' }), 'sonnet'), [{ sub: '', model: 'opus', cost: 2.8 - 3, calls: 0 }]);
});

test('the transcript tracker keeps the parts by subagent type and model', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-budget-tr-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 's.jsonl');
  const line = (id: string, model: string) => JSON.stringify({ type: 'assistant', timestamp: '2026-10-06T01:00:00Z', message: { id, model, usage: { input_tokens: 1000, output_tokens: 100 } } });
  writeFileSync(transcript, `${line('a', 'claude-opus-5-5')}\n`);
  const sub = path.join(dir, 's', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(path.join(sub, 'agent-x.jsonl'), `${line('b', 'claude-haiku-4-5')}\n`);
  writeFileSync(path.join(sub, 'agent-x.meta.json'), JSON.stringify({ agentType: 'business-analyst' }));
  const tr = newTracker();
  tr.transcript = transcript;
  scanTracker(tr);
  const usage = trackerUsage(tr);
  assert.deepEqual(Object.keys(usage.parts!).sort(), ['business-analyst|claude-haiku-4-5', '|claude-opus-5-5']);
  const sum = Object.values(usage.parts!).reduce((n, p) => n + p.cost, 0);
  assert.ok(Math.abs(sum - usage.cost) < 1e-9);
});

test('the office\'s background calls are booked on the floor they served, priced, and added to the office Ledger once', (t) => {
  const f = fake(t);
  f.workers.push(worker('bolt'));
  const off = onBackgroundSpend((s) => f.b.onBackground(s));
  t.after(off);
  const cli = JSON.stringify({ type: 'result', total_cost_usd: 9, modelUsage: { 'claude-haiku-4-5-20251001': { inputTokens: 2000, outputTokens: 300, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } });
  withBilling({ floor: 'travel', source: 'analyzer' }, () => withBilling({ source: 'jeff' }, () => meterCliResult(cli, 'analyzer')));
  withBilling({ worker: 'bolt', source: 'task-namer' }, () => meterCliResult(cli, 'task-namer'));
  meterCliResult(cli, 'summary'); // no floor: the office's own
  // The Firm books its own spend into the office's Ledger: only the project ledger gets it here.
  emitSpend({ floor: 'travel', source: 'firm', model: 'claude-opus-5-5', usage: u(2, 0), inLedger: true });
  const priced = spendOfCliResult(cli)!.usage.cost;
  assert.ok(Math.abs(priced - (2000 * 1 + 300 * 5) / 1e6) < 1e-12, 'priced from the price list, not the CLI\'s own figure');
  const v = floorView(f.b, { id: 'travel', name: 't', dir: f.dir }, false);
  const names = v.byAgent.map((r) => r.label).sort();
  assert.deepEqual(names, ['Jeff (the Router)', 'Task naming', 'The Firm (audit reviewers)']);
  assert.equal(f.added.length, 3, 'three CLI calls went into the office Ledger; the Firm\'s was there already');
  const o = officeView(f.b, false);
  assert.deepEqual(o.background.bySource.map((r) => r.label).sort(), ['Jeff (the Router)', 'Task naming', 'The Firm (audit reviewers)', 'The project summary']);
  assert.equal(o.firm.total, 2);
});

test('providers the office cannot price are counted, not costed, and stay out of the office Ledger', (t) => {
  const f = fake(t);
  const c = worker('codex', { provider: 'codex' as WorkerInfo['provider'] });
  f.workers.push(c);
  c.usage = u(0, 0);
  f.b.onWorker('travel', c);
  c.usage = u(4, 7);
  f.b.onWorker('travel', c);
  const v = floorView(f.b, { id: 'travel', name: 't', dir: f.dir }, false);
  assert.equal(v.spent, 0);
  assert.equal(v.unmetered.calls, 7);
  assert.deepEqual(v.unmetered.agents, ['Codex']);
});

test('no double counting: the exact ledger matches what the office Ledger was given, cent for cent', (t) => {
  const f = fake(t);
  const ws = ['a1', 'b2', 'c3'].map((id) => worker(id));
  f.workers.push(...ws);
  const office = { cost: 0 };
  for (const w of ws) {
    w.usage = u(0, 0);
    f.b.onWorker('travel', w);
  }
  // The manager books each delta into the office Ledger, then sends the update: some updates repeat, some are skipped.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 200; i++) {
    const w = ws[i % 3];
    const before = w.usage!;
    const after = u(before.cost + Math.round(rnd() * 100) / 100, before.calls + 1, { model: 'claude-opus-5-5', parts: { '|claude-opus-5-5': { cost: before.cost + 0.5, calls: before.calls + 1 } } });
    office.cost += after.cost - before.cost;
    w.usage = after;
    if (rnd() < 0.8) f.b.onWorker('travel', w);
    if (rnd() < 0.1) f.b.onWorker('travel', w);
  }
  for (const w of ws) f.b.onWorker('travel', w);
  const v = floorView(f.b, { id: 'travel', name: 't', dir: f.dir }, false);
  assert.ok(Math.abs(v.spent - office.cost) < 1e-6, `${v.spent} vs ${office.cost}`);
  assert.equal(v.estimated, 0);
});

test('the ledger is saved per floor and keeps daily rollups forever, detailed rows for 30 days', (t) => {
  const d = emptyLedger(NOW);
  const agent = { key: 'w', name: 'W', role: 'Worker', kind: 'worker' as const };
  for (let i = 0; i < 60; i++) book(d, { day: addDays('2026-10-06', -i), agent: 'w', model: 'opus', stage: '5', cost: 1, calls: 1 }, agent);
  prune(d, '2026-10-06');
  assert.equal(Object.keys(d.days).length, 60);
  assert.equal(d.rows.length, 30);
  assert.equal(totalOf(d), 60);
  assert.equal(breakdowns(d).byAgent[0].cost, 60, 'the tables come from the rollups, so old days still count');

  const f = fake(t);
  const w = worker('ada');
  f.workers.push(w);
  w.usage = u(0, 0);
  f.b.onWorker('travel', w);
  w.usage = u(5, 3);
  f.b.onWorker('travel', w);
  f.b.flush();
  const again = new BudgetService({ ...f.b.deps });
  assert.equal(floorView(again, { id: 'travel', name: 't', dir: f.dir }, false).spent, 5);
  // And it carries on from where it was: the same usage isn't booked twice.
  again.onWorker('travel', w);
  assert.equal(floorView(again, { id: 'travel', name: 't', dir: f.dir }, false).spent, 5);
});

test('history is back-filled once from the workers at their desks and the runs log, marked estimated', (t) => {
  const runs = [{ id: 'travel:gone1', floor: 'travel', worker: 'Barbara', workerId: 'gone1', provider: 'claude', model: 'claude-opus-5-5', startedAt: NOW - 3 * 86_400_000, endedAt: NOW - 86_400_000, updatedAt: NOW - 86_400_000, apiCalls: 30, cost: 22.1, issue: 16 } as unknown as RunRecord];
  const f = fake(t, {}, runs);
  const old = worker('ada', { createdAt: NOW - 2 * 86_400_000, usage: u(14.6, 40, { model: 'claude-opus-5-5' }) });
  f.workers.push(old);
  const v = floorView(f.b, { id: 'travel', name: 't', dir: f.dir }, false);
  assert.ok(Math.abs(v.spent - 36.7) < 1e-4, String(v.spent));
  assert.ok(Math.abs(v.estimated - 36.7) < 1e-4, 'all of it is labelled estimated from history');
  assert.ok(v.byAgent.every((r) => r.est !== undefined));
  assert.equal(v.daysActive, 4, "spread over the days each worker was around");
  assert.deepEqual(v.topWork.map((r) => r.label), ['#16']);
  assert.equal(f.added.length, 0, 'history is already in the office Ledger');
  // The worker's next spend is exact.
  old.usage = u(15.6, 41, { model: 'claude-opus-5-5' });
  f.b.onWorker('travel', old);
  const after = floorView(f.b, { id: 'travel', name: 't', dir: f.dir }, false);
  assert.ok(Math.abs(after.spent - 37.7) < 1e-4);
  assert.ok(Math.abs(after.estimated - 36.7) < 1e-4);
});

test('the exchange rate: set by hand, fetched daily, and the last one kept when a fetch fails', async () => {
  assert.deepEqual(fxView({ currency: 'SGD', mode: 'manual', manualRate: 1.3 }, undefined), { currency: 'SGD', rate: 1.3, source: 'manual' });
  assert.equal(typeof cleanFx({ currency: 'sgd', mode: 'manual' }), 'string', 'manual needs a rate');
  assert.deepEqual(cleanFx({ currency: 'eur', mode: 'daily' }), { currency: 'EUR', mode: 'daily' });
  const ok = (async (url: string) => {
    assert.match(String(url), /base=USD&symbols=SGD/);
    return new Response(JSON.stringify({ amount: 1, base: 'USD', date: '2026-10-05', rates: { SGD: 1.2803 } }));
  }) as typeof fetch;
  const got = await fetchFx('SGD', undefined, '2026-10-06', ok);
  assert.deepEqual(got, { currency: 'SGD', rate: 1.2803, asOf: '2026-10-05', fetchedDay: '2026-10-06' });
  const view = fxView({ currency: 'SGD', mode: 'daily' }, got);
  assert.equal(view.source, 'ecb');
  assert.equal(view.asOf, '2026-10-05');
  const down = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
  const kept = await fetchFx('SGD', got, '2026-10-07', down);
  assert.equal(kept.rate, 1.2803);
  assert.equal(kept.asOf, '2026-10-05');
  assert.match(kept.error!, /503/);
  assert.match(fxView({ currency: 'SGD', mode: 'daily' }, kept).error!, /503/);
  const none = await fetchFx('SGD', undefined, '2026-10-07', down);
  assert.equal(fxView({ currency: 'SGD', mode: 'daily' }, none).source, 'none');
});

test('the top bar\'s chips: words, local currency on hover, colour from the forecast', () => {
  const fx = { currency: 'SGD', rate: 1.28, asOf: '2026-10-05', source: 'ecb' as const };
  const c = projectChip({ today: 42, spent: 252, budget: 600, fx });
  assert.equal(c.text, '$42 today · $252 / $600 · 42 %');
  assert.equal(c.tone, 'good');
  assert.match(c.title, /\$42 \(S\$54\) today/);
  assert.match(c.title, /1 USD = 1\.2800 SGD, ECB reference rate as of 2026-10-05/);
  assert.equal(projectChip({ today: 4.2, spent: 25.5 }).text, '$4.20 today · $26 spent');
  assert.equal(projectChip({ today: 0, spent: 25.5 }).tone, 'none');
  assert.equal(toneOf(600, 252, 545), 'warn', 'within 10 % of the budget');
  assert.equal(toneOf(600, 252, 610), 'bad', 'the forecast is over');
  assert.equal(toneOf(600, 610), 'bad');
  assert.equal(toneOf(600, 500), 'good');
  assert.equal(officeChip(110, undefined).text, 'Office $110 today');
  assert.equal(officeChip(110, 100).tone, 'bad');
  assert.equal(usd(1250.4), '$1,250');
});
