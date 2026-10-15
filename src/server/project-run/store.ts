// What ⏸ Pause project keeps, and each floor's resume pacing: <office data>/project-run.json. A paused
// floor's office prompts are held (roster/deliver.ts asks projectPauseOf), so the pause has to outlive
// a restart: that's the point of pausing before one. Module-level like roster/pause.ts, so the one
// delivery path can ask without a handle on the office; useProjectRunFile points it at the office's
// data dir (until then, and in tests that don't, it lives in memory only).

import { onForgetFloor } from '../office/forget.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanPacing, DEFAULT_PACING, PAUSED_HIRES, type Pacing, type PauseInfo } from '../../shared/project-run.js';
import { writeJsonAtomic } from '../flow/store.js';

/**
 * A floor's latest resume, for the office's notes after it (roster/awareness.ts): when, why, and the
 * agents that slept through the pause before it and haven't been told yet. Each is told once, with its
 * next message, and then taken off `owed`: that's the pause it acknowledged.
 */
export interface ResumeMark {
  at: number;
  /** "after a safe restart", "after a pause by Keith". */
  why: string;
  by: string;
  /** Workers that slept through the pause and haven't been told of this resume. */
  owed: string[];
}

interface Saved {
  pauses: Record<string, PauseInfo>;
  pacing: Record<string, Pacing>;
  resumes: Record<string, ResumeMark>;
  /** Workers a pause wound down (asked for a handoff, or put to sleep) since the floor's last resume. */
  slept: Record<string, string[]>;
}

let file: string | undefined;
const empty = (): Saved => ({ pauses: {}, pacing: {}, resumes: {}, slept: {} });
let data: Saved = empty();

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
/** The most workers a floor's owed and slept lists keep. */
const IDS_MAX = 60;
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, 64)).filter(Boolean))].slice(-IDS_MAX) : []);

function revive(raw: unknown): Saved {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Saved, Record<string, unknown>>>;
  const out = empty();
  for (const [id, p] of Object.entries(r.pauses ?? {})) {
    const v = p as Partial<PauseInfo>;
    if (!v || typeof v.at !== 'number') continue;
    out.pauses[id] = { by: str(v.by, 80) || 'Someone', at: v.at, why: v.why === 'restart' || v.why === 'budget' ? v.why : 'person', waiting: Array.isArray(v.waiting) ? v.waiting.map((x) => str(x, 40)).filter(Boolean).slice(0, 20) : [] };
  }
  for (const [id, p] of Object.entries(r.pacing ?? {})) out.pacing[id] = cleanPacing(p);
  for (const [id, m] of Object.entries(r.resumes ?? {})) {
    const v = m as Partial<ResumeMark>;
    if (!v || typeof v.at !== 'number') continue;
    out.resumes[id] = { at: v.at, why: str(v.why, 120) || 'after a pause', by: str(v.by, 80) || 'Someone', owed: ids(v.owed) };
  }
  for (const [id, l] of Object.entries(r.slept ?? {})) {
    const v = ids(l);
    if (v.length) out.slept[id] = v;
  }
  return out;
}

/** Keeps it in `dir`/project-run.json from now on, loading what's there (undefined: memory only, emptied). */
export function useProjectRunFile(dir: string | undefined) {
  file = dir ? path.join(dir, 'project-run.json') : undefined;
  data = empty();
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
  return `This project is paused (⏸ Pause project${p.why === 'restart' ? ', for a safe restart' : p.why === 'budget' ? ': its budget is reached' : ` by ${p.by}`}): the office sends its agents no prompts of its own until it's resumed`;
}

/** Floors a person is hiring on anyway, from the Team tab, after a confirm (overrideHold). */
const overriding = new Map<string, number>();
onForgetFloor((f) => {
  overriding.delete(f.id);
  if (![data.pauses, data.pacing, data.resumes, data.slept].some((m) => f.id in m)) return;
  delete data.pauses[f.id];
  delete data.pacing[f.id];
  delete data.resumes[f.id];
  delete data.slept[f.id];
  save();
});

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

// ---- After a resume: who slept through the pause and hasn't heard (roster/awareness.ts) -------------

export const lastResume = (floorId: string): ResumeMark | undefined => data.resumes[floorId];

/**
 * A pause wound these workers down (told "the project is pausing"): each is owed a word once it's
 * resumed. Those still owed one from the last resume carry into this pause too.
 */
export function noteSlept(floorId: string, workerIds: string[]) {
  const m = data.resumes[floorId];
  const v = ids([...(data.slept[floorId] ?? []), ...(m?.owed ?? []), ...workerIds]);
  if (m) m.owed = [];
  if (v.length) data.slept[floorId] = v;
  save();
}

/** The floor was resumed: everyone who slept through the pause is owed the note, once. */
export function noteResumed(floorId: string, m: Omit<ResumeMark, 'owed'>) {
  data.resumes[floorId] = { ...m, owed: ids([...(data.resumes[floorId]?.owed ?? []), ...(data.slept[floorId] ?? [])]) };
  delete data.slept[floorId];
  save();
}

/** The resume this worker is still to hear about, while the floor isn't paused again. */
export function resumeOwed(floorId: string, workerId: string): ResumeMark | undefined {
  const m = data.resumes[floorId];
  return m && !data.pauses[floorId] && m.owed.includes(workerId) ? m : undefined;
}

/** The worker has heard (its note went in, or it was told another way): never again for this resume. */
export function ackResume(floorId: string, workerId: string) {
  const m = data.resumes[floorId];
  if (!m?.owed.includes(workerId)) return;
  m.owed = m.owed.filter((x) => x !== workerId);
  save();
}
