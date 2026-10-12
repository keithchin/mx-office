// The requests a worker's usage tracker (usage.ts) has counted, so each is counted once. Claude Code
// writes one API response as several transcript lines, one per content block, with the same message
// id (and request id) and usage; they need not be next to each other, and a subagent's request can be
// in the session's own transcript (an isSidechain line) as well as in its subagent file. The tracker
// looks every line up here by id, across all of the worker's files, and books only what is new.

import type { Usage } from '../shared/protocol.js';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const usageOf = (v: any): Usage | undefined =>
  v && typeof v === 'object' ? { input: num(v.input), output: num(v.output), cacheWrite: num(v.cacheWrite), cacheRead: num(v.cacheRead), cost: num(v.cost), calls: num(v.calls) } : undefined;

/** What was counted for one request: its usage so far and the part it was booked under. */
export interface SeenEntry {
  /** Its message id, and `req:<request id>` when a line had one. */
  ids: string[];
  usage: Usage;
  part?: string;
  /** Booked from a subagent's own file (not from an isSidechain line in the session's transcript). */
  sub: boolean;
}

/**
 * The requests a worker's tracker has counted, by message id and request id, across all of its
 * transcript files. Bounded, least recently seen out first: the lines of one response, and a subagent's
 * request in its two files, are written within moments of each other, so MAX requests (thousands of
 * turns) is a generous window. Only the latest SAVED go into workers.json with the tracker, for a
 * restart in the middle of a response.
 */
export class SeenIds {
  static MAX = 10_000;
  static SAVED = 100;
  private map = new Map<string, SeenEntry>();
  private count = 0;

  get size(): number {
    return this.count;
  }

  get(ids: string[]): SeenEntry | undefined {
    for (const id of ids) {
      const e = this.map.get(id);
      if (!e) continue;
      // Touched: to the back of the line, under every id it is known by.
      for (const k of e.ids) this.map.delete(k);
      for (const k of ids) if (!e.ids.includes(k)) e.ids.push(k);
      for (const k of e.ids) this.map.set(k, e);
      return e;
    }
    return undefined;
  }

  add(e: SeenEntry): void {
    for (const k of e.ids) this.map.set(k, e);
    this.count++;
    while (this.count > SeenIds.MAX) {
      const oldest = this.map.values().next().value as SeenEntry | undefined;
      if (!oldest) break;
      for (const k of oldest.ids) this.map.delete(k);
      this.count--;
    }
  }

  toJSON(): unknown[] {
    return [...new Set(this.map.values())]
      .slice(-SeenIds.SAVED)
      .map((e) => ({ ids: e.ids, usage: e.usage, ...(e.part !== undefined ? { part: e.part } : {}), ...(e.sub ? { sub: true } : {}) }));
  }

  static restore(saved: unknown): SeenIds {
    const s = new SeenIds();
    if (!Array.isArray(saved)) return s;
    for (const e of saved.slice(-SeenIds.SAVED)) {
      const ids: string[] = Array.isArray(e?.ids) ? e.ids.filter((k: unknown) => typeof k === 'string' && k.length < 300) : [];
      const usage = usageOf(e?.usage);
      if (!ids.length || !usage || s.get(ids)) continue;
      s.add({ ids, usage, ...(typeof e.part === 'string' && e.part.length < 200 ? { part: e.part } : {}), sub: e.sub === true });
    }
    return s;
  }
}

/** Field by field, what `now` has over `before` (nothing where it has less), and no new call. */
export function growth(before: Usage, now: Usage): Usage {
  const d = (a: number, b: number) => Math.max(0, b - a);
  return { input: d(before.input, now.input), output: d(before.output, now.output), cacheWrite: d(before.cacheWrite, now.cacheWrite), cacheRead: d(before.cacheRead, now.cacheRead), cost: d(before.cost, now.cost), calls: 0 };
}

export const maxUsage = (a: Usage, b: Usage): Usage => ({
  input: Math.max(a.input, b.input),
  output: Math.max(a.output, b.output),
  cacheWrite: Math.max(a.cacheWrite, b.cacheWrite),
  cacheRead: Math.max(a.cacheRead, b.cacheRead),
  cost: Math.max(a.cost, b.cost),
  calls: Math.max(a.calls, b.calls),
});
