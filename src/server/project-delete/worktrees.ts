// The worktrees the office made in a project (under its .agent-office/worktrees/), what each holds, and
// taking them away when the project is deleted. git runs off the event loop (worktree-sweep/sweep.ts's
// git). Every junction inside a worktree is unlinked before git removes it, so a node_modules junction's
// target is never touched. A branch with commits on no remote stays in the repository when the folder
// stays (only its worktree goes); worktrees made anywhere else are another office's business.

import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { PlanWorktree } from '../../shared/project-delete.js';
import { BRANCH_PREFIX, WORKTREES_DIR, gitError } from '../worktrees.js';
import { git, listWorktrees, unlinkLinks, within } from '../worktree-sweep/sweep.js';

const isRepo = (dir: string) =>
  git(['rev-parse', '--git-dir'], dir).then(
    () => true,
    () => false,
  );

/** The office's worktrees in the project at `dir`, each with its uncommitted files and unpushed commits. */
export async function officeWorktrees(dir: string): Promise<PlanWorktree[]> {
  if (!(await lstat(dir).catch(() => undefined)) || !(await isRepo(dir))) return [];
  const root = await realpath(dir).catch(() => path.resolve(dir));
  const home = path.join(root, WORKTREES_DIR);
  const listed = await listWorktrees(dir).catch(() => []);
  const out: PlanWorktree[] = [];
  for (const wt of listed) {
    if (wt.main || !within(home, wt.path)) continue;
    const there = await lstat(wt.path).catch(() => undefined);
    const dirty =
      !there || wt.prunable
        ? 0
        : await git(['status', '--porcelain'], wt.path).then(
            (s) => s.split('\n').filter(Boolean).length,
            () => -1,
          );
    const tip = wt.branch ? `refs/heads/${wt.branch}` : wt.head;
    // On no remote and not in the project's own checkout: what deleting the branch would lose.
    const unpushed = tip
      ? await git(['rev-list', '--count', tip, '--not', '--remotes', 'HEAD'], dir).then(
          (s) => Number(s) || 0,
          () => -1,
        )
      : 0;
    out.push({
      path: wt.path,
      ...(wt.branch ? { branch: wt.branch } : {}),
      dirty,
      unpushed,
    });
  }
  return out;
}

export interface RemovedTrees {
  removed: number;
  /** Branches left in the repository because they hold commits on no remote. */
  keptBranches: string[];
  failed: string[];
}

/**
 * Removes the office's worktrees in the project. Their office/ branches go too, unless one holds
 * commits on no remote and the folder stays (`keepUnpushed`): then only its worktree goes.
 */
export async function removeOfficeWorktrees(dir: string, keepUnpushed: boolean): Promise<RemovedTrees> {
  const res: RemovedTrees = { removed: 0, keptBranches: [], failed: [] };
  const trees = await officeWorktrees(dir);
  for (const wt of trees) {
    try {
      if (await lstat(wt.path).catch(() => undefined)) {
        await unlinkLinks(wt.path);
        // Twice forced: a locked worktree goes too (the person confirmed).
        await git(['worktree', 'remove', '--force', '--force', wt.path], dir);
      }
      res.removed++;
    } catch (err) {
      res.failed.push(`${wt.path}: ${gitError(err)}`);
      continue;
    }
    if (!wt.branch?.startsWith(BRANCH_PREFIX)) continue;
    if (keepUnpushed && wt.unpushed !== 0) {
      res.keptBranches.push(wt.branch);
      continue;
    }
    await git(['branch', '-D', wt.branch], dir).catch(() => undefined);
  }
  if (trees.length) await git(['worktree', 'prune'], dir).catch(() => undefined);
  return res;
}
