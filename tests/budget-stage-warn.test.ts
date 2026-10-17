// Stage overspend and pace warnings (shared/budget/stage-warn.ts, shared/budget/stage-need.ts,
// server/budget/stage-warn.ts, the run-out estimate in shared/budget/forecast.ts): a stage past its plan
// line warns once at each of 1×, 2×, 5×, 10×; Dismiss for this stage holds until the next level; the pace
// warning (run-out before the plan's end or a milestone) at most once a day; nothing within plan; spend with
// no stage, and a project without the pipeline, said honestly; the budget's own alerts and pause untouched.
// Shaped on a migration project's ledger of 16 Oct (Stage 5 at $61.70 against a $6.86 plan line, $500 budget).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { UsageState } from '../src/shared/protocol.js';
import type { BudgetPlan, StageId, StageVariance } from '../src/shared/budget/types.js';
import { checkPace, checkStageWarnings, crossedMultiple, dismissStage, paceEnd, ratioWord, stageWarnText, type StageWarnRecord } from '../src/shared/budget/stage-warn.js';
import { runOutOf } from '../src/shared/budget/forecast.js';
import { stageNeeds } from '../src/shared/budget/stage-need.js';
import { collectNeeds } from '../src/shared/needsyou.js';
import { BudgetService, localDay } from '../src/server/budget/service.js';
import { checkFloor, numbersOf, setSettings, type ControlDeps } from '../src/server/budget/control.js';
import { checkStages, dismissPaceWarning, dismissStageWarning, stagePlanOf } from '../src/server/budget/stage-warn.js';
import { book } from '../src/server/budget/ledger.js';
import { zeroUsage } from '../src/server/usage.js';

const DAY = '2026-10-16';
const NOW = Date.parse(`${DAY}T12:00:00`);
const v = (stage: StageId, planned: number, actual: number): StageVariance => ({ stage, label: `Stage ${stage}`, planned, actual, diff: actual - planned, done: false });

test('a stage warns once at each level: 1×, 2×, 5×, 10×, never twice for the same one', () => {
  let recs: StageWarnRecord[] = [];
  const raisedAt: number[] = [];
  for (const actual of [5, 6.86, 7, 13.72, 20, 34.3, 40, 61.7, 68.6, 80]) {
    const r = checkStageWarnings([v('5', 6.86, actual)], recs, '5', NOW);
    recs = r.records;
    raisedAt.push(...r.raised.map((x) => x.multiple));
  }
  assert.deepEqual(raisedAt, [1, 2, 5, 10]);
  assert.equal(recs.length, 1);
  // A jump straight past several levels raises the highest one only.
  assert.deepEqual(checkStageWarnings([v('5', 6.86, 61.7)], [], '5', NOW).raised.map((x) => x.multiple), [5]);
  assert.equal(crossedMultiple(61.7, 6.86), 5);
  assert.equal(ratioWord(61.7 / 6.86), '9×');
  assert.equal(ratioWord(1.34), '1.3×');
});

test('no warning while a stage is within its plan line', () => {
  const r = checkStageWarnings([v('1', 53.2, 40), v('2', 34.11, 0), v('5', 6.86, 6.85)], [], '5', NOW);
  assert.deepEqual(r.raised, []);
  assert.deepEqual(r.records, []);
  assert.deepEqual(stageNeeds({ floor: 'p', alerts: [] }), []);
});

test('dismissed for a stage until its next level; a new level clears the dismissal; a raised plan line steps it down', () => {
  let recs = checkStageWarnings([v('5', 6.86, 7)], [], '5', NOW).records;
  recs = dismissStage(recs, '5', 'Keith', NOW + 1) as StageWarnRecord[];
  assert.equal(recs[0].dismissedBy, 'Keith');
  // More spend within the same level: nothing new, still dismissed.
  let r = checkStageWarnings([v('5', 6.86, 13)], recs, '5', NOW + 2);
  assert.deepEqual(r.raised, []);
  assert.ok(r.records[0].dismissedAt);
  // The next level: raised again, not dismissed.
  r = checkStageWarnings([v('5', 6.86, 14)], r.records, '5', NOW + 3);
  assert.deepEqual(r.raised.map((x) => x.multiple), [2]);
  assert.equal(r.records[0].dismissedAt, undefined);
  // The plan line raised to $70: the warning steps down and goes, so passing the new line is news again.
  r = checkStageWarnings([v('5', 70, 14)], r.records, '5', NOW + 4);
  assert.deepEqual(r.records, []);
  assert.match(dismissStage([], '5', 'Keith', NOW) as string, /no warning standing/);
});

