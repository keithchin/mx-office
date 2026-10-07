// The audit log on disk: a JSONL file per floor in the office's data dir (audit/<floor>.jsonl, and
// audit/_office.jsonl for the office's own), append only. Every line carries `prev`, the sha256 of
// the line before it, and `hash`, its own without that field, so an edited, dropped or reordered line
// breaks the chain (verify). Past the cap the oldest go to audit/archive/<floor>-<month>.jsonl, but
// never any from the last 90 days nor the newest 50k; the active file remembers where its chain
// continues from (audit/chain.json).

import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OFFICE_FLOOR, type AuditChain, type AuditEvent, type AuditInput } from '../../shared/audit.js';
import { cleanIds } from '../../shared/evidence/ids.js';

export const CAP_EVENTS = 50_000;
export const KEEP_DAYS = 90;
const DAY = 86_400_000;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** A floor's name as a file name. */
export const fileKey = (floor: string | undefined) => (floor || OFFICE_FLOOR).replace(/[^A-Za-z0-9._-]/g, '_');

interface Cached {
  size: number;
  events: AuditEvent[];
  /** The raw line of each event, for the chain. */
  lines: string[];
}

interface Verified {
  /** The text checked so far, by length and hash, so a later look only checks what was added. */
  chars: number;
  prefix: string;
  /** How many lines were checked, and the hash the next one has to point at. */
  n: number;
  last: string;
  result: AuditChain;
  /** The file's size in bytes and when it last changed, as checked; and when the whole of it was last checked. */
  bytes: number;
  mtimeMs: number;
  fullAt: number;
}

/**
 * The whole file is hashed again at most this often; in between, a file that only grew has only its new
 * lines checked. Hashing all of a big floor's log for every page of the Audit log blocked the server for
 * a quarter of a second each time (the performance guard, 2026-10-07).
 */
export const FULL_VERIFY_MS = 60_000;

export interface AuditLogOpts {
  now?: () => number;
  cap?: number;
  keepDays?: number;
}

export class AuditLog {
  readonly archiveDir: string;
  private cache = new Map<string, Cached>();
  private verified = new Map<string, Verified>();
  private seq = 0;
  private now: () => number;
  private cap: number;
  private keepMs: number;
  /** The count past which the next append looks at rotating again. */
  private nextCheck = new Map<string, number>();

  constructor(
    readonly dir: string,
    opts: AuditLogOpts = {},
  ) {
    this.archiveDir = path.join(dir, 'archive');
    this.now = opts.now ?? Date.now;
    this.cap = opts.cap ?? CAP_EVENTS;
    this.keepMs = (opts.keepDays ?? KEEP_DAYS) * DAY;
  }

  fileOf(floor: string | undefined) {
    return path.join(this.dir, `${fileKey(floor)}.jsonl`);
  }

