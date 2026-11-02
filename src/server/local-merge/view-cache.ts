// The local-merge panel's view, kept per project (release 83, real build: while microflow tests loaded the machine
// GET /api/local-merge took 52 s to over two minutes, every look asking git ~8 questions per branch again). Now a
// look costs one `git for-each-ref` (every branch head, local and origin's) when nothing moved: the view is
// answered from the cache while that fingerprint, the review book, the team's merge asks and its workers'
// branches are what they were, for at most a minute. One build per project at a time: a look while one is
// under way gets that one's answer. A review or a merge in the office forgets the project's view at once.

import type { Git } from '../gitgraph/index.js';

/** How long a view is given again at most, even when nothing it reads seems to have moved (DC titles, levels). */
export const VIEW_FRESH_MS = 60_000;

interface Kept<V> {
  key: string;
  at: number;
  view: Promise<V>;
}

const kept = new Map<string, Kept<unknown>>();

/** Every branch head here (local and remote-tracking), one git start: what moves when anything is committed or merged. */
export async function refsPrint(git: Git, dir: string): Promise<string> {
  return git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'], dir).catch(() => `unread ${Date.now()}`);
}

/**
 * The project's view for `key` (the fingerprint of what it reads): the kept one while the key is the same and it's
 * under VIEW_FRESH_MS old, else built once (a look meanwhile shares that build). A failed build isn't kept.
 */
export function viewFor<V>(floorId: string, key: string, build: () => Promise<V>, now = Date.now(), rekey?: () => Promise<string>): Promise<V> {
  const had = kept.get(floorId) as Kept<V> | undefined;
  if (had && had.key === key && now - had.at < VIEW_FRESH_MS) return had.view;
  // Once built, kept under the fingerprint as it is then: the build's own fetch may have moved origin's refs.
  const view = build().then(async (v) => {
    const after = await rekey?.().catch(() => undefined);
    if (after !== undefined && kept.get(floorId) === mine) mine.key = after;
    return v;
  });
  const mine: Kept<V> = { key, at: now, view };
  kept.set(floorId, mine);
  view.catch(() => {
    if (kept.get(floorId) === mine) kept.delete(floorId);
  });
  return view;
}

/** Forgets a project's view (a review or merge in the office; tests): the next look builds it anew. */
export function forgetView(floorId?: string) {
  if (floorId === undefined) kept.clear();
  else kept.delete(floorId);
}
