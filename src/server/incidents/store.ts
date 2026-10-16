// The incidents on disk, in the office's data dir: incidents/incidents.jsonl, append only. A change is a
// line carrying the whole incident as it became; a rule firing into an open incident again is a small
// 'recur' line with only what changed (recur.ts), folded onto the incident when the file is read, so a
// stall that recurs all day no longer copies the whole incident and its timeline each time. The newest
// state per id is the incident now. Every line is hash-chained like the audit log's (prev: the sha256 of
// the line before it; hash: its own without that field), so an edited or dropped line shows. An office
// from before 'recur' lines skips them when it reads (it doesn't know the op) and still verifies them.
//
// Verifying the chain means hashing the whole file, which is far too slow for a page load (GET
// /api/incidents did it on every request: 0.7 to 6 s with the event loop blocked, and each stall that
// caused was itself recorded as a recurrence, growing the file). So it is verified once, off the event
// loop's critical path (the file read async, the lines hashed a slice at a time between turns), and the
// result is kept: a line this process appends extends it (hashing that line only), and only a file that
// changed some other way (its size or mtime not what this process left) is verified again, the same way.
// The route returns the state kept (`checking` while a verification runs). The rules' settings are
// incidents/settings.json.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { normalizeSettings, type Incident, type IncidentSettings } from '../../shared/incidents.js';
import { sha256 } from '../audit/log.js';
import { foldRecur, type RecurDelta } from './recur.js';

export interface IncidentLine {
  at: number;
  /** 'reopen': a rule brought a resolved incident back (index.ts raise), a full copy like 'update', which an office from before it reads as one. */
  op: 'create' | 'update' | 'resolve' | 'seed' | 'recur' | 'reopen';
  by: string;
  /** Every op but 'recur': the incident as it became. */
  incident?: Incident;
  /** 'recur': which incident, and what changed. */
  id?: string;
  recur?: RecurDelta;
  prev: string;
  hash: string;
}

export interface ChainState {
  ok: boolean;
  brokenAt?: number;
  /** Being verified now (the file changed since it was last verified, or never was): `ok` is the last result. */
  checking?: boolean;
}

/** How long a slice of hashing may hold the event loop before it lets others in. */
const SLICE_MS = 8;

export class IncidentStore {
  readonly file: string;
  private byId = new Map<string, Incident>();
  private lastLine = '';
  private size = -1;
  private top = 0;
  /** The chain as last verified, up to `verifiedSize` bytes with the file's mtime then; undefined until verified once. */
  private chain: { ok: boolean; brokenAt?: number } | undefined;
  private verifiedSize = -1;
  private verifiedMtime = -1;
  /** The hash of the last line verified (what the next line's prev must be). */
  private verifiedLast = '';
  private verifying: Promise<ChainState> | undefined;

  constructor(
    readonly dir: string,
    private now: () => number = Date.now,
  ) {
    this.file = path.join(dir, 'incidents.jsonl');
  }

  /** Whether there's a file yet (the seed goes in only when there isn't). */
  exists(): boolean {
    return existsSync(this.file);
  }