test('spend with no stage and stages without a plan line never warn; nor does a project without the pipeline', () => {
  assert.deepEqual(checkStageWarnings([v('—', 0, 50), v('7', 0, 30)], [], '5', NOW).raised, []);
  assert.deepEqual(checkStageWarnings([v('5', 6.86, 61.7)], [], '—', NOW).raised, []);
});

test('the run-out estimate: what is left ÷ the recent pace, calendar days, none without a budget or recent spend', () => {
  // The sample project: $111.51 on its first and only day, $500 budget: $388.49 left at $111.51 a day → 4 days.
  const r = runOutOf({ [DAY]: 111.51 }, DAY, 500, 111.51)!;
  assert.deepEqual(r, { date: '2026-10-20', perDay: 111.51, days: 1, remaining: 388.49 });
  // Averaged over the last 7 days once the ledger is older (quiet days count).
  assert.equal(runOutOf({ '2026-10-01': 300, '2026-10-12': 70 }, DAY, 500, 370)!.perDay, 10);
  assert.equal(runOutOf({ [DAY]: 10 }, DAY, undefined, 10), undefined);
  assert.equal(runOutOf({ [DAY]: 600 }, DAY, 500, 600), undefined);
  assert.equal(runOutOf({ '2026-09-01': 50 }, DAY, 500, 50), undefined);
  const e = paceEnd('2026-11-05');
  assert.equal(stageWarnText('5', 'Build', 61.7, 6.86, 500, r, e), 'Stage 5 Build has spent $61.70 against its plan of $6.86 (9×). At this rate the project budget ($500) runs out around 20 Oct (estimate), before the plan\'s end (5 Nov).');
  // A milestone earlier than the plan's end is what the run-out is compared with.
  assert.deepEqual(paceEnd('2026-11-05', '2026-10-19'), { end: '2026-10-19', endIs: 'milestone' });
  assert.deepEqual(paceEnd('2026-11-05', '2026-12-01'), { end: '2026-11-05', endIs: 'plan' });
});

test('the pace warning: once a day while the run-out is before the end; not when the threshold alert already speaks', () => {
  const runOut = runOutOf({ [DAY]: 111.51 }, DAY, 500, 111.51);
  const end = paceEnd('2026-11-05');
  const a = checkPace({ runOut, end, today: DAY, now: NOW, suppressed: false });
  assert.ok(a.raised);
  const again = checkPace({ runOut, end, today: DAY, now: NOW + 60_000, record: a.record, suppressed: false });
  assert.equal(again.raised, undefined);
  const tomorrow = checkPace({ runOut, end, today: '2026-10-17', now: NOW + 86_400_000, record: a.record, suppressed: false });
  assert.equal(tomorrow.raised?.day, '2026-10-17');
  // Run-out after the end, or the budget's own threshold alert covering it: nothing.
  assert.equal(checkPace({ runOut, end: paceEnd('2026-10-18'), today: DAY, now: NOW, suppressed: false }).raised, undefined);
  assert.equal(checkPace({ runOut, end, today: DAY, now: NOW, suppressed: true }).raised, undefined);
});

test('Needs you: a stage row with Raise the budget… and Dismiss for this stage; the pace row only when no stage row says it; none when paused', () => {
  const stage = { stage: '5' as StageId, label: 'Stage 5 · Build', planned: 6.86, actual: 61.7, ratio: 8.99, multiple: 5, text: 'Stage 5 Build has spent …', at: NOW, dismissed: false };
  const pace = { end: '2026-11-05', endIs: 'plan' as const, runOut: '2026-10-20', perDay: 111.51, text: 'At the last 1 day…', at: NOW, dismissed: false };
  const items = collectNeeds({ floor: 'p', workers: [], pulls: [], floors: [], budget: { floor: 'p', alerts: [], stageWarnings: [stage], pace } });
  assert.deepEqual(
    items.map((n) => [n.key, n.action, n.target, n.alt?.action, n.alt?.target]),
    [['budget-stage-5', 'Raise the budget…', { to: 'budget', section: 'settings' }, 'Dismiss for this stage', { to: 'budget', dismissStage: '5' }]],
  );
  assert.deepEqual(stageNeeds({ floor: 'p', alerts: [], pace }).map((n) => [n.key, n.action, n.alt?.target]), [['budget-pace', 'Review the plan', { to: 'budget', dismissPace: true }]]);
  assert.deepEqual(stageNeeds({ floor: 'p', alerts: [], stageWarnings: [{ ...stage, dismissed: true }], pace: { ...pace, dismissed: true } }), []);
  assert.deepEqual(stageNeeds({ floor: 'p', alerts: [], paused: 'Budget reached', stageWarnings: [stage] }), []);
});

// ---- On a budget file, the way the office runs it -------------------------------------------------

