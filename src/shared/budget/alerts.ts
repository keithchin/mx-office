// When the budget speaks up: at the alert threshold (80 % by default), at 100 %, and when the forecast
// goes over. Each level is raised once per budget: a level already raised isn't raised again, and
// raising the budget clears them all, so the next crossing of the new one is news again. The forecast
// and threshold alerts can be marked as seen (out of Needs you, still on the Budget tab); a seen
// forecast comes back when the forecast grows by more than 10 % since, a seen threshold when the budget
// changes. 100 % can't be marked: it needs a budget decision. Pure.

import type { AlertLevel, BudgetAlert, BudgetSettings } from './types.js';
import { usd } from './money.js';

export interface AlertCheck {
  /** The alerts to keep (the old ones still standing, and the new). */
  alerts: BudgetAlert[];
  /** The ones raised just now. */
  raised: BudgetAlert[];
}

/** How much a seen forecast may grow before it's raised again: 10 %. */
export const FORECAST_RERAISE = 1.1;

/** The levels a person may mark as seen. */
export const SEEABLE_LEVELS: readonly AlertLevel[] = ['forecast', 'threshold'];
export const isSeeable = (l: unknown): l is 'forecast' | 'threshold' => SEEABLE_LEVELS.includes(l as AlertLevel);

const unseen = ({ seenAt: _a, seenBy: _b, seenForecast: _c, ...a }: BudgetAlert): BudgetAlert => a;

/**
 * The alerts after a budget change: a raised budget clears them. A lowered one keeps "reached" (said again against the new
 * budget, with `spent` now) and the threshold (no repeat, said again), and drops the forecast, so the next check says it with the new numbers: an
 * alert never names a budget that's no longer the budget (real-build fix: "$905 against $60" stood after a change to $30).
 */
export function afterBudgetChange(alerts: BudgetAlert[], total: number | undefined, spent?: number): BudgetAlert[] {
  if (!total) return [];
  const pct = spent !== undefined ? Math.round((spent / total) * 100) : 0;
  const words = (a: BudgetAlert) => (a.level === 'full' ? `Budget reached: ${usd(spent!)} of ${usd(total)} (${pct} %)` : `Budget at ${pct} %: ${usd(spent!)} of ${usd(total)}`);
  return alerts.filter((a) => a.budget >= total && a.level !== 'forecast').map((a) => ({ ...unseen(a), budget: total, ...(a.text && spent !== undefined ? { text: words(a) } : {}) }));
}

/** Marks a standing forecast or threshold alert as seen by `by`; the alerts after, or why not. */
export function markSeen(alerts: BudgetAlert[], level: unknown, by: string, now: number, forecast: number | undefined): BudgetAlert[] | string {
  if (!isSeeable(level)) return level === 'full' ? 'The budget reached 100 %: raise the budget or resume the project, it can’t be marked as seen' : 'Only a forecast or threshold alert can be marked as seen';
  const a = alerts.find((x) => x.level === level && x.text);
  if (!a) return 'There’s no such alert standing';
  if (a.seenAt) return alerts;
  return alerts.map((x) => (x === a ? { ...x, seenAt: now, seenBy: by, ...(level === 'forecast' && forecast !== undefined ? { seenForecast: forecast } : {}) } : x));
}

/** Which levels `spent` and `forecast` are past, against `settings`, and which of those are news. */
export function checkAlerts(settings: BudgetSettings, officeThreshold: number, spent: number, forecast: number | undefined, alerts: BudgetAlert[], now: number): AlertCheck {
  const total = settings.total;
  if (!total || total <= 0) return { alerts: [], raised: [] };
  const threshold = settings.threshold ?? officeThreshold;
  // A seen forecast that has grown past +10 % since is news again: taken out here and raised below with its new numbers.
  const kept = alerts.filter((a) => !(a.level === 'forecast' && a.seenAt && a.seenForecast !== undefined && forecast !== undefined && forecast > a.seenForecast * FORECAST_RERAISE));
  const has = (l: AlertLevel) => kept.some((a) => a.level === l);
  const raised: BudgetAlert[] = [];
  const raise = (level: AlertLevel, text: string) => raised.push({ level, at: now, text, budget: total });
  const pct = Math.round((spent / total) * 100);
  if (spent >= total && !has('full')) raise('full', `Budget reached: ${usd(spent)} of ${usd(total)} (${pct} %)`);
  if (spent >= (total * threshold) / 100 && spent < total && !has('threshold') && !has('full')) raise('threshold', `Budget at ${pct} %: ${usd(spent)} of ${usd(total)} (alert at ${threshold} %)`);
  if (forecast !== undefined && forecast > total && !has('forecast') && spent < total) raise('forecast', `Forecast over budget: ${usd(forecast)} at completion against ${usd(total)}`);
  // Past 100 % the threshold is old news: it's recorded so it isn't raised after a later drop in spend.
  if (raised.some((a) => a.level === 'full') && !has('threshold')) raised.push({ level: 'threshold', at: now, text: '', budget: total });
  return { alerts: [...kept, ...raised], raised: raised.filter((a) => a.text) };
}
