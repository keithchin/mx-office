// Planned against actual: per stage, and the forecast at completion. The forecast is what's spent plus
// what the plan still has to do, scaled by how the finished stages went (actual ÷ planned for completed
// work), with the scale kept between FACTOR_MIN and FACTOR_MAX so one odd stage can't swing it wildly,
// and never below what's already spent. Pure.

import type { BudgetPlan, Forecast, StageId, StageVariance } from './types.js';
import { STAGE_IDS, STAGE_TITLE } from './types.js';

export const FACTOR_MIN = 0.5;
export const FACTOR_MAX = 2;

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Pipeline order: P, 0, 1 … 7. */
const order = (s: StageId) => STAGE_IDS.indexOf(s);

/** Planned and actual per stage in the plan; a stage is done once the project is past it. */
export function varianceOf(plan: BudgetPlan, actualByStage: Record<string, number>, current: StageId): StageVariance[] {
  const planned = new Map<StageId, number>();
  for (const l of plan.lines) planned.set(l.stage, (planned.get(l.stage) ?? 0) + l.usd);
  const stages = [...new Set([...planned.keys(), ...(Object.keys(actualByStage) as StageId[]).filter((s) => s !== '—')])].sort((a, b) => order(a) - order(b));
  return stages.map((stage) => {
    const p = r2(planned.get(stage) ?? 0);
    const a = r2(actualByStage[stage] ?? 0);
    return { stage, label: stage === '—' ? 'No stage' : `Stage ${stage} · ${STAGE_TITLE[stage]}`, planned: p, actual: a, diff: r2(a - p), done: current !== '—' && order(stage) < order(current) };
  });
}

/**
 * The forecast at completion: actual + remaining plan × (actual ÷ planned for the completed stages).
 * The current stage's remaining plan is what's left of it; stages ahead count in full. `spent` is
 * everything spent (spend outside any stage too), so the forecast never drops below it.
 */
export function forecastOf(variance: StageVariance[], spent: number, budget?: number): Forecast {
  const done = variance.filter((v) => v.done && v.planned > 0);
  const plannedDone = done.reduce((n, v) => n + v.planned, 0);
  const actualDone = done.reduce((n, v) => n + v.actual, 0);
  const raw = plannedDone > 0 ? actualDone / plannedDone : 1;
  const factor = Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, raw));
  const remainingPlan = r2(variance.filter((v) => !v.done).reduce((n, v) => n + Math.max(0, v.planned - v.actual), 0));
  const atCompletion = r2(Math.max(spent, spent + remainingPlan * factor));
  return { atCompletion, factor: Math.round(factor * 1000) / 1000, remainingPlan, ...(budget && atCompletion > budget ? { over: r2(atCompletion - budget) } : {}) };
}
