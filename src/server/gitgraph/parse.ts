// The Git tab's pure half: what git prints, read into branches and commits, and which branches the
// graph shows. No git is run here (index.ts runs it), so the tests can feed it text.

import type { GhPull, WorkerInfo } from '../../shared/protocol.js';
import { ownerInfo, ownerOf, pullInfo, pullOf, type GitBranch, type GitBranchOwner, type GitBranchPull, type GitCommit } from '../../shared/gitgraph.js';

/** Between the fields git prints for each ref and commit (the unit separator). */
export const SEP = '\x1f';
/** for-each-ref's line: full name, tip, committer date, author, subject. */
export const REF_FORMAT = ['%(refname)', '%(objectname)', '%(committerdate:iso-strict)', '%(authorname)', '%(subject)'].join('%1f');
/** git log's line: sha, parents, committer date, author, subject. */
export const LOG_FORMAT = ['%H', '%P', '%cI', '%an', '%s'].join('%x1f');

/** How many branches the graph shows at most, and how many merged ones of those. */
export const MAX_BRANCHES = 40;
export const MAX_MERGED = 8;
/** A merged branch older than this, with nobody on it, is folded away. */
export const MERGED_FRESH_MS = 7 * 24 * 3600_000;

export interface RefRow {
  ref: string;
  sha: string;
  date: string;
  author: string;
  subject: string;
}

/** A branch by name, here, on origin or both, at the commit shown. */
export interface Tip {
  name: string;
  /** The full ref the tip is from (the local one when it's both). */
  ref: string;
  where: GitBranch['where'];
  diverged?: boolean;
  sha: string;
  date: string;
  author: string;
  subject: string;
}

export interface Candidate extends Tip {
  merged: boolean;
  /** Merged by being on the default branch (not just a merged pull request, which may have been squashed). */
  reachable: boolean;
  mergedBy?: string;
  worker?: GitBranchOwner;
  pr?: GitBranchPull;
}

export function parseRefs(out: string): RefRow[] {
  const rows: RefRow[] = [];
  for (const line of out.split('\n')) {
    const [ref, sha, date, author, ...rest] = line.replace(/\r$/, '').split(SEP);
    if (!ref || !sha || !/^[0-9a-f]{7,64}$/.test(sha)) continue;
    rows.push({ ref, sha, date: date ?? '', author: author ?? '', subject: rest.join(SEP) });
  }
  return rows;
}

export function parseLog(out: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const line of out.split('\n')) {
    const [sha, parents, date, author, ...rest] = line.replace(/\r$/, '').split(SEP);
    if (!sha || !/^[0-9a-f]{7,64}$/.test(sha)) continue;
    commits.push({ sha, parents: (parents ?? '').split(' ').filter(Boolean), date: date ?? '', author: author ?? '', subject: rest.join(SEP) });
  }
  return commits;
}

/** "3\t12" from rev-list --left-right --count A...B: what's only on B (ahead) and only on A (behind). */
export function parseCounts(out: string): { behind: number; ahead: number } {
  const [l, r] = out.trim().split(/\s+/).map((n) => Number.parseInt(n, 10));
  return { behind: Number.isFinite(l) ? l : 0, ahead: Number.isFinite(r) ? r : 0 };
}

/** "refs/remotes/origin/main" from symbolic-ref origin/HEAD: "main". */
export function defaultFromSymref(out: string): string | undefined {
  return /^refs\/remotes\/origin\/(.+)$/.exec(out.trim())?.[1];
}

/** The branch name of a ref, and whether it's origin's; undefined for one the graph doesn't show. */
export function branchOf(ref: string): { name: string; remote: boolean } | undefined {
  if (ref.startsWith('refs/heads/')) return { name: ref.slice('refs/heads/'.length), remote: false };
  const m = /^refs\/remotes\/origin\/(.+)$/.exec(ref);
  if (!m || m[1] === 'HEAD') return undefined;
  return { name: m[1], remote: true };
}

/** Every branch but the default one, its local and origin refs as one, newest first. */
export function mergeRefs(rows: readonly RefRow[], defaultBranch: string): Tip[] {
  const local = new Map<string, RefRow>();
  const remote = new Map<string, RefRow>();
  for (const r of rows) {
    const b = branchOf(r.ref);
    if (!b || b.name === defaultBranch) continue;
    (b.remote ? remote : local).set(b.name, r);
  }
  const tips: Tip[] = [];
  for (const name of new Set([...local.keys(), ...remote.keys()])) {
    const l = local.get(name);
    const o = remote.get(name);
    const r = (l ?? o)!;
    tips.push({ name, ref: r.ref, where: l && o ? 'both' : l ? 'local' : 'remote', diverged: l && o && l.sha !== o.sha ? true : undefined, sha: r.sha, date: r.date, author: r.author, subject: r.subject });
  }
  return tips.sort((a, b) => Date.parse(b.date || '0') - Date.parse(a.date || '0'));
}

/** The merge commit in `history` that brought `sha` in (one of its other parents is it). */
export function mergedBy(history: readonly GitCommit[], sha: string): string | undefined {
  return history.find((c) => c.parents.slice(1).includes(sha))?.sha;
}

export interface PickInput {
  tips: readonly Tip[];
  /** The full refs already on the default branch (for-each-ref --merged). */
  reachable: ReadonlySet<string>;
  history: readonly GitCommit[];
  workers: Iterable<WorkerInfo>;
  pulls: readonly GhPull[];
  now: number;
}

/**
 * Which branches the graph shows, with their worker and pull request: every unmerged one, and the
 * merged ones still worth seeing (someone's on it, its merge is in the history, or it's recent), up
 * to MAX_MERGED of those and MAX_BRANCHES in all. The rest are counted in `hidden`.
 */
export function pick(input: PickInput): { chosen: Candidate[]; hidden: { merged: number; more: number } } {
  const workers = [...input.workers];
  const hidden = { merged: 0, more: 0 };
  const chosen: Candidate[] = [];
  let mergedShown = 0;
  for (const t of input.tips) {
    const w = ownerOf(t.name, workers);
    const p = pullOf(t.name, input.pulls);
    const reachable = input.reachable.has(t.ref);
    const c: Candidate = { ...t, reachable, merged: reachable || p?.state === 'MERGED', worker: w && ownerInfo(w), pr: p && pullInfo(p) };
    if (reachable) c.mergedBy = mergedBy(input.history, t.sha);
    if (c.merged) {
      const fresh = input.now - Date.parse(t.date || '0') < MERGED_FRESH_MS;
      if (mergedShown >= MAX_MERGED || !(w || c.mergedBy || fresh)) {
        hidden.merged++;
        continue;
      }
    }
    if (chosen.length >= MAX_BRANCHES) {
      hidden.more++;
      continue;
    }
    if (c.merged) mergedShown++;
    chosen.push(c);
  }
  return { chosen, hidden };
}

/** A shown branch, once git has said how far it is from the default branch and where it left it. */
export function finish(c: Candidate, counts: { ahead: number; behind: number; fork?: string; commits?: number }): GitBranch {
  const b: GitBranch = { name: c.name, where: c.where, sha: c.sha, subject: c.subject, author: c.author, date: c.date, ahead: counts.ahead, behind: counts.behind, merged: c.merged };
  if (c.diverged) b.diverged = true;
  if (counts.fork) b.fork = counts.fork;
  if (c.mergedBy) b.mergedBy = c.mergedBy;
  if (counts.commits !== undefined) b.commits = counts.commits;
  if (c.worker) b.worker = c.worker;
  if (c.pr) b.pr = c.pr;
  return b;
}
