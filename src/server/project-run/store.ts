// What ⏸ Pause project keeps, and each floor's resume pacing: <office data>/project-run.json. A paused
// floor's office prompts are held (roster/deliver.ts asks projectPauseOf), so the pause has to outlive
// a restart: that's the point of pausing before one. Module-level like roster/pause.ts, so the one
// delivery path can ask without a handle on the office; useProjectRunFile points it at the office's
// data dir (until then, and in tests that don't, it lives in memory only).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanPacing, DEFAULT_PACING, PAUSED_HIRES, type Pacing, type PauseInfo } from '../../shared/project-run.js';
import { writeJsonAtomic } from '../flow/store.js';

interface Saved {
  pauses: Record<string, PauseInfo>;
  pacing: Record<string, Pacing>;
}

let file: string | undefined;
let data: Saved = { pauses: {}, pacing: {} };

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

function revive(raw: unknown): Saved {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Saved, Record<string, unknown>>>;
  const out: Saved = { pauses: {}, pacing: {} };
  for (const [id, p] of Object.entries(r.pauses ?? {})) {
    const v = p as Partial<PauseInfo>;
    if (!v || typeof v.at !== 'number') continue;
    out.pauses[id] = { by: str(v.by, 80) || 'Someone', at: v.at, why: v.why === 'restart' ? 'restart' : 'person', waiting: Array.isArray(v.waiting) ? v.waiting.map((x) => str(x, 40)).filter(Boolean).slice(0, 20) : [] };
  }
  for (const [id, p] of Object.entries(r.pacing ?? {})) out.pacing[id] = cleanPacing(p);
  return out;
}

/** Keeps it in `dir`/project-run.json from now on, loading what's there (undefined: memory only, emptied). */
export function useProjectRunFile(dir: string | undefined) {
  file = dir ? path.join(dir, 'project-run.json') : undefined;
  data = { pauses: {}, pacing: {} };
  if (!file || !existsSync(file)) return;
  try {
    data = revive(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    // a broken file: nothing paused
  }
}

function save() {
  if (!file) return;
  try {
    writeJsonAtomic(file, data);
  } catch (err) {
    console.error(`agent-office: couldn't save project pauses: ${(err as Error).message}`);
  }
}

export const projectPause = (floorId: string): PauseInfo | undefined => data.pauses[floorId];

/** Why the office types nothing of its own into this floor's agents now, if it's paused. */
export function projectPauseOf(floorId: string): string | undefined {
  const p = data.pauses[floorId];
  if (!p) return undefined;
  return `This floor is paused (⏸ Pause project${p.why === 'restart' ? ', for a safe restart' : ` by ${p.by}`}): the office sends its agents no prompts of its own until it's resumed`;
}

/** Floors a person is hiring on anyway, from the Team tab, after a confirm (overrideHold). */
const overriding = new Map<string, number>();

/**
 * Why nobody new is hired on this floor now: it's paused. roster/pause.ts's floorLedger adds it to the
 * floor's hiringPaused, so the worker manager, the queue, meetings, the roster and the Firm all stop.
 */
export const hireHoldOf = (floorId: string): string | undefined => (data.pauses[floorId] && !overriding.get(floorId) ? PAUSED_HIRES : undefined);

/** Runs `fn` (a person's explicit hire) with the floor's hire hold lifted for it, then puts it back. */
export async function overrideHold<T>(floorId: string, fn: () => Promise<T>): Promise<T> {
  overriding.set(floorId, (overriding.get(floorId) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const n = (overriding.get(floorId) ?? 1) - 1;
    if (n > 0) overriding.set(floorId, n);
    else overriding.delete(floorId);
  }
}

export function setProjectPause(floorId: string, p: PauseInfo | undefined) {
  if (p) data.pauses[floorId] = p;
  else delete data.pauses[floorId];
  save();
}

/** Who a pause left waiting on a person: said on the Command Center. */
export function setPauseWaiting(floorId: string, waiting: string[]) {
  const p = data.pauses[floorId];
  if (!p) return;
  p.waiting = waiting.slice(0, 20);
  save();
}

export const pacingOf = (floorId: string): Pacing => data.pacing[floorId] ?? DEFAULT_PACING;

export function setPacing(floorId: string, p: unknown): Pacing {
  const v = cleanPacing(p, pacingOf(floorId));
  data.pacing[floorId] = v;
  save();
  return v;
}
