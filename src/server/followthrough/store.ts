// What Recorded as given keeps per floor (<data>/followthrough/<floor>.json, written atomically, off the
// event loop): each escalation's last finding (a question's lives on its answer in the questions book), and
// the follow-throughs the person dismissed, each at the revision it was dismissed at (a new revision shows
// again). A finding the office can work out again on the next look, so a background write is enough.

import { loadJson } from '../durable/read.js';
import { writeTextDurable } from '../durable/write.js';
import path from 'node:path';
import type { DecisionRef } from '../../shared/dispatch.js';
import type { Recording } from '../../shared/followthrough.js';

export interface FollowData {
  recordings: Record<DecisionRef, Recording>;
  dismissed: Record<DecisionRef, { rev: number; at: number; by: string }>;
}

const empty = (): FollowData => ({ recordings: {}, dismissed: {} });

export class FollowStore {
  private floors = new Map<string, Promise<FollowData>>();
  private writing = new Map<string, Promise<void>>();
  private loaded = new Map<string, FollowData>();

  constructor(readonly dir: string) {}

  private file(floorId: string) {
    return path.join(this.dir, `${floorId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  /** The floor's data, read once (asynchronously). */
  get(floorId: string): Promise<FollowData> {
    let p = this.floors.get(floorId);
    if (!p) {
      // Only a missing file is empty; a locked one rejects and is read again next time (durable/read.ts).
      p = loadJson(
        this.file(floorId),
        (v) => {
          if (v === undefined) return empty();
          const o = v as Partial<FollowData>;
          return { recordings: o.recordings && typeof o.recordings === 'object' ? o.recordings : {}, dismissed: o.dismissed && typeof o.dismissed === 'object' ? o.dismissed : {} };
        },
        () => this.floors.delete(floorId),
      ).then((d) => (this.loaded.set(floorId, d), d));
      this.floors.set(floorId, p);
    }
    return p;
  }

  /** The copy in memory, when it's been read. */
  peek(floorId: string): FollowData | undefined {
    return this.loaded.get(floorId);
  }

  /** Writes the floor's data (one write at a time per floor). */
  save(floorId: string): Promise<void> {
    const prev = this.writing.get(floorId) ?? Promise.resolve();
    const next = prev.then(async () => {
      const d = await this.get(floorId);
      const f = this.file(floorId);
      try {
        await writeTextDurable(f, JSON.stringify(d));
      } catch (err) {
        console.error(`agent-office: followthrough: couldn't save ${floorId}: ${(err as Error).message}`);
      }
    });
    this.writing.set(floorId, next);
    return next;
  }
}
