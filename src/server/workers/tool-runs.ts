// A Bash command a worker ran, from its PostToolUse hook (providers/claude.ts): heard by whoever listens
// (a permission card closes once its denied command runs: roster/escalation-fold.ts sawCommandRun). Only a
// call that ran gets here: a denied one never reaches PostToolUse, and a failed call is PostToolUseFailure.

type Listener = (workerId: string, command: string) => void;
const listeners = new Set<Listener>();

/** Listens for commands workers ran; returns what stops it. */
export function onCommandRun(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** A PostToolUse hook payload: passed on when it's a Bash command. True when it was one. */
export function noteCommandRun(workerId: string, payload: unknown): boolean {
  const p = (payload ?? {}) as { tool_name?: unknown; tool_input?: { command?: unknown } };
  const command = p.tool_name === 'Bash' && typeof p.tool_input?.command === 'string' ? p.tool_input.command.slice(0, 2000) : undefined;
  if (!command?.trim()) return false;
  for (const l of listeners) {
    try {
      l(workerId, command);
    } catch (err) {
      console.error(`agent-office: a command-run listener failed: ${(err as Error).message}`);
    }
  }
  return true;
}
