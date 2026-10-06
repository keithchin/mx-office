// What other parts of the office tell the incident rules (rules.ts) that isn't in the audit log or a
// worker's update: a launch test mode refused (testmode.ts), a gate-check run that failed
// (wizard/gate-source.ts), worktrees the cleanup couldn't remove (worktree-sweep/), and the budget's
// alerts. A seam with no imports of its own, so any module may call signal() without pulling the
// incidents in; with nobody listening it does nothing.

export type IncidentSignal =
  /** Test mode stopped a worker from starting a real agent CLI. */
  | { kind: 'launch.refused'; floorDir: string; worker: { id: string; name: string }; command: string; why: string }
  /** A real agent CLI started on a test office anyway (allowed with AGENT_OFFICE_ALLOW_REAL_AGENTS). */
  | { kind: 'launch.real'; floorDir: string; worker: { id: string; name: string }; command: string }
  | { kind: 'gate-check.failed'; floorDir: string; message: string }
  | { kind: 'sweep.failed'; floor?: string; path: string; why: string }
  /** The budget module's alerts: `cap` when spending stopped, `warn` when it's close. Floor id, or none for the office's budget. */
  | { kind: 'budget.alert'; floor?: string; level: 'warn' | 'cap'; text: string; spentUsd?: number };

type Listener = (s: IncidentSignal) => void;
const listeners = new Set<Listener>();

export function onIncidentSignal(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tells whoever listens; never throws. */
export function signal(s: IncidentSignal) {
  for (const fn of listeners) {
    try {
      fn(s);
    } catch (err) {
      console.error(`agent-office: incident rules: ${(err as Error).message}`);
    }
  }
}
