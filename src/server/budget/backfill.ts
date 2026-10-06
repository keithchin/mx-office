// A new ledger's history: what the project spent before the office kept one. From the workers at their
// desks (their session's usage so far, split by subagent and model where the session kept that) and the
// analysis runs log (analysis/runs.jsonl: one record per worker the analyzer saw, gone home ones too).
// Each is spread evenly over the days the worker was around and booked as "estimated from history":
// the real days are unknown, and it's already in the office's Ledger, so it never goes there again.

import type { RunRecord } from '../../shared/analysis.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { AgentInfo, SpendRow } from '../../shared/budget/types.js';
import { splitDelta } from './attribute.js';
import { addDays, book, daysBetween, stageAt, type LedgerData } from './ledger.js';

/** At most this many days back a back-filled worker's spend is spread over. */
const SPREAD_MAX = 30;

export interface BackfillDeps {
  /** The day `ms` falls on, on the office's clock. */
  dayOf(ms: number): string;
  today: string;
  /** A worker's role title, by id or by name (a gone worker's record has only its name). */
  roleOf(workerId: string, name: string): string;
  /** The agent for a piece of a worker's spend (the worker, or one of its subagents). */
  agentFor(w: { id: string; name: string; provider?: string }, sub: string, role: string): AgentInfo;
}

/** Books `cost`/`calls` evenly over the days from `from` to `to` (at most SPREAD_MAX, ending on `to`). */
function spread(d: LedgerData, row: Omit<SpendRow, 'day'>, agent: AgentInfo, from: string, to: string, at: (day: string) => number) {
  const n = Math.max(1, Math.min(SPREAD_MAX, daysBetween(from, to) + 1));
  for (let i = 0; i < n; i++) {
    const day = addDays(to, -(n - 1 - i));
    const calls = Math.floor(row.calls / n) + (i < row.calls % n ? 1 : 0);
    book(d, { ...row, day, cost: row.cost / n, calls, stage: d.stages.length ? stageAt(d, at(day)) : row.stage }, agent);
  }
}

const dayStart = (day: string) => Date.parse(`${day}T12:00:00`);

/** Books the history of the live workers and the runs log into `d`; marks the live workers seen. Returns the dollars booked. */
export function backfill(d: LedgerData, live: WorkerInfo[], runs: RunRecord[], deps: BackfillDeps): number {
  let booked = 0;
  const liveIds = new Set(live.map((w) => w.id));
  for (const w of live) {
    if (w.kind !== 'agent' || !w.usage) continue;
    const role = deps.roleOf(w.id, w.name);
    const unmetered = (w.provider ?? 'claude') !== 'claude';
    const from = deps.dayOf(w.createdAt);
    for (const p of splitDelta(undefined, w.usage, w.model ?? 'claude')) {
      if (p.cost <= 0 && !p.calls) continue;
      const agent = deps.agentFor(w, p.sub, role);
      spread(d, { agent: agent.key, model: p.model, stage: '—', cost: unmetered ? 0 : p.cost, calls: p.calls, est: true, ...(unmetered ? { unmetered: true } : {}), ...(w.pr ? { pr: w.pr.number } : {}) }, agent, from, deps.today, dayStart);
      if (!unmetered) booked += p.cost;
    }
    d.seen[w.id] = { cost: w.usage.cost, calls: w.usage.calls, ...(w.usage.parts ? { parts: structuredClone(w.usage.parts) } : {}) };
  }
  for (const r of runs) {
    if (liveIds.has(r.workerId) || d.seen[r.workerId] || !(r.cost ?? 0)) continue;
    const role = deps.roleOf(r.workerId, r.worker);
    const agent = deps.agentFor({ id: r.workerId, name: r.worker, provider: r.provider }, '', role);
    const unmetered = (r.provider ?? 'claude') !== 'claude';
    const from = deps.dayOf(r.startedAt);
    const to = deps.dayOf(Math.max(r.endedAt ?? r.startedAt, r.updatedAt ?? 0, r.startedAt));
    spread(d, { agent: agent.key, model: r.model ?? 'unknown', stage: '—', cost: unmetered ? 0 : (r.cost ?? 0), calls: r.apiCalls ?? 0, est: true, ...(unmetered ? { unmetered: true } : {}), ...(r.issue !== undefined ? { issue: r.issue } : {}), ...(r.pr ? { pr: r.pr.number } : {}) }, agent, from, to < from ? from : to, dayStart);
    if (!unmetered) booked += r.cost ?? 0;
    // Gone home: nothing more will come from it.
    d.seen[r.workerId] = { cost: r.cost ?? 0, calls: r.apiCalls ?? 0 };
  }
  d.backfilled = true;
  return booked;
}
