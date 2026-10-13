// Marking a budget alert as seen (shared/budget/alerts.ts markSeen, server/budget/control.ts
// markAlertSeen, POST /api/budget/action {action: 'seen'}, ui/budget/alerts.ts): a seen forecast or
// threshold alert leaves Needs you and its count but stays on the Budget tab; 100 % and the pause can't
// be marked; a seen forecast comes back past +10 %, a seen threshold when the budget changes; it's audited.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { UsageState } from '../src/shared/protocol.js';
import type { BudgetAlert, StageId } from '../src/shared/budget/types.js';
import { checkAlerts, markSeen } from '../src/shared/budget/alerts.js';
import { collectNeeds } from '../src/shared/needsyou.js';
import { hereCount } from '../src/client/ui/needsyou/logic.js';
import { BudgetService, localDay } from '../src/server/budget/service.js';
import { markAlertSeen, setSettings, type ControlDeps } from '../src/server/budget/control.js';
import { budgetRoutes } from '../src/server/http/routes/budget.js';
import { zeroUsage } from '../src/server/usage.js';
import { installFakeDom } from './support/fakedom.js';

const NOW = Date.parse('2026-10-13T10:00:00');
const S = { total: 100, autoPause: true };
const needsOf = (alerts: readonly BudgetAlert[], paused?: string) => collectNeeds({ floor: 'w', workers: [], pulls: [], floors: [], budget: { floor: 'w', alerts, ...(paused ? { paused } : {}) } });

test('a seen forecast alert leaves Needs you and the waiting count; Needs you offers Mark as seen beside Budget', () => {
  const { alerts } = checkAlerts(S, 80, 50, 120, [], NOW);
  const before = needsOf(alerts);
  assert.deepEqual(before.map((n) => [n.key, n.action, n.alt?.action, n.alt?.target]), [['budget-forecast', 'Budget', 'Mark as seen', { to: 'budget', seen: 'forecast' }]]);
  assert.equal(hereCount(before), 1);
  const seen = markSeen(alerts, 'forecast', 'Keith', NOW + 1, 120) as BudgetAlert[];
  assert.deepEqual([seen[0].seenAt, seen[0].seenBy, seen[0].seenForecast], [NOW + 1, 'Keith', 120]);
  assert.deepEqual(needsOf(seen), []);
  assert.equal(hereCount(needsOf(seen)), 0);
  // With the threshold standing too, Needs you moves on to it once the forecast is seen.
  const both = checkAlerts(S, 80, 85, 120, [], NOW).alerts;
  assert.deepEqual(needsOf(markSeen(both, 'forecast', 'Keith', NOW, 120) as BudgetAlert[]).map((n) => n.key), ['budget-threshold']);
});

test('100 % and the pause can’t be marked as seen: they need a budget decision', () => {
  const { alerts } = checkAlerts(S, 80, 101, 130, [], NOW);
  assert.match(markSeen(alerts, 'full', 'Keith', NOW, 130) as string, /raise the budget or resume/);
  assert.match(markSeen(alerts, 'nonsense', 'Keith', NOW, 130) as string, /Only a forecast or threshold/);
  assert.match(markSeen([], 'forecast', 'Keith', NOW, 130) as string, /no such alert/);
  const full = needsOf(alerts);
  assert.deepEqual(full.map((n) => [n.key, n.alt]), [['budget-full', undefined]]);
  const paused = needsOf(alerts, 'Budget reached');
  assert.deepEqual(paused.map((n) => [n.key, n.alt?.action]), [['budget-paused', 'Resume']]);
});

test('a seen forecast comes back, unseen and with its new numbers, once the forecast grows past +10 %', () => {
  let alerts = checkAlerts(S, 80, 50, 120, [], NOW).alerts;
  alerts = markSeen(alerts, 'forecast', 'Keith', NOW, 120) as BudgetAlert[];
  // +10 % exactly (132): still seen, nothing raised.
  let r = checkAlerts(S, 80, 55, 132, alerts, NOW + 1);
  assert.equal(r.raised.length, 0);
  assert.ok(r.alerts.find((a) => a.level === 'forecast')!.seenAt);
  // Past it: raised again, unseen, with the new forecast in its text.
  r = checkAlerts(S, 80, 60, 133, r.alerts, NOW + 2);
  assert.deepEqual(r.raised.map((a) => a.level), ['forecast']);
  const f = r.alerts.filter((a) => a.level === 'forecast');
  assert.equal(f.length, 1);
  assert.equal(f[0].seenAt, undefined);
  assert.match(f[0].text, /\$133/);
  assert.deepEqual(needsOf(r.alerts).map((n) => n.key), ['budget-forecast']);
});