  private load() {
    const size = this.exists() ? statSync(this.file).size : 0;
    if (size === this.size) return;
    this.size = size;
    this.byId.clear();
    this.lastLine = '';
    this.top = 0;
    if (!size) return;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const l = JSON.parse(line) as IncidentLine;
        if (l.op === 'recur') {
          const was = l.id ? this.byId.get(l.id) : undefined;
          if (was && l.recur) this.byId.set(was.id, foldRecur(was, l.recur));
        } else {
          if (!l.incident?.id) continue;
          this.byId.set(l.incident.id, l.incident);
          this.top = Math.max(this.top, l.incident.number || 0);
        }
        this.lastLine = line;
      } catch {
        // A torn line: verify says so; reading skips it.
      }
    }
  }

  list(): Incident[] {
    this.load();
    return [...this.byId.values()];
  }

  get(id: string): Incident | undefined {
    this.load();
    return this.byId.get(id);
  }

  /** The next INC- number. */
  nextNumber(): number {
    this.load();
    return this.top + 1;
  }

  /** Appends a line chained to the one before; the kept chain state follows it when it was current. */
  private append(body: Omit<IncidentLine, 'prev' | 'hash'>) {
    this.load();
    const prev = this.lastLine ? sha256(this.lastLine) : '';
    const full = { ...body, prev };
    const line = JSON.stringify({ ...full, hash: sha256(JSON.stringify(full)) });
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const before = this.size;
    // Whether what's verified is exactly the file as it was (nobody else touched it): then this line extends it.
    const current = this.chain !== undefined && !this.verifying && this.verifiedSize === before && this.mtimeNow() === this.verifiedMtime;
    appendFileSync(this.file, `${line}\n`, { mode: 0o600 });
    this.lastLine = line;
    const st = statSync(this.file);
    this.size = st.size;
    if (current) {
      // Its prev is the hash of the line before it, which is what verified last (a broken chain stays broken).
      if (this.chain!.ok && prev !== this.verifiedLast) this.chain = { ok: false, brokenAt: body.at };
      this.verifiedLast = sha256(line);
      this.verifiedSize = st.size;
      this.verifiedMtime = st.mtimeMs;
    }
  }

  private mtimeNow(): number {
    try {
      return statSync(this.file).mtimeMs;
    } catch {
      return -1;
    }
  }

  /** Writes `incident` as it is now, chained to the line before. */
  put(incident: Incident, op: Exclude<IncidentLine['op'], 'recur'>, by: string): Incident {
    this.append({ at: this.now(), op, by, incident });
    this.byId.set(incident.id, incident);
    this.top = Math.max(this.top, incident.number);
    return incident;
  }

  /** A rule fired into incident `id` again: a small line with what changed, folded onto it. Undefined when there's no such incident. */
  recur(id: string, delta: RecurDelta, by: string): Incident | undefined {
    const was = this.get(id);
    if (!was) return undefined;
    this.append({ at: this.now(), op: 'recur', by, id, recur: delta });
    const now = foldRecur(was, delta);
    this.byId.set(id, now);
    return now;
  }

  /**
   * Whether every line fits its own hash and points at the one before it, as last verified: never reads
   * or hashes the file itself. When the file changed since (or was never verified), a verification starts
   * in the background and the answer says `checking`.
   */
  verify(): ChainState {
    if (!this.exists()) return { ok: true };
    let st: { size: number; mtimeMs: number };
    try {
      st = statSync(this.file);
    } catch {
      return { ok: true };
    }
    if (this.chain && !this.verifying && st.size === this.verifiedSize && st.mtimeMs === this.verifiedMtime) return { ...this.chain };
    void this.verified().catch(() => undefined);
    return { ...(this.chain ?? { ok: true }), checking: true };
  }

  /** The chain verified against the file as it is now (one verification at a time; a fresh one when the file changed under it). */
  verified(): Promise<ChainState> {
    if (this.verifying) return this.verifying;
    // A file taken away mid-read (a test office deleted) is no file: nothing to verify, never an unhandled rejection.
    const run = this.verifyFile()
      .catch((e: NodeJS.ErrnoException) => {
        if (e?.code !== 'ENOENT') throw e;
        this.chain = { ok: true };
        this.verifiedSize = 0;
        this.verifiedMtime = -1;
        this.verifiedLast = '';
        return { ok: true };
      })
      .finally(() => {
        if (this.verifying === run) this.verifying = undefined;
      });
    this.verifying = run;
    return run;
  }

  private async verifyFile(): Promise<ChainState> {
    for (let tries = 0; ; tries++) {
      if (!this.exists()) {
        this.chain = { ok: true };
        this.verifiedSize = 0;
        this.verifiedMtime = -1;
        this.verifiedLast = '';
        return { ok: true };
      }
      const before = await stat(this.file);
      const buf = await readFile(this.file);
      const after = await stat(this.file);
      // Appended to while it was read: read it again (a few times at most, then go with what was read).
      if ((buf.length !== after.size || before.mtimeMs !== after.mtimeMs) && tries < 3) continue;
      const r = await chainOf(buf.toString('utf8'));
      this.chain = r.state;
      this.verifiedLast = r.last;
      this.verifiedSize = buf.length;
      this.verifiedMtime = after.mtimeMs;
      // This process appended while the lines were being hashed: those lines aren't in it, so look again.
      if (statSync(this.file).size !== buf.length && tries < 3) continue;
      return { ...r.state };
    }
  }

  settings(): IncidentSettings {
    try {
      return normalizeSettings(JSON.parse(readFileSync(path.join(this.dir, 'settings.json'), 'utf8')));
    } catch {
      return normalizeSettings(undefined);
    }
  }

  setSettings(s: unknown): IncidentSettings {
    const clean = normalizeSettings(s);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(this.dir, 'settings.json'), JSON.stringify(clean, null, 2), { mode: 0o600 });
    return clean;
  }
}

const turn = () => new Promise<void>((r) => setImmediate(r));

/** The chain of `text`'s lines, checked a slice at a time between turns of the event loop; and the hash of its last line. */
export async function chainOf(text: string): Promise<{ state: { ok: boolean; brokenAt?: number }; last: string }> {
  let prev = '';
  let started = performance.now();
  let from = 0;
  while (from < text.length) {
    let end = text.indexOf('\n', from);
    if (end < 0) end = text.length;
    const line = text.slice(from, end);
    from = end + 1;
    if (!line.trim()) continue;
    let l: Record<string, unknown>;
    try {
      l = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return { state: { ok: false }, last: prev };
    }
    const { hash, ...rest } = l;
    if (l.prev !== prev || sha256(JSON.stringify(rest)) !== hash) return { state: { ok: false, ...(typeof l.at === 'number' ? { brokenAt: l.at } : {}) }, last: prev };
    prev = sha256(line);
    if (performance.now() - started > SLICE_MS) {
      await turn();
      started = performance.now();
    }
  }
  return { state: { ok: true }, last: prev };
}