const PLAN: BudgetPlan = {
  lines: [
    { id: 'P', stage: 'P', label: 'Stage P · Kickoff', basis: 'default', usd: 6, days: 1 },
    { id: '1', stage: '1', label: 'Stage 1 · Analysis', basis: 'history', usd: 53.2, days: 3 },
    { id: '5:1', stage: '5', label: 'Build · Checksheet', basis: 'history', usd: 6.86, days: 2 },
    { id: '6', stage: '6', label: 'Stage 6 · Test', basis: 'history', usd: 40.05, days: 1 },
  ],
  start: DAY,
  end: '2026-11-05',
  basis: 'project-like',
  generatedAt: NOW,
};

function service(t: { after(fn: () => void): void }, stage: StageId = '5') {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-stage-warn-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let now = NOW;
  const b = new BudgetService({
    dataDir: dir,
    now: () => now,
    floors: () => [{ id: 'p', name: 'sample-checksheet-demo', dir }],
    workers: () => [],
    floorOfWorker: () => 'p',
    roleOf: () => undefined,
    taskIssue: () => undefined,
    stageOf: () => stage,
    officeLedger: { add: () => {}, state: () => ({ total: zeroUsage(), today: zeroUsage(), day: localDay(NOW), pauseHiring: false }) as UsageState },
    runs: () => [],
  });
  const floor = { id: 'p', name: 'sample-checksheet-demo', dir };
  const f = b.file(floor);
  f.ledger.backfilled = true;
  f.plan = structuredClone(PLAN);
  const warned: { kind: string; text: string }[] = [];
  const alerts: string[] = [];
  const records: string[] = [];
  const deps: ControlDeps = { alert: (_f, a) => alerts.push(a.level), record: (_f, _by, action) => records.push(action), warn: (_f, w) => warned.push(w) };
  const spend = (s: StageId, cost: number) => book(f.ledger, { day: localDay(now), agent: 'w1', model: 'claude-sonnet-5', stage: s, cost, calls: 1 }, { key: 'w1', name: 'Sophie', role: 'Lead Developer', kind: 'worker' });
  const check = () => {
    const n = numbersOf(b, floor);
    checkFloor(b, floor, deps, n);
    checkStages(b, floor, deps, n);
  };
  return { b, f, floor, deps, warned, alerts, records, spend, check, at: (ms: number) => (now = ms) };
}

test('a migration project: Stage 5 at 9× its plan warns with the run-out estimate; the 80 % alert and auto-pause are untouched', (t) => {
  const s = service(t);
  setSettings(s.b, s.floor, { total: 500 }, 'Keith', s.deps);
  s.spend('P', 44.71);
  s.spend('—', 0.01);
  s.spend('5', 61.7);
  s.check();
  // A warning each for Stage P (7× its $6) and Stage 5 (9×), at the highest level reached; the pace isn't said a second time in the same check.
  assert.deepEqual(s.warned.map((w) => w.kind), ['stage', 'stage']);
  assert.equal(s.warned.find((w) => w.text.startsWith('Stage 5'))!.text, "Stage 5 Build has spent $61.70 against its plan of $6.86 (9×). At this rate the project budget ($500) runs out around 20 Oct (estimate), before the plan's end (5 Nov).");
  assert.deepEqual(s.alerts, []);
  assert.equal(s.f.alerts.length, 0);
  assert.equal(s.f.pausedAt, undefined);
  // Stage P is past its $6 line too (7×): its own warning.
  assert.deepEqual(s.f.stageWarns!.map((r) => [r.stage, r.multiple]).sort(), [['5', 5], ['P', 5]]);
  // Again on the same numbers: nothing new.
  s.warned.length = 0;
  s.check();
  assert.deepEqual(s.warned, []);
  // The view: the table with plan, spent and ×, missing data in words.
  const v = stagePlanOf(s.b, s.floor);
  const row5 = v.rows.find((r) => r.stage === '5')!;
  assert.deepEqual([row5.planned, row5.spent, row5.ratio, row5.warned, row5.current], [6.86, 61.7, 8.99, 5, true]);
  assert.equal(v.unattributed, 0.01);
  assert.equal(v.noPipeline, false);
  assert.equal(v.planEstimated, true);
  assert.equal(v.runOut?.date, '2026-10-20');
  assert.ok(v.pace, 'the pace warning stands for today');
});

