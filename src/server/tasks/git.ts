// The local git the task links read (Slice 1B-4): the commits since an answer on every local ref, the
// commits on one branch, and whether a revision contains a commit. All off the event loop (asks/sources.ts
// git) and cached briefly (a minute) or, for ancestry, for good (followthrough/locate.ts isAncestor). Only
// asked when someone opens a decision's links or the follow-through look runs: no polling, no fetch.

import { git } from '../asks/sources.js';
import { isAncestor } from '../followthrough/locate.js';
import type { Commit } from './evaluate.js';

const TTL_MS = 60_000;
const MAX_COMMITS = 1000;
const KEPT = 200;

interface Cached<T> {
  at: number;
  p: Promise<T>;
}

const logs = new Map<string, Cached<Commit[]>>();
const branches = new Map<string, Cached<ReadonlySet<string> | undefined>>();

function cached<T>(m: Map<string, Cached<T>>, key: string, now: number, make: () => Promise<T>): Promise<T> {
  const had = m.get(key);
  if (had && now - had.at < TTL_MS) return had.p;
  const p = make();
  m.set(key, { at: now, p });
  while (m.size > KEPT) m.delete(m.keys().next().value!);
  return p;
}

const SEP = '\u001e';
const FS = '\u001f';

/** The commits on every local ref (branches, worktrees' branches, origin's) since `sinceMs`, newest first. */
export function commitsSince(dir: string, sinceMs: number, now = Date.now()): Promise<Commit[]> {
  // Bucketed by the minute so asks about answers a few seconds apart share one log.
  const since = Math.floor(sinceMs / 60_000) * 60;
  return cached(logs, `${dir}\0${since}`, now, async () => {
    const out = await git(['log', '--all', `--since=${since}`, `-n${MAX_COMMITS}`, `--format=%H${FS}%ct${FS}%B${SEP}`], dir);
    if (!out) return [];
    return out
      .split(SEP)
      .map((rec) => rec.replace(/^\s+/, ''))
      .filter(Boolean)
      .map((rec) => {
        const [sha, ct, ...msg] = rec.split(FS);
        return { sha: sha.trim(), at: Number(ct) * 1000, message: msg.join(FS).trim() };
      })
      .filter((c) => /^[0-9a-f]{40}$/.test(c.sha));
  });
}

/** The commits on a local branch since `sinceMs`, or undefined when there's no such branch. */
export function branchCommits(dir: string, branch: string, sinceMs: number, now = Date.now()): Promise<ReadonlySet<string> | undefined> {
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(branch) || branch.startsWith('-')) return Promise.resolve(undefined);
  const since = Math.floor(sinceMs / 60_000) * 60;
  return cached(branches, `${dir}\0${branch}\0${since}`, now, async () => {
    const out = await git(['log', branch, `--since=${since}`, `-n${MAX_COMMITS}`, '--format=%H', '--'], dir);
    return out === undefined ? undefined : new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
  });
}

/** Whether revision `into` contains commit `sha` (cached for good: it can't change). */
export const contains = (dir: string, sha: string, into: string) => isAncestor(dir, sha, into);
