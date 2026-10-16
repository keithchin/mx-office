// A project's stage overspend and pace warnings (shared/budget/stage-warn.ts) on its budget file: checked
// after spend beside the budget's own alerts (index.ts), raised to the audit log and a toast, shown on the
// Budget tab's stage table and in Needs you, and dismissed by an admin (a stage until its next level, the
// pace for the day). The stage spend is the ledger's attribution as booked (stage.ts, read only here).
// Nothing here raises or clears the budget's alerts or touches its auto-pause.

import { STAGE_TITLE, type StageId } from '../../shared/budget/types.js';
import { runOutOf } from '../../shared/budget/forecast.js';
import { checkPace, checkStageWarnings, crossedMultiple, dismissStage, paceActive, paceEnd, paceText, stageWarnText, type PaceView, type StagePlanView, type StageWarnView } from '../../shared/budget/stage-warn.js';
import { numbersOf, type ControlDeps, type Numbers } from './control.js';
import type { BudgetService, FloorRef } from './service.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The ledger's spend per day, and what was booked to no stage. */
function ledgerSums(b: BudgetService, floor: FloorRef): { byDay: Record<string, number>; unattributed: number } {
  const byDay: Record<string, number> = {};
  let unattributed = 0;
  for (const [day, roll] of Object.entries(b.file(floor).ledger.days)) {
    byDay[day] = roll.cost;
    unattributed += roll.stage['—'] ?? 0;
  }
  return { byDay, unattributed: r2(unattributed) };
}

/** What the run-out, the end and the suppression are for this floor now. */
function paceInputs(b: BudgetService, floor: FloorRef, n: Numbers) {
  const f = b.file(floor);
  const total = f.settings.total;
  const threshold = f.settings.threshold ?? b.store.office().threshold;
  const sums = ledgerSums(b, floor);
  const runOut = runOutOf(sums.byDay, b.today, total, n.spent);
  const end = paceEnd(n.plan.end, f.settings.milestone);
  // The budget's own alerts speak from the threshold on (and there's nothing to run out without a budget).
  const suppressed = !total || n.spent >= (total * threshold) / 100;
  return { total, runOut, end, suppressed, unattributed: sums.unattributed };
}

/** The Budget tab's stage table and the warnings standing. */
export function stagePlanOf(b: BudgetService, floor: FloorRef, n: Numbers = numbersOf(b, floor)): StagePlanView {
  const f = b.file(floor);
  const current = b.deps.stageOf(floor.dir);
  const p = paceInputs(b, floor, n);
  const inPlan = new Set<StageId>(n.plan.lines.map((l) => l.stage));
  const recs = new Map((f.stageWarns ?? []).map((r) => [r.stage, r]));
  const rows = n.variance.map((v) => {
    const planned = inPlan.has(v.stage) ? v.planned : null;
    const rec = recs.get(v.stage);
    return { stage: v.stage, label: v.label, planned, spent: v.actual, ratio: planned && planned > 0 ? r2(v.actual / planned) : null, done: v.done, current: v.stage === current, ...(rec ? { warned: rec.multiple, dismissed: !!rec.dismissedAt } : {}) };
  });
  const warnings: StageWarnView[] = [];
  for (const v of n.variance) {
    const rec = recs.get(v.stage);
    if (!rec || current === '—' || !crossedMultiple(v.actual, v.planned)) continue;
    warnings.push({ stage: v.stage, label: v.label, planned: v.planned, actual: v.actual, ratio: r2(v.actual / v.planned), multiple: rec.multiple, text: stageWarnText(v.stage, STAGE_TITLE[v.stage], v.actual, v.planned, p.total, p.runOut, p.end), at: rec.at, dismissed: !!rec.dismissedAt });
  }
  let pace: PaceView | undefined;
  if (f.pace && f.pace.day === b.today && p.runOut && p.total && paceActive(p)) pace = { ...p.end, runOut: p.runOut.date, perDay: p.runOut.perDay, text: paceText(p.total, p.runOut, p.end), at: f.pace.at, dismissed: !!f.pace.dismissedAt };
  return {
    rows,
    unattributed: p.unattributed,
    noPipeline: current === '—',
    estimated: r2(Object.values(f.ledger.days).reduce((s, d) => s + d.est, 0)),
    planEstimated: n.plan.lines.some((l) => l.basis === 'default' || l.basis === 'history'),
    ...(p.runOut ? { runOut: p.runOut } : {}),
    ...p.end,
    warnings,
    ...(pace ? { pace } : {}),
  };
}

/** After spend: raises the stage warnings and the pace warning that are due. */
export function checkStages(b: BudgetService, floor: FloorRef, deps: ControlDeps, n: Numbers = numbersOf(b, floor)) {
  const f = b.file(floor);
  const now = b.deps.now();
  const current = b.deps.stageOf(floor.dir);
  const s = checkStageWarnings(n.variance, f.stageWarns ?? [], current, now);
  const p = paceInputs(b, floor, n);
  const pc = checkPace({ runOut: p.runOut, end: p.end, today: b.today, now, record: f.pace, suppressed: p.suppressed });
  const before = JSON.stringify([f.stageWarns ?? [], f.pace ?? null]);
  const after = JSON.stringify([s.records, pc.record ?? null]);
  if (before === after) return;
  f.stageWarns = s.records;
  if (pc.record) f.pace = pc.record;
  b.store.changed(floor.id);
  for (const r of s.raised) deps.warn?.(floor.id, { kind: 'stage', key: `stage-${r.stage}-${r.multiple}`, text: stageWarnText(r.stage, STAGE_TITLE[r.stage], r.actual, r.planned, p.total, p.runOut, p.end) });
  // The stage warning already says when the budget runs out: the pace isn't said twice in one go.
  if (pc.raised && !s.raised.length && p.total && p.runOut) deps.warn?.(floor.id, { kind: 'pace', key: `pace-${pc.raised.day}`, text: paceText(p.total, p.runOut, p.end) });
}

/** Dismisses a stage's warning until its next level (admins). */
export function dismissStageWarning(b: BudgetService, floor: FloorRef, stage: unknown, by: string, deps: ControlDeps): string | undefined {
  const f = b.file(floor);
  const next = dismissStage(f.stageWarns ?? [], stage, by, b.deps.now());
  if (typeof next === 'string') return next;
  const rec = next.find((r) => r.stage === stage)!;
  f.stageWarns = next;
  b.store.changed(floor.id);
  deps.record(floor.id, by, 'budget.stage.dismiss', `Dismissed ${floor.name}'s Stage ${String(stage)} overspend warning at ${rec.multiple}× its plan, until its next level`, { stage, multiple: rec.multiple });
  return undefined;
}

/** Dismisses today's pace warning (admins): it can come back tomorrow. */
export function dismissPaceWarning(b: BudgetService, floor: FloorRef, by: string, deps: ControlDeps): string | undefined {
  const f = b.file(floor);
  if (!f.pace || f.pace.day !== b.today) return 'There’s no pace warning standing today';
  if (f.pace.dismissedAt) return undefined;
  f.pace = { ...f.pace, dismissedAt: b.deps.now(), dismissedBy: by };
  b.store.changed(floor.id);
  deps.record(floor.id, by, 'budget.pace.dismiss', `Dismissed ${floor.name}'s pace warning for today (run-out estimate ${f.pace.runOut}, end ${f.pace.end})`);
  return undefined;
}
