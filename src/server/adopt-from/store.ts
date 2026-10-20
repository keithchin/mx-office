// What a project was set up with from another app: <data>/adopt-from/<floor>.json, one small file per project,
// written with the acknowledged critical write and read back for Project Settings. Deleting the folder is the
// rollback: the binding, the pin and the role skills it describes stay as their own modules keep them.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AdoptItem, AdoptRecord } from '../../shared/adopt-from.js';
import { writeJsonCritical } from '../flow/critical-write.js';

const SAFE = /^[A-Za-z0-9._-]{1,100}$/;
const KINDS = new Set(['design', 'brain', 'toolkit', 'role-skills']);

function clean(v: unknown, floor: string): AdoptRecord | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const s = r.source as Record<string, unknown> | undefined;
  if (!s || typeof s.floor !== 'string' || typeof s.name !== 'string' || typeof r.at !== 'number') return undefined;
  const items = (Array.isArray(r.items) ? r.items : []).filter((i: unknown): i is AdoptItem => { const x = i as Record<string, unknown> | null; return !!x && KINDS.has(x.kind as string) && (x.status === 'available' || x.status === 'failed') && typeof x.text === 'string'; });
  return { floor, source: { floor: s.floor, name: s.name, ...(typeof s.client === 'string' ? { client: s.client } : {}) }, at: r.at, by: typeof r.by === 'string' ? r.by : '', items };
}

export class AdoptStore {
  readonly dir: string;
  private chain = new Map<string, Promise<unknown>>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'adopt-from');
  }

  file(floor: string): string | undefined {
    return SAFE.test(floor) ? path.join(this.dir, `${floor}.json`) : undefined;
  }

  async get(floor: string): Promise<AdoptRecord | undefined> {
    const f = this.file(floor);
    if (!f) return undefined;
    await this.chain.get(floor)?.catch(() => undefined);
    try {
      return clean(JSON.parse(await readFile(f, 'utf8')), floor);
    } catch {
      return undefined;
    }
  }

  /** Writes the record (one write per project at a time). */
  put(rec: AdoptRecord): Promise<void> {
    const f = this.file(rec.floor);
    if (!f) return Promise.reject(new Error('Not a project id'));
    const p = (this.chain.get(rec.floor) ?? Promise.resolve()).catch(() => undefined).then(() => writeJsonCritical(f, rec));
    this.chain.set(rec.floor, p);
    return p;
  }
}
