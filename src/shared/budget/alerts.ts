// When the budget speaks up: at the alert threshold (80 % by default), at 100 %, and when the forecast
// goes over. Each level is raised once per budget: a level already raised isn't raised again, and
// raising the budget clears them all, so the next crossing of the new one is news again. Pure.

import type { AlertLevel, BudgetAlert, BudgetSettings } from './types.js';
import { usd } from './money.js';

export interface AlertCheck {
  /** The alerts to keep (the old ones still standing, and the new). */
  alerts: BudgetAlert[];
  /** The ones raised just now. */
  raised: BudgetAlert[];
}

/** The alerts after a budget change: a raised budget clears them; a lowered one keeps them (no repeats). */
export function afterBudgetChange(alerts: BudgetAlert[], total: number | undefined): BudgetAlert[] {
  if (!total) return [];
  return alerts.filter((a) => a.budget >= total);
}

/** Which levels `spent` and `forecast` are past, against `settings`, and which of those are news. */
export function checkAlerts(settings: BudgetSettings, officeThreshold: number, spent: number, forecast: number | undefined, alerts: BudgetAlert[], now: number): AlertCheck {
  const total = settings.total;
  if (!total || total <= 0) return { alerts: [], raised: [] };
  const threshold = settings.threshold ?? officeThreshold;
  const has = (l: AlertLevel) => alerts.some((a) => a.level === l);
  const raised: BudgetAlert[] = [];
  const raise = (level: AlertLevel, text: string) => raised.push({ level, at: now, text, budget: total });
  const pct = Math.round((spent / total) * 100);
  if (spent >= total && !has('full')) raise('full', `Budget reached: ${usd(spent)} of ${usd(total)} (${pct} %)`);
  if (spent >= (total * threshold) / 100 && spent < total && !has('threshold') && !has('full')) raise('threshold', `Budget at ${pct} %: ${usd(spent)} of ${usd(total)} (alert at ${threshold} %)`);
  if (forecast !== undefined && forecast > total && !has('forecast') && spent < total) raise('forecast', `Forecast over budget: ${usd(forecast)} at completion against ${usd(total)}`);
  // Past 100 % the threshold is old news: it's recorded so it isn't raised after a later drop in spend.
  if (raised.some((a) => a.level === 'full') && !has('threshold')) raised.push({ level: 'threshold', at: now, text: '', budget: total });
  return { alerts: [...alerts, ...raised], raised: raised.filter((a) => a.text) };
}
