// Spend per phase, pure: the project's budget ledger (server/budget/ledger.ts: detailed rows per day, agent and
// stage for the last 30 days, a rollup per day by stage kept forever) shared out to the phases by when each ran.
// The rules:
//   - Stages P–3 are Discovery and Stages 6–7 Cutover: never a phase's.
//   - Spend on a day a phase was running (from its start to its end) is that phase's; when two ran that day (a
//     later phase started early), the early phase takes the spend of the teams working on it early
//     (Phase.early.teams), the earlier phase the rest.
//   - Coordination (the Project Coordinator's team) and the office's own background calls are "Not tied to a
//     phase", and so is Build spend on a day no phase ran. Stage 4 spend before the first phase started is
//     Discovery's (the Build Plan is Discovery's last stage on the Roadmap).
// Older days have only their stage rollup: shared out by day alone (the earlier phase that day).

import type { Phase } from './types.js';

export interface LedgerRowLite {
  day: string;
  agent: string;
  stage: string;
  cost: number;
}

export interface SpendInput {
  rows: readonly LedgerRowLite[];
  days: Readonly<Record<string, { stage: Record<string, number> }>>;
  agents: Readonly<Record<string, { role: string; kind: string; lead?: string }>>;
  phases: readonly Phase[];
  /** The team a role title is on ('management' for the Project Coordinator), from shared/roster/roles.ts. */
  teamOf(role: string): string | undefined;
  /** The office's day of a time ('2026-10-30'). */
  dayOf(ms: number): string;
}

export interface PhaseSpend {
  byPhase: Record<string, number>;
  unassigned: number;
  discovery: number;
  cutover: number;
  total: number;
}

const DISCOVERY = new Set(['P', '0', '1', '2', '3']);
const CUTOVER = new Set(['6', '7']);
const round = (n: number) => Math.round(n * 100) / 100;

export function phaseSpend(i: SpendInput): PhaseSpend {
  const out: PhaseSpend = { byPhase: Object.fromEntries(i.phases.map((p) => [p.id, 0])), unassigned: 0, discovery: 0, cutover: 0, total: 0 };
  const windows = i.phases.filter((p) => p.startedAt).map((p) => ({ p, from: i.dayOf(p.startedAt!), to: p.endedAt ? i.dayOf(p.endedAt) : undefined }));
  const early = i.phases.filter((p) => p.early).map((p) => ({ p, from: i.dayOf(p.early!.since), to: p.startedAt ? i.dayOf(p.startedAt) : undefined, teams: new Set(p.early!.teams) }));
  const running = (day: string) => windows.filter((w) => w.from <= day && (!w.to || day <= w.to)).map((w) => w.p);
  const teamOfAgent = (key: string): string | undefined => {
    const a = i.agents[key];
    if (!a) return undefined;
    if (a.kind === 'background') return 'office';
    if (a.kind === 'subagent' && a.lead) return i.teamOf(i.agents[a.lead]?.role ?? '') ?? undefined;
    return i.teamOf(a.role);
  };
  const book = (day: string, stage: string, cost: number, team: string | undefined | null) => {
    if (!cost) return;
    out.total += cost;
    if (DISCOVERY.has(stage)) return void (out.discovery += cost);
    if (CUTOVER.has(stage)) return void (out.cutover += cost);
    // An early phase takes its early teams' spend.
    if (team) {
      const e = early.find((x) => x.teams.has(team) && x.from <= day && (!x.to || day < x.to));
      if (e) return void (out.byPhase[e.p.id] += cost);
    }
    const on = running(day);
    if (!on.length) {
      if (stage === '4' && !windows.some((w) => w.from <= day)) return void (out.discovery += cost);
      return void (out.unassigned += cost);
    }
    if (team === 'management' || team === 'office') return void (out.unassigned += cost);
    out.byPhase[on[0].id] += cost;
  };
  const detailed = new Set<string>();
  for (const r of i.rows) {
    detailed.add(r.day);
    book(r.day, r.stage, r.cost, teamOfAgent(r.agent) ?? null);
  }
  const oldest = [...detailed].sort()[0];
  for (const [day, roll] of Object.entries(i.days)) {
    if (detailed.has(day) || (oldest && day >= oldest)) continue;
    for (const [stage, cost] of Object.entries(roll.stage ?? {})) book(day, stage, cost, undefined);
  }
  for (const k of Object.keys(out.byPhase)) out.byPhase[k] = round(out.byPhase[k]);
  out.unassigned = round(out.unassigned);
  out.discovery = round(out.discovery);
  out.cutover = round(out.cutover);
  out.total = round(out.total);
  return out;
}
