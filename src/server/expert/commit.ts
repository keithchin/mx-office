// The auto-commit: once the session is idle after a change, what it left uncommitted on the session branch is
// committed with a message made from the changed files. Never an amend, never a rewrite, never twice: when HEAD
// moved since the last look (the toolkit's own commit habit, Studio Pro's commit on Publish) or the tree is clean,
// nothing is committed this time. Never while git holds the repository.

import { SESSION_BRANCH } from '../../shared/expert-proof.js';
import { gitHeld, type ProofGit } from './git.js';
import { currentBranch, headOf, pendingChanges } from './session.js';

/** The trailer every auto-commit carries, so it can be told from the session's own. */
export const AUTO_TRAILER = 'Mx-Office-Auto-Commit';

export type CommitOutcome =
  | { kind: 'committed'; sha: string; message: string; files: number }
  | { kind: 'clean'; head: string }
  | { kind: 'moved'; head: string }
  | { kind: 'busy'; why: string }
  | { kind: 'off-branch'; branch: string }
  | { kind: 'error'; error: string };

export interface ChangedFile {
  status: string;
  path: string;
}

const MODULE_DIRS: Record<string, string> = { javasource: 'Java', javascriptsource: 'JavaScript', themesource: 'theme' };

/** What a changed path belongs to, in words: the app model, a module's Java, a top folder, a root file. */
export function areaOf(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  if (/\.mpr$/i.test(p) || parts[0] === 'mprcontents') return 'app model';
  const kind = MODULE_DIRS[parts[0].toLowerCase()];
  if (kind && parts.length > 2) return `${kind} ${parts[1]}`;
  return parts[0];
}

/** The commit message for these changes: a subject naming the areas and a list of the files. */
export function commitMessage(files: readonly ChangedFile[]): string {
  const areas: string[] = [];
  for (const f of files) {
    const a = areaOf(f.path);
    if (!areas.includes(a)) areas.push(a);
  }
  // The app model first: it's what a Mendix session mostly changes.
  areas.sort((a, b) => Number(b === 'app model') - Number(a === 'app model'));
  const shown = areas.slice(0, 4).join(', ');
  const more = areas.length > 4 ? ` and ${areas.length - 4} more` : '';
  const n = files.length;
  let subject = `Session: ${shown}${more} (${n} file${n === 1 ? '' : 's'})`;
  if (subject.length > 72) subject = `Session: ${areas.slice(0, 2).join(', ')}${areas.length > 2 ? ` and ${areas.length - 2} more` : ''} (${n} file${n === 1 ? '' : 's'})`.slice(0, 72);
  const list = files.slice(0, 30).map((f) => `${f.status} ${f.path}`);
  if (n > 30) list.push(`… and ${n - 30} more`);
  return `${subject}\n\n${list.join('\n')}\n\n${AUTO_TRAILER}: ${SESSION_BRANCH}`;
}

/** `git diff --cached --name-status -z`, read. */
export function parseNameStatus(out: string): ChangedFile[] {
  const parts = out.split('\0').filter((x) => x !== '');
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    // A rename or copy names both paths: the new one counts.
    if (/^[RC]/.test(status)) {
      i++;
      files.push({ status: status[0], path: parts[i++] ?? '' });
    } else files.push({ status: status[0], path: parts[i++] ?? '' });
  }
  return files.filter((f) => f.path);
}

/**
 * One look: commits the session branch's pending changes unless HEAD moved since `seen` (the head at the last
 * look; undefined: no look yet, nothing to compare), the tree is clean, git holds the repository, or the folder
 * isn't on the session branch. `identity` is used only when the repository has no committer of its own.
 */
export async function autoCommit(git: ProofGit, dir: string, seen: string | undefined, identity: () => { name: string; email: string }): Promise<CommitOutcome> {
  try {
    const held = await gitHeld(git, dir);
    if (held) return { kind: 'busy', why: held };
    const branch = await currentBranch(git, dir);
    if (branch !== SESSION_BRANCH) return { kind: 'off-branch', branch };
    const head = await headOf(git, dir);
    if (seen !== undefined && head !== seen) return { kind: 'moved', head };
    if (!(await pendingChanges(git, dir))) return { kind: 'clean', head };
    await git(['add', '--all'], dir);
    const files = parseNameStatus(await git(['diff', '--cached', '--name-status', '-z', '--find-renames'], dir));
    if (!files.length) return { kind: 'clean', head };
    const message = commitMessage(files);
    const hasOwn = !!(await git(['config', 'user.email'], dir).catch(() => '')).trim();
    const id = hasOwn ? [] : (() => {
      const me = identity();
      return ['-c', `user.name=${me.name}`, '-c', `user.email=${me.email}`];
    })();
    try {
      // No --amend, no --no-verify: the project's own hooks and signing settings apply as they are.
      await git([...id, 'commit', '--quiet', '-m', message], dir);
    } catch (err) {
      // Left as it was found: unstaged again (the files themselves are never touched).
      await git(['reset', '--quiet'], dir).catch(() => '');
      return { kind: 'error', error: `The commit didn't go: ${(err as Error).message}` };
    }
    return { kind: 'committed', sha: await headOf(git, dir), message: message.split('\n')[0], files: files.length };
  } catch (err) {
    return { kind: 'error', error: (err as Error).message };
  }
}