test('dismissal on the file: Needs you drops the stage row until the next level, audited', (t) => {
  const s = service(t);
  setSettings(s.b, s.floor, { total: 500 }, 'Keith', s.deps);
  s.spend('5', 7);
  s.check();
  assert.equal(dismissStageWarning(s.b, s.floor, '5', 'Keith', s.deps), undefined);
  assert.ok(s.records.includes('budget.stage.dismiss'));
  assert.deepEqual(stagePlanOf(s.b, s.floor).warnings.map((w) => [w.stage, w.dismissed]), [['5', true]]);
  s.warned.length = 0;
  s.spend('5', 6); // $13: still under 2×
  s.check();
  assert.deepEqual(s.warned, []);
  s.spend('5', 1); // $14: past 2×
  s.check();
  assert.deepEqual(s.warned.map((w) => w.kind), ['stage']);
  assert.deepEqual(stagePlanOf(s.b, s.floor).warnings.map((w) => [w.multiple, w.dismissed]), [[2, false]]);
  assert.match(dismissStageWarning(s.b, s.floor, '6', 'Keith', s.deps)!, /no warning standing/);
});

test('the pace warning on the file: raised once a day, dismissed for the day, back the next', (t) => {
  const s = service(t);
  setSettings(s.b, s.floor, { total: 500 }, 'Keith', s.deps);
  s.spend('1', 40); // within Stage 1's $53.20: no stage warning; $40 a day runs $500 out on 28 Oct, before 5 Nov.
  s.check();
  assert.deepEqual(s.warned.map((w) => w.kind), ['pace']);
  assert.match(s.warned[0].text, /runs out around 28 Oct \(estimate\), before the plan's end \(5 Nov\)/);
  s.check();
  assert.equal(s.warned.length, 1);
  assert.equal(dismissPaceWarning(s.b, s.floor, 'Keith', s.deps), undefined);
  assert.equal(stagePlanOf(s.b, s.floor).pace?.dismissed, true);
  // The next day, the pace still short of the end: once more.
  s.at(NOW + 86_400_000);
  s.spend('6', 40);
  s.check();
  assert.deepEqual(s.warned.map((w) => w.kind), ['pace', 'pace']);
  assert.equal(stagePlanOf(s.b, s.floor).pace?.dismissed, false);
  // A milestone sooner: compared with it instead.
  setSettings(s.b, s.floor, { milestone: '2026-10-20' }, 'Keith', s.deps);
  assert.equal(stagePlanOf(s.b, s.floor).end, '2026-10-20');
  assert.match(setSettings(s.b, s.floor, { milestone: '20 Oct' }, 'Keith', s.deps)!, /YYYY-MM-DD/);
});

test('no pace warning past the alert threshold: the 80 % alert says it, so it isn’t said twice', (t) => {
  const s = service(t);
  setSettings(s.b, s.floor, { total: 100, threshold: 40 }, 'Keith', s.deps);
  s.spend('1', 45);
  s.check();
  assert.deepEqual(s.alerts, ['threshold']);
  assert.deepEqual(s.warned, []);
  assert.equal(stagePlanOf(s.b, s.floor).pace, undefined);
});

test('missing stage attribution is said, never guessed: a project without the pipeline warns about no stage', (t) => {
  const s = service(t, '—');
  setSettings(s.b, s.floor, { total: 5000 }, 'Keith', s.deps);
  s.spend('—', 61.7);
  s.check();
  assert.deepEqual(s.warned, []);
  const v = stagePlanOf(s.b, s.floor);
  assert.equal(v.noPipeline, true);
  assert.equal(v.unattributed, 61.7);
  assert.deepEqual(v.warnings, []);
  // The plan's stages show with nothing booked to them: the spend isn't spread over them.
  assert.ok(v.rows.every((r) => r.spent === 0));
});

test('a stage that spends with no plan line shows as not in the plan, not as $0 planned', (t) => {
  const s = service(t, '7');
  s.spend('7', 12);
  s.check();
  const row = stagePlanOf(s.b, s.floor).rows.find((r) => r.stage === '7')!;
  assert.deepEqual([row.planned, row.ratio, row.spent], [null, null, 12]);
  assert.deepEqual(s.warned, []);
});

test('the page’s Dismiss buttons post the stage and pace actions for the floor', async () => {
  const { installFakeDom } = await import('./support/fakedom.js');
  installFakeDom();
  if (!document.getElementById('toasts')) {
    const toasts = document.createElement('div');
    toasts.id = 'toasts';
    document.body.append(toasts);
  }
  const made = document.createElement;
  document.createElement = ((tag: string) => Object.assign(made(tag), { style: {} })) as typeof document.createElement;
  const sent: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => (sent.push(JSON.parse(init.body)), new Response(JSON.stringify({ ok: true }), { status: 200 }))) as unknown as typeof fetch;
  try {
    const ui = await import('../src/client/ui/budget/stages.js');
    assert.equal(await ui.dismissStage('p', '5'), true);
    assert.equal(await ui.dismissPace('p'), true);
    assert.deepEqual(sent.map((b) => [b.floor, b.action, b.stage]), [['p', 'stage-dismiss', '5'], ['p', 'pace-dismiss', undefined]]);
  } finally {
    globalThis.fetch = realFetch;
    document.createElement = made;
  }
});
