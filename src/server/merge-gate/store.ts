// The merge gate's records, per project: <data>/merge-gate/<project>.jsonl, append only. A line per review
// record (from a Review comment or GitHub review the first time the office sees it, or a review the Project
// Manager recorded in the office), per admin override, and per "unreviewed" mark cleared, so the history
// stays when a mark goes. Read once per project (asynchronously), kept in memory, each append fsync'd and
// one at a time per project. A locked or torn file is handled by durable/jsonl.ts.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { readJsonlStore } from '../durable/jsonl.js';
import type { OverrideRecord, ReviewRecord } from '../../shared/merge-gate.js';

export interface ClearedMark {
  pr: number;
  task?: string;
  why: string;
  at: number;
}

export type GateLine = ({ t: 'review' } & ReviewRecord) | ({ t: 'override' } & OverrideRecord) | ({ t: 'cleared' } & ClearedMark);

interface FloorBook {
  reviews: Map<string, ReviewRecord>;
  overrides: OverrideRecord[];
  cleared: ClearedMark[];
}

const FLOOR = /^[A-Za-z0-9_.-]{1,64}$/;

export class GateStore {
  private books = new Map<string, FloorBook>();
  private loading = new Map<string, Promise<FloorBook>>();
  private chains = new Map<string, Promise<unknown>>();

  constructor(readonly dir: string) {}

  file(floorId: string) {
    if (!FLOOR.test(floorId)) throw new Error(`not a project id: ${floorId}`);
    return path.join(this.dir, `${floorId}.jsonl`);
  }

  /** The project's records, read once. */
  async book(floorId: string): Promise<FloorBook> {
    const had = this.books.get(floorId);
    if (had) return had;
    let p = this.loading.get(floorId);
    if (!p) {
      p = this.read(floorId).finally(() => this.loading.delete(floorId));
      this.loading.set(floorId, p);
    }
    const b = await p;
    this.books.set(floorId, b);
    return b;
  }

  /** The records in memory, when they've been read (the review gate's synchronous look). */
  loaded(floorId: string): FloorBook | undefined {
    return this.books.get(floorId);
  }

  private async read(floorId: string): Promise<FloorBook> {
    const b: FloorBook = { reviews: new Map(), overrides: [], cleared: [] };
    const { lines } = await readJsonlStore(this.file(floorId));
    for (const line of lines) {
      try {
        const l = JSON.parse(line) as GateLine;
        if (l.t === 'review' && typeof l.id === 'string') b.reviews.set(l.id, strip(l) as ReviewRecord);
        else if (l.t === 'override') b.overrides.push(strip(l) as OverrideRecord);
        else if (l.t === 'cleared') b.cleared.push(strip(l) as ClearedMark);
      } catch {
        // not a line of ours
      }
    }
    return b;
  }

  /** Adds the records it hasn't seen (by id); the new ones. */
  async addReviews(floorId: string, records: readonly ReviewRecord[]): Promise<ReviewRecord[]> {
    const b = await this.book(floorId);
    const fresh = records.filter((r) => !b.reviews.has(r.id));
    if (!fresh.length) return [];
    for (const r of fresh) b.reviews.set(r.id, r);
    await this.append(floorId, fresh.map((r) => ({ t: 'review' as const, ...r })));
    return fresh;
  }

  async addOverride(floorId: string, o: OverrideRecord) {
    const b = await this.book(floorId);
    b.overrides.push(o);
    await this.append(floorId, [{ t: 'override', ...o }]);
  }

  async addCleared(floorId: string, c: ClearedMark) {
    const b = await this.book(floorId);
    b.cleared.push(c);
    await this.append(floorId, [{ t: 'cleared', ...c }]);
  }

  /** Appends lines with an fsync, one append at a time per project. */
  private append(floorId: string, lines: GateLine[]): Promise<void> {
    const file = this.file(floorId);
    const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    const run = (this.chains.get(floorId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      await fsp.mkdir(this.dir, { recursive: true });
      const fh = await fsp.open(file, 'a', 0o600);
      try {
        await fh.appendFile(text, 'utf8');
        await fh.sync();
      } finally {
        await fh.close();
      }
    });
    this.chains.set(floorId, run);
    return run;
  }
}

function strip<T extends { t?: unknown }>(l: T): Omit<T, 't'> {
  const { t: _t, ...rest } = l;
  return rest;
}
