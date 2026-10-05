// A Lead's subagents' track record and standing: each run the office saw (Claude Code's SubagentStart /
// SubagentStop hooks, and the Agent tool's result), the Lead's review verdict on it, and where the
// subagent stands with its Lead: active, on warning, or benched until a cool-down ends. The scorer
// grades a subagent on one model from its last reviewed runs. Pure: the browser imports it too.

import type { RoleId } from './roles.js';
import type { Gate, SubagentOp } from './skills.js';

export type RunOutcome = 'pending' | 'accept' | 'rework' | 'failed';

export interface SubagentRun {
  /** Claude Code's agent_id when the hook gave one. */
  id: string;
  at: number;
  endedAt?: number;
  durationMs?: number;
  /** The model it ran on: the Agent call's, else its definition's (an alias, or inherit). */
  model: string;
  task?: string;
  outcome: RunOutcome;
  /** When its Lead gave the verdict (`office-workers subagent review`). */
  reviewedAt?: number;
  note?: string;
  /** The CI result of the pull request it fed, when the office could tie one to it. */
  ci?: 'pass' | 'fail';
}

export type SubagentState = 'active' | 'warning' | 'benched';

export interface SubagentRecord {
  name: string;
  lead: RoleId;
  state: SubagentState;
  /** The model the Lead or the Project Manager swapped it to (its definition's `model:`). */
  model?: string;
  warnings: { at: number; reason: string; by: string }[];
  benchedAt?: number;
  benchedUntil?: number;
  benchReason?: string;
  runs: SubagentRun[];
  /** When the scorer last flagged it, and when its Lead was nudged about that. */
  flaggedAt?: number;
  nudgedAt?: number;
}

/** Runs kept per subagent. */
export const RUNS_KEPT = 50;
/** The scorer's window, and the fewest reviewed runs it grades. */
export const SCORE_WINDOW = 5;
export const SCORE_MIN_RUNS = 3;

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface SubagentScore {
  model: string;
  /** All its runs on this model, and those reviewed in the window. */
  runs: number;
  reviewed: number;
  accepted: number;
  reworks: number;
  /** 0–100 over the window: accepted runs (half for one whose PR's CI failed) over reviewed ones. */
  score?: number;
  grade?: Grade;
  underperforming: boolean;
  /** Why, in a few words ("3 reworks in 5 runs"). */
  why?: string;
}

export function gradeOf(score: number): Grade {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}

/**
 * Grades one subagent on one model from its runs (any order). Over the last SCORE_WINDOW reviewed
 * runs (accept, rework or failed), with at least SCORE_MIN_RUNS of them: grade A–F from the accept
 * rate. Underperforming: a grade below C, or 2+ reworks in the window (counted from the first run).
 *
 * TODO(ranking): the worker rankings (src/server/ranking, src/client/ui/ranking) may adopt this as
 * their subagent grade, or replace it with theirs: callers only use this function and SubagentScore.
 */
export function scoreSubagent(runs: readonly SubagentRun[], model: string): SubagentScore {
  const mine = runs.filter((r) => r.model === model).sort((a, b) => a.at - b.at);
  const window = mine.filter((r) => r.outcome !== 'pending').slice(-SCORE_WINDOW);
  const accepted = window.filter((r) => r.outcome === 'accept');
  const reworks = window.filter((r) => r.outcome === 'rework' || r.outcome === 'failed').length;
  const out: SubagentScore = { model, runs: mine.length, reviewed: window.length, accepted: accepted.length, reworks, underperforming: false };
  if (reworks >= 2) {
    out.underperforming = true;
    out.why = `${reworks} reworks in ${window.length} runs`;
  }
  if (window.length < SCORE_MIN_RUNS) return out;
  const credit = accepted.reduce((n, r) => n + (r.ci === 'fail' ? 0.5 : 1), 0);
  out.score = Math.round((100 * credit) / window.length);
  out.grade = gradeOf(out.score);
  if (out.score < 70) {
    out.underperforming = true;
    out.why ??= `grade ${out.grade} (${out.score}% accepted) over ${window.length} runs`;
  }
  return out;
}

/** The model a subagent's newest run was on (or its swap), which its card grades. */
export const currentModel = (r: SubagentRecord, fallback: string): string => r.model ?? r.runs.at(-1)?.model ?? fallback;

/** What the Team tab shows of a subagent. */
export interface SubagentView {
  lead: RoleId;
  name: string;
  /** Defined by the office's team table (its Playbook writes its file), not one the Lead made. */
  defined: boolean;
  model: string;
  state: SubagentState;
  benchedUntil?: number;
  benchReason?: string;
  warnings: number;
  lastWarning?: string;
  score: SubagentScore;
  lastRunAt?: number;
}

/** A subagent action waiting on the Project Manager, or decided (its gate was propose). */
export interface SubagentAction {
  id: string;
  at: number;
  lead: RoleId;
  by: string;
  op: SubagentOp;
  name: string;
  reason?: string;
  model?: string;
  gate: Gate;
  status: 'pending' | 'approved' | 'rejected' | 'done';
  /** For an `ask`, the escalation it raised. */
  escalationId?: string;
  decidedBy?: string;
  decidedAt?: number;
  decision?: string;
}

/** "bench tester (Haiku)", for activity lines and approvals. */
export const OP_VERB: Record<SubagentOp, string> = { warn: 'put on warning', bench: 'benched', 'swap-model': 'swapped the model of', reinstate: 'reinstated' };
export const OP_ASK: Record<SubagentOp, string> = { warn: 'put on warning', bench: 'bench', 'swap-model': 'swap the model of', reinstate: 'reinstate' };
export const OP_ICON: Record<SubagentOp, string> = { warn: '⚠️', bench: '🪑', 'swap-model': '🔁', reinstate: '✅' };

/** "Haiku" for haiku, the id as it is otherwise. */
export const modelWord = (m: string) => (/^[a-z]+$/.test(m) ? m[0].toUpperCase() + m.slice(1) : m);
