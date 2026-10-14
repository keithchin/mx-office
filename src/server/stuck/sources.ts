// Other features' findings for stuck detection: a feature that knows of something waiting on the Project
// Manager (the Questions page's blocking client questions, server/questions/) registers a source here,
// and each look (service.ts) adds what it finds to the detectors' drafts, so it's raised once, updated in
// place and resolved by itself like any other stuck item. A source that fails is skipped for that look.

import type { StuckDraft } from '../../shared/stuck.js';
import type { StuckFloor } from './service.js';

export type StuckSource = (floor: StuckFloor, now: number) => Promise<readonly StuckDraft[]>;

const sources = new Set<StuckSource>();

/** Adds a source; returns what takes it away again. */
export function registerStuckSource(fn: StuckSource): () => void {
  sources.add(fn);
  return () => sources.delete(fn);
}

/** Every source's drafts for the floor. */
export async function sourcedDrafts(floor: StuckFloor, now: number): Promise<StuckDraft[]> {
  const all = await Promise.all([...sources].map((fn) => fn(floor, now).catch(() => [] as readonly StuckDraft[])));
  return all.flat();
}
