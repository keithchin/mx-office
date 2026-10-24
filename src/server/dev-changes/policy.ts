// A project's Developer change queue policy (shared/dev-changes.ts DevChangePolicy), kept beside its record as
// <data>/dev-changes/<project>.policy.json: corrections go to the front (default on), and whether a queued
// change that overlaps an earlier, untried change waits for its review (default off: it proceeds with the note).
// Admins change it, audited (http/routes/dev-changes.ts). Read once per project, then kept in memory.

import path from 'node:path';
import { parseStoreSync } from '../durable/read.js';
import { writeTextDurableSync } from '../durable/write.js';
import { DEFAULT_CHANGE_POLICY, type DevChangePolicy } from '../../shared/dev-changes.js';

export class ChangePolicies {
  private kept = new Map<string, DevChangePolicy>();

  constructor(readonly dir: string) {}

  private file(floorId: string) {
    return path.join(this.dir, `${floorId.replace(/[^A-Za-z0-9_.-]/g, '_')}.policy.json`);
  }

  get(floorId: string): DevChangePolicy {
    let p = this.kept.get(floorId);
    if (p) return p;
    try {
      const v = parseStoreSync(this.file(floorId)) as Partial<DevChangePolicy> | undefined;
      p = { correctionsFirst: v?.correctionsFirst !== false, waitForReview: v?.waitForReview === true };
    } catch {
      p = { ...DEFAULT_CHANGE_POLICY };
    }
    this.kept.set(floorId, p);
    return p;
  }

  set(floorId: string, next: Partial<DevChangePolicy>): DevChangePolicy {
    const p: DevChangePolicy = { ...this.get(floorId), ...(typeof next.correctionsFirst === 'boolean' ? { correctionsFirst: next.correctionsFirst } : {}), ...(typeof next.waitForReview === 'boolean' ? { waitForReview: next.waitForReview } : {}) };
    writeTextDurableSync(this.file(floorId), JSON.stringify(p));
    this.kept.set(floorId, p);
    return p;
  }
}
