// "Resolve old incidents…" on the Incidents page (ui/incidents/bulk.ts, POST /api/incidents/bulk-resolve,
// server/incidents/bulk.ts): which incidents it may resolve at once. One that's mitigated (someone already
// stopped the harm), or one nobody has seen for a week; never an open one seen in the last seven days.
// The page lists exactly these for the admin to tick, and the office checks each again by its own clock.

import type { Incident } from './incidents.js';

const DAY = 24 * 3_600_000;
/** Not seen for longer than this many days: old enough to resolve in bulk. */
export const BULK_STALE_DAYS = 7;
/** The note it's resolved with unless the admin writes another. */
export const BULK_NOTE = `Bulk-resolved: mitigated or not seen for ${BULK_STALE_DAYS}+ days`;
/** At most this many in one go. */
export const BULK_MAX = 500;

/** Whether "Resolve old incidents…" may resolve `i` at `now`. */
export function bulkResolvable(i: Pick<Incident, 'status' | 'lastSeenAt'>, now: number): boolean {
  if (i.status === 'resolved') return false;
  return i.status === 'mitigated' || now - i.lastSeenAt > BULK_STALE_DAYS * DAY;
}

/** The ones it offers, oldest first. */
export function bulkCandidates<T extends Pick<Incident, 'status' | 'lastSeenAt'>>(list: readonly T[], now: number): T[] {
  return list.filter((i) => bulkResolvable(i, now)).sort((a, b) => a.lastSeenAt - b.lastSeenAt);
}
