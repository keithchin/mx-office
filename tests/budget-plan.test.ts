// The Budget's expectation (server/budget/control.ts, shared/budget/): the plan per tier and entry mode,
// from history or the default rates; edits; the forecast; alerts once per level, reset when the budget is
// raised; the pause at 100 % through the seam; and the wizard's levels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Usage, UsageState, WorkerInfo } from '../src/shared/protocol.js';
import type { BudgetAlert, StageId } from '../src/shared/budget/types.js';
import { DEFAULT_RATES, estimateFor, expectedCurve, generatePlan, historyRate, planTotal, addWorkDays, curveOf } from '../src/shared/budget/plan.js';
import { forecastOf, varianceOf } from '../src/shared/budget/forecast.js';
import { afterBudgetChange, checkAlerts } from '../src/shared/budget/alerts.js';
import { cleanChoice, levelCards, LEVELS, roundBudget, subagentModelAt } from '../src/shared/budget/levels.js';
import { BudgetService, localDay } from '../src/server/budget/service.js';
import { checkFloor, editPlan, planOf, resume, setSettings, type ControlDeps } from '../src/server/budget/control.js';
import { registerProjectPause } from '../src/server/budget/pause.js';
import { floorHold, floorLedger } from '../src/server/roster/pause.js';
import { buildModules, entryOf, firmForecastOf, projectShape } from '../src/server/budget/plan-source.js';
import { collectNeeds } from '../src/shared/needsyou.js';
import { zeroUsage } from '../src/server/usage.js';
import type { Ledger } from '../src/server/usage.js';
import type { Report } from '../src/shared/firm/report.js';

const NOW = Date.parse('2026-10-06T10:00:00');

test('the plan per tier and entry mode, from the default rates', () => {
  const small = generatePlan({ tier: 'small', entry: 'requirements-driven', start: '2026-10-05', now: NOW });
  assert.deepEqual(small.lines.map((l) => l.stage), ['P', '0', '1', '2', '3', '4', '5', '6']);
  assert.equal(planTotal(small), 332.5, 'travel-approval: small requirements-driven');
  assert.ok(small.lines.every((l) => l.basis === 'default'));
  assert.match(small.basis, /small requirements-driven project: 8 from the default rates/);
  const std = generatePlan({ tier: 'standard', entry: 'requirements-driven', start: '2026-10-05', now: NOW });
  assert.equal(std.lines.filter((l) => l.stage === '5').length, 4, 'four modules assumed before a build plan');
  assert.equal(planTotal(std), 15 + 30 + 90 + 80 + 90 + 40 + 4 * 120 + 80);
  const green = generatePlan({ tier: 'standard', entry: 'greenfield', start: '2026-10-05', now: NOW });
  assert.deepEqual([...new Set(green.lines.map((l) => l.stage))], ['P', '0', '5', '6']);
  const mig = generatePlan({ tier: 'standard', entry: 'migration', start: '2026-10-05', now: NOW });
  assert.ok(mig.lines.some((l) => l.stage === '7'), 'a migration ends with a cutover');
  assert.equal(mig.lines.find((l) => l.stage === '1')!.usd, DEFAULT_RATES['1'].usd * 1.3);
  const change = generatePlan({ tier: 'standard', entry: 'existing-app-change', start: '2026-10-05', now: NOW });
  assert.equal(change.lines.find((l) => l.stage === '2')!.usd, 48, 'stages 2-4 cover only the change');
  assert.deepEqual(generatePlan({ tier: 'small', entry: 'assurance', start: '2026-10-05', now: NOW }).lines.map((l) => [l.stage, l.usd]), [['—', 60]]);
  // Build modules from the build plan replace the assumed ones.
  const mods = generatePlan({ tier: 'standard', entry: 'requirements-driven', modules: ['Requests', 'Approvals'], start: '2026-10-05', now: NOW });
  assert.deepEqual(mods.lines.filter((l) => l.stage === '5').map((l) => l.label), ['Build · Requests', 'Build · Approvals']);
});

