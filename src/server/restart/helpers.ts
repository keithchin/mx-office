// Why an agent whose own turn is over still counts as busy: a background helper of its (a subagent sent
// with the Agent tool to run in the background) is still at work. Katherine's turn ended, her
// architect-agent kept going for 18 minutes, and the safe restart's panel said only "handing off" (the
// live office, 2026-10-08). The office already knows most of it: a Lead's runs from the roster's
// subagent-live record (hooks and its transcript). For any other agent, a subagent transcript of its
// session (<session>/subagents/*.jsonl) written to in the last HELPER_FRESH_MS counts, found with a
// directory listing and a stat per file, off the event loop, and only for agents that are awake and not
// mid-turn. Nothing polls on its own: the safe restart's 1 s tick and the pause view's own looks ask.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { LiveRun } from '../../shared/roster/subagent-live.js';
import { agentTypeOf, subagentDir } from '../usage.js';
import type { Ctx } from '../office/context.js';
import { rosterOf } from '../roster/adapter.js';
import { notedTranscript } from '../convo/index.js';

/** A subagent transcript written to this recently is a helper still running. */
export const HELPER_FRESH_MS = 90_000;

export interface Helper {
  /** Its type ("architect-agent"), or "subagent" when its session doesn't say. */
  agent: string;
  /** Since when it has been at it, when known. */
  since?: number;
}

/** "background helper running (architect-agent, 18 min)". */
export function helperNote(h: Helper, now: number): string {
  const min = h.since === undefined ? undefined : Math.max(0, Math.round((now - h.since) / 60_000));
  return `background helper running (${h.agent}${min === undefined ? '' : `, ${min} min`})`;
}

/** The roster's word for it: the newest background run of this worker's still working. */
export function helperFromRuns(runs: readonly LiveRun[], workerId: string): Helper | undefined {
  const r = runs.filter((x) => x.workerId === workerId && x.status === 'working' && x.background).sort((a, b) => b.startedAt - a.startedAt)[0];
  return r && { agent: r.name, since: r.resumedAt ?? r.startedAt };
}

/** The transcripts' word for it: the subagent file of `transcript`'s session written to most recently, if within HELPER_FRESH_MS. */
export async function helperFromFiles(transcript: string, now: number): Promise<Helper | undefined> {
  const dir = subagentDir(transcript);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return undefined;
  }
  let best: { file: string; mtime: number; birth: number } | undefined;
  for (const n of names) {
    const file = path.join(dir, n);
    const s = await stat(file).catch(() => undefined);
    if (s && now - s.mtimeMs < HELPER_FRESH_MS && (!best || s.mtimeMs > best.mtime)) best = { file, mtime: s.mtimeMs, birth: s.birthtimeMs || s.ctimeMs };
  }
  return best && { agent: typeOf(best.file), since: best.birth };
}

/** A subagent file's type, read once (its .meta.json). */
const types = new Map<string, string>();
function typeOf(file: string): string {
  let t = types.get(file);
  if (t === undefined) {
    t = agentTypeOf(file);
    if (types.size > 500) types.clear();
    types.set(file, t);
  }
  return t;
}

export interface HelperSource {
  /** The roster's live runs of the floor (a floor without a team: none). */
  runs(floorId: string): readonly LiveRun[];
  /** The agent's session transcript, when the office knows it. */
  transcript(floorId: string, w: WorkerInfo): string | undefined;
}

const ASLEEP = new Set(['offline', 'exited']);
/** Awake, between turns: the agents a helper can keep busy (mid-turn ones are busy anyway). */
export const betweenTurns = (w: WorkerInfo) => w.kind === 'agent' && !ASLEEP.has(w.status) && w.status !== 'working' && w.status !== 'starting';

/**
 * The helpers running for `workers` (by worker id), the roster's record first, then the transcripts.
 * Only agents between turns are looked at.
 */
export async function helpersOf(src: HelperSource, floors: { id: string; workers: WorkerInfo[] }[], now: number): Promise<Map<string, Helper>> {
  const out = new Map<string, Helper>();
  for (const f of floors) {
    const runs = src.runs(f.id);
    for (const w of f.workers.filter(betweenTurns)) {
      const known = helperFromRuns(runs, w.id);
      if (known) {
        out.set(w.id, known);
        continue;
      }
      const t = src.transcript(f.id, w);
      const seen = t ? await helperFromFiles(t, now) : undefined;
      if (seen) out.set(w.id, seen);
    }
  }
  return out;
}

/** Where the office finds them: the roster's live runs, and the session it noted from the hooks. */
export function helperSource(ctx: Ctx): HelperSource {
  return {
    runs: (floorId) => rosterOf(ctx).data(floorId).subagentRuns ?? [],
    transcript: (_floorId, w) => notedTranscript(w.id),
  };
}

/**
 * The helper notes of one floor's agents for a view that asks every second or so (the pause flow's
 * progress): answered from the last look, and looked again in the background when that's over a
 * second old. No timer of its own.
 */
export function helperNotes(ctx: Ctx): (floorId: string, workerId: string) => string | undefined {
  const seen = new Map<string, { at: number; notes: Map<string, string>; looking?: boolean }>();
  return (floorId, workerId) => {
    const now = Date.now();
    const had = seen.get(floorId);
    if (!had || (now - had.at > 1000 && !had.looking)) {
      const entry = had ?? { at: 0, notes: new Map<string, string>() };
      entry.looking = true;
      seen.set(floorId, entry);
      const f = ctx.floors.get(floorId);
      void (f ? helpersOf(helperSource(ctx), [{ id: f.id, workers: f.workers.list() }], now) : Promise.resolve(new Map<string, Helper>()))
        .then((found) => {
          entry.notes = new Map([...found].map(([id, h]) => [id, helperNote(h, Date.now())]));
        })
        .catch(() => undefined)
        .finally(() => {
          entry.at = Date.now();
          entry.looking = false;
        });
    }
    return seen.get(floorId)?.notes.get(workerId);
  };
}
