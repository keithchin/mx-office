// A floor's acceptance records on disk: <data>/acceptance/<floor>.jsonl, append only, a line per accept
// or reopen, each hash-chained like the audit log's and the incidents' (prev: the sha256 of the line
// before; hash: its own without that field), so an edited, dropped or reordered line shows. Nothing is
// ever rewritten: reopening adds a line, and the record it reopened stays as it was.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { cyclesOf, type AcceptanceEntry, type Cycle } from '../../shared/acceptance.js';
import { sha256 } from '../audit/log.js';

export type AcceptanceLine = AcceptanceEntry & { at: number; prev: string; hash: string };

const FLOOR = /^[A-Za-z0-9_-]{1,64}$/;

export class AcceptanceStore {
  readonly file: string;
  private entries: AcceptanceLine[] = [];
  private lines: string[] = [];
  private size = -1;

  constructor(
    readonly dir: string,
    readonly floorId: string,
    private now: () => number = Date.now,
  ) {
    if (!FLOOR.test(floorId)) throw new Error(`not a floor id: ${floorId}`);
    this.file = path.join(dir, `${floorId}.jsonl`);
  }

  /** Reads the file again only when its size changed. */
  private load() {
    const size = existsSync(this.file) ? statSync(this.file).size : 0;
    if (size === this.size) return;
    this.size = size;
    this.entries = [];
    this.lines = [];
    if (!size) return;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const l = JSON.parse(line) as AcceptanceLine;
        if (l.op !== 'accept' && l.op !== 'reopen') continue;
        this.entries.push(l);
        this.lines.push(line);
      } catch {
        // A torn line: verify says so; reading skips it.
      }
    }
  }

  all(): readonly AcceptanceLine[] {
    this.load();
    return this.entries;
  }

  cycles(): Cycle[] {
    return cyclesOf(this.all());
  }

  /** Appends `entry`, chained to the line before. */
  append(entry: AcceptanceEntry): AcceptanceLine {
    this.load();
    const prev = this.lines.length ? sha256(this.lines[this.lines.length - 1]) : '';
    const body = { at: this.now(), ...entry, prev };
    const line = JSON.stringify({ ...body, hash: sha256(JSON.stringify(body)) });
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    appendFileSync(this.file, `${line}\n`, { mode: 0o600 });
    const out = JSON.parse(line) as AcceptanceLine;
    this.lines.push(line);
    this.entries.push(out);
    this.size = statSync(this.file).size;
    return out;
  }

  /** Whether every line fits its own hash and points at the one before it. */
  verify(): { ok: boolean; brokenAt?: number } {
    if (!existsSync(this.file)) return { ok: true };
    let prev = '';
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let l: Record<string, unknown>;
      try {
        l = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { ok: false };
      }
      const { hash, ...rest } = l;
      if (l.prev !== prev || sha256(JSON.stringify(rest)) !== hash) return { ok: false, brokenAt: typeof l.at === 'number' ? l.at : undefined };
      prev = sha256(line);
    }
    return { ok: true };
  }
}
