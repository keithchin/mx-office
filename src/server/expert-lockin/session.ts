// After a Lock in merge, session/main carries on from the new main, never rewritten: a fast-forward when nothing
// came after the checked commit (the usual case: the files don't change, only the branch's place), else main is
// merged into session/main with a merge commit, and only while the session is idle and nothing is uncommitted. A
// conflict there is aborted and said: the session keeps its own commits and the person asks it to settle it.
// Through the expert git's single flight (one local operation at a time per repository).

import { SESSION_BRANCH } from '../../shared/expert-proof.js';
import type { SessionAfter } from '../../shared/expert-lockin.js';
import { gitHeld, serial, type ProofGit } from '../expert/git.js';
import { currentBranch, headOf, pendingChanges } from '../expert/session.js';

export interface CarryOn {
  session: SessionAfter;
  note?: string;
}

/** Brings session/main to the new `main` (its merge commit `merge`). `busy`: the session is working now. */
export function carryOn(git: ProofGit, dir: string, main: string, merge: string, busy: boolean, identity: { name: string; email: string }): Promise<CarryOn> {
  return serial(dir, async () => {
    const held = await gitHeld(git, dir);
    if (held) return { session: 'waiting', note: `${SESSION_BRANCH} takes the new ${main} once git is done (${held})` };
    if ((await currentBranch(git, dir)) !== SESSION_BRANCH) return { session: 'left', note: `The folder isn't on ${SESSION_BRANCH}: it stays where it is` };
    const head = await headOf(git, dir);
    if (head === merge || (await git(['merge-base', '--is-ancestor', merge, head], dir).then(() => true, () => false))) return { session: 'fast-forward' };
    const ff = await git(['merge-base', '--is-ancestor', head, merge], dir).then(() => true, () => false);
    if (ff) {
      try {
        // git never overwrites an uncommitted change here: it refuses, and the folder stays as it is.
        await git(['merge', '--ff-only', '--quiet', merge], dir);
        return { session: 'fast-forward' };
      } catch (err) {
        return { session: 'waiting', note: `${SESSION_BRANCH} stays put for now: ${(err as Error).message.slice(0, 160)}` };
      }
    }
    if (busy) return { session: 'waiting', note: `The session committed after the checks: ${main} is merged into ${SESSION_BRANCH} once it is idle` };
    if (await pendingChanges(git, dir).catch(() => 'x')) return { session: 'waiting', note: `Uncommitted changes in the folder: ${main} is merged into ${SESSION_BRANCH} after the next commit` };
    const id = ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`];
    try {
      await git([...id, 'merge', '--no-ff', '--quiet', '-m', `Merge ${main} into ${SESSION_BRANCH} after Lock in`, merge], dir);
      return { session: 'merged-main' };
    } catch {
      const files = (await git(['diff', '--name-only', '--diff-filter=U'], dir).catch(() => '')).split(/\r?\n/).filter(Boolean);
      await git(['merge', '--abort'], dir).catch(() => '');
      return { session: 'left', note: `${main} conflicts with the session's newer commits${files.length ? ` (${files.slice(0, 3).join(', ')})` : ''}: nothing was merged. Ask the session to merge ${main} and settle it` };
    }
  });
}
