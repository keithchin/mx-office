// An Expert-mode project's session: the person's own interactive `claude` in the project folder, in the
// office's terminal host like any worker (ptyhost.ts: resume after a restart, pop out, hooks for busy and
// idle), but started with no prompt, marked `session` (the office never types into it, not even the
// carry-on after a restart: workers/manager.ts), in the project's own folder (no worktree), and with no
// team round it. One per project.

import type { Floor } from '../floor.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import { nextFreeSeat } from '../../shared/layout.js';
import { isAsleep } from '../../shared/status.js';

/** The session's worker on this floor, if it has one. */
export function sessionWorker(floor: Floor): WorkerInfo | undefined {
  return floor.workers.list().find((w) => w.session);
}

/**
 * Makes sure the session runs: started the first time (no prompt), woken when it's asleep (its conversation
 * carried on with --resume, nothing typed). `model`: the first start's `--model` (the Expert wizard's choice,
 * expert/settings.ts); undefined starts on the person's own default. Resolves to the worker, or why it couldn't.
 */
export async function ensureSession(floor: Floor, by: string, owner?: string, model?: string): Promise<WorkerInfo | string> {
  const had = sessionWorker(floor);
  if (had) {
    if (!isAsleep(had.status)) return had;
    const err = floor.workers.resume(had.id);
    return err && err !== 'Worker is already running' ? err : had;
  }
  const seat = nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing);
  if (!seat) return 'No free desk for the session';
  const r = await floor.workers.spawn(seat.id, by, undefined, false, 'agent', 'claude', model, undefined, undefined, owner);
  if (typeof r === 'string') return r;
  r.session = true;
  // Renaming saves the worker (with its session mark) and tells everyone.
  floor.workers.rename(r.id, 'Session');
  return r;
}
