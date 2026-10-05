// A floor's chatter on disk, in the office's data dir: chatter/<floor>.jsonl (one message a line,
// appended as they happen, cut back to the newest when it grows past the cap) and chatter/<floor>.state.json
// (what the sources have already turned into messages, and each journal's cursor). Never throws on a
// bad line or a missing file: that's no messages.

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatterMessage } from '../../shared/chatter.js';

/** Messages kept per floor; past it the file is cut back to KEEP_AFTER_CUT. */
export const CHATTER_CAP = 1000;
const KEEP_AFTER_CUT = 800;
/** Source keys are forgotten this long after their message: the sources skip anything older anyway. */
export const SEEN_KEPT_MS = 8 * 86_400_000;

export interface ChatterState {
  /** Source key → when its message was. */
  seen: Record<string, number>;
  /** Per team, the journal entries already read (date|heading#n). */
  journals: Record<string, string[]>;
}

const safe = (id: string) => id.replace(/[^A-Za-z0-9_.-]/g, '_');

export class ChatterFile {
  private list?: ChatterMessage[];
  private st?: ChatterState;
  private dir: string;

  constructor(dataDir: string, readonly floor: string, private cap = CHATTER_CAP) {
    this.dir = path.join(dataDir, 'chatter');
  }

  private get file() {
    return path.join(this.dir, `${safe(this.floor)}.jsonl`);
  }
  private get stateFile() {
    return path.join(this.dir, `${safe(this.floor)}.state.json`);
  }

  messages(): ChatterMessage[] {
    if (this.list) return this.list;
    const out: ChatterMessage[] = [];
    try {
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line) as ChatterMessage;
          if (m && typeof m.id === 'string' && typeof m.at === 'number') out.push(m);
        } catch {
          // a torn line: skip it
        }
      }
    } catch {
      // no file yet
    }
    this.list = out.slice(-this.cap);
    return this.list;
  }

  add(m: ChatterMessage) {
    const list = this.messages();
    list.push(m);
    try {
      mkdirSync(this.dir, { recursive: true });
      if (list.length > this.cap) {
        // Oldest first by time, so what's cut is what's oldest even when a message came in late.
        const keep = [...list].sort((a, b) => a.at - b.at).slice(-Math.min(KEEP_AFTER_CUT, this.cap));
        list.splice(0, list.length, ...keep);
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, keep.map((x) => JSON.stringify(x)).join('\n') + '\n');
        renameSync(tmp, this.file);
      } else appendFileSync(this.file, `${JSON.stringify(m)}\n`);
    } catch (err) {
      console.error(`agent-office: couldn't save the ${this.floor} chatter: ${(err as Error).message}`);
    }
  }

  state(): ChatterState {
    if (this.st) return this.st;
    let raw: Partial<ChatterState> = {};
    try {
      raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Partial<ChatterState>;
    } catch {
      // first time
    }
    this.st = { seen: raw.seen ?? {}, journals: raw.journals ?? {} };
    return this.st;
  }

  saveState(now: number) {
    const st = this.state();
    for (const [k, at] of Object.entries(st.seen)) if (now - at > SEEN_KEPT_MS) delete st.seen[k];
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(st));
      renameSync(tmp, this.stateFile);
    } catch (err) {
      console.error(`agent-office: couldn't save the ${this.floor} chatter state: ${(err as Error).message}`);
    }
  }
}
