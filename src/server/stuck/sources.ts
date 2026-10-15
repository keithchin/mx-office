// Other features' findings for stuck detection: a feature that knows of something waiting on the Project
// Manager (the Questions page's blocking client questions, server/questions/) registers a source here,
// and each look (service.ts) adds what it finds to the detectors' drafts, so it's raised once, updated in
// place and resolved by itself like any other stuck item. A source that fails says so (failed), and its
// items are kept as they were rather than resolved (decision cards, D02).

import type { StuckDraft } from '../../shared/stuck.js';
import type { StuckFloor } from './service.js';

export type StuckSource = (floor: StuckFloor, now: number) => Promise<readonly StuckDraft[]>;

/** How a look at the sources went: ok (read, maybe with nothing), or failed (a source threw: what it found before stays). */
export interface SourcedResult {
  status: 'ok' | 'missing' | 'failed';
  drafts: StuckDraft[];
}

const sources = new Set<StuckSource>();

/** Adds a source; returns what takes it away again. */
export function registerStuckSource(fn: StuckSource): () => void {
  sources.add(fn);
  return () => sources.delete(fn);
}

/** Every source's drafts for the floor, and whether any source failed (missing: no source registered). */
export async function sourcedDrafts(floor: StuckFloor, now: number): Promise<SourcedResult> {
  if (!sources.size) return { status: 'missing', drafts: [] };
  let failed = false;
  const all = await Promise.all(
    [...sources].map((fn) =>
      fn(floor, now).catch(() => {
        failed = true;
        return [] as readonly StuckDraft[];
      }),
    ),
  );
  return { status: failed ? 'failed' : 'ok', drafts: all.flat() };
}
