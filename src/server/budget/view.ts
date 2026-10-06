// What GET /api/budget and GET /api/budget/office answer: a project's numbers and breakdowns, and the
// office-wide view (every project, the office's background calls, the Firm), from the ledgers.

import type { BudgetView, OfficeBudgetView, OfficeFloorBudget } from '../../shared/budget/types.js';
import { toneOf } from '../../shared/budget/money.js';
import { breakdowns, recentDays, totalOf, type LedgerData } from './ledger.js';
import type { BudgetService, FloorRef } from './service.js';

/** Days of the "by day" table and chart. */
const DAY_ROWS = 30;
/** Days of a home-page sparkline. */
const SPARK_DAYS = 14;

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

function unmeteredOf(d: LedgerData) {
  const calls = sum(Object.values(d.days).map((x) => x.unmetered));
  const agents = [...new Set(d.rows.filter((r) => r.unmetered).map((r) => d.agents[r.agent]?.name ?? r.agent))];
  return { calls, agents };
}

/** A project's Budget tab. */
export function floorView(b: BudgetService, floor: FloorRef, admin: boolean): BudgetView {
  const f = b.file(floor);
  const d = f.ledger;
  const today = b.today;
  const days = Object.keys(d.days).sort();
  const spent = totalOf(d);
  const o = b.store.office();
  return {
    floor: floor.id,
    name: floor.name,
    spent,
    today: d.days[today]?.cost ?? 0,
    estimated: sum(Object.values(d.days).map((x) => x.est)),
    daysActive: days.filter((x) => d.days[x].cost > 0 || d.days[x].calls > 0).length,
    ...(days[0] ? { firstDay: days[0] } : {}),
    unmetered: unmeteredOf(d),
    ...breakdowns(d),
    byDay: recentDays(d, today, DAY_ROWS),
    stage: b.deps.stageOf(floor.dir),
    settings: f.settings,
    officeThreshold: o.threshold,
    tone: toneOf(f.settings.total, spent),
    fx: b.fx(),
    admin,
  };
}

/** One project's line on the office view and the home page. */
export function floorLine(b: BudgetService, floor: FloorRef): OfficeFloorBudget {
  const f = b.file(floor);
  const spent = totalOf(f.ledger);
  return {
    id: floor.id,
    name: floor.name,
    spent,
    today: f.ledger.days[b.today]?.cost ?? 0,
    ...(f.settings.total ? { budget: f.settings.total } : {}),
    tone: toneOf(f.settings.total, spent),
    ...(f.pausedAt ? { paused: true } : {}),
    spark: recentDays(f.ledger, b.today, SPARK_DAYS).map((x) => x.cost),
  };
}

/** The office-wide view. */
export function officeView(b: BudgetService, admin: boolean, lines: (floor: FloorRef) => OfficeFloorBudget = (fl) => floorLine(b, fl)): OfficeBudgetView {
  const state = b.deps.officeLedger.state();
  const floors = b.deps.floors();
  const ledgers = [...floors.map((fl) => b.file(fl).ledger), b.store.office().ledger];
  const today = b.today;
  const bg = new Map<string, { label: string; cost: number; today: number }>();
  for (const d of ledgers) {
    for (const [day, roll] of Object.entries(d.days)) {
      for (const [key, cost] of Object.entries(roll.agent)) {
        const a = d.agents[key];
        if (a?.kind !== 'background') continue;
        const o = bg.get(key) ?? { label: a.name, cost: 0, today: 0 };
        o.cost += cost;
        if (day === today) o.today += cost;
        bg.set(key, o);
      }
    }
  }
  const total = sum([...bg.values()].map((x) => x.cost));
  const firm = bg.get('bg:firm');
  return {
    today: state.today.cost,
    total: state.total.cost,
    ...(state.budget !== undefined ? { dailyBudget: state.budget } : {}),
    floors: floors.map(lines),
    background: {
      today: sum([...bg.values()].map((x) => x.today)),
      total,
      bySource: [...bg].map(([key, v]) => ({ key, label: v.label, cost: v.cost, share: total > 0 ? v.cost / total : 0 })).sort((a, z) => z.cost - a.cost),
    },
    firm: { total: firm?.cost ?? 0, audits: 0 },
    fx: b.fx(),
    fxSettings: b.store.office().fx,
    officeThreshold: b.store.office().threshold,
    admin,
  };
}
