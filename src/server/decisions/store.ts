// The only thing decision cards keep (shared/decisions/): the person's "Separate" choices, per floor, at
// <data>/decisions/<floor>.json → { splits: [{ cardId, sourceId, by, at }] }. A projection setting, not
// a register: the cards themselves are built afresh from their sources every time. Read once per floor
// (asynchronously), written atomically (a temp file, then a rename), off the event loop's hot path.

import { loadJson } from '../durable/read.js';
import { writeTextDurable } from '../durable/write.js';
import path from 'node:path';
import type { DecisionSplit } from '../../shared/decisions/types.js';

/** At most this many splits per floor are kept (the oldest go first). */
const KEPT = 500;

const clean = (v: unknown): DecisionSplit[] => {
  const arr = (v as { splits?: unknown })?.splits;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s): s is DecisionSplit => !!s && typeof s === 'object' && typeof (s as DecisionSplit).cardId === 'string' && typeof (s as DecisionSplit).sourceId === 'string')
    .map((s) => ({ cardId: s.cardId.slice(0, 300), sourceId: s.sourceId.slice(0, 300), ...(typeof s.by === 'string' ? { by: s.by.slice(0, 80) } : {}), ...(typeof s.at === 'number' ? { at: s.at } : {}) }));
};

export class SplitsStore {
  private floors = new Map<string, Promise<DecisionSplit[]>>();
  constructor(private readonly dataDir: string) {}

  private file(floorId: string) {
    return path.join(this.dataDir, 'decisions', `${floorId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  /** The floor's splits (read from disk the first time). */
  get(floorId: string): Promise<DecisionSplit[]> {
    let p = this.floors.get(floorId);
    if (!p) {
      p = loadJson(this.file(floorId), (v) => (v === undefined ? [] : clean(v)), () => this.floors.delete(floorId));
      this.floors.set(floorId, p);
    }
    return p;
  }

  /** Adds one (a second Separate of the same source from the same card changes nothing); true when it's new. */
  async add(floorId: string, s: DecisionSplit): Promise<boolean> {
    const list = await this.get(floorId);
    if (list.some((x) => x.cardId === s.cardId && x.sourceId === s.sourceId)) return false;
    list.push(s);
    while (list.length > KEPT) list.shift();
    const f = this.file(floorId);
    await writeTextDurable(f, JSON.stringify({ splits: list }));
    return true;
  }
}
