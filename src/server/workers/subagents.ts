// The last subagent result each worker got back: a Claude Code session dispatches a subagent with its
// Agent tool (Task, in older versions), and the PostToolUse hook for that call fires when the subagent
// returns. The team's review nudge (roster/nudge.ts) reads it to tell a Lead whose turn just ended with
// a fresh subagent result to review it rather than sit idle. Kept in memory: after a restart there's
// simply nothing new to review until the next result.
//
// The same hooks, with Claude Code's SubagentStart / SubagentStop, are also passed on as run events to
// whoever listens (the roster's subagent track record, roster/subagents.ts).

export interface SubagentResult {
  at: number;
  /** The subagent's type (its .claude/agents/<id>.md), when the call named one. */
  agent?: string;
  /** What it was asked to do, as the call described it. */
  task?: string;
  failed: boolean;
}

/** One moment of a subagent run, as a worker's hooks report it. */
export type SubagentEvent =
  | { kind: 'start'; at: number; agentId?: string; agent?: string }
  | { kind: 'stop'; at: number; agentId?: string; agent?: string }
  | { kind: 'result'; at: number; agent?: string; task?: string; model?: string; failed: boolean; durationMs?: number; background: boolean };

const TOOLS = new Set(['Agent', 'Task']);
const last = new Map<string, SubagentResult>();
const listeners = new Set<(workerId: string, ev: SubagentEvent) => void>();

const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, n) : undefined);
const emit = (workerId: string, ev: SubagentEvent) => {
  for (const l of listeners) {
    try {
      l(workerId, ev);
    } catch (err) {
      console.error('agent-office: a subagent listener failed', err);
    }
  }
};

/** Hears every subagent run event of every worker; returns the way to stop. */
export function onSubagentEvent(l: (workerId: string, ev: SubagentEvent) => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** A PostToolUse(-Failure) hook payload: noted when it's a subagent coming back. True when it was one. */
export function noteSubagentHook(workerId: string, payload: unknown, failed: boolean, now = Date.now()): boolean {
  const p = (payload ?? {}) as { tool_name?: unknown; tool_input?: { subagent_type?: unknown; description?: unknown; prompt?: unknown; run_in_background?: unknown; model?: unknown }; tool_response?: { totalDurationMs?: unknown } };
  if (typeof p.tool_name !== 'string' || !TOOLS.has(p.tool_name)) return false;
  const agent = clip(p.tool_input?.subagent_type, 60);
  const task = clip(p.tool_input?.description, 120) ?? clip(p.tool_input?.prompt, 120);
  const background = p.tool_input?.run_in_background === true;
  const ms = p.tool_response?.totalDurationMs;
  emit(workerId, { kind: 'result', at: now, agent, task, model: clip(p.tool_input?.model, 40), failed, background, ...(typeof ms === 'number' && ms >= 0 ? { durationMs: ms } : {}) });
  // A background subagent's call returns as soon as it's launched: nothing to review yet.
  if (background) return false;
  last.set(workerId, { at: now, agent, task, failed });
  return true;
}

/**
 * Claude Code's SubagentStart / SubagentStop hook payload (agent_id, agent_type): a run beginning or
 * ending, foreground or background. True when it was one of those.
 */
export function noteSubagentLifecycle(workerId: string, event: string, payload: unknown, now = Date.now()): boolean {
  if (event !== 'SubagentStart' && event !== 'SubagentStop') return false;
  const p = (payload ?? {}) as { agent_id?: unknown; agent_type?: unknown; subagent_type?: unknown; agent_name?: unknown };
  emit(workerId, { kind: event === 'SubagentStart' ? 'start' : 'stop', at: now, agentId: clip(p.agent_id, 80), agent: clip(p.agent_type, 60) ?? clip(p.subagent_type, 60) ?? clip(p.agent_name, 60) });
  return true;
}

export const lastSubagentResult = (workerId: string): SubagentResult | undefined => last.get(workerId);

/** Forgets a worker that went home. */
export const forgetSubagents = (workerId: string) => void last.delete(workerId);
