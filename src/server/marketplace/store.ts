// The Marketplace requests of each project, at <data>/marketplace/<floor>.json → { requests: [...] }: what was
// asked, by whom, from which folder and branch, and what became of it (added with its commit and package
// sha256, declined, failed). Read once per floor, written atomically. Never a token.

import path from 'node:path';
import { loadJson } from '../durable/read.js';
import { writeTextDurable } from '../durable/write.js';
import type { MarketplaceRequest } from '../../shared/marketplace.js';

/** At most this many requests per project are kept (the oldest finished ones go first). */
const KEPT = 200;

const clean = (v: unknown): MarketplaceRequest[] => {
  const arr = (v as { requests?: unknown })?.requests;
  return Array.isArray(arr) ? arr.filter((r): r is MarketplaceRequest => !!r && typeof r === 'object' && typeof (r as MarketplaceRequest).rid === 'string' && typeof (r as MarketplaceRequest).id === 'string') : [];
};

export class MarketplaceStore {
  private floors = new Map<string, Promise<MarketplaceRequest[]>>();
  constructor(private readonly dataDir: string) {}

  private file(floor: string) {
    return path.join(this.dataDir, 'marketplace', `${floor.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  list(floor: string): Promise<MarketplaceRequest[]> {
    let p = this.floors.get(floor);
    if (!p) {
      p = loadJson(this.file(floor), (v) => (v === undefined ? [] : clean(v)), () => this.floors.delete(floor));
      this.floors.set(floor, p);
    }
    return p;
  }

  async get(floor: string, rid: string): Promise<MarketplaceRequest | undefined> {
    return (await this.list(floor)).find((r) => r.rid === rid);
  }

  /** Adds or replaces request `r` (by rid) and writes the project's file. */
  async put(r: MarketplaceRequest): Promise<void> {
    const list = await this.list(r.floor);
    const i = list.findIndex((x) => x.rid === r.rid);
    if (i >= 0) list[i] = r;
    else list.push(r);
    while (list.length > KEPT) {
      const old = list.findIndex((x) => x.status !== 'pending' && x.status !== 'working');
      list.splice(old >= 0 ? old : 0, 1);
    }
    await writeTextDurable(this.file(r.floor), JSON.stringify({ requests: list }));
  }
}
