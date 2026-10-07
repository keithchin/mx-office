// The Test Mode page's history (server/testlab/): <data>/testlab/index.json lists the runs (newest
// first, at most RUN_HISTORY), and each run's folder runs/<id>/ keeps what the runner left (result.json,
// summary.md, screenshots) and its log (log.txt, at most LOG_MAX bytes). A run that was going when the
// office stopped is marked as interrupted the next time the store opens.

import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RUN_HISTORY, type RunResult, type RunSummary } from '../../shared/testlab.js';
import { isRunId, safeFileName } from './logic.js';

/** A run's log is cut off past this many bytes (a runaway runner can't fill the disk). */
export const LOG_MAX = 2 * 1024 * 1024;
/** At most this much of the log comes back per request. */
export const LOG_CHUNK = 64 * 1024;

export class RunStore {
  readonly indexFile: string;
  private runs: RunSummary[] = [];

  constructor(
    readonly dir: string,
    private keep = RUN_HISTORY,
  ) {
    this.indexFile = path.join(dir, 'index.json');
    mkdirSync(path.join(dir, 'runs'), { recursive: true });
    try {
      const v = JSON.parse(readFileSync(this.indexFile, 'utf8'));
      if (Array.isArray(v)) this.runs = v.filter((r) => r && typeof r.id === 'string' && isRunId(r.id));
    } catch {
      this.runs = [];
    }
    // Nothing is running in a store that has just opened: the office stopped while a run went.
    let changed = false;
    for (const r of this.runs)
      if (r.status === 'running') {
        r.status = 'error';
        r.headline = 'Interrupted: the office stopped while this run was going';
        changed = true;
      }
    if (changed) this.save();
  }

  list(): RunSummary[] {
    return this.runs.map((r) => ({ ...r }));
  }

  get(id: string): RunSummary | undefined {
    const r = this.runs.find((x) => x.id === id);
    return r && { ...r };
  }

  runDir(id: string): string {
    if (!isRunId(id)) throw new Error(`bad run id ${id}`);
    return path.join(this.dir, 'runs', id);
  }

  logFile(id: string): string {
    return path.join(this.runDir(id), 'log.txt');
  }

  /** Adds or replaces a run's summary, newest first, and lets go of the oldest past the history's size. */
  put(s: RunSummary) {
    const i = this.runs.findIndex((x) => x.id === s.id);
    if (i >= 0) this.runs[i] = { ...s };
    else this.runs.unshift({ ...s });
    this.runs.sort((a, b) => b.startedAt - a.startedAt);
    const gone = this.runs.splice(this.keep);
    for (const g of gone) rmSync(this.runDir(g.id), { recursive: true, force: true });
    this.save();
  }

  private save() {
    const tmp = `${this.indexFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.runs, null, 1));
    renameSync(tmp, this.indexFile);
  }

  result(id: string): RunResult | undefined {
    if (!this.get(id)) return undefined;
    try {
      return JSON.parse(readFileSync(path.join(this.runDir(id), 'result.json'), 'utf8')) as RunResult;
    } catch {
      return undefined;
    }
  }

  summaryMd(id: string): string | undefined {
    if (!this.get(id)) return undefined;
    try {
      return readFileSync(path.join(this.runDir(id), 'summary.md'), 'utf8').slice(0, 64 * 1024);
    } catch {
      return undefined;
    }
  }

  /** The log from byte `from` on (at most LOG_CHUNK), and where to ask from next. */
  log(id: string, from: number): { text: string; next: number; size: number } | undefined {
    if (!this.get(id)) return undefined;
    const file = this.logFile(id);
    if (!existsSync(file)) return { text: '', next: 0, size: 0 };
    const size = statSync(file).size;
    const start = Math.max(0, Math.min(Number.isFinite(from) ? Math.floor(from) : 0, size));
    const len = Math.min(LOG_CHUNK, size - start);
    if (len <= 0) return { text: '', next: start, size };
    const buf = Buffer.alloc(len);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buf, 0, len, start);
    } finally {
      closeSync(fd);
    }
    return { text: buf.toString('utf8'), next: start + len, size };
  }

  /** A file the run left that the page may have (a screenshot, the summary): only a plain name in its own folder. */
  file(id: string, name: string): string | undefined {
    if (!this.get(id)) return undefined;
    const safe = safeFileName(name);
    if (!safe) return undefined;
    const p = path.join(this.runDir(id), safe);
    return path.dirname(p) === this.runDir(id) && existsSync(p) ? p : undefined;
  }
}
