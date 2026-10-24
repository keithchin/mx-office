// What the guard keeps: per project `<data>/data-impact/<project>.json` (the hold standing now, the approvals
// with the ones voided, the dumps taken), and the office's policy, `<data>/data-impact/policy.json` (who holds
// the `data-impact approval` permission: office admins by default, plus accounts the policy names). Written
// through durable/ (aside and renamed); a broken file reads as empty and is set aside, never written over.

import path from 'node:path';
import { readJsonStoreSync, valueOr, writeJsonDurableSync } from '../durable/index.js';
import { DEFAULT_POLICY, type DataImpactApproval, type DataImpactPolicy, type DumpRecord, type HeldFact, type ImpactAssessment } from '../../shared/data-impact.js';

const KEEP = 20;

export type Held = HeldFact & { assessment: ImpactAssessment };

export interface FloorRecord {
  /** The hold standing in each environment (live-preview today), by environment. */
  holds: Record<string, Held>;
  approvals: DataImpactApproval[];
  dumps: DumpRecord[];
}

const safe = (floor: string) => floor.replace(/[^A-Za-z0-9_.-]/g, '_');

export class ImpactStore {
  readonly dir: string;
  private cache = new Map<string, FloorRecord>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'data-impact');
  }

  get(floor: string): FloorRecord {
    let r = this.cache.get(floor);
    if (!r) {
      const v = valueOr(readJsonStoreSync(path.join(this.dir, `${safe(floor)}.json`)), {}) as Partial<FloorRecord> | null;
      r = { holds: v?.holds && typeof v.holds === 'object' && !Array.isArray(v.holds) ? v.holds : {}, approvals: Array.isArray(v?.approvals) ? v.approvals : [], dumps: Array.isArray(v?.dumps) ? v.dumps : [] };
      this.cache.set(floor, r);
    }
    return r;
  }

  update(floor: string, fn: (r: FloorRecord) => void): FloorRecord {
    const r = this.get(floor);
    fn(r);
    r.approvals = r.approvals.slice(-KEEP);
    r.dumps = r.dumps.slice(-KEEP);
    writeJsonDurableSync(path.join(this.dir, `${safe(floor)}.json`), r);
    return r;
  }

  /** The folder a project's dumps go in. */
  dumpDir(floor: string): string {
    return path.join(this.dir, 'dumps', safe(floor));
  }

  policy(): DataImpactPolicy {
    const v = valueOr(readJsonStoreSync(path.join(this.dir, 'policy.json')), {}) as Partial<DataImpactPolicy> | null;
    return {
      admins: typeof v?.admins === 'boolean' ? v.admins : DEFAULT_POLICY.admins,
      accounts: Array.isArray(v?.accounts) ? v.accounts.filter((x): x is string => typeof x === 'string').slice(0, 100) : [],
    };
  }

  setPolicy(p: DataImpactPolicy) {
    writeJsonDurableSync(path.join(this.dir, 'policy.json'), p);
  }

  forget(floor: string) {
    this.cache.delete(floor);
  }
}
