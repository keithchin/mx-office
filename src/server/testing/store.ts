// A floor's test-run records on disk: <data>/testing/<floor>.jsonl, append only, a line per record,
// hash-chained like the audit log's and the acceptance records' (prev: the sha256 of the line before;
// hash: its own without that field), so an edited, dropped or reordered line shows. Ingestion is
// idempotent by source key: a run or report read again is skipped, never written twice. Nothing is ever
// rewritten, and everything here can be derived again from its sources (Testing release 1 needs no
// durable-write guarantees). All file work is asynchronous, and appends to a floor go one at a time.

import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from '../../shared/evidence/ids.js';
import type { TestRunDraft, TestRunRecord } from '../../shared/testing/record.js';
import { sha256 } from '../audit/log.js';

export type TestRunLine = TestRunRecord & { prev: string; hash: string };

const FLOOR = /^[A-Za-z0-9_-]{1,64}$/;

export class TestRunStore {
  readonly file: string;
  private records: TestRunLine[] = [];
  private lines: string[] = [];
  private keys = new Set<string>();
  private size = -1;
  /** Loads and appends, one after another. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly dir: string,
    readonly floorId: string,
    private now: () => number = Date.now,
  ) {
    if (!FLOOR.test(floorId)) throw new Error(`not a floor id: ${floorId}`);
    this.file = path.join(dir, `${floorId}.jsonl`);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /** Reads the file again only when its size changed underneath. */
  private async load() {
    const size = await stat(this.file).then(
      (s) => s.size,
      () => 0,
    );
    if (size === this.size) return;
    const text = size ? await readFile(this.file, 'utf8').catch(() => '') : '';
    this.size = size;
    this.records = [];
    this.lines = [];
    this.keys = new Set();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as TestRunLine;
        if (typeof r.sourceKey !== 'string' || typeof r.id !== 'string') continue;
        this.records.push(r);
        this.lines.push(line);
        this.keys.add(r.sourceKey);
      } catch {
        // A torn line: verify says so; reading skips it.
      }
    }
  }

  /** Every record, oldest first. */
  all(): Promise<readonly TestRunLine[]> {
    return this.serial(async () => {
      await this.load();
      return this.records;
    });
  }

  /** The newest record's id, or undefined with none. */
  async newestId(): Promise<string | undefined> {
    return (await this.all()).at(-1)?.id;
  }

  /** Takes in each draft whose source key isn't here yet; hands back the records it added. */
  ingest(drafts: readonly TestRunDraft[]): Promise<TestRunRecord[]> {
    if (!drafts.length) return Promise.resolve([]);
    return this.serial(async () => {
      await this.load();
      const added: TestRunRecord[] = [];
      let out = '';
      for (const d of drafts) {
        if (this.keys.has(d.sourceKey)) continue;
        const at = this.now();
        const prev = this.lines.length ? sha256(this.lines[this.lines.length - 1]) : '';
        const body = { schemaVersion: 1 as const, id: `tr_${ulid(at)}`, ...d, ingestedAt: at, prev };
        const line = JSON.stringify({ ...body, hash: sha256(JSON.stringify(body)) });
        const rec = JSON.parse(line) as TestRunLine;
        this.lines.push(line);
        this.records.push(rec);
        this.keys.add(d.sourceKey);
        added.push(rec);
        out += `${line}\n`;
      }
      if (!out) return added;
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await appendFile(this.file, out, { mode: 0o600 });
      this.size += Buffer.byteLength(out);
      return added;
    });
  }

  /** Whether every line fits its own hash and points at the one before it. */
  async verify(): Promise<{ ok: boolean; brokenAt?: string }> {
    const text = await readFile(this.file, 'utf8').catch(() => '');
    let prev = '';
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let l: Record<string, unknown>;
      try {
        l = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { ok: false };
      }
      const { hash, ...rest } = l;
      if (l.prev !== prev || sha256(JSON.stringify(rest)) !== hash) return { ok: false, brokenAt: String(l.id ?? '') };
      prev = sha256(line);
    }
    return { ok: true };
  }
}
