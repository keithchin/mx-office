// Where a project's toolkit commit is written down. Two places, for two readers:
//   - committed: `toolkit` in agent-office.project.json at the project's root (with its history), so it
//     survives clones, another office opening the project sees it, and agents can read it;
//   - the office's own book, <data>/toolkit-pins.json: floor → pin, what the office runs gate-check and
//     writes Playbooks with, read without git.
// Also the toolkit's own record of it, PROJECT.md's `Toolkit commit: <sha>` line (the session ack that
// gate-check's protocol-freshness check reads), which the Update toolkit action moves along with the pin.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ToolkitHistoryEntry, ToolkitPinRecord } from '../../shared/toolkit.js';

/** The project's committed settings file (wizard/steps.ts writes the rest of it). */
export const PROJECT_FILE = 'agent-office.project.json';
const HISTORY_MAX = 40;

/** The `toolkit` record in an agent-office.project.json's text, when it has a valid one. */
export function recordOf(json: string | undefined): ToolkitPinRecord | undefined {
  if (!json) return undefined;
  try {
    const t = (JSON.parse(json) as { toolkit?: Partial<ToolkitPinRecord> }).toolkit;
    if (!t || typeof t.commit !== 'string' || !/^[0-9a-f]{7,40}$/i.test(t.commit)) return undefined;
    return { commit: t.commit, at: String(t.at ?? ''), by: String(t.by ?? ''), ...(t.repo ? { repo: String(t.repo) } : {}), history: Array.isArray(t.history) ? t.history.slice(-HISTORY_MAX) : [] };
  } catch {
    return undefined;
  }
}

/** The file's text with `toolkit` set to `rec` (the other settings kept as they are). */
export function withRecord(json: string | undefined, rec: ToolkitPinRecord): string {
  let obj: Record<string, unknown> = {};
  try {
    obj = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    // a broken file: written afresh with the record
  }
  return `${JSON.stringify({ ...obj, toolkit: rec }, null, 2)}\n`;
}

/** The record after moving to `commit`: the move appended to its history. */
export function nextRecord(prev: ToolkitPinRecord | undefined, commit: string, by: string, action: ToolkitHistoryEntry['action'], repo?: string, at = new Date().toISOString()): ToolkitPinRecord {
  const history = [...(prev?.history ?? []), { commit, at, by, action, ...(prev?.commit && prev.commit !== commit ? { from: prev.commit } : {}) }].slice(-HISTORY_MAX);
  return { commit, at, by, ...(repo ?? prev?.repo ? { repo: repo ?? prev?.repo } : {}), history };
}

/** The commit before the current one in a record's history (what Roll back goes to). */
export function previousOf(rec: ToolkitPinRecord | undefined): string | undefined {
  const h = rec?.history ?? [];
  for (let i = h.length - 1; i >= 0; i--) if (h[i].commit !== rec!.commit) return h[i].commit;
  return undefined;
}

/** PROJECT.md's `Toolkit commit: <sha>` (the toolkit's session ack), when it names one. */
export const ackOf = (register: string | undefined) => (register ? /Toolkit commit:\s*([0-9a-f]{7,40})\b/i.exec(register)?.[1] : undefined);

/** PROJECT.md with its `Toolkit commit:` line set to `sha` (short), or unchanged when it has no such line. */
export function withAck(register: string, sha: string): string {
  return register.replace(/(Toolkit commit:)[ \t]*[^\r\n]*/, `$1 ${sha.slice(0, 7)}`);
}

// ---- The office's book --------------------------------------------------------------------------

export interface BookEntry {
  commit: string;
  floorDir: string;
  at: number;
  previous?: string;
}

interface BookFile {
  floors: Record<string, BookEntry>;
  fetchedAt?: number;
}

/** The office's floor → pin map, saved in <data>/toolkit-pins.json. */
export class PinBook {
  private data: BookFile = { floors: {} };

  constructor(private file?: string) {
    if (!file) return;
    try {
      const d = JSON.parse(readFileSync(file, 'utf8')) as Partial<BookFile>;
      this.data = { floors: d.floors && typeof d.floors === 'object' ? d.floors : {}, fetchedAt: typeof d.fetchedAt === 'number' ? d.fetchedAt : undefined };
    } catch {
      // first time
    }
  }

  get(floor: string): BookEntry | undefined {
    return this.data.floors[floor];
  }

  /** The entry whose floor folder is `dir`. */
  byDir(dir: string): BookEntry | undefined {
    const want = path.resolve(dir).toLowerCase();
    return Object.values(this.data.floors).find((e) => path.resolve(e.floorDir).toLowerCase() === want);
  }

  set(floor: string, e: BookEntry) {
    this.data.floors[floor] = e;
    this.save();
  }

  /** Takes a deleted project's floor out of the book; gives back what it had. */
  remove(floor: string): BookEntry | undefined {
    const had = this.data.floors[floor];
    if (!had) return undefined;
    delete this.data.floors[floor];
    this.save();
    return had;
  }

  all(): BookEntry[] {
    return Object.values(this.data.floors);
  }

  get fetchedAt() {
    return this.data.fetchedAt;
  }

  set fetchedAt(at: number | undefined) {
    this.data.fetchedAt = at;
    this.save();
  }

  private save() {
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
      renameSync(tmp, this.file);
    } catch (err) {
      console.warn(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}

const folderCache = new Map<string, { key: string; rec?: ToolkitPinRecord }>();

/** The record in the floor folder's own agent-office.project.json (a small read, remembered until the file changes). */
export function folderRecord(floorDir: string): ToolkitPinRecord | undefined {
  const f = path.join(floorDir, PROJECT_FILE);
  if (!existsSync(f)) return undefined;
  let key = '';
  try {
    const s = statSync(f);
    key = `${s.mtimeMs}:${s.size}`;
  } catch {
    return undefined;
  }
  const hit = folderCache.get(f);
  if (hit?.key === key) return hit.rec;
  let rec: ToolkitPinRecord | undefined;
  try {
    rec = recordOf(readFileSync(f, 'utf8'));
  } catch {
    rec = undefined;
  }
  folderCache.set(f, { key, rec });
  return rec;
}
