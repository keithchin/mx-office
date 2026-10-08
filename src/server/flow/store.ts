// Where runs are kept: one JSON file per run, <root>/<workflow>/<runId>.json, written to a .tmp file
// and renamed over the old one so a crash mid-write leaves the last good checkpoint. Cached step
// results sit beside them in <root>/_cache/<workflow>/<step>/<hash of the key>.json.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunRecord } from './types.js';

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
  constructor(readonly root: string) {}

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
    try {
      writeJsonAtomic(this.fileOf(run.workflow, run.runId), run);
    } catch (err) {
      console.error(`agent-office: couldn't save the checkpoint of ${run.workflow} ${run.runId}: ${(err as Error).message}`);
    }
  }

  private cacheFile(workflow: string, step: string, key: string) {
    return path.join(this.root, CACHE, safe(workflow), safe(step), `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  }

  cacheGet(workflow: string, step: string, key: string): CachedResult | undefined {
    try {
      const c = JSON.parse(readFileSync(this.cacheFile(workflow, step, key), 'utf8')) as CachedResult;
      return c.key === key ? c : undefined;
    } catch {
      return undefined;
    }
  }

  cachePut(workflow: string, step: string, entry: CachedResult) {
    try {
      writeJsonAtomic(this.cacheFile(workflow, step, entry.key), entry);
    } catch (err) {
      console.error(`agent-office: couldn't cache ${workflow} ${step}: ${(err as Error).message}`);
    }
  }
}
