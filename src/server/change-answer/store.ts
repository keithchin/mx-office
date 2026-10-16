// What Change answer keeps per floor (<data>/change-answer/<floor>.json, written atomically, off the event
// loop): each replaced revision's follow-through finding as it was when the answer changed, so the history
// shows what came of rev n after rev n+1 took over. The answers themselves live in the answer store.

import { loadJson } from '../durable/read.js';
import { writeTextDurable } from '../durable/write.js';
import path from 'node:path';
import type { DecisionRef } from '../../shared/dispatch.js';
import type { RecordedOutcome } from '../../shared/followthrough.js';

export interface KeptOutcome {
  outcome: RecordedOutcome;
  rev?: number;
}

export interface ChangeData {
  /** decision → rev → its finding when it was replaced. */
  outcomes: Record<DecisionRef, Record<string, KeptOutcome>>;
}

export class ChangeStore {
  private floors = new Map<string, Promise<ChangeData>>();
  private writing = new Map<string, Promise<void>>();

  constructor(readonly dir: string) {}

  private file(floorId: string) {
    return path.join(this.dir, `${floorId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  get(floorId: string): Promise<ChangeData> {
    let p = this.floors.get(floorId);
    if (!p) {
      p = loadJson(
        this.file(floorId),
        (v) => {
          const o = (v ?? {}) as Partial<ChangeData>;
          return { outcomes: o.outcomes && typeof o.outcomes === 'object' ? o.outcomes : {} };
        },
        () => this.floors.delete(floorId),
      );
      this.floors.set(floorId, p);
    }
    return p;
  }

  /** Keeps rev `rev`'s finding (once: the first word on a revision stays). */
  async keep(floorId: string, decision: DecisionRef, rev: number, o: KeptOutcome | undefined): Promise<void> {
    if (!o) return;
    const d = await this.get(floorId);
    const m = (d.outcomes[decision] ??= {});
    m[String(rev)] ??= { outcome: o.outcome, ...(o.rev !== undefined ? { rev: o.rev } : {}) };
    await this.save(floorId);
  }

  save(floorId: string): Promise<void> {
    const prev = this.writing.get(floorId) ?? Promise.resolve();
    const next = prev.then(async () => {
      const d = await this.get(floorId);
      const f = this.file(floorId);
      try {
        await writeTextDurable(f, JSON.stringify(d));
      } catch (err) {
        console.error(`agent-office: change-answer: couldn't save ${floorId}: ${(err as Error).message}`);
      }
    });
    this.writing.set(floorId, next);
    return next;
  }
}
