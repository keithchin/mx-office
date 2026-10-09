// Every judgement Jeff makes, per floor, in the office's data dir (judge/<floor>.jsonl): what he said,
// what the office's own rule said, whether they agreed and whether it was acted on. Capped: past
// MAX_LINES the oldest are dropped down to KEEP_LINES. Text in it is already redacted and clipped.

import { dropKeys, forgetWith } from '../office/forget.js';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isJudgeKind, type JudgeRow } from '../../shared/judge.js';

export const MAX_LINES = 5000;
const KEEP_LINES = 4000;

export class JudgeLog {
  private counts = new Map<string, number>();
  /** Lets go of a deleted project's floor (office/forget.ts). */
  private readonly forgetsFloor = forgetWith(this, (o, f) => dropKeys(o.counts, f));

  constructor(
    readonly dir: string,
    private max = MAX_LINES,
    private keep = KEEP_LINES,
  ) {}

  private file(floorId: string) {
    return path.join(this.dir, `${floorId.replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`);
  }

  append(floorId: string, row: JudgeRow) {
    const file = this.file(floorId);
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      let n = this.counts.get(floorId) ?? (existsSync(file) ? this.read(floorId).length : 0);
      appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
      n++;
      if (n > this.max) {
        const rows = this.read(floorId).slice(-this.keep);
        writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
        n = rows.length;
      }
      this.counts.set(floorId, n);
    } catch (err) {
      console.error(`agent-office: couldn't log Jeff's judgement on ${floorId}: ${(err as Error).message}`);
    }
  }

  /** The floor's judgements, oldest first; a torn or foreign line is skipped. */
  read(floorId: string): JudgeRow[] {
    let raw = '';
    try {
      raw = readFileSync(this.file(floorId), 'utf8');
    } catch {
      return [];
    }
    const out: JudgeRow[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r && typeof r.at === 'number' && isJudgeKind(r.kind)) out.push(r);
      } catch {
        // half-written line
      }
    }
    return out;
  }
}
