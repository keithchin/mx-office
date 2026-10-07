// A floor's budget file (budget/<floor>.json, server/budget/store.ts): its ledger booked row by row
// through the real ledger (budget/ledger.ts book, then prune to its detail window), its settings (a total
// comfortably above the spend, so the project is never paused by its budget) and its plan.

import type { AgentInfo, BudgetPlan, StageId } from '../../../src/shared/budget/types.js';
import { book, emptyLedger, prune, type LedgerData } from '../../../src/server/budget/ledger.js';
import type { FloorFile, OfficeFile } from '../../../src/server/budget/store.js';
import { DEFAULT_FX } from '../../../src/server/budget/fx.js';
import { ROLE_BY_ID } from '../../../src/shared/roster/roles.js';
import { DAY, Gen } from './gen.js';
import type { Cast } from './workers.js';

const STAGES: StageId[] = ['P', '0', '1', '2', '3', '4', '5', '6'];
const MODEL: Record<string, string> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-4-5' };

/** The ledger of `days` days: every worker (and a few subagents per Lead) on a few rows a day. */
export function ledger(g: Gen, cast: Cast, days: number, rowsPerAgentDay: number): LedgerData {
  const d = emptyLedger(g.base - days * DAY);
  const agents: AgentInfo[] = [];
  for (const w of cast.workers) {
    agents.push({ key: w.id, name: w.name, role: w.role ? ROLE_BY_ID.get(w.role)!.title : 'Worker', kind: 'worker', provider: 'claude' });
    if (w.role && w.role !== 'pm') for (const t of ['developer', 'tester', 'reviewer']) agents.push({ key: `${w.id}/${t}`, name: `${w.name}'s ${t}`, role: t, kind: 'subagent', lead: w.id, provider: 'claude' });
  }
  for (let day = days - 1; day >= 0; day--) {
    const at = g.base - day * DAY;
    const date = Gen.day(at);
    const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(((days - day) / days) * STAGES.length))];
    if (!d.stages.length || d.stages.at(-1)!.stage !== stage) d.stages.push({ at, stage });
    for (const a of agents) {
      if (!g.chance(0.7)) continue;
      const w = cast.workers.find((x) => x.id === (a.lead ?? a.key))!;
      for (let k = 0; k < rowsPerAgentDay; k++) {
        const issue = g.chance(0.7) ? g.int(1, 400) : undefined;
        book(d, { day: date, agent: a.key, model: MODEL[w.model], stage, ...(issue !== undefined ? { issue } : g.chance(0.3) ? { pr: g.int(1, 400) } : {}), cost: Math.round(g.rand() * 3 * 1e6) / 1e6, calls: g.int(1, 60) }, a);
      }
    }
  }
  prune(d, Gen.day(g.base));
  d.backfilled = true;
  return d;
}

export function floorBudget(g: Gen, cast: Cast, days: number, rowsPerAgentDay: number): FloorFile {
  const l = ledger(g, cast, days, rowsPerAgentDay);
  const spent = Object.values(l.days).reduce((s, x) => s + x.cost, 0);
  const total = Math.ceil((spent * 1.6) / 100) * 100;
  const start = Gen.day(g.base - days * DAY);
  const end = Gen.day(g.base + 30 * DAY);
  const plan: BudgetPlan = {
    lines: STAGES.map((stage, i) => ({ id: `stage-${stage}`, stage, label: `Stage ${stage}`, usd: Math.round((total / STAGES.length) * (0.6 + g.rand() * 0.8)), days: g.int(2, 12), basis: i % 3 === 0 ? 'history' : 'default' })),
    start,
    end,
    basis: 'a large synthetic project, default rates',
    generatedAt: g.base - days * DAY,
  };
  return { ledger: l, settings: { total, autoPause: true, level: 'balanced', threshold: 80 }, plan, alerts: [] };
}

export function officeBudget(g: Gen): OfficeFile {
  return { fx: { ...DEFAULT_FX }, threshold: 80, ledger: emptyLedger(g.base - 30 * DAY) };
}
