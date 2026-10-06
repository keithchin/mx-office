// A project's budget beyond the ledger: its expected plan (made, kept up to date until someone edits it,
// edited line by line, re-forecast from a Firm audit), planned against actual and the forecast, the
// alerts it raises, and the pause at 100 %. Works on a BudgetService (service.ts); index.ts gives it the
// office's audit log, toasts and the team (for a level's models and settings).

import type { BudgetAlert, BudgetPlan, BudgetSettings, CurvePoint, Forecast, StageVariance } from '../../shared/budget/types.js';
import { afterBudgetChange, checkAlerts } from '../../shared/budget/alerts.js';
import { forecastOf, varianceOf } from '../../shared/budget/forecast.js';
import { addWorkDays, curveOf, generatePlan, type HistoryRun } from '../../shared/budget/plan.js';
import { usd } from '../../shared/budget/money.js';
import { totalOf } from './ledger.js';
import { pauseFloorForBudget, resumeFloorFromBudget } from './pause.js';
import { buildModules, projectShape } from './plan-source.js';
import type { BudgetService, FloorRef } from './service.js';

export interface ControlDeps {
  /** An alert was raised (to the audit log, a toast, the Needs-you strip). */
  alert(floorId: string, a: BudgetAlert, paused: boolean): void;
  /** A change to record in the audit log. */
  record(floorId: string, by: string, action: string, summary: string, details?: Record<string, unknown>): void;
}

