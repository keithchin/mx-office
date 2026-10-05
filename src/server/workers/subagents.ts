// The last subagent result each worker got back: a Claude Code session dispatches a subagent with its
// Agent tool (Task, in older versions), and the PostToolUse hook for that call fires when the subagent
// returns. The team's review nudge (roster/nudge.ts) reads it to tell a Lead whose turn just ended with
// a fresh subagent result to review it rather than sit idle. Kept in memory: after a restart there's
// simply nothing new to review until the next result.

export interface SubagentResult {
  at: number;
  /** The subagent's type (its .claude/agents/<id>.md), when the call named one. */
  agent?: string;
  /** What it was asked to do, as the call described it. */
  task?: string;
  failed: boolean;
}

const TOOLS = new Set(['Agent', 'Task']);
const last = new Map<string, SubagentResult>();

const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, n) : undefined);

/** A PostToolUse(-Failure) hook payload: noted when it's a subagent coming back. True when it was one. */
export function noteSubagentHook(workerId: string, payload: unknown, failed: boolean, now = Date.now()): boolean {
  const p = (payload ?? {}) as { tool_name?: unknown; tool_input?: { subagent_type?: unknown; description?: unknown; prompt?: unknown; run_in_background?: unknown } };
  if (typeof p.tool_name !== 'string' || !TOOLS.has(p.tool_name)) return false;
  // A background subagent's call returns as soon as it's launched: nothing to review yet.
  if (p.tool_input?.run_in_background === true) return false;
  last.set(workerId, { at: now, agent: clip(p.tool_input?.subagent_type, 60), task: clip(p.tool_input?.description, 120) ?? clip(p.tool_input?.prompt, 120), failed });
  return true;
}

export const lastSubagentResult = (workerId: string): SubagentResult | undefined => last.get(workerId);

/** Forgets a worker that went home. */
export const forgetSubagents = (workerId: string) => void last.delete(workerId);
