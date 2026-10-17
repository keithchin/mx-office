// "New test evidence landed for a floor": the test-run store says so after it appended records, so
// whatever reads results against a commit (the live app's readiness, server/liveapp/) looks again then,
// instead of polling the store.

type Listener = (floorId: string) => void;
const listeners = new Set<Listener>();

/** Hears each floor that got new test-run records; returns the unsubscribe. */
export function onTestRuns(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The store appended records for `floorId`. */
export function testRunsLanded(floorId: string): void {
  for (const fn of listeners) {
    try {
      fn(floorId);
    } catch {
      // A listener's trouble is its own.
    }
  }
}
