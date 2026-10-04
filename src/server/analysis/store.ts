// The run records, kept in the office's own data folder (.agent-office/analysis/runs.jsonl) rather
// than a floor's, so a ranking spans every project the building has had. One JSON object a line, the
// whole file written again (to a temporary file, then renamed) when a record changes: there are tens
// of runs, not millions, and a reader never sees half a file.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunRecord } from '../../shared/analysis.js';

export class RunStore {
  readonly dir: string;
  private file: string;
  private runs = new Map<string, RunRecord>();

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
    this.write();
  }

  private write() {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, [...this.runs.values()].map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
