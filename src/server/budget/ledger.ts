// A project's spend ledger, as data: detailed rows (day × agent × model × stage × issue/PR) for the
// last DETAIL_DAYS days, and a rollup per day kept forever, plus who each agent is. Pure (no disk, no
// clock): store.ts saves it, index.ts feeds it, and the tests drive it directly.

import type { AgentInfo, BreakdownRow, DayRollup, SpendRow, StageId } from '../../shared/budget/types.js';
import { STAGE_IDS, STAGE_TITLE } from '../../shared/budget/types.js';

/** Days of detailed rows kept; the daily rollups are kept forever. */
export const DETAIL_DAYS = 30;

/** What a worker had spent when the ledger last booked it: the next update books the difference. */
export interface Seen {
  cost: number;
  calls: number;
  parts?: Record<string, { cost: number; calls: number }>;
}

export interface LedgerData {
  version: 1;
  /** When this ledger started (ms): workers hired before then were back-filled, not booked live. */
  startedAt: number;
  days: Record<string, DayRollup>;
  rows: SpendRow[];
  agents: Record<string, AgentInfo>;
  seen: Record<string, Seen>;
  /** The toolkit stage, each time it changed: what spend is attributed to. */
  stages: { at: number; stage: StageId }[];
  /** History was back-filled once (from the workers' usage and the analysis runs). */
  backfilled?: boolean;
}

export const emptyLedger = (now: number): LedgerData => ({ version: 1, startedAt: now, days: {}, rows: [], agents: {}, seen: {}, stages: [] });

const emptyDay = (): DayRollup => ({ cost: 0, calls: 0, est: 0, unmetered: 0, stage: {}, role: {}, model: {}, agent: {}, work: {} });

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const bump = (m: Record<string, number>, k: string, v: number) => {
  m[k] = round((m[k] ?? 0) + v);
};

/** The piece of work a row was for: "#12", "PR #3" (no issue), or undefined. */
export const workKey = (r: Pick<SpendRow, 'issue' | 'pr'>) => (r.issue !== undefined ? `#${r.issue}` : r.pr !== undefined ? `PR #${r.pr}` : undefined);

/** A short model name for tables: claude-opus-5-5 → Opus 5.5; anything else as it is. */
export function modelLabel(model: string): string {
  const m = /(opus|sonnet|haiku|fable|mythos)[-_]?(\d+)?(?:[-_.](\d+))?/i.exec(model);
  if (!m) return model || 'unknown';
  const fam = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return m[2] ? `${fam} ${m[2]}${m[3] && m[3].length < 3 ? `.${m[3]}` : ''}` : fam;
}

/** Books one row: into the detailed rows (merged with a row of the same key) and the day's rollup. */
export function book(d: LedgerData, row: SpendRow, agent: AgentInfo) {
  if (!row.cost && !row.calls) return;
  d.agents[agent.key] = { ...d.agents[agent.key], ...agent };
  const same = d.rows.find((r) => r.day === row.day && r.agent === row.agent && r.model === row.model && r.stage === row.stage && r.issue === row.issue && r.pr === row.pr && !!r.est === !!row.est && !!r.unmetered === !!row.unmetered);
  if (same) {
    same.cost = round(same.cost + row.cost);
    same.calls += row.calls;
  } else d.rows.push({ ...row, cost: round(row.cost) });
  const day = (d.days[row.day] ??= emptyDay());
  day.cost = round(day.cost + row.cost);
  day.calls += row.calls;
  if (row.est) day.est = round(day.est + row.cost);
  if (row.unmetered) day.unmetered += row.calls;
  bump(day.stage, row.stage, row.cost);
  bump(day.role, agent.kind === 'subagent' ? `${roleOfLead(d, agent)} (subagents)` : agent.role, row.cost);
  bump(day.model, row.model || 'unknown', row.cost);
  bump(day.agent, row.agent, row.cost);
  const w = workKey(row);
  if (w) bump(day.work, w, row.cost);
}

const roleOfLead = (d: LedgerData, a: AgentInfo) => (a.lead ? (d.agents[a.lead]?.role ?? 'Lead') : 'Lead');

/** Drops detailed rows older than `keep` days before `today` (the rollups stay). */
export function prune(d: LedgerData, today: string, keep = DETAIL_DAYS) {
  const cut = addDays(today, -(keep - 1));
  d.rows = d.rows.filter((r) => r.day >= cut);
  if (d.stages.length > 200) d.stages = d.stages.slice(-200);
}

