// The answer store (Slice 1B-1): the authoritative history of what the person decided, per floor,
// <data>/answers/<floor>.jsonl. Append only, a line per revision with its full text (up to 20 kB), each
// hash-chained like the acceptance records (acceptance/store.ts: prev is the sha256 of the line before,
// hash is the line's own without that field), so an edited, dropped or reordered line shows. Each line
// is written with an fsync'd append that the caller awaits (one per answer), off the event loop, one at
// a time per floor so the chain holds.
//
// The audit log redacts and truncates; the escalation's resolution and the questions book keep only a
// pointer ({answerRev, dispatchId}) and a bounded copy. This file is where the whole text lives.
// Durability is the critical write's (flow/critical-write.ts): process-crash safe, power loss not claimed.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { ANSWER_TEXT_MAX, type AnswerRevision, type DecisionRef } from '../../shared/dispatch.js';
import { sha256 } from '../audit/log.js';

export type AnswerLine = AnswerRevision & { prev: string; hash: string };

const FLOOR = /^[A-Za-z0-9_.-]{1,64}$/;

/** The file operations the append uses (a test's, to make one fail). */
export interface AppendFs {
  open: typeof fsp.open;
  mkdir: typeof fsp.mkdir;
  readFile: typeof fsp.readFile;
}

interface FloorAnswers {
  lines: AnswerLine[];
  last: string;
  /** The newest revision per decision. */
  latest: Map<DecisionRef, AnswerLine>;
}

export class AnswerStore {
  private floors = new Map<string, FloorAnswers>();
  private loading = new Map<string, Promise<FloorAnswers>>();
  private chains = new Map<string, Promise<unknown>>();

  constructor(
    readonly dir: string,
    private fs: AppendFs = fsp as unknown as AppendFs,
  ) {}

  file(floorId: string) {
    if (!FLOOR.test(floorId)) throw new Error(`not a project id: ${floorId}`);
    return path.join(this.dir, `${floorId}.jsonl`);
  }

  /** Reads the floor's file once (asynchronously); the copy in memory is kept up to date by append. */
  load(floorId: string): Promise<void> {
    if (this.floors.has(floorId)) return Promise.resolve();
    let p = this.loading.get(floorId);
    if (!p) {
      p = this.read(floorId).then((f) => {
        this.floors.set(floorId, f);
        this.loading.delete(floorId);
        return f;
      });
      this.loading.set(floorId, p);
    }
    return p.then(() => undefined);
  }

  private async read(floorId: string): Promise<FloorAnswers> {
    const out: FloorAnswers = { lines: [], last: '', latest: new Map() };
    let text = '';
    try {
      text = String(await this.fs.readFile(this.file(floorId), 'utf8'));
    } catch {
      return out;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const l = JSON.parse(line) as AnswerLine;
        if (typeof l.decision !== 'string' || typeof l.rev !== 'number') continue;
        out.lines.push(l);
        out.last = line;
        const had = out.latest.get(l.decision);
        if (!had || had.rev < l.rev) out.latest.set(l.decision, l);
      } catch {
        // A torn last line (a crash mid-append): verify says so; reading skips it.
      }
    }
    return out;
  }

  private loaded(floorId: string): FloorAnswers {
    const f = this.floors.get(floorId);
    if (!f) throw new Error(`answers for ${floorId} not loaded`);
    return f;
  }

  /** The decision's current revision number (0: never answered). Call after load. */
  rev(floorId: string, decision: DecisionRef): number {
    return this.floors.get(floorId)?.latest.get(decision)?.rev ?? 0;
  }

  /** The decision's newest revision, if any. Call after load. */
  latest(floorId: string, decision: DecisionRef): AnswerLine | undefined {
    return this.floors.get(floorId)?.latest.get(decision);
  }

  /** Every revision of a decision, oldest first (the full history). */
  async history(floorId: string, decision: DecisionRef): Promise<AnswerLine[]> {
    await this.load(floorId);
    return this.loaded(floorId).lines.filter((l) => l.decision === decision);
  }

  /** Every line, oldest first. */
  async all(floorId: string): Promise<readonly AnswerLine[]> {
    await this.load(floorId);
    return this.loaded(floorId).lines;
  }

  /**
   * Appends the next revision of `r.decision` (its rev is the current one plus one), chained to the line
   * before, fsync'd before it resolves. Rejects (and changes nothing in memory) when the disk refused.
   */
  append(floorId: string, r: Omit<AnswerRevision, 'rev'>): Promise<AnswerLine> {
    const prevChain = this.chains.get(floorId) ?? Promise.resolve();
    const next = prevChain
      .catch(() => undefined)
      .then(async () => {
        await this.load(floorId);
        const f = this.loaded(floorId);
        const rev = (f.latest.get(r.decision)?.rev ?? 0) + 1;
        const body = { ...r, text: r.text.slice(0, ANSWER_TEXT_MAX), rev, prev: f.last ? sha256(f.last) : '' };
        const line = JSON.stringify({ ...body, hash: sha256(JSON.stringify(body)) });
        await this.fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
        const h = await this.fs.open(this.file(floorId), 'a', 0o600);
        try {
          await h.writeFile(`${line}\n`);
          await h.sync();
        } finally {
          await h.close();
        }
        const out = JSON.parse(line) as AnswerLine;
        f.lines.push(out);
        f.last = line;
        f.latest.set(out.decision, out);
        return out;
      });
    this.chains.set(floorId, next);
    return next;
  }

  /** Whether every line fits its own hash and points at the one before it. */
  async verify(floorId: string): Promise<{ ok: boolean; brokenAt?: number }> {
    let text = '';
    try {
      text = String(await this.fs.readFile(this.file(floorId), 'utf8'));
    } catch {
      return { ok: true };
    }
    let prev = '';
    let n = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      n++;
      let l: Record<string, unknown>;
      try {
        l = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { ok: false, brokenAt: n };
      }
      const { hash, ...rest } = l;
      if (l.prev !== prev || sha256(JSON.stringify(rest)) !== hash) return { ok: false, brokenAt: n };
      prev = sha256(line);
    }
    return { ok: true };
  }
}
