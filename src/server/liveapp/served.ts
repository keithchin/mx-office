// The live app's last served revision on disk (<live dir>/<floor>.served.json), so the office can say what
// ran last after it restarts: written when a build comes up (no `until`: it's serving) and when that runtime
// stops serving (with `until`). Read back only as `lastServed`, never as `served`: after a restart nothing
// runs until someone starts it. A record without `until` (the office ended without its shutdown) says only
// that it served from `builtAt`, so that is all `until` claims. Small, rare writes; a convenience, never fatal.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LiveServed } from '../../shared/protocol.js';

export type ServedRecord = LiveServed & { until?: number };

const fileOf = (liveDir: string, floorId: string) => path.join(liveDir, `${floorId}.served.json`);

/** What served last on this floor, as `lastServed` (undefined when nothing ever did, or the file isn't readable). */
export function readLastServed(liveDir: string, floorId: string): (LiveServed & { until: number }) | undefined {
  try {
    const o = JSON.parse(readFileSync(fileOf(liveDir, floorId), 'utf8')) as Partial<ServedRecord>;
    if (typeof o.sha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(o.sha) || typeof o.builtAt !== 'number') return undefined;
    const until = typeof o.until === 'number' && o.until >= o.builtAt ? o.until : o.builtAt;
    return { sha: o.sha, ...(typeof o.subject === 'string' ? { subject: o.subject.slice(0, 300) } : {}), ...(typeof o.commitAt === 'number' ? { commitAt: o.commitAt } : {}), builtAt: o.builtAt, until };
  } catch {
    return undefined;
  }
}

/** A deleted project's record goes with it. */
export function forgetServed(liveDir: string, floorId: string): void {
  rmSync(fileOf(liveDir, floorId), { force: true });
}

/** Writes the record (through a temporary file, so a torn write never leaves half of one). */
export function writeServed(liveDir: string, floorId: string, rec: ServedRecord): void {
  try {
    mkdirSync(liveDir, { recursive: true });
    const file = fileOf(liveDir, floorId);
    writeFileSync(`${file}.tmp`, JSON.stringify(rec));
    renameSync(`${file}.tmp`, file);
  } catch {
    // Only what the page says after a restart depends on it.
  }
}
