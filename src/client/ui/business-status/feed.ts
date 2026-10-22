// The project's business status in the page (GET /api/business-status, shared/business-status.ts): the
// same answer the server gives Home, the phone, the progress bar and the Teams digest, so the Overview and
// the Live app chip say the same words. Asked when the project's live app changes what it runs (its
// served revision, its readiness, its status: the key the Live app view hands in), never on a timer, and
// one answer per project per key. What listens is drawn again when an answer comes.

import type { BusinessStatusView } from '../../../shared/business-status';

const kept = new Map<string, { key: string; v?: BusinessStatusView; asking?: Promise<void> }>();
const fns = new Set<() => void>();

/** What's known of `floor`'s status now (undefined before the first answer). */
export const businessNow = (floor: string | null | undefined): BusinessStatusView | undefined => (floor ? kept.get(floor)?.v : undefined);

/** Draws `fn` again whenever an answer comes. Gives back a way to stop. */
export function onBusiness(fn: () => void): () => void {
  fns.add(fn);
  return () => void fns.delete(fn);
}

/** Asks for `floor`'s status when `key` (what it runs, as the Live app view says it) changed since the last answer. */
export function wantBusiness(floor: string | null | undefined, key: string): void {
  if (!floor) return;
  const k = kept.get(floor);
  if (k && k.key === key) return;
  const e = { key, v: k?.v } as { key: string; v?: BusinessStatusView; asking?: Promise<void> };
  kept.set(floor, e);
  e.asking = fetch(`/api/business-status?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<BusinessStatusView>) : undefined))
    .catch(() => undefined)
    .then((v) => {
      if (kept.get(floor) !== e) return;
      e.asking = undefined;
      if (!v) return;
      e.v = v;
      for (const fn of fns) fn();
    });
}
