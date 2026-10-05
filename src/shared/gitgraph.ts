// The Git tab's branch graph (GET /api/git?floor=<id>, see server/gitgraph/): the floor's default
// branch with its recent history, and every other branch with where it left the default branch, how
// far ahead and behind it is, and the worker and pull request it belongs to. Pure: both sides use it.

import type { GhPull } from './protocol/github.js';
import type { WorkerInfo, WorkerStatus } from './protocol/workers.js';

export interface GitCommit {
  sha: string;
  subject: string;
  author: string;
  /** ISO 8601. */
  date: string;
  /** More than one: a merge. */
  parents: string[];
}

export interface GitBranchOwner {
  id: string;
  name: string;
  color: string;
  status: WorkerStatus;
}

export interface GitBranchPull {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  checks: GhPull['checks'];
  reviewDecision: string;
  url: string;
}

export interface GitBranch {
  /** Without refs/heads/ or origin/: "office/ada-1234". */
  name: string;
  /** Where it is: only here, only on origin, or both (`local` is the tip shown then). */
  where: 'local' | 'remote' | 'both';
  /** Here and on origin at different commits: there's work not pushed yet (or not pulled). */
  diverged?: boolean;
  sha: string;
  subject: string;
  author: string;
  date: string;
  /** Commits on it that the default branch hasn't got, and the other way round. */
  ahead: number;
  behind: number;
  /** Everything on it is on the default branch (or its pull request was merged). */
  merged: boolean;
  /** Where it left the default branch (git merge-base); for a merged branch, where it left before the merge. */
  fork?: string;
  /** The merge commit on the default branch that brought it in, when that's in `history`. */
  mergedBy?: string;
  /** Commits between `fork` and its tip, for a merged branch whose ahead is 0. */
  commits?: number;
  worker?: GitBranchOwner;
  pr?: GitBranchPull;
}

export interface GitGraph {
  floor: string;
  /** "main". */
  defaultBranch: string;
  /** What branches are compared with: "origin/main", or "main" when there's no origin. */
  defaultRef: string;
  /** The default branch's latest commits, newest first, following first parents (merges keep both parents). */
  history: GitCommit[];
  /** Newest first. */
  branches: GitBranch[];
  /** What's left out: old merged branches, and any past the cap. */
  hidden: { merged: number; more: number };
  /** When origin was last fetched, and why the last fetch failed. */
  fetchedAt?: number;
  fetchError?: string;
  at: number;
}

/** Behind the default branch by more than this: stale. */
export const STALE_BEHIND = 20;

/** The worker whose worktree is on `branch`. */
export function ownerOf(branch: string, workers: Iterable<WorkerInfo>): WorkerInfo | undefined {
  for (const w of workers) if (w.worktree?.branch === branch) return w;
  return undefined;
}

/** The pull request from `branch`: an open one first, else the latest. */
export function pullOf(branch: string, pulls: readonly GhPull[]): GhPull | undefined {
  const mine = pulls.filter((p) => p.headRefName === branch);
  return mine.find((p) => p.state === 'OPEN') ?? mine.sort((a, b) => b.number - a.number)[0];
}

export const ownerInfo = (w: WorkerInfo): GitBranchOwner => ({ id: w.id, name: w.name, color: w.color, status: w.status });
export const pullInfo = (p: GhPull): GitBranchPull => ({ number: p.number, title: p.title, state: p.state, isDraft: p.isDraft, checks: p.checks, reviewDecision: p.reviewDecision, url: p.url });
