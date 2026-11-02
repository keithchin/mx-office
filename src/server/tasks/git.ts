// The local git the task links read (Slice 1B-4): the commits since an answer on every local ref, the
// commits on one branch, and whether a revision contains a commit. All off the event loop (asks/sources.ts
// git) and cached briefly (a minute; one `log --all` per folder, release 83) or, for ancestry, for good (followthrough/locate.ts isAncestor). Only
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

/** One folder's `git log --all`: the window it covers (seconds), when it was asked, and its commits (newest first). */
interface DirLog {
  at: number;
  since: number;
  p: Promise<Commit[]>;
}
const dirLogs = new Map<string, DirLog>();

/** Stand-in for the log itself (tests). */
let logRunner: (dir: string, since: number) => Promise<string | undefined> = (dir, since) => git(['log', '--all', `--since=${since}`, `-n${MAX_COMMITS}`, `--format=%H${FS}%ct${FS}%B${SEP}`], dir);
export const useLogRunner = (fn?: typeof logRunner) => {
  logRunner = fn ?? ((dir, since) => git(['log', '--all', `--since=${since}`, `-n${MAX_COMMITS}`, `--format=%H${FS}%ct${FS}%B${SEP}`], dir));
  dirLogs.clear();
};

function parseCommits(out: string | undefined): Commit[] {
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
}

/**
 * The commits on every local ref (branches, worktrees' branches, origin's) since `sinceMs`, newest first.
 * One `git log --all` per folder at a time and per minute (release 83: each answer's own `since` started its own
 * log, and dozens piled up while tests loaded the machine): it covers the widest window asked, and each caller
 * gets its part of it. A wider ask than the one kept (or running) starts one log for the wider window.
 */
export function commitsSince(dir: string, sinceMs: number, now = Date.now()): Promise<Commit[]> {
  // Bucketed by the minute so asks about answers a few seconds apart share one log.
  const since = Math.floor(sinceMs / 60_000) * 60;
  const mine = (cs: Commit[]) => cs.filter((c) => c.at >= since * 1000);
  const had = dirLogs.get(dir);
  const fresh = had && now - had.at < TTL_MS;
  if (fresh && had.since <= since) return had.p.then(mine);
  const from = fresh ? Math.min(had.since, since) : since;
  const p = logRunner(dir, from).then(parseCommits, () => [] as Commit[]);
  dirLogs.set(dir, { at: now, since: from, p });
  while (dirLogs.size > KEPT) dirLogs.delete(dirLogs.keys().next().value!);
  return p.then(mine);
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
