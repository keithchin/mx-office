// The session branch: an Expert project's folder works on `session/main` (Lock in merges it into main later).
// Taken when the session attaches or starts: created at HEAD or checked out, never with force and never at the
// cost of a change. Uncommitted changes on the default branch (main/master) are carried along; on any other branch
// the folder stays where it is and the status says so; nothing is committed or pushed until the branch is taken.

import { SESSION_BRANCH } from '../../shared/expert-proof.js';
import { gitHeld, type ProofGit } from './git.js';

export type BranchResult = { ok: true; branch: string; head: string } | { ok: false; branch: string; why: string };

/** The branch HEAD is on ('' when detached). */
export const currentBranch = async (git: ProofGit, dir: string) => (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], dir).catch(() => '')).trim();

/** HEAD's commit ('' before the first commit). */
export const headOf = async (git: ProofGit, dir: string) => (await git(['rev-parse', '--verify', '--quiet', 'HEAD'], dir).catch(() => '')).trim();

/** Uncommitted changes (untracked files too, ignored ones not), as `git status --porcelain` lists them. */
export const pendingChanges = async (git: ProofGit, dir: string) => (await git(['status', '--porcelain', '--untracked-files=normal'], dir)).trim();

/** The repository's default branch is `branch`: origin's HEAD names it, else it is main or master. */
export async function isDefaultBranch(git: ProofGit, dir: string, branch: string): Promise<boolean> {
  const origin = (await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], dir).catch(() => '')).trim();
  if (origin) return origin.replace(/^origin\//, '') === branch;
  return branch === 'main' || branch === 'master';
}

/** Puts the folder on SESSION_BRANCH if that can be done without losing or carrying anything; else says why not. */
export async function ensureSessionBranch(git: ProofGit, dir: string): Promise<BranchResult> {
  const inside = (await git(['rev-parse', '--is-inside-work-tree'], dir).catch(() => '')).trim();
  if (inside !== 'true') return { ok: false, branch: '', why: 'The project folder is not a git repository' };
  const cur = await currentBranch(git, dir);
  if (cur === SESSION_BRANCH) return { ok: true, branch: cur, head: await headOf(git, dir) };
  const where = cur || 'a detached HEAD';
  const held = await gitHeld(git, dir);
  if (held) return { ok: false, branch: cur, why: `Still on ${where}: ${held}. The session moves to ${SESSION_BRANCH} once git is done` };
  let dirty: string;
  try {
    dirty = await pendingChanges(git, dir);
  } catch (err) {
    return { ok: false, branch: cur, why: `Couldn't read the folder's changes: ${(err as Error).message}` };
  }
  // Uncommitted changes on the default branch go along to the session branch (git carries them, or refuses rather than
  // overwrite anything); on any other branch they stay where they are.
  if (dirty && !(cur && (await isDefaultBranch(git, dir, cur)))) return { ok: false, branch: cur, why: `Uncommitted changes on ${where}: the session stays there, and nothing is committed or pushed, until they are committed; then it moves to ${SESSION_BRANCH}` };
  const head = await headOf(git, dir);
  const exists = !!(await git(['rev-parse', '--verify', '--quiet', `refs/heads/${SESSION_BRANCH}`], dir).catch(() => '')).trim();
  try {
    // No -f anywhere: git refuses rather than overwrite a file.
    if (exists) await git(['checkout', '--quiet', SESSION_BRANCH], dir);
    else if (!head) await git(['symbolic-ref', 'HEAD', `refs/heads/${SESSION_BRANCH}`], dir);
    else await git(['checkout', '--quiet', '-b', SESSION_BRANCH], dir);
  } catch (err) {
    return { ok: false, branch: cur, why: `Couldn't move to ${SESSION_BRANCH}: ${(err as Error).message}` };
  }
  return { ok: true, branch: SESSION_BRANCH, head: await headOf(git, dir) };
}
