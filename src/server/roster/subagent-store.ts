// The Leads' subagents as the roster file keeps them (roster/<floor>.json `subagents`): made whole
// when read back, a bad record dropped, the runs capped.

import { isRoleId, type RoleId } from '../../shared/roster/roles.js';
import { RUNS_KEPT, type RunOutcome, type SubagentRecord, type SubagentRun, type SubagentState } from '../../shared/roster/subagents.js';

export const SUBAGENT_ACTIONS_KEPT = 100;

/** A subagent's key in the roster: its Lead and its name. */
export const subKey = (lead: RoleId, name: string) => `${lead}/${name}`;

/** A subagent name as Claude Code has it (its .claude/agents/<name>.md): undefined when it won't do. */
export function cleanSubName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s) ? s : undefined;
}

const STATES: SubagentState[] = ['active', 'warning', 'benched'];
const OUTCOMES: RunOutcome[] = ['pending', 'accept', 'rework', 'failed'];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, n: number) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);

function reviveRun(raw: unknown): SubagentRun | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<SubagentRun>;
  const at = num(r.at);
  if (at === undefined) return undefined;
  return {
    id: str(r.id, 80) ?? `run-${at}`,
    at,
    ...(num(r.endedAt) !== undefined ? { endedAt: r.endedAt } : {}),
    ...(num(r.durationMs) !== undefined ? { durationMs: r.durationMs } : {}),
    model: str(r.model, 64) ?? 'inherit',
    ...(str(r.task, 160) ? { task: str(r.task, 160) } : {}),
    outcome: OUTCOMES.includes(r.outcome as RunOutcome) ? (r.outcome as RunOutcome) : 'pending',
    ...(num(r.reviewedAt) !== undefined ? { reviewedAt: r.reviewedAt } : {}),
    ...(str(r.note, 400) ? { note: str(r.note, 400) } : {}),
    ...(r.ci === 'pass' || r.ci === 'fail' ? { ci: r.ci } : {}),
  };
}

export function reviveSubagents(raw: unknown): Record<string, SubagentRecord> {
  const out: Record<string, SubagentRecord> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const v of Object.values(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Partial<SubagentRecord>;
    const name = cleanSubName(r.name);
    if (!name || !isRoleId(r.lead)) continue;
    out[subKey(r.lead, name)] = {
      name,
      lead: r.lead,
      state: STATES.includes(r.state as SubagentState) ? (r.state as SubagentState) : 'active',
      ...(str(r.model, 64) ? { model: str(r.model, 64) } : {}),
      warnings: Array.isArray(r.warnings) ? r.warnings.filter((w) => w && typeof w.at === 'number').map((w) => ({ at: w.at, reason: String(w.reason ?? '').slice(0, 400), by: String(w.by ?? '').slice(0, 40) })).slice(-20) : [],
      ...(num(r.benchedAt) !== undefined ? { benchedAt: r.benchedAt } : {}),
      ...(num(r.benchedUntil) !== undefined ? { benchedUntil: r.benchedUntil } : {}),
      ...(str(r.benchReason, 400) ? { benchReason: str(r.benchReason, 400) } : {}),
      runs: (Array.isArray(r.runs) ? r.runs : []).map(reviveRun).filter((x): x is SubagentRun => !!x).slice(-RUNS_KEPT),
      ...(num(r.flaggedAt) !== undefined ? { flaggedAt: r.flaggedAt } : {}),
      ...(num(r.nudgedAt) !== undefined ? { nudgedAt: r.nudgedAt } : {}),
      ...(num(r.reworks) !== undefined ? { reworks: r.reworks } : {}),
      ...(num(r.exhaustedAt) !== undefined ? { exhaustedAt: r.exhaustedAt } : {}),
      ...(str(r.exhaustedEscalation, 40) ? { exhaustedEscalation: str(r.exhaustedEscalation, 40) } : {}),
    };
  }
  return out;
}

/** One reviewed subagent run, for the worker rankings' Lead criteria (review turnaround, review quality). */
export interface SubagentReview {
  floor: string;
  lead: RoleId;
  name: string;
  model: string;
  task?: string;
  /** When the run was dispatched and finished, and when its Lead gave the verdict. */
  dispatchedAt: number;
  finishedAt?: number;
  reviewedAt?: number;
  /** reviewedAt − finishedAt, when both are known. */
  turnaroundMs?: number;
  verdict: 'accept' | 'rework' | 'failed';
  note?: string;
}

/**
 * The reviewed runs of a floor's Leads' subagents (one Lead's with `role`), oldest first, from the
 * floor's roster data (`rosterOf(ctx).data(floorId)`). Pure: reads what the roster keeps, changes nothing.
 * For the rankings (src/server/ranking/facts.ts) to read as their review facts.
 */
export function subagentReviews(data: { subagents: Record<string, SubagentRecord> }, floor: string, role?: RoleId): SubagentReview[] {
  const out: SubagentReview[] = [];
  for (const rec of Object.values(data.subagents)) {
    if (role && rec.lead !== role) continue;
    for (const r of rec.runs) {
      if (r.outcome === 'pending') continue;
      out.push({
        floor,
        lead: rec.lead,
        name: rec.name,
        model: r.model,
        ...(r.task ? { task: r.task } : {}),
        dispatchedAt: r.at,
        ...(r.endedAt !== undefined ? { finishedAt: r.endedAt } : {}),
        ...(r.reviewedAt !== undefined ? { reviewedAt: r.reviewedAt } : {}),
        ...(r.reviewedAt !== undefined && r.endedAt !== undefined ? { turnaroundMs: Math.max(0, r.reviewedAt - r.endedAt) } : {}),
        verdict: r.outcome,
        ...(r.note ? { note: r.note } : {}),
      });
    }
  }
  return out.sort((a, b) => a.dispatchedAt - b.dispatchedAt);
}
