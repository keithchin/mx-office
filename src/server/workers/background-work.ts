// Each worker's open background work (shared/roster/background-work.ts), kept in memory: heard from its
// PostToolUse hook as it's launched (providers/claude.ts) and from its transcript (roster/subagent-live.ts
// feeds the same reads to background-transcript.ts), which also says when it ended, as no hook does. A
// new session (SessionStart from a fresh start or a resume, a new transcript) or the worker going home
// clears it: nothing of the old session runs on. After an office restart the transcript's first look
// brings it back. Whoever listens hears when a worker's list changed (the roster tells the browsers).

import { applyBg, bgState, openBg, pruneBg, type BgItem, type BgSignal } from '../../shared/roster/background-work.js';
import { bgCallOf, bgTaskOf } from '../roster/background-transcript.js';

const items = new Map<string, BgItem[]>();
const listeners = new Set<(workerId: string) => void>();

function told(workerId: string) {
  for (const l of listeners) {
    try {
      l(workerId);
    } catch (err) {
      console.error(`agent-office: a background-work listener failed: ${(err as Error).message}`);
    }
  }
}

/** Hears every change to any worker's background work; returns the way to stop. */
export function onBackgroundChange(l: (workerId: string) => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Takes in signals about a worker's background work; listeners hear of it when that changed anything. */
export function applyBackground(workerId: string, signals: readonly BgSignal[], quiet = false): boolean {
  if (!signals.length) return false;
  const list = items.get(workerId) ?? [];
  let changed = false;
  for (const s of signals) if (applyBg(list, s)) changed = true;
  if (list.length) items.set(workerId, list);
  else items.delete(workerId);
  if (changed && !quiet) told(workerId);
  return changed;
}

/**
 * A hook payload: a PostToolUse whose result names a background task (a Monitor started, a command run
 * or moved to the background) opens it; a SessionStart from a fresh start or a resume clears the worker's
 * list. True when it was one of those.
 */
export function noteBackgroundHook(workerId: string, event: string, payload: unknown, now = Date.now()): boolean {
  const p = (payload ?? {}) as { tool_name?: unknown; tool_use_id?: unknown; tool_input?: unknown; tool_response?: unknown; source?: unknown };
  if (event === 'SessionStart') {
    if (p.source !== 'startup' && p.source !== 'resume') return false;
    applyBackground(workerId, [{ kind: 'reset', at: now }]);
    return true;
  }
  if (event !== 'PostToolUse') return false;
  const call = bgCallOf(p.tool_name, p.tool_input);
  const task = call && bgTaskOf(p.tool_response);
  if (!call || !task) return false;
  const toolUseId = typeof p.tool_use_id === 'string' ? p.tool_use_id : undefined;
  const timeoutMs = task.timeoutMs ?? call.timeoutMs;
  applyBackground(workerId, [{ kind: 'launched', at: now, tool: call.tool, taskId: task.taskId, ...(toolUseId ? { toolUseId } : {}), ...(call.label ? { label: call.label } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(task.persistent || call.persistent ? { persistent: true } : {}) }]);
  return true;
}

/** A worker's items still shown (running, or of unknown status), as GET /api/roster carries them. */
export function backgroundOf(workerId: string, now = Date.now()): BgItem[] {
  return (items.get(workerId) ?? []).filter((i) => bgState(i, now) !== 'gone').map((i) => ({ ...i }));
}

/** Whether anything of the worker's runs in the background now (evidenced, within its stated life). */
export const backgroundOpen = (workerId: string, now = Date.now()): boolean => openBg(items.get(workerId), now).length > 0;

/** The once-a-minute look: what's gone is dropped. True when a worker's shown list changed (listeners are told). */
export function tickBackground(workerIds: Iterable<string>, now = Date.now()): boolean {
  let changed = false;
  for (const id of workerIds) {
    const list = items.get(id);
    if (!list) continue;
    const shown = (at: number) => list.map((i) => `${i.id}:${bgState(i, at)}`).filter((x) => !x.endsWith(':gone')).join(',');
    const before = shown(now - 60_000);
    pruneBg(list, now);
    const after = shown(now);
    if (!list.length) items.delete(id);
    if (before !== after) {
      changed = true;
      told(id);
    }
  }
  return changed;
}

/** A new session (a new transcript): nothing of the old one runs on. */
export const resetBackground = (workerId: string, now = Date.now()) => applyBackground(workerId, [{ kind: 'reset', at: now }]);

/** Forgets a worker that went home. */
export function forgetBackground(workerId: string) {
  if (items.delete(workerId)) told(workerId);
}