test('history prices a line once there are enough runs of its kind, else the defaults stay', () => {
  const few = [{ types: ['logic'], cost: 30 }, { types: ['ui-pages'], cost: 10 }];
  assert.equal(historyRate(few, ['logic', 'ui-pages']), undefined);
  const runs = [10, 20, 30, 40, 50].map((cost) => ({ types: ['domain-model'], cost }));
  assert.equal(historyRate(runs, ['domain-model', 'logic']), 30);
  const p = generatePlan({ tier: 'small', entry: 'requirements-driven', history: runs, start: '2026-10-05', now: NOW });
  const build = p.lines.find((l) => l.stage === '5')!;
  assert.equal(build.basis, 'history');
  assert.equal(build.usd, 120, 'median $30 a run × 4 runs a module');
  assert.equal(p.lines.find((l) => l.stage === '1')!.basis, 'default', 'no docs history: the default rate');
  assert.match(p.basis, /1 line from this office's history, 7 from the default rates/);
});

test('the expected curve spreads each line over its working days, weekends flat', () => {
  const p = generatePlan({ tier: 'small', entry: 'requirements-driven', start: '2026-10-05', now: NOW });
  const c = expectedCurve(p);
  assert.equal(c[c.length - 1].expected, planTotal(p));
  assert.equal(c[0].day, '2026-10-05');
  const sat = c.find((x) => x.day === '2026-10-10')!;
  const fri = c.find((x) => x.day === '2026-10-09')!;
  assert.equal(sat.expected, fri.expected, 'nothing is expected on a Saturday');
  assert.equal(addWorkDays('2026-10-09', 1), '2026-10-12');
  const joined = curveOf(p, { '2026-10-05': 5, '2026-10-06': 7 }, '2026-10-06');
  assert.deepEqual(joined.slice(0, 2).map((x) => x.actual), [5, 12]);
  assert.equal(joined[2].actual, undefined, 'no actual after today');
});

test('the forecast: actual + remaining plan × (actual ÷ planned for completed work), floored and capped', () => {
  const plan = generatePlan({ tier: 'small', entry: 'requirements-driven', start: '2026-10-05', now: NOW });
  // Done: P (7.5 planned) and 0 (15) cost 45 together: twice the plan. Now at Stage 1 with 10 spent of its 45.
  const v = varianceOf(plan, { P: 15, '0': 30, '1': 10 }, '1');
  assert.deepEqual(v.filter((s) => s.done).map((s) => s.stage), ['P', '0']);
  const f = forecastOf(v, 55, 400);
  const remaining = 45 - 10 + 40 + 45 + 20 + 120 + 40;
  assert.equal(f.remainingPlan, remaining);
  assert.equal(f.factor, 2);
  assert.equal(f.atCompletion, 55 + remaining * 2);
  assert.equal(f.over, 55 + remaining * 2 - 400);
  // A wild overrun is capped at 2×; an underrun floored at 0.5×.
  assert.equal(forecastOf(varianceOf(plan, { P: 75, '0': 150 }, '1'), 225).factor, 2);
  assert.equal(forecastOf(varianceOf(plan, { P: 1, '0': 1 }, '1'), 2).factor, 0.5);
  // Nothing done yet: the plan as it stands; and never below what's spent.
  const fresh = forecastOf(varianceOf(plan, {}, 'P'), 0);
  assert.equal(fresh.atCompletion, planTotal(plan));
  assert.equal(forecastOf(varianceOf(plan, { '6': 900 }, '6'), 1000).atCompletion >= 1000, true);
});

test('alerts: one per level crossing, never repeated, and reset when the budget is raised', () => {
  const s = { total: 100, autoPause: true };
  let alerts: BudgetAlert[] = [];
  let r = checkAlerts(s, 80, 50, 90, alerts, 1);
  assert.equal(r.raised.length, 0);
  r = checkAlerts(s, 80, 81, 95, (alerts = r.alerts), 2);
  assert.deepEqual(r.raised.map((a) => a.level), ['threshold']);
  r = checkAlerts(s, 80, 85, 95, (alerts = r.alerts), 3);
  assert.equal(r.raised.length, 0, 'no repeat');
  r = checkAlerts(s, 80, 86, 120, (alerts = r.alerts), 4);
  assert.deepEqual(r.raised.map((a) => a.level), ['forecast']);
  r = checkAlerts(s, 80, 101, 130, (alerts = r.alerts), 5);
  assert.deepEqual(r.raised.map((a) => a.level), ['full']);
  alerts = r.alerts;
  assert.equal(checkAlerts(s, 80, 120, 140, alerts, 6).raised.length, 0);
  // Raised to 200: the old alerts go, and 80 % of the new budget is news again.
  alerts = afterBudgetChange(alerts, 200);
  assert.equal(alerts.length, 0);
  assert.deepEqual(checkAlerts({ total: 200, autoPause: true }, 80, 165, 170, alerts, 7).raised.map((a) => a.level), ['threshold']);
  // A project threshold beats the office default.
  assert.deepEqual(checkAlerts({ total: 100, threshold: 50, autoPause: true }, 80, 55, undefined, [], 8).raised.map((a) => a.level), ['threshold']);
  // Straight past 100 %: only "reached" is said, and the threshold doesn't come later.
  const jump = checkAlerts(s, 80, 105, undefined, [], 9);
  assert.deepEqual(jump.raised.map((a) => a.level), ['full']);
  assert.equal(checkAlerts(s, 80, 90, undefined, jump.alerts, 10).raised.length, 0);
});

function service(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-budget-plan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const workers: WorkerInfo[] = [];
  const b = new BudgetService({
    dataDir: dir,
    now: () => NOW,
    floors: () => [{ id: 'travel', name: 'travel-approval', dir }],
    workers: () => workers,
    floorOfWorker: () => 'travel',
    roleOf: () => undefined,
    taskIssue: () => undefined,
    stageOf: () => '1' as StageId,
    officeLedger: { add: () => {}, state: () => ({ total: zeroUsage(), today: zeroUsage(), day: localDay(NOW), pauseHiring: false }) as UsageState },
    runs: () => [],
  });
  const raised: { level: string; paused: boolean }[] = [];
  const records: string[] = [];
  const deps: ControlDeps = { alert: (_f, a, paused) => raised.push({ level: a.level, paused }), record: (_f, _by, action, summary) => records.push(`${action}: ${summary}`) };
  const floor = { id: 'travel', name: 'travel-approval', dir };
  const spend = (w: WorkerInfo, cost: number) => {
    w.usage = { ...zeroUsage(), cost, calls: 1 } as Usage;
    b.onWorker('travel', w);
  };
  return { b, dir, workers, raised, records, deps, floor, spend };
}

test('plan edits record who made them, and the plan follows the build plan until someone edits it', (t) => {
  const s = service(t);
  writeFileSync(path.join(s.dir, 'agent-office.project.json'), JSON.stringify({ entryMode: 'requirements-driven', sizeTier: 'small' }));
  const p = planOf(s.b, s.floor);
  assert.equal(planTotal(p), 332.5);
  mkdirSync(path.join(s.dir, 'architecture', 'modules', 'Requests'), { recursive: true });
  mkdirSync(path.join(s.dir, 'architecture', 'modules', 'Approvals'), { recursive: true });
  assert.deepEqual(planOf(s.b, s.floor).lines.filter((l) => l.stage === '5').map((l) => l.label), ['Build · Approvals', 'Build · Requests']);
  assert.equal(editPlan(s.b, s.floor, { lines: [{ id: '3', usd: 70 }] }, 'Test', s.deps), undefined);
  const line = planOf(s.b, s.floor).lines.find((l) => l.id === '3')!;
  assert.deepEqual([line.usd, line.basis, line.editedBy], [70, 'edited', 'Test']);
  assert.match(s.records[0], /budget\.plan: Edited travel-approval's expected plan: Stage 3 · Architecture & design \$45 → \$70/);
  assert.match(editPlan(s.b, s.floor, { lines: [{ id: 'nope', usd: 1 }] }, 'Test', s.deps)!, /No plan line/);
  assert.match(editPlan(s.b, s.floor, { lines: [{ id: '3', days: 1.5 }] }, 'Test', s.deps)!, /whole working days/);
  // Edited: a new module no longer remakes it.
  mkdirSync(path.join(s.dir, 'architecture', 'modules', 'Reports'), { recursive: true });
  assert.equal(planOf(s.b, s.floor).lines.filter((l) => l.stage === '5').length, 2);
});

test('auto-pause at 100 % goes through the seam: the existing floor pause, or the Pause project when there is one', (t) => {
  const s = service(t);
  const w = { id: 'w1', name: 'Dylan', kind: 'agent', provider: 'claude', status: 'working', createdAt: NOW + 1, deskId: 'd', color: '#fff' } as WorkerInfo;
  s.workers.push(w);
  spend(0);
  function spend(c: number) {
    s.spend(w, c);
  }
  assert.equal(setSettings(s.b, s.floor, { total: 100 }, 'Test', s.deps), undefined);
  spend(85);
  checkFloor(s.b, s.floor, s.deps);
  assert.deepEqual(s.raised, [{ level: 'threshold', paused: false }, { level: 'forecast', paused: false }].filter((x) => x.level === 'threshold' || s.raised.some((r) => r.level === x.level)));
  spend(101);
  checkFloor(s.b, s.floor, s.deps);
  assert.ok(s.raised.some((r) => r.level === 'full' && r.paused));
  assert.match(floorHold('travel')!, /Budget reached \(\$101 of \$100\): project paused/);
  const office = { hiringPaused: undefined } as unknown as Ledger;
  assert.match(floorLedger(office, 'travel').hiringPaused!, /project paused/, 'hiring stops');
  // Needs you says so, with Raise budget and Resume.
  const f = s.b.file(s.floor);
  const needs = collectNeeds({ floor: 'travel', workers: [], pulls: [], floors: [], budget: { floor: 'travel', alerts: f.alerts, paused: 'x' } });
  assert.deepEqual(needs.map((n) => [n.text.slice(0, 30), n.action, n.alt?.action]), [['Budget reached: project paused', 'Raise budget', 'Resume']]);
  // Resume: off, and it doesn't pause again for this budget.
  assert.equal(resume(s.b, s.floor, 'Test', s.deps), undefined);
  assert.equal(floorHold('travel'), undefined);
  spend(110);
  checkFloor(s.b, s.floor, s.deps);
  assert.equal(floorHold('travel'), undefined);
  // Raised: the alerts reset.
  setSettings(s.b, s.floor, { total: 300 }, 'Test', s.deps);
  assert.equal(s.b.file(s.floor).alerts.length, 0);
  assert.ok(s.records.some((r) => /budget\.settings: Changed travel-approval's budget: total 100 → 300/.test(r)));

  // With a Pause project registered, the seam uses it instead.
  const calls: string[] = [];
  registerProjectPause({ pause: (id, why, by) => calls.push(`pause ${id} by ${by}: ${why.slice(0, 14)}`), resume: (id, by) => calls.push(`resume ${id} by ${by}`) });
  t.after(() => registerProjectPause(undefined));
  spend(301);
  checkFloor(s.b, s.floor, s.deps);
  assert.deepEqual(calls, ['pause travel by The office (budget): Budget reached']);
  assert.equal(floorHold('travel'), undefined, 'not the fallback');
  resume(s.b, s.floor, 'Test', s.deps);
  assert.deepEqual(calls.slice(1), ['resume travel by Test']);
});

test('the wizard\'s levels: preset budgets from the plan estimate, durations and settings', () => {
  const est = estimateFor('small', 'requirements-driven');
  assert.equal(est, 332.5);
  const cards = levelCards(est, 12);
  assert.deepEqual(cards.map((c) => [c.id, c.budget, c.time, c.days]), [['lean', 220, '~1.3× time', 16], ['balanced', 330, '~1.0× time', 12], ['fast', 530, '~0.7× time', 8]]);
  assert.equal(roundBudget(1234), 1250);
  const [lean, balanced, fast] = LEVELS;
  assert.deepEqual([lean.settings.leadModel, lean.settings.subagentModel, lean.settings.earlyDrafts, lean.settings.autonomyByStage.enabled], ['sonnet', 'haiku', false, true]);
  assert.deepEqual([balanced.settings.leadModel, balanced.settings.discoveryModel, balanced.settings.earlyDrafts], ['sonnet', 'opus', true]);
  assert.deepEqual([fast.settings.leadModel, fast.settings.parallel], ['opus', 'more']);
  // Haiku only where the role allows it.
  assert.equal(subagentModelAt(lean.settings, 'tester', 'sonnet'), 'haiku');
  assert.equal(subagentModelAt(lean.settings, 'developer', 'sonnet'), 'sonnet');
  // A choice from the wizard is cleaned: a level's defaults fill what's missing, nonsense is refused.
  const c = cleanChoice({ level: 'lean', total: 220, settings: { leadModel: 'gpt' } })!;
  assert.deepEqual([c.level, c.total, c.threshold, c.autoPause, c.settings.leadModel, c.settings.subagentModel], ['lean', 220, 80, true, 'sonnet', 'haiku']);
  assert.equal(cleanChoice({ level: 'fast', total: -5 }), undefined);
  assert.equal(cleanChoice({ level: 'manual', total: 500, threshold: 70, autoPause: false, settings: { leadModel: 'opus' } })!.settings.threshold, 70);
});

test('the plan\'s inputs from the project: shape, modules, a Firm re-forecast', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-budget-src-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'PROJECT.md'), '## Decisions\n\nEntry mode: Change an existing app\nSize tier: small — declared at kickoff\n');
  assert.deepEqual(projectShape(dir), { tier: 'small', entry: 'existing-app-change', known: true });
  assert.equal(entryOf('Requirements-driven'), 'requirements-driven');
  mkdirSync(path.join(dir, 'architecture'), { recursive: true });
  writeFileSync(path.join(dir, 'architecture', 'build-plan.md'), '# Build plan\n\n## Overview\n\n## 1. Requests — submit\n\n## 2. Approvals\n');
  assert.deepEqual(buildModules(dir), ['Requests', 'Approvals']);
  const report = { id: 'r1', generatedAt: 1, expectations: [{ area: 'cost', expected: '$400', actual: '$310 so far', gap: 'partial', note: 'Re-forecast at completion: $520' }], timeline: { milestones: [{ name: 'Build', forecast: '2026-11-20', status: 'at-risk', confidence: 'medium' }, { name: 'Test', forecast: '2026-12-04', status: 'at-risk', confidence: 'low' }] } } as unknown as Report;
  assert.deepEqual(firmForecastOf(report), { report: 'r1', generatedAt: 1, usd: 520, end: '2026-12-04' });
});

test('the wizard\'s Budget step: the plan carries the choice, and the team step applies it once, before anyone is hired', async (t) => {
  const { setupSteps } = await import('../src/server/wizard/steps.js');
  const { newJob } = await import('../src/server/wizard/job.js');
  const { cleanPlan } = await import('../src/server/wizard/plan.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-budget-wz-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const choice = cleanChoice({ level: 'lean', total: 220 })!;
  const raw = { kind: 'new', owner: 'Test-Org', name: 'travel-approval', mendix: '11.12.4', entry: 'requirements-driven', tier: 'small', roles: ['pm', 'chief-analyst'], discovery: { issue: true, queue: true, model: 'sonnet' }, budget: choice };
  const plan = cleanPlan(raw, ['11.12.4'], 'Test-Org');
  assert.ok(typeof plan !== 'string', String(plan));
  assert.deepEqual((plan as { budget?: unknown }).budget, choice);
  const order: string[] = [];
  const steps = setupSteps({
    cfg: { toolkitDir: dir, bash: 'bash', mendixDir: dir, org: 'Test-Org', adminTokenFile: path.join(dir, 'none') },
    projectsDir: () => dir,
    floorOf: () => undefined,
    addFloor: async () => 'unused',
    adoptFloor: () => 'unused',
    queue: () => 'unused',
    hired: () => false,
    known: () => false,
    hire: async (_f, role, _by, _a, _task, model) => void order.push(`hire ${role}${model ? ` on ${model}` : ''}`),
    applyBudget: (floor, c, by) => (order.push(`budget ${floor} ${c.level} $${c.total} by ${by}`), []),
  });
  const job = Object.assign(newJob(plan as never, 'Probe'), { dir, floor: 'travel-approval', issue: 3 });
  await steps.team(job, { log: () => undefined });
  assert.deepEqual(order, ['budget travel-approval lean $220 by Probe', 'hire pm', 'hire chief-analyst on sonnet']);
  // A Retry doesn't apply it again.
  await steps.team(Object.assign(job, { addRoles: undefined }), { log: () => undefined });
  assert.equal(order.filter((o) => o.startsWith('budget')).length, 1);
});
