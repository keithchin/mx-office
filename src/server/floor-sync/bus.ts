// What tells the floor sync (./index.ts) to look: something in the office just fetched a floor's origin
// (the setup panel's and the Deliverables' fetchDefault, the Git tab's fetch, the worktrees' fetch before
// a hire), the Live app saw main move on GitHub, or someone walked onto the floor. A plain list of
// listeners and nothing else, so the places that fetch don't pull the sync (and Studio Pro's detection)
// in with them. No timers of its own: the sync only ever looks when one of these says so.

/** `fetched`: origin's refs in the folder were just brought up to date. `stale`: they may be behind GitHub (fetch first). */
export type OriginNews = 'fetched' | 'stale';

type Listener = (dir: string, news: OriginNews) => void;
const listeners = new Set<Listener>();

/** Says that the checkout at `dir` may have something new from origin. Never throws. */
export function originNews(dir: string, news: OriginNews = 'fetched'): void {
  for (const fn of listeners) {
    try {
      fn(dir, news);
    } catch (err) {
      console.error('agent-office: a project sync listener failed', err);
    }
  }
}

/** Hears originNews; returns how to stop. */
export function onOriginNews(fn: Listener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