function service(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-budget-seen-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const b = new BudgetService({
    dataDir: dir,
    now: () => NOW,
    floors: () => [{ id: 'w', name: 'welcomedesk-registration', dir }],
    workers: () => [],
    floorOfWorker: () => 'w',
    roleOf: () => undefined,
    taskIssue: () => undefined,
    stageOf: () => '1' as StageId,
    officeLedger: { add: () => {}, state: () => ({ total: zeroUsage(), today: zeroUsage(), day: localDay(NOW), pauseHiring: false }) as UsageState },
    runs: () => [],
  });
  const records: { action: string; summary: string; by: string }[] = [];
  const deps: ControlDeps = { alert: () => {}, record: (_f, by, action, summary) => records.push({ action, summary, by }) };
  return { b, deps, records, floor: { id: 'w', name: 'welcomedesk-registration', dir } };
}

test('marking is audited, and a seen threshold stays seen until the budget changes', (t) => {
  const s = service(t);
  setSettings(s.b, s.floor, { total: 100 }, 'Keith', s.deps);
  const f = s.b.file(s.floor);
  f.alerts = checkAlerts(S, 80, 85, undefined, [], NOW).alerts;
  assert.equal(markAlertSeen(s.b, s.floor, 'threshold', 'Keith', s.deps), undefined);
  const rec = s.records.find((r) => r.action === 'budget.alert.seen')!;
  assert.equal(rec.by, 'Keith');
  assert.match(rec.summary, /Marked welcomedesk-registration's budget threshold alert as seen: Budget at 85 %/);
  // Again: nothing new to record.
  markAlertSeen(s.b, s.floor, 'threshold', 'Keith', s.deps);
  assert.equal(s.records.filter((r) => r.action === 'budget.alert.seen').length, 1);
  assert.match(markAlertSeen(s.b, s.floor, 'full', 'Keith', s.deps)!, /can’t be marked/);
  // More spend: the threshold stays seen.
  const later = checkAlerts(S, 80, 95, undefined, f.alerts, NOW + 5);
  assert.equal(later.raised.length, 0);
  assert.ok(later.alerts.find((a) => a.level === 'threshold')!.seenAt);
  // The budget lowered: kept (no repeat), no longer seen, so Needs you shows it again.
  setSettings(s.b, s.floor, { total: 90 }, 'Keith', s.deps);
  assert.equal(s.b.file(s.floor).alerts.find((a) => a.level === 'threshold')!.seenAt, undefined);
  assert.deepEqual(needsOf(s.b.file(s.floor).alerts).map((n) => n.key), ['budget-threshold']);
  // Raised: cleared, as before.
  setSettings(s.b, s.floor, { total: 500 }, 'Keith', s.deps);
  assert.deepEqual(s.b.file(s.floor).alerts, []);
});

test('only admins may mark an alert as seen, as every other budget change', async () => {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ floor: 'w', action: 'seen', level: 'forecast' }))]), { method: 'POST', headers: { origin: 'http://office', host: 'office' } });
  let status = 0;
  let out: any;
  const res = { writeHead: (st: number) => ((status = st), res), end: (b: string) => (out = JSON.parse(b)), headersSent: false };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: false }) };
  await (budgetRoutes.action.handle as (...a: unknown[]) => unknown)(ctx, { req, res, url: new URL('http://office/api/budget/action'), path: '/api/budget/action', session: { account: { id: 'acc2', name: 'Visitor' } } });
  assert.equal(status, 403);
  assert.match(out.error, /Only admins/);
});

test('the page’s Mark as seen posts the seen action for the floor and level', async () => {
  installFakeDom();
  const toasts = document.createElement('div');
  toasts.id = 'toasts';
  document.body.append(toasts);
  const made = document.createElement;
  document.createElement = ((tag: string) => Object.assign(made(tag), { style: {} })) as typeof document.createElement;
  const sent: { url: string; body: any }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { body: string }) => (sent.push({ url, body: JSON.parse(init.body) }), new Response(JSON.stringify({ ok: true }), { status: 200 }))) as unknown as typeof fetch;
  try {
    const { markAlertSeen: clientMark } = await import('../src/client/ui/budget/alerts.js');
    assert.equal(await clientMark('w', 'forecast'), true);
    assert.equal(sent[0].url, '/api/budget/action');
    assert.deepEqual({ floor: sent[0].body.floor, action: sent[0].body.action, level: sent[0].body.level }, { floor: 'w', action: 'seen', level: 'forecast' });
  } finally {
    globalThis.fetch = realFetch;
  }
});