  /** Every floor with a log, the office's own included (by file name). */
  floors(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.slice(0, -6));
    } catch {
      return [];
    }
  }

  /** Appends one event, chained to the one before it on its floor. */
  append(input: AuditInput): AuditEvent {
    const key = fileKey(input.floor);
    const c = this.load(key);
    const at = input.at ?? this.now();
    const id = `${at.toString(36).padStart(9, '0')}${(this.seq++ % 1296).toString(36).padStart(2, '0')}${randomBytes(3).toString('hex')}`;
    const prev = c.lines.length ? sha256(c.lines[c.lines.length - 1]) : this.anchor(key);
    const ids = cleanIds(input.ids);
    const body: Omit<AuditEvent, 'hash'> = {
      id,
      at,
      ...(input.floor ? { floor: input.floor } : {}),
      actor: input.actor,
      action: input.action,
      ...(input.target ? { target: input.target } : {}),
      summary: input.summary,
      ...(input.details && Object.keys(input.details).length ? { details: input.details } : {}),
      severity: input.severity ?? 'info',
      ...(ids ? { ids } : {}),
      prev,
    };
    const unhashed = JSON.stringify(body);
    const event = { ...body, hash: sha256(unhashed) } as AuditEvent;
    const line = JSON.stringify(event);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    appendFileSync(this.fileOf(input.floor), `${line}\n`, { mode: 0o600 });
    c.events.push(event);
    c.lines.push(line);
    c.size += Buffer.byteLength(line) + 1;
    if (c.lines.length > (this.nextCheck.get(key) ?? this.cap + this.slack())) this.rotate(key);
    return event;
  }

  /** A floor's events, oldest first (by file key: fileKey(floor)). Read again when the file changed underneath. */
  events(key: string): readonly AuditEvent[] {
    return this.load(key).events;
  }

  private slack() {
    return Math.max(1, Math.floor(this.cap / 10));
  }

  private load(key: string): Cached {
    const file = path.join(this.dir, `${key}.jsonl`);
    const size = existsSync(file) ? statSync(file).size : 0;
    const had = this.cache.get(key);
    if (had && had.size === size) return had;
    const c: Cached = { size, events: [], lines: [] };
    if (size) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          c.events.push(JSON.parse(line) as AuditEvent);
          c.lines.push(line);
        } catch {
          // A torn line: verify reports it; reading skips it.
        }
      }
    }
    this.cache.set(key, c);
    return c;
  }

  // ---- The chain -----------------------------------------------------------------------------------

  private chainFile() {
    return path.join(this.dir, 'chain.json');
  }

  private anchors(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.chainFile(), 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  /** The hash the active file's first line points at: the last one archived, or '' from the start. */
  private anchor(key: string): string {
    return this.anchors()[key] ?? '';
  }

  /**
   * Whether a floor's file is whole: each line's own hash fits it, and points at the one before (the
   * first at the archive's last). Read fresh from disk; only what was added since the last look is
   * checked again while the file only grew.
   */
  verify(key: string): AuditChain {
    const file = path.join(this.dir, `${key}.jsonl`);
    if (!existsSync(file)) return { ok: true };
    const st = statSync(file);
    const had = this.verified.get(key);
    // Not changed since the last look: the same answer.
    if (had && had.bytes === st.size && had.mtimeMs === st.mtimeMs) return had.result;
    // Only grown, and checked in full a moment ago: check the lines added.
    if (had && had.result.ok && st.size > had.bytes && this.now() - had.fullAt < FULL_VERIFY_MS) {
      const tail = readTail(file, had.bytes, st.size);
      if (tail !== undefined) {
        let { n, last } = had;
        let result: AuditChain = { ok: true };
        for (const line of tail.split('\n')) {
          if (!line.trim()) continue;
          const bad = checkLine(line, last);
          if (bad) {
            result = { ok: false, brokenAt: bad.at, brokenFloor: key };
            break;
          }
          last = sha256(line);
          n++;
        }
        this.verified.set(key, { ...had, chars: had.chars + tail.length, n, last, result, bytes: st.size, mtimeMs: st.mtimeMs });
        return result;
      }
    }
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n').filter((l) => l.trim());
    let n = 0;
    let last = this.anchor(key);
    if (had && had.result.ok && text.length >= had.chars && had.n <= lines.length && sha256(text.slice(0, had.chars)) === had.prefix) {
      n = had.n;
      last = had.last;
    }
    let result: AuditChain = { ok: true };
    for (; n < lines.length; n++) {
      const bad = checkLine(lines[n], last);
      if (bad) {
        result = { ok: false, brokenAt: bad.at, brokenFloor: key };
        break;
      }
      last = sha256(lines[n]);
    }
    this.verified.set(key, { chars: text.length, prefix: sha256(text), n, last, result, bytes: Buffer.byteLength(text), mtimeMs: st.mtimeMs, fullAt: this.now() });
    return result;
  }

  // ---- Rotation ------------------------------------------------------------------------------------

  /**
   * Moves the oldest events to the archive, by month: those older than the days kept, and only past
   * the newest `cap`. The lines move as they are, so the chain still holds across the two.
   */
  rotate(key: string) {
    const c = this.load(key);
    const cutoff = this.now() - this.keepMs;
    const firstRecent = c.events.findIndex((e) => e.at >= cutoff);
    const k = Math.min(firstRecent < 0 ? c.events.length : firstRecent, Math.max(0, c.events.length - this.cap));
    this.nextCheck.set(key, c.events.length - k + this.slack());
    if (k <= 0) return;
    mkdirSync(this.archiveDir, { recursive: true, mode: 0o700 });
    const byMonth = new Map<string, string[]>();
    for (let i = 0; i < k; i++) {
      const month = new Date(c.events[i].at).toISOString().slice(0, 7);
      const list = byMonth.get(month) ?? [];
      list.push(c.lines[i]);
      byMonth.set(month, list);
    }
    for (const [month, lines] of byMonth) appendFileSync(path.join(this.archiveDir, `${key}-${month}.jsonl`), `${lines.join('\n')}\n`, { mode: 0o600 });
    const anchors = this.anchors();
    anchors[key] = sha256(c.lines[k - 1]);
    writeFileSync(this.chainFile(), JSON.stringify(anchors), { mode: 0o600 });
    const file = path.join(this.dir, `${key}.jsonl`);
    const rest = c.lines.slice(k);
    writeFileSync(`${file}.tmp`, rest.length ? `${rest.join('\n')}\n` : '', { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    this.cache.delete(key);
    this.verified.delete(key);
  }
}

/** The bytes of `file` from `from` to `to` as text, when they start at a line's start (else undefined). */
function readTail(file: string, from: number, to: number): string | undefined {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(to - from + 1);
    // One byte before: the line before the new ones must have ended there.
    const got = readSync(fd, buf, 0, buf.length, from - 1);
    if (got < 1 || buf[0] !== 0x0a) return undefined;
    return buf.subarray(1, got).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** What's wrong with one line, given the hash it has to point at: undefined when nothing is. */
function checkLine(line: string, prev: string): { at?: number } | undefined {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return {};
  }
  const at = typeof e.at === 'number' ? e.at : undefined;
  const { hash, ...rest } = e;
  if (e.prev !== prev || typeof hash !== 'string' || sha256(JSON.stringify(rest)) !== hash) return { at };
  return undefined;
}
