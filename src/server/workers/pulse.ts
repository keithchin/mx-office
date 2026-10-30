// A worker's pulse: when the office last saw it actually doing something, whatever its status says. The
// real build showed the roster's "nobody working" while commits kept landing: a member's status is only
// what its last hook said (a turn ended, a subagent or a background command still writing, a session the
// hooks lag on), so the team view lagged the work. Three kinds of evidence count here, all already passing
// through the office and none read from disk:
//   - output: its terminal printed enough to be work (workers/manager.ts, every chunk: a few chunks and some bytes
//             within 20 s, so a TUI at rest redrawing its status line doesn't count; cheap, numbers per worker);
//   - tool:   one of its hooks fired (a tool call, a subagent's, providers/claude.ts);
//   - commit: it ran `git commit` (its PostToolUse, roster/adapter.ts hears it through workers/tool-runs.ts).
// A worker is *active* while its newest pulse is under ACTIVE_MS old. Listeners hear only the flips (quiet →
// active, active → quiet), so the roster and the floors' working counts move promptly without a message per
// chunk of output. In memory only: after a restart nobody is active until it does something.

/** How long after its last sign of work a worker still counts as active. */
export const ACTIVE_MS = 90_000;
/** A commit counts for longer: it's the work landing, and a quiet minute after one is still the same stretch. */
export const COMMIT_ACTIVE_MS = 5 * 60_000;

export type PulseKind = 'output' | 'tool' | 'commit';

export interface Pulse {
  /** The newest sign of work of each kind (ms). */
  output?: number;
  tool?: number;
  commit?: number;
}

/** The kind that keeps it active now, strongest evidence first (a commit, a tool call, output), or undefined. */
export function activeVia(p: Pulse | undefined, now: number): { via: PulseKind; at: number } | undefined {
  if (!p) return undefined;
  if (p.commit !== undefined && now - p.commit < COMMIT_ACTIVE_MS) return { via: 'commit', at: p.commit };
  if (p.tool !== undefined && now - p.tool < ACTIVE_MS) return { via: 'tool', at: p.tool };
  if (p.output !== undefined && now - p.output < ACTIVE_MS) return { via: 'output', at: p.output };
  return undefined;
}

type Listener = (workerId: string, active: boolean) => void;

const pulses = new Map<string, Pulse>();
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let clock: () => number = Date.now;

/** Tests: a clock of their own (and everything forgotten). */
export function setPulseClock(now: (() => number) | undefined) {
  clock = now ?? Date.now;
  resetPulses();
}

/** Hears a worker going active or quiet; returns what stops it. */
export function onPulseFlip(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

function tell(workerId: string, active: boolean) {
  for (const l of listeners) {
    try {
      l(workerId, active);
    } catch (err) {
      console.error(`agent-office: a pulse listener failed: ${(err as Error).message}`);
    }
  }
}

/** When it goes quiet, if nothing new comes: one timer per worker, moved on lazily (never per chunk). */
function arm(workerId: string) {
  if (timers.has(workerId)) return;
  const due = () => {
    const now = clock();
    const a = activeVia(pulses.get(workerId), now);
    if (!a) {
      timers.delete(workerId);
      tell(workerId, false);
      return;
    }
    const left = (a.via === 'commit' ? COMMIT_ACTIVE_MS : ACTIVE_MS) - (now - a.at);
    const t = setTimeout(due, Math.max(1_000, left + 50));
    t.unref?.();
    timers.set(workerId, t);
  };
  const t = setTimeout(due, ACTIVE_MS + 50);
  t.unref?.();
  timers.set(workerId, t);
}

/**
 * Output counts only when there's enough of it: a few chunks and some bytes within OUTPUT_WINDOW_MS. A TUI at rest
 * still redraws now and then (a status line, a resize), and that mustn't read as work.
 */
export const OUTPUT_WINDOW_MS = 20_000;
export const OUTPUT_MIN_CHUNKS = 3;
export const OUTPUT_MIN_BYTES = 512;
const windows = new Map<string, { since: number; chunks: number; bytes: number }>();

/** A sign of work from a worker. Cheap: a number set, and a flip told only when it was quiet. `bytes`: an output chunk's size. */
export function notePulse(workerId: string, kind: PulseKind = 'output', at = clock(), bytes = OUTPUT_MIN_BYTES) {
  if (kind === 'output') {
    let w = windows.get(workerId);
    if (!w || at - w.since > OUTPUT_WINDOW_MS) windows.set(workerId, (w = { since: at, chunks: 0, bytes: 0 }));
    w.chunks++;
    w.bytes += bytes;
    if (w.chunks < OUTPUT_MIN_CHUNKS || w.bytes < OUTPUT_MIN_BYTES) return;
  }
  let p = pulses.get(workerId);
  const was = !!activeVia(p, at);
  if (!p) pulses.set(workerId, (p = {}));
  if ((p[kind] ?? 0) < at) p[kind] = at;
  if (was) return;
  arm(workerId);
  tell(workerId, true);
}

/** What keeps the worker active now, or undefined. */
export function pulseOf(workerId: string, now = clock()): { via: PulseKind; at: number } | undefined {
  return activeVia(pulses.get(workerId), now);
}

/** Whether a worker is active now. */
export const isActive = (workerId: string, now = clock()) => !!pulseOf(workerId, now);

/** A worker left: forgotten. */
export function forgetPulse(workerId: string) {
  pulses.delete(workerId);
  windows.delete(workerId);
  const t = timers.get(workerId);
  if (t) clearTimeout(t);
  timers.delete(workerId);
}

/** Tests: everything forgotten. */
export function resetPulses() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  pulses.clear();
  windows.clear();
}

/** A command a worker ran that makes a commit (`git commit`, `git merge` that commits), for the commit pulse. */
export const COMMIT_COMMAND = /(^|[;&|]\s*|\s)git(\s+-C\s+\S+)?\s+(commit|merge|cherry-pick|revert)\b/;
