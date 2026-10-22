// A project's security record, <data>/security/<project>.json: its security policy (when it isn't the
// default: who set it, when and why), the security states read per revision (the newest few, each with its
// commit) and the mx check results per revision (each with its commit, verdict and error codes). Written
// through the durable write (temp file, fsync, rename), serialised per project; read once, then kept.
// Deleting the file is the rollback: the project is back on the default policy with nothing read yet.

import path from 'node:path';
import { readJsonStore } from '../durable/read.js';
import { writeJsonDurable } from '../durable/write.js';
import { cleanPolicy, DEFAULT_POLICY, type MxCheckResult, type SecurityPolicy, type SecurityState } from '../../shared/security.js';

export const KEEP_READS = 10;
export const KEEP_CHECKS = 20;

export interface SecurityRecord {
  policy?: SecurityPolicy;
  reads: SecurityState[];
  checks: MxCheckResult[];
}

const SHA = /^[0-9a-f]{7,64}$/;
const isRead = (v: unknown): v is SecurityState => !!v && typeof v === 'object' && SHA.test(String((v as SecurityState).commit)) && typeof (v as SecurityState).readAt === 'number';
const isCheck = (v: unknown): v is MxCheckResult => !!v && typeof v === 'object' && SHA.test(String((v as MxCheckResult).commit)) && ['pass', 'fail', 'error'].includes(String((v as MxCheckResult).status));

export function cleanRecord(v: unknown): SecurityRecord {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return {
    ...(o.policy ? { policy: cleanPolicy(o.policy) } : {}),
    reads: Array.isArray(o.reads) ? o.reads.filter(isRead).slice(-KEEP_READS) : [],
    checks: Array.isArray(o.checks) ? o.checks.filter(isCheck).slice(-KEEP_CHECKS) : [],
  };
}

const FLOOR = /^[A-Za-z0-9_.-]{1,80}$/;

export class SecurityStore {
  private cache = new Map<string, Promise<SecurityRecord>>();
  private chains = new Map<string, Promise<unknown>>();
  constructor(readonly dir: string) {}

  file(floorId: string): string {
    if (!FLOOR.test(floorId)) throw new Error(`not a project id: ${floorId}`);
    return path.join(this.dir, `${floorId}.json`);
  }

  get(floorId: string): Promise<SecurityRecord> {
    let p = this.cache.get(floorId);
    if (!p) {
      p = readJsonStore(this.file(floorId)).then((r) => cleanRecord(r.state === 'ok' ? r.value : {}), () => cleanRecord({}));
      this.cache.set(floorId, p);
    }
    return p;
  }

  async policy(floorId: string): Promise<SecurityPolicy> {
    return (await this.get(floorId)).policy ?? DEFAULT_POLICY;
  }

  /** Changes the record with `fn` and writes it, one change at a time per project. */
  update(floorId: string, fn: (r: SecurityRecord) => SecurityRecord): Promise<SecurityRecord> {
    const prev = this.chains.get(floorId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const r = fn(await this.get(floorId));
        await writeJsonDurable(this.file(floorId), r);
        this.cache.set(floorId, Promise.resolve(r));
        return r;
      });
    this.chains.set(floorId, next);
    return next;
  }

  /** Keeps a state read at a commit (the newest KEEP_READS; one per commit). */
  addRead(floorId: string, s: SecurityState): Promise<SecurityRecord> {
    return this.update(floorId, (r) => ({ ...r, reads: [...r.reads.filter((x) => x.commit !== s.commit), s].slice(-KEEP_READS) }));
  }

  /** Keeps an mx check result (the newest KEEP_CHECKS; a later run of the same commit replaces it). */
  addCheck(floorId: string, c: MxCheckResult): Promise<SecurityRecord> {
    return this.update(floorId, (r) => ({ ...r, checks: [...r.checks.filter((x) => x.commit !== c.commit), c].slice(-KEEP_CHECKS) }));
  }

  /** Lets go of a project (deleted). */
  forget(floorId: string) {
    this.cache.delete(floorId);
    this.chains.delete(floorId);
  }
}