/** `day` (YYYY-MM-DD) moved by `n` days. */
export function addDays(day: string, n: number): string {
  const [y, m, dd] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return t.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The total of every day. */
export const totalOf = (d: LedgerData) => round(Object.values(d.days).reduce((n, x) => n + x.cost, 0));

function rows(map: Map<string, { cost: number; est: number }>, label: (k: string) => string, total: number, hint?: (k: string) => string | undefined): BreakdownRow[] {
  return [...map]
    .filter(([, v]) => Math.abs(v.cost) > 1e-9)
    .map(([key, v]) => ({ key, label: label(key), cost: round(v.cost), share: total > 0 ? v.cost / total : 0, ...(v.est > 1e-9 ? { est: round(v.est) } : {}), ...(hint?.(key) ? { hint: hint(key) } : {}) }))
    .sort((a, b) => b.cost - a.cost);
}

/** Sums one of the rollups' splits over every day; estimated history is apportioned by the day's share. */
function split(d: LedgerData, field: 'stage' | 'role' | 'model' | 'agent' | 'work') {
  const out = new Map<string, { cost: number; est: number }>();
  for (const day of Object.values(d.days)) {
    const ratio = day.cost > 0 ? day.est / day.cost : 0;
    for (const [k, v] of Object.entries(day[field])) {
      const o = out.get(k) ?? { cost: 0, est: 0 };
      o.cost += v;
      o.est += v * ratio;
      out.set(k, o);
    }
  }
  return out;
}

/** The same split with keys that share a label merged (claude-haiku-4-5 and claude-haiku-4-5-20251001 are both Haiku 4.5). */
function byLabel(m: Map<string, { cost: number; est: number }>, label: (k: string) => string) {
  const out = new Map<string, { cost: number; est: number }>();
  for (const [k, v] of m) {
    const o = out.get(label(k)) ?? { cost: 0, est: 0 };
    o.cost += v.cost;
    o.est += v.est;
    out.set(label(k), o);
  }
  return out;
}

export interface Breakdowns {
  byStage: BreakdownRow[];
  byRole: BreakdownRow[];
  byAgent: BreakdownRow[];
  byModel: BreakdownRow[];
  topWork: BreakdownRow[];
}

/** The Budget tab's tables: by stage (in pipeline order), role, agent (subagents under their Lead), model and the top issues/PRs. */
export function breakdowns(d: LedgerData, topN = 10): Breakdowns {
  const total = totalOf(d);
  const stage = rows(split(d, 'stage'), (k) => (k === '—' ? 'No stage' : `Stage ${k} · ${STAGE_TITLE[k as StageId] ?? k}`), total).sort((a, b) => STAGE_IDS.indexOf(a.key as StageId) - STAGE_IDS.indexOf(b.key as StageId));
  const agentName = (k: string) => d.agents[k]?.name ?? k;
  const flat = rows(split(d, 'agent'), agentName, total, (k) => {
    const a = d.agents[k];
    if (!a) return undefined;
    if (a.kind === 'subagent') return `${a.role} · hired by ${a.lead ? agentName(a.lead) : 'a Lead'}`;
    return a.role;
  });
  // Subagents nest under their Lead; a Lead's row then covers its own session and its subagents'.
  const byKey = new Map(flat.map((r) => [r.key, r]));
  const top: BreakdownRow[] = [];
  for (const r of flat) {
    const a = d.agents[r.key];
    if (a?.kind === 'subagent' && a.lead) {
      let lead = byKey.get(a.lead);
      if (!lead) {
        lead = { key: a.lead, label: agentName(a.lead), cost: 0, share: 0, hint: d.agents[a.lead]?.role };
        byKey.set(a.lead, lead);
        top.push(lead);
      }
      (lead.sub ??= []).push(r);
    } else top.push(r);
  }
  for (const r of top) {
    if (!r.sub) continue;
    const own = r.cost;
    const subs = r.sub.reduce((n, s) => n + s.cost, 0);
    r.cost = round(own + subs);
    r.share = total > 0 ? r.cost / total : 0;
    r.sub.unshift({ key: `${r.key}#own`, label: `${r.label} itself`, cost: round(own), share: total > 0 ? own / total : 0 });
  }
  top.sort((a, b) => b.cost - a.cost);
  return {
    byStage: stage,
    byRole: rows(split(d, 'role'), (k) => k, total),
    byAgent: top,
    byModel: rows(byLabel(split(d, 'model'), modelLabel), (k) => k, total),
    topWork: rows(split(d, 'work'), (k) => k, total).slice(0, topN),
  };
}

/** The last `n` days' spend, oldest first, zeros for days with none. */
export function recentDays(d: LedgerData, today: string, n: number): { day: string; cost: number; est: number }[] {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    out.push({ day, cost: round(d.days[day]?.cost ?? 0), est: round(d.days[day]?.est ?? 0) });
  }
  return out;
}

/** The stage that was active at `at`, from the stage timeline, or "—". */
export function stageAt(d: LedgerData, at: number): StageId {
  let s: StageId = '—';
  for (const x of d.stages) {
    if (x.at > at) break;
    s = x.stage;
  }
  return s;
}

/** Records the current stage when it changed; true when it did. */
export function noteStage(d: LedgerData, stage: StageId, at: number): boolean {
  if (d.stages[d.stages.length - 1]?.stage === stage) return false;
  d.stages.push({ at, stage });
  return true;
}
