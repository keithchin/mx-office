// A project's phase plan, <data>/phases/<project>.json (shared/phases/types.ts PhasePlan): the phases, the
// open and decided team proposals and the change history. Read once, then kept; every change is written
// through the durable write (aside, fsync, rename) before it's acknowledged, synchronously so two changes on
// one project never interleave. A broken file reads as the empty plan and is set aside, never written over.
// Deleting the file is the rollback: the project is back to "in one go" with no phases.

import path from 'node:path';
import { readJsonStoreSync, valueOr, writeJsonDurableSync } from '../durable/index.js';
import { cleanPlan } from '../../shared/phases/plan.js';
import type { PhasePlan } from '../../shared/phases/types.js';

const safe = (floor: string) => floor.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);

export class PhaseStore {
  readonly dir: string;
  private cache = new Map<string, PhasePlan>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'phases');
  }

  file(floorId: string): string {
    return path.join(this.dir, `${safe(floorId)}.json`);
  }

  /** The project's plan (the empty one, "in one go", when it has none). Callers get a copy. */
  get(floorId: string): PhasePlan {
    let p = this.cache.get(floorId);
    if (!p) {
      p = cleanPlan(valueOr(readJsonStoreSync(this.file(floorId)), null));
      this.cache.set(floorId, p);
    }
    return structuredClone(p);
  }

  /** Whether the project has a plan file at all (no file: exactly as before phases existed). */
  has(floorId: string): boolean {
    return this.get(floorId).state !== 'none' || this.get(floorId).proposals.length > 0;
  }

  /** Changes the plan with `fn` (a copy; return a string to refuse, nothing is written) and writes it. */
  update(floorId: string, fn: (p: PhasePlan) => string | void): PhasePlan | string {
    const next = this.get(floorId);
    const err = fn(next);
    if (typeof err === 'string') return err;
    const clean = cleanPlan(next);
    writeJsonDurableSync(this.file(floorId), clean);
    this.cache.set(floorId, clean);
    return structuredClone(clean);
  }

  forget(floorId: string) {
    this.cache.delete(floorId);
  }
}
