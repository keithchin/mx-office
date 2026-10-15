// Other features that read what the asks look already read (sources.ts: the floor's folder, the agents'
// worktrees and the local branch heads, off the event loop, branch reads cached by commit), so they add no
// look and no polling of their own: Recorded as given (server/followthrough/) finds the escalations'
// `Decided per ESC-<id> rev <n>` citations there. A reader that fails is logged and the look goes on.

import type { Read } from './sources.js';

export type AsksReader = (floor: { id: string; dir: string }, reads: readonly Read[]) => Promise<void>;

const readers = new Set<AsksReader>();

/** Adds a reader; returns what takes it away again. */
export function registerAsksReader(fn: AsksReader): () => void {
  readers.add(fn);
  return () => readers.delete(fn);
}

/** Every reader, one after another, given this look's reads. Never throws. */
export async function runAsksReaders(floor: { id: string; dir: string }, reads: readonly Read[]): Promise<void> {
  for (const fn of readers) {
    try {
      await fn(floor, reads);
    } catch (err) {
      console.error(`agent-office: asks: a reader failed on ${floor.id}: ${(err as Error)?.message ?? err}`);
    }
  }
}
