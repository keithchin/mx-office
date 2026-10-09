// Where the Model tab keeps what it worked out, under <data dir>/model/:
//
//   docs/<2>/<key>.json  each answer (a diagram, a document's MDL, the tree) as JSON, by a key made of
//                        what it was worked out from: a document's content hash (its unit's git blob)
//                        and the hashes of the few units it also reads, or for the tree the app's
//                        structure. A new commit that left a document alone finds its answer here at
//                        once, whichever commit it was first worked out on.
//   mpr/, work/          the .mpr copies node:sqlite opens (units.ts) and the folders mxcli reads
//                        (workdir.ts).
//
// Nothing here goes stale (a key names its inputs); the least recently used answers are let go past
// CACHE_MAX_BYTES. The most recent answers are kept in memory too, and two asks for the same thing at
// once share one read (`once`). Older offices kept a full copy of every commit (snap/) and answers
// per commit (cache/): those are removed on start (`dropLegacy`).

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileOffP } from '../offloop/exec.js';

export const CACHE_MAX_BYTES = 200 * 1024 * 1024;
const MEMORY_MAX = 300;
const PRUNE_EVERY_MS = 60_000;

const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
export type GitRun = (args: string[], cwd: string) => Promise<string>;
export const gitOff: GitRun = async (args, cwd) => (await execFileOffP('git', ['-c', 'core.longpaths=true', ...args], { cwd, env: GIT_ENV, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 })).stdout;

/** The .mpr a commit has: at the top, or one folder down (as liveapp/checkout.ts's findMpr). */
export function mprIn(files: string[]): string | undefined {
  const mprs = files.filter((f) => /\.mpr$/i.test(f) && f.split('/').length <= 2 && !f.split('/').some((p) => p.startsWith('.')));
  return mprs.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
}

export const SHA = /^[0-9a-f]{7,64}$/;

/** A cache key from its parts (what the answer was worked out from). */
export const keyOf = (...parts: string[]): string => createHash('sha1').update(parts.join('\0')).digest('hex');

export class ModelStore {
  private inflight = new Map<string, Promise<unknown>>();
  private memory = new Map<string, unknown>();
  private pruned = 0;
  readonly root: string;
  /** Answers worked out (not found), for tests and the perf script. */
  misses = 0;

  constructor(dataDir: string) {
    this.root = path.join(dataDir, 'model');
  }

  /** Shares one run of `fn` between everyone asking for `key` while it runs. */
  once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private file(key: string): string {
    return path.join(this.root, 'docs', key.slice(0, 2), `${key}.json`);
  }

  /** The answer kept under `key`, or undefined. */
  async peek<T>(key: string): Promise<T | undefined> {
    if (this.memory.has(key)) return this.remember(key, this.memory.get(key)) as T;
    try {
      const file = this.file(key);
      const value = JSON.parse(await readFile(file, 'utf8')) as T;
      const now = new Date();
      void utimes(file, now, now).catch(() => {});
      return this.remember(key, value);
    } catch {
      return undefined;
    }
  }

  /** `fn`'s answer for `key` (keyOf(...)), from memory or disk when it was worked out before. */
  cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.memory.has(key)) return Promise.resolve(this.remember(key, this.memory.get(key)) as T);
    return this.once(`cache:${key}`, async () => {
      const kept = await this.peek<T>(key);
      if (kept !== undefined) return kept;
      this.misses++;
      const value = await fn();
      await this.put(key, value);
      if (Date.now() - this.pruned > PRUNE_EVERY_MS) {
        this.pruned = Date.now();
        void this.prune();
      }
      return value;
    });
  }

  /** Keeps `value` under `key` (replacing what was there). */
  async put<T>(key: string, value: T): Promise<void> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
    this.remember(key, value);
  }

  private remember<T>(key: string, value: T): T {
    this.memory.delete(key);
    this.memory.set(key, value);
    while (this.memory.size > MEMORY_MAX) this.memory.delete(this.memory.keys().next().value as string);
    return value;
  }

  /** Lets go of the least recently used answers past CACHE_MAX_BYTES. */
  async prune(max = CACHE_MAX_BYTES): Promise<void> {
    const docs = path.join(this.root, 'docs');
    const files: { p: string; at: number; size: number }[] = [];
    for (const d of await readdir(docs).catch(() => [] as string[])) {
      for (const f of await readdir(path.join(docs, d)).catch(() => [] as string[])) {
        const p = path.join(docs, d, f);
        const s = await stat(p).catch(() => null);
        if (s?.isFile()) files.push({ p, at: s.mtimeMs, size: s.size });
      }
    }
    files.sort((a, b) => b.at - a.at);
    let total = 0;
    for (const f of files) {
      total += f.size;
      if (total > max) await rm(f.p, { force: true }).catch(() => {});
    }
  }

  /** Removes what older offices kept: a full copy of each commit (snap/) and answers per commit (cache/). */
  async dropLegacy(): Promise<void> {
    for (const d of ['snap', 'cache']) await rm(path.join(this.root, d), { recursive: true, force: true }).catch(() => {});
  }
}
