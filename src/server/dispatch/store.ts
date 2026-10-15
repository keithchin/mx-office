// Dispatch records on disk (Slice 1B-1): one file per floor, <data>/dispatch/<floor>.json, every change
// written with the acknowledged critical write (flow/critical-write.ts: fsynced, then an atomic rename)
// and serialised per floor like the setup's operation records (wizard/operations.ts OperationStore.put).
// The copy in memory changes only once the file has it, so a write that failed leaves what was there and
// rejects to the caller, who then doesn't act (an intent) or stops for reconciliation (an outcome).
//
// Settled records are trimmed to the newest KEPT; unsettled ones are never dropped (the rollback guard and
// the person's card need every one).

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DISPATCH_SCHEMA, DISPATCH_STATES, isUnsettled, type DispatchRecord } from '../../shared/dispatch.js';
import { writeJsonCritical, type CriticalFs } from '../flow/critical-write.js';

const KEPT = 500;
const FLOOR = /^[A-Za-z0-9_.-]{1,64}$/;

/** A record as saved, or undefined when it isn't one. */
export function readRecord(v: unknown): DispatchRecord | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Partial<DispatchRecord>;
  if (typeof r.id !== 'string' || !/^dsp_[0-9A-Z]{26}$/.test(r.id)) return undefined;
  if (typeof r.decision !== 'string' || typeof r.answerRev !== 'number' || typeof r.payload !== 'string') return undefined;
  if (!DISPATCH_STATES.includes(r.state as never) || !['type', 'hold', 'github-issue'].includes(r.channel as never)) return undefined;
  return { ...r, history: Array.isArray(r.history) ? r.history : [] } as DispatchRecord;
}

export interface DispatchFile {
  v: number;
  floor: string;
  records: DispatchRecord[];
}

/** What a floor's file says (sync; the CLI's rollback guard and tests). Unreadable: no records, and `error`. */
export function readDispatchFile(file: string): { v: number; records: DispatchRecord[]; error?: string } {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<DispatchFile>;
    return { v: typeof j.v === 'number' ? j.v : 0, records: Array.isArray(j.records) ? j.records.map(readRecord).filter((r): r is DispatchRecord => !!r) : [] };
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { v: DISPATCH_SCHEMA, records: [] } : { v: 0, records: [], error: (err as Error).message };
  }
}

export class DispatchStore {
  private cache = new Map<string, DispatchRecord[]>();
  private loading = new Map<string, Promise<DispatchRecord[]>>();
  private chains = new Map<string, Promise<unknown>>();

  constructor(
    readonly root: string,
    private fs?: CriticalFs,
  ) {}

  file(floorId: string) {
    if (!FLOOR.test(floorId)) throw new Error(`not a project id: ${floorId}`);
    return path.join(this.root, `${floorId}.json`);
  }

  /** Reads the floor's file once (asynchronously). */
  async load(floorId: string): Promise<DispatchRecord[]> {
    const had = this.cache.get(floorId);
    if (had) return had;
    let p = this.loading.get(floorId);
    if (!p) {
      p = readFile(this.file(floorId), 'utf8').then(
        (t) => {
          const j = JSON.parse(t) as Partial<DispatchFile>;
          return Array.isArray(j.records) ? j.records.map(readRecord).filter((r): r is DispatchRecord => !!r) : [];
        },
        () => [] as DispatchRecord[],
      );
      this.loading.set(floorId, p);
    }
    const list = await p;
    this.loading.delete(floorId);
    if (!this.cache.has(floorId)) this.cache.set(floorId, list);
    return this.cache.get(floorId)!;
  }

  /** The floor's records as loaded (empty before load). */
  list(floorId: string): readonly DispatchRecord[] {
    return this.cache.get(floorId) ?? [];
  }

  get(floorId: string, id: string): DispatchRecord | undefined {
    return this.cache.get(floorId)?.find((r) => r.id === id);
  }

  /** The floors with a file loaded. */
  floors(): string[] {
    return [...this.cache.keys()];
  }

  /**
   * Writes `r` (new, or a newer version of one kept) through the critical write, one write per floor at
   * a time; the records read here change only once the file has it. Rejects with the write's error.
   */
  put(floorId: string, r: DispatchRecord): Promise<DispatchRecord> {
    const prev = this.chains.get(floorId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const list = await this.load(floorId);
        const others = list.filter((o) => o.id !== r.id);
        const settled = others.filter((o) => !isUnsettled(o.state));
        const drop = new Set(settled.slice(0, Math.max(0, others.length + 1 - KEPT)).map((o) => o.id));
        const after = [...others.filter((o) => !drop.has(o.id)), r];
        await writeJsonCritical(this.file(floorId), { v: DISPATCH_SCHEMA, floor: floorId, records: after } satisfies DispatchFile, this.fs);
        this.cache.set(floorId, after);
        return r;
      });
    this.chains.set(floorId, next);
    return next as Promise<DispatchRecord>;
  }
}
