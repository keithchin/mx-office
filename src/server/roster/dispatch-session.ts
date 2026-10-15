// Where a dispatch's evidence will be (server/dispatch/evidence.ts), captured before anything is typed:
// the worker's Claude Code session id, its transcript file (TeamFloor.transcript) and that file's size
// now, so reconcile reads only what was written after. Off the event loop (fs/promises stat). A worker
// with no transcript (another provider, a test floor) gives nothing: its dispatch can't be proven, and
// reconcile says outcome-unknown rather than guess.

import { stat } from 'node:fs/promises';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { SessionAt } from '../dispatch/service.js';
import type { TeamFloor } from './types.js';

export async function sessionAt(floor: TeamFloor, w: WorkerInfo | undefined): Promise<SessionAt> {
  if (!w) return {};
  const sessionId = (w as { sessionId?: string }).sessionId;
  let file: string | undefined;
  try {
    file = floor.transcript?.(w);
  } catch {
    file = undefined;
  }
  if (!file) return sessionId ? { sessionId } : {};
  try {
    const s = await stat(file);
    return { ...(sessionId ? { sessionId } : {}), transcriptPath: file, transcriptOffset: s.size };
  } catch {
    // Not written yet (a session that hasn't started): from its start.
    return { ...(sessionId ? { sessionId } : {}), transcriptPath: file, transcriptOffset: 0 };
  }
}