export interface Numbers {
  spent: number;
  plan: BudgetPlan;
  variance: StageVariance[];
  /** None for a project without the toolkit's pipeline whose plan nobody has set: there's nothing to forecast from. */
  forecast?: Forecast;
  curve: CurvePoint[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The history the plan is priced from: the analysis runs' cost and task types. */
function history(b: BudgetService): HistoryRun[] {
  return b.deps.runs().map((r) => ({ types: r.types ?? [], cost: r.cost ?? 0 }));
}

/** A fresh plan for the floor from its shape, modules and the office's history. */
export function makePlan(b: BudgetService, floor: FloorRef): BudgetPlan {
  const f = b.file(floor);
  const shape = projectShape(floor.dir);
  const days = Object.keys(f.ledger.days).sort();
  return generatePlan({ tier: shape.tier, entry: shape.entry, modules: buildModules(floor.dir), history: history(b), start: days[0] ?? b.today, now: b.deps.now() });
}

/**
 * The floor's plan: made the first time, and made again while nobody has edited it once the build
 * plan's modules change (the per-module lines follow the real modules).
 */
export function planOf(b: BudgetService, floor: FloorRef): BudgetPlan {
  const f = b.file(floor);
  if (!f.plan) {
    f.plan = makePlan(b, floor);
    b.store.changed(floor.id);
    return f.plan;
  }
  if (!f.plan.edited) {
    const mods = buildModules(floor.dir);
    const now = f.plan.lines.filter((l) => l.stage === '5' && !l.label.endsWith('(assumed)')).length;
    if (mods && mods.length !== now) {
      f.plan = { ...makePlan(b, floor), start: f.plan.start };
      b.store.changed(floor.id);
    }
  }
  return f.plan;
}

/** Planned against actual, the forecast and the curves. */
export function numbersOf(b: BudgetService, floor: FloorRef): Numbers {
  const f = b.file(floor);
  const plan = planOf(b, floor);
  const spent = totalOf(f.ledger);
  const byStage: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  for (const [day, roll] of Object.entries(f.ledger.days)) {
    byDay[day] = roll.cost;
    for (const [s, c] of Object.entries(roll.stage)) byStage[s] = (byStage[s] ?? 0) + c;
  }
  const stage = b.deps.stageOf(floor.dir);
  const variance = varianceOf(plan, byStage, stage);
  const forecast = stage !== '—' || plan.edited ? forecastOf(variance, spent, f.settings.total) : undefined;
  return { spent, plan, variance, ...(forecast ? { forecast } : {}), curve: curveOf(plan, byDay, b.today) };
}

/** After spend: raises the alerts that are due, and pauses the project at 100 % when auto-pause is on. */
export function checkFloor(b: BudgetService, floor: FloorRef, deps: ControlDeps) {
  const f = b.file(floor);
  if (!f.settings.total) return;
  const n = numbersOf(b, floor);
  const { alerts, raised } = checkAlerts(f.settings, b.store.office().threshold, n.spent, n.forecast?.atCompletion, f.alerts, b.deps.now());
  if (alerts.length === f.alerts.length) return;
  f.alerts = alerts;
  let paused = false;
  if (raised.some((a) => a.level === 'full') && f.settings.autoPause && !f.pausedAt) {
    f.pausedAt = b.deps.now();
    pauseFloorForBudget(floor.id, pauseWhy(f.settings.total, n.spent));
    paused = true;
  }
  b.store.changed(floor.id);
  for (const a of raised) deps.alert(floor.id, a, paused && a.level === 'full');
}

export const pauseWhy = (total: number, spent: number) => `Budget reached (${usd(spent)} of ${usd(total)}): project paused. No new hires and no office prompts until the budget is raised or someone resumes it; people's messages still go through`;

/** Puts the budget's pause back after a restart (holds live in memory). */
export function restorePause(b: BudgetService, floor: FloorRef) {
  const f = b.file(floor);
  if (f.pausedAt && f.settings.total) pauseFloorForBudget(floor.id, pauseWhy(f.settings.total, totalOf(f.ledger)));
}

/** Resume: takes the budget's pause off (it won't pause again for this budget: the 100 % alert stands). */
export function resume(b: BudgetService, floor: FloorRef, by: string, deps: ControlDeps): string | undefined {
  const f = b.file(floor);
  if (!f.pausedAt) return 'The project isn’t paused by its budget';
  f.pausedAt = undefined;
  resumeFloorFromBudget(floor.id, by);
  b.store.changed(floor.id);
  deps.record(floor.id, by, 'budget.resume', `Resumed ${floor.name} after its budget paused it`);
  return undefined;
}

/** New budget settings from a request (admins). A raised budget clears the alerts and lifts the pause when it's no longer spent. */
export function setSettings(b: BudgetService, floor: FloorRef, raw: unknown, by: string, deps: ControlDeps): string | undefined {
  if (!raw || typeof raw !== 'object') return 'Send the budget settings';
  const r = raw as Record<string, unknown>;
  const f = b.file(floor);
  const was: BudgetSettings = { ...f.settings };
  const next: BudgetSettings = { ...f.settings };
  if ('total' in r) {
    if (r.total === null || r.total === '' || r.total === 0) delete next.total;
    else {
      const t = Number(r.total);
      if (!(t > 0 && t < 10_000_000)) return 'The budget is an amount in US dollars, more than 0';
      next.total = r2(t);
    }
  }
  if ('threshold' in r) {
    if (r.threshold === null || r.threshold === '') delete next.threshold;
    else {
      const t = Number(r.threshold);
      if (!(t >= 1 && t <= 99)) return 'The alert threshold is a percentage between 1 and 99';
      next.threshold = Math.round(t);
    }
  }
  if (typeof r.autoPause === 'boolean') next.autoPause = r.autoPause;
  next.updatedBy = by;
  next.updatedAt = b.deps.now();
  f.settings = next;
  if ((next.total ?? 0) > (was.total ?? 0)) f.alerts = afterBudgetChange(f.alerts, next.total);
  if (!next.total) f.alerts = [];
  const spent = totalOf(f.ledger);
  if (f.pausedAt && (!next.total || spent < next.total || !next.autoPause)) {
    f.pausedAt = undefined;
    resumeFloorFromBudget(floor.id, by);
  }
  b.store.changed(floor.id);
  const changes = (['total', 'threshold', 'autoPause'] as const).filter((k) => was[k] !== next[k]);
  if (changes.length) deps.record(floor.id, by, 'budget.settings', `Changed ${floor.name}'s budget: ${changes.map((k) => `${k} ${String(was[k] ?? '—')} → ${String(next[k] ?? '—')}`).join(', ')}`, { before: pick(was), after: pick(next) });
  return undefined;
}

const pick = (s: BudgetSettings) => ({ total: s.total, threshold: s.threshold, autoPause: s.autoPause, level: s.level });

/** Edits plan lines (`[{ id, usd?, days? }]`), each marked as edited by `by`. */
export function editPlan(b: BudgetService, floor: FloorRef, raw: unknown, by: string, deps: ControlDeps): string | undefined {
  const edits = (raw as { lines?: unknown })?.lines;
  if (!Array.isArray(edits) || !edits.length || edits.length > 100) return 'Send the lines to change';
  const plan = planOf(b, floor);
  const before = plan.lines.map((l) => ({ ...l }));
  const now = b.deps.now();
  for (const e of edits as Record<string, unknown>[]) {
    const line = plan.lines.find((l) => l.id === e?.id);
    if (!line) return `No plan line ${String(e?.id)}`;
    const u = e.usd === undefined ? line.usd : Number(e.usd);
    const d = e.days === undefined ? line.days : Number(e.days);
    if (!(u >= 0 && u < 10_000_000)) return `${line.label}: the cost is an amount in US dollars`;
    if (!(d >= 0 && d <= 365 && Number.isInteger(d))) return `${line.label}: the days are whole working days, 0 to 365`;
    if (u === line.usd && d === line.days) continue;
    Object.assign(line, { usd: r2(u), days: d, basis: 'edited', editedBy: by, editedAt: now });
  }
  plan.edited = true;
  plan.end = generateEnd(plan);
  b.store.changed(floor.id);
  const changed = plan.lines.filter((l, i) => l.usd !== before[i].usd || l.days !== before[i].days);
  if (changed.length) deps.record(floor.id, by, 'budget.plan', `Edited ${floor.name}'s expected plan: ${changed.map((l) => `${l.label} ${usd(before.find((x) => x.id === l.id)!.usd)} → ${usd(l.usd)}`).join(', ')}`);
  return undefined;
}

function generateEnd(p: BudgetPlan): string {
  const days = p.lines.reduce((n, l) => n + l.days, 0);
  return addWorkDays(p.start, days);
}

/** Makes the plan again from the project (edited lines are replaced too). */
export function regeneratePlan(b: BudgetService, floor: FloorRef, by: string, deps: ControlDeps) {
  const f = b.file(floor);
  f.plan = makePlan(b, floor);
  b.store.changed(floor.id);
  deps.record(floor.id, by, 'budget.plan', `Made ${floor.name}'s expected plan again from the project (${f.plan.basis})`);
}

/** Applies a Firm audit's re-forecast: the plan's lines scaled to its total, and its end date. */
export function applyFirm(b: BudgetService, floor: FloorRef, firm: { report: string; usd?: number; end?: string }, by: string, deps: ControlDeps): string | undefined {
  const plan = planOf(b, floor);
  const total = plan.lines.reduce((n, l) => n + l.usd, 0);
  if (firm.usd === undefined && !firm.end) return 'The audit gave no re-forecast to apply';
  if (firm.usd !== undefined && total > 0) {
    const k = firm.usd / total;
    for (const l of plan.lines) Object.assign(l, { usd: r2(l.usd * k), basis: 'firm', editedBy: `${by} (Firm audit ${firm.report})`, editedAt: b.deps.now() });
  }
  if (firm.end) plan.end = firm.end;
  plan.edited = true;
  b.store.changed(floor.id);
  deps.record(floor.id, by, 'budget.plan', `Applied the Firm audit's re-forecast to ${floor.name}'s plan${firm.usd !== undefined ? `: ${usd(firm.usd)} at completion` : ''}${firm.end ? `, ending ${firm.end}` : ''}`, { report: firm.report });
  return undefined;
}
