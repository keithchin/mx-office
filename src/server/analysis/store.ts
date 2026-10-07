// The run records, kept in the office's own data folder (.agent-office/analysis/runs.jsonl) rather
// than a floor's, so a ranking spans every project the building has had. One JSON object a line, the
// whole file written again (to a temporary file, then renamed) when a record changes: there are tens
// of runs, not millions, and a reader never sees half a file. Puts in one go (settling every run a
// ranking looks at) are written once, after them, off the event loop: each put wrote the whole file
// and renamed it, 400 times on the big test office's first ranking (360 ms of renames on Windows).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunRecord } from '../../shared/analysis.js';

export class RunStore {
  readonly dir: string;
  private file: string;
  private runs = new Map<string, RunRecord>();
  /** A write is due (see put) / going now. */
  private due = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'analysis');
    this.file = path.join(this.dir, 'runs.jsonl');
    try {
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as RunRecord;
          if (r && typeof r.id === 'string' && typeof r.floor === 'string') this.runs.set(r.id, r);
        } catch {
          // a damaged line: skip it, keep the rest
        }
      }
    } catch {
      // no runs recorded yet
    }
  }

  all(): RunRecord[] {
    return [...this.runs.values()];
  }

  get(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  put(r: RunRecord) {
    this.runs.set(r.id, r);
    if (this.due) return;
    this.due = true;
    setImmediate(() => void this.writeSoon()).unref();
  }

  /** Every put so far on disk (the tests, and the office's exit). */
  async settled(): Promise<void> {
    while (this.due) await this.writeSoon();
    await this.writing;
  }

  private text(): string {
    return [...this.runs.values()].map((r) => JSON.stringify(r)).join('\n') + '\n';
  }

  private writeSoon(): Promise<void> {
    this.writing = this.writing.then(async () => {
      if (!this.due) return;
      this.due = false;
      try {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, this.text(), { mode: 0o600 });
        await rename(tmp, this.file);
      } catch {
        // disk issues shouldn't take the office down
      }
    });
    return this.writing;
  }

  /** Writes it now, at once (the office's exit). */
  flush() {
    if (!this.due) return;
    this.due = false;
    this.write();
  }

  private write() {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, this.text(), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
