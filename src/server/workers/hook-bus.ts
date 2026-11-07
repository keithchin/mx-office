// Every Claude hook a worker reports (providers/claude.ts), for a feature that follows one worker's session
// as it goes: Expert mode's asked → visible timer (expert/) hears its prompts and the commands it ran. Heard
// after the worker's own handling; a listener's failure never reaches the hook.

type Listener = (workerId: string, event: string, payload: unknown) => void;
const listeners = new Set<Listener>();

/** Hears every worker's hooks; returns what stops it. */
export function onWorkerHook(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function noteWorkerHook(workerId: string, event: string, payload: unknown): void {
  if (!listeners.size) return;
  for (const l of listeners) {
    try {
      l(workerId, event, payload);
    } catch (err) {
      console.error(`agent-office: a hook listener failed: ${(err as Error).message}`);
    }
  }
}
