// A floor's quality records on disk: <data>/testing/quality/<floor>.jsonl, append only, hash-chained like
// the test-run records (store.ts), one per commit and mxcli version (the source key): a second run of the
// same pair is skipped, never written twice. Everything here can be worked out again by running mxcli on
// that commit, so nothing needs durable-write guarantees.

import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from '../../shared/evidence/ids.js';
import type { QualityDraft, QualityRecord } from '../../shared/testing/quality.js';
import { sha256 } from '../audit/log.js';

const FLOOR = /^[A-Za-z0-9_-]{1,64}$/;

export class QualityStore {
  readonly file: string;
  private records: QualityRecord[] = [];
  private last = '';
  private keys = new Set<string>();
  private size = -1;
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

  private async load() {
    const size = await stat(this.file).then(
      (s) => s.size,
      () => 0,
    );
    if (size === this.size) return;
    const text = size ? await readFile(this.file, 'utf8').catch(() => '') : '';
    this.size = size;
    this.records = [];
    this.keys = new Set();
    this.last = '';
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as QualityRecord;
        if (typeof r.sourceKey !== 'string' || typeof r.commit !== 'string') continue;
        this.records.push(r);
        this.keys.add(r.sourceKey);
        this.last = line;
      } catch {
        // A torn line: skipped.
      }
    }
  }

  /** Every record, oldest first. */
  all(): Promise<readonly QualityRecord[]> {
    return this.serial(async () => {
      await this.load();
      return this.records;
    });
  }

  async has(key: string): Promise<boolean> {
    return this.serial(async () => {
      await this.load();
      return this.keys.has(key);
    });
  }

  /** Keeps the draft unless its commit and mxcli version are already here; the record, or undefined when skipped. */
  ingest(d: QualityDraft): Promise<QualityRecord | undefined> {
    return this.serial(async () => {
      await this.load();
      if (this.keys.has(d.sourceKey)) return undefined;
      const at = this.now();
      const body = { schemaVersion: 1 as const, id: `qr_${ulid(at)}`, ...d, ingestedAt: at, prev: this.last ? sha256(this.last) : '' };
      const line = JSON.stringify({ ...body, hash: sha256(JSON.stringify(body)) });
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await appendFile(this.file, `${line}\n`, { mode: 0o600 });
      this.size += Buffer.byteLength(`${line}\n`);
      const rec = JSON.parse(line) as QualityRecord;
      this.records.push(rec);
      this.keys.add(d.sourceKey);
      this.last = line;
      return rec;
    });
  }
}
