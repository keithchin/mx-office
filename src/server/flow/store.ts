// Where runs are kept: one JSON file per run, <root>/<workflow>/<runId>.json, written to a .tmp file
// and renamed over the old one so a crash mid-write leaves the last good checkpoint. Cached step
// results sit beside them in <root>/_cache/<workflow>/<step>/<hash of the key>.json.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunRecord } from './types.js';
import { BackgroundFile } from '../offloop/save.js';

export interface CachedResult {
  key: string;
  at: number;
  update: unknown;
}

/** What the engine keeps runs in. The file store is the office's; a test can give another. */
export interface CheckpointStore {
  loadAll(): RunRecord[];
  save(run: RunRecord): void;
  cacheGet(workflow: string, step: string, key: string): CachedResult | undefined;
  cachePut(workflow: string, step: string, entry: CachedResult): void;
}

const CACHE = '_cache';
const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '-');

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Writes JSON so a reader never sees half a file. On Windows a rename over a file something else has
 * open for a moment (a virus scanner, the search indexer) fails with EPERM or EBUSY: it's tried again
 * a few times, a few milliseconds apart.
 */
export function writeJsonAtomic(file: string, value: unknown) {
  const text = JSON.stringify(value, null, 2);
  // The folder is made when the write finds it missing, not looked at first: each call costs on a loaded
  // Windows machine (the journey's project making, 2026-10-08).
  try {
    writeFileSync(`${file}.tmp`, text, { mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, text, { mode: 0o600 });
  }
  for (let i = 0; ; i++) {
    try {
      renameSync(`${file}.tmp`, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      pause(5 * (i + 1));
    }
  }
}

export class FileStore implements CheckpointStore {
  /** Checkpoints and cached results written in the background, by file (`background` stores only). */
  private out = new Map<string, BackgroundFile>();

  /**
   * `background`: checkpoints are written off the event loop (offloop/save.ts), the latest one per run, and
   * whatever is still due at the office's exit. The office's store is one: a checkpoint written in place
   * held the loop up to 1.5 s on a loaded machine in the middle of the wizard (2026-10-08). A crash in the
   * few ms before one lands resumes from the checkpoint before it, as a crash mid-step does.
   */
  constructor(
    readonly root: string,
    private opts: { background?: boolean } = {},
  ) {
    if (opts.background) process.once('exit', () => this.flush());
  }

  /** Writes what's still due now. */
  flush() {
    for (const b of this.out.values()) b.flush();
  }

  private write(file: string, value: unknown, what: string) {
    const onError = (err: unknown) => console.error(`agent-office: couldn't save ${what}: ${(err as Error).message}`);
    if (!this.opts.background) {
      try {
        writeJsonAtomic(file, value);
      } catch (err) {
        onError(err);
      }
      return;
    }
    let b = this.out.get(file);
    if (!b) this.out.set(file, (b = new BackgroundFile(file, { mkdir: true, onError })));
    const mine = b;
    void b.write(JSON.stringify(value, null, 2)).then(() => {
      if (this.out.get(file) === mine && mine.pending() === undefined) this.out.delete(file);
    });
  }

  fileOf(workflow: string, runId: string) {
    return path.join(this.root, safe(workflow), `${safe(runId)}.json`);
  }

  loadAll(): RunRecord[] {
    const out: RunRecord[] = [];
    let dirs: string[] = [];
    try {
      dirs = readdirSync(this.root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== CACHE)
        .map((d) => d.name);
    } catch {
      return out;
    }
    for (const d of dirs) {
      let files: string[] = [];
      try {
        files = readdirSync(path.join(this.root, d)).filter((f) => f.endsWith('.json'));
      } catch {
        continue;
      }
      for (const f of files) {
        try {
          const run = JSON.parse(readFileSync(path.join(this.root, d, f), 'utf8')) as RunRecord;
          if (run?.format === 1 && run.runId && run.workflow && Array.isArray(run.history)) out.push(run);
        } catch {
          // not one of ours, or cut short by a crash before the rename
        }
      }
    }
    return out;
  }

  save(run: RunRecord) {
    this.write(this.fileOf(run.workflow, run.runId), run, `the checkpoint of ${run.workflow} ${run.runId}`);
  }

  private cacheFile(workflow: string, step: string, key: string) {
    return path.join(this.root, CACHE, safe(workflow), safe(step), `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  }

  cacheGet(workflow: string, step: string, key: string): CachedResult | undefined {
    try {
      const file = this.cacheFile(workflow, step, key);
      const c = JSON.parse(this.out.get(file)?.pending() ?? readFileSync(file, 'utf8')) as CachedResult;
      return c.key === key ? c : undefined;
    } catch {
      return undefined;
    }
  }

  cachePut(workflow: string, step: string, entry: CachedResult) {
    this.write(this.cacheFile(workflow, step, entry.key), entry, `the cache of ${workflow} ${step}`);
  }
}
