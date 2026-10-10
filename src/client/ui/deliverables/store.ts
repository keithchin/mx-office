// The floor's documents (GET /api/deliverables), fetched in one place for the Documents page
// (page.ts) and the setup panel's line (summary.ts): one request per floor at a time, however many
// times it's asked for while that one is on its way (a click on Documents, then another, then the
// setup panel drawing again), and the last answer kept so a page opened again shows it at once while
// a newer one is asked for. Pure enough for tests: `fetcher` can be swapped.

import type { DeliverablesView } from '../../../shared/deliverables';

/** An answer this young isn't asked for again (unless asked to: Refresh). */
export const DOCS_FRESH_MS = 30_000;

type Fetcher = (floor: string, fresh: boolean) => Promise<DeliverablesView | undefined>;

const httpFetcher: Fetcher = (floor, fresh) =>
  fetch(`/api/deliverables?${new URLSearchParams({ floor, ...(fresh ? { fresh: '1' } : {}) })}`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<DeliverablesView>) : undefined))
    .catch(() => undefined);

let fetcher: Fetcher = httpFetcher;
const views = new Map<string, { view: DeliverablesView; at: number }>();
const going = new Map<string, { fresh: boolean; p: Promise<DeliverablesView | undefined> }>();
const listeners = new Set<(floor: string) => void>();
/** When a request that brought nothing (the office unreachable) was made: not asked again sooner than DOCS_FRESH_MS. */
const failed = new Map<string, number>();

/** Tests: where the answers come from (the office's API when undefined). */
export function setDocsFetcher(f: Fetcher | undefined) {
  fetcher = f ?? httpFetcher;
  views.clear();
  going.clear();
  failed.clear();
}

/** The last answer for `floor`, and how old it is. */
export function cachedDocs(floor: string): { view: DeliverablesView; at: number } | undefined {
  return views.get(floor);
}

/** Whether a request for `floor` is on its way. */
export const docsLoading = (floor: string) => going.has(floor);

/** Hears of every new answer (and of a request starting, so a page can say it's looking). */
export function onDocs(fn: (floor: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The floor's documents: the request on its way if there is one (a fresh ask waits for a fresh one),
 * else the kept answer when it's young enough, else a new request. Never more than one at a time.
 */
export function loadDocs(floor: string, opts: { fresh?: boolean; maxAgeMs?: number } = {}): Promise<DeliverablesView | undefined> {
  const fresh = !!opts.fresh;
  const now = going.get(floor);
  if (now && (now.fresh || !fresh)) return now.p;
  const kept = views.get(floor);
  if (!fresh && !now && kept && Date.now() - kept.at < (opts.maxAgeMs ?? DOCS_FRESH_MS)) return Promise.resolve(kept.view);
  if (!fresh && !now && !kept && Date.now() - (failed.get(floor) ?? -Infinity) < DOCS_FRESH_MS) return Promise.resolve(undefined);
  // A fresh ask while a plain one is going: after it, so there's still only one at a time.
  const p = (now ? now.p.then(() => fetcher(floor, true)) : fetcher(floor, fresh)).then((view) => {
    if (going.get(floor)?.p === p) going.delete(floor);
    if (view) views.set(floor, { view, at: Date.now() });
    else failed.set(floor, Date.now());
    for (const fn of listeners) fn(floor);
    return view;
  });
  going.set(floor, { fresh, p });
  for (const fn of listeners) fn(floor);
  return p;
}
