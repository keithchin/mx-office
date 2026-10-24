// The Developer change record (shared/dev-changes.ts): <data>/dev-changes/<project>.jsonl, append only, a line
// per change made or per event on one, each hash-chained like the task record (tasks/store.ts: prev is the
// sha256 of the line before, hash is the line's own without that field), so an edited, dropped or reordered
// line shows in verify(). Read once per project (a torn tail is set aside by readJsonlStore), then kept in
// memory; every append is fsync'd, in order, one at a time, and a caller that needs it on disk awaits it
// (intake does, before it answers: the queue survives a restart).

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { sha256 } from '../audit/log.js';
import { readJsonlStore } from '../durable/jsonl.js';
import { foldChange, type DevChange, type DevChangeEvent, type DevChangeLine, type DevChangeNew } from '../../shared/dev-changes.js';

const FLOOR = /^[A-Za-z0-9_.-]{1,64}$/;

interface FloorChanges {
  byId: Map<string, DevChange>;
  byKey: Map<string, string>;
  last: string;
  next: number;
}

export class ChangeStore {
  private floors = new Map<string, FloorChanges>();
  private loading = new Map<string, Promise<FloorChanges>>();
  private chains = new Map<string, Promise<unknown>>();

  constructor(readonly dir: string) {}

  file(floorId: string) {
    if (!FLOOR.test(floorId)) throw new Error(`not a project id: ${floorId}`);
    return path.join(this.dir, `${floorId}.jsonl`);
  }

  /** The project's changes, read from disk the first time. */
  load(floorId: string): Promise<FloorChanges> {
    const had = this.floors.get(floorId);
    if (had) return Promise.resolve(had);
    let p = this.loading.get(floorId);
    if (!p) {
      p = (async () => {
        const { lines } = await readJsonlStore(this.file(floorId));
        const f: FloorChanges = { byId: new Map(), byKey: new Map(), last: '', next: 1 };
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const l = JSON.parse(line) as DevChangeLine;
            foldChange(f.byId, l);
            if (l.op === 'create' && l.change?.key) f.byKey.set(l.change.key, l.change.id);
            f.last = line;
          } catch {
            // not a line of ours: verify says so
          }
        }
        for (const id of f.byId.keys()) f.next = Math.max(f.next, Number(id.slice(3)) + 1);
        this.floors.set(floorId, f);
        return f;
      })().finally(() => this.loading.delete(floorId));
      this.loading.set(floorId, p);
    }
    return p;
  }

  /** Every change of the project, oldest first (load first). */
  async all(floorId: string): Promise<DevChange[]> {
    const f = await this.load(floorId);
    return [...f.byId.values()];
  }

  /** The change with this idempotency key, when one was made with it. */
  async byKey(floorId: string, key: string): Promise<DevChange | undefined> {
    const f = await this.load(floorId);
    const id = f.byKey.get(key);
    return id ? f.byId.get(id) : undefined;
  }

  async get(floorId: string, id: string): Promise<DevChange | undefined> {
    return (await this.load(floorId)).byId.get(id);
  }

  /** Takes the next DC number (synchronously, once loaded, so two at once never share one). */
  async nextId(floorId: string): Promise<string> {
    const f = await this.load(floorId);
    return `DC-${f.next++}`;
  }

  /** A change made: in memory at once, on disk when the promise resolves (rejects, and is taken out again, when it couldn't be written). */
  async create(floorId: string, c: DevChangeNew): Promise<DevChange> {
    const f = await this.load(floorId);
    foldChange(f.byId, { op: 'create', change: c });
    if (c.key) f.byKey.set(c.key, c.id);
    try {
      await this.write(floorId, { op: 'create', change: c });
    } catch (err) {
      f.byId.delete(c.id);
      if (c.key) f.byKey.delete(c.key);
      throw err;
    }
    return f.byId.get(c.id)!;
  }

  /** An event on a change: folded in at once, on disk when the promise resolves. */
  async event(floorId: string, id: string, e: DevChangeEvent): Promise<void> {
    const f = await this.load(floorId);
    foldChange(f.byId, { op: 'event', id, event: e });
    await this.write(floorId, { op: 'event', id, event: e });
  }

  private write(floorId: string, l: DevChangeLine): Promise<void> {
    const prev = this.chains.get(floorId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const f = await this.load(floorId);
        const body = { ...l, prev: f.last ? sha256(f.last) : '' };
        const line = JSON.stringify({ ...body, hash: sha256(JSON.stringify(body)) });
        await fsp.mkdir(this.dir, { recursive: true, mode: 0o700 });
        const h = await fsp.open(this.file(floorId), 'a', 0o600);
        try {
          await h.writeFile(`${line}\n`);
          await h.sync();
        } finally {
          await h.close();
        }
        f.last = line;
      });
    this.chains.set(floorId, next.catch((err: unknown) => console.error(`agent-office: dev changes: couldn't save a line for ${floorId}: ${(err as Error).message}`)));
    return next;
  }

  /** Whether every line fits its own hash and points at the one before it. */
  async verify(floorId: string): Promise<{ ok: boolean; lines: number; brokenAt?: number }> {
    let text = '';
    try {
      text = await fsp.readFile(this.file(floorId), 'utf8');
    } catch {
      return { ok: true, lines: 0 };
    }
    let prev = '';
    let n = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      n++;
      let l: Record<string, unknown>;
      try {
        l = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { ok: false, lines: n, brokenAt: n };
      }
      const { hash, ...rest } = l;
      if (l.prev !== prev || sha256(JSON.stringify(rest)) !== hash) return { ok: false, lines: n, brokenAt: n };
      prev = sha256(line);
    }
    return { ok: true, lines: n };
  }

  /** Whether the project has a queued or active change (only once read: a project not read yet says no). */
  waiting(floorId: string): boolean {
    const f = this.floors.get(floorId);
    if (!f) return false;
    for (const c of f.byId.values()) if (c.queue === 'queued' || c.queue === 'active') return true;
    return false;
  }

  /** Forgets what's in memory (a test's restart). */
  forget() {
    this.floors.clear();
  }
}
