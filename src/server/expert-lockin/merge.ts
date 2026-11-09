// Lock in's merge of session/main into main: exactly the checked commit (never whatever the head has become since),
// with the local-merge machinery's method (local-merge/merge.ts): `git merge --no-ff <sha>` in a temporary worktree
// off main, as the office's identity, so the project folder (the session, Studio Pro, the live app) is never mid-
// merge. The merge commit carries the receipt: the checks recorded at that exact commit, what the person accepted
// and the data impact they confirmed. main moves with a compare-and-swap (`update-ref <new> <old>`): a main that
// moved meanwhile refuses it, and nothing changes. Never a force; a conflict stops with the files named, and
// nothing is resolved for you. Then session/main carries on from the new main (./session.ts carryOn).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SESSION_BRANCH } from '../../shared/expert-proof.js';
import { STATUS_WORDS, type LockInCheck } from '../../shared/expert-lockin.js';
import { gitHeld, type ProofGit } from '../expert/git.js';
import { SLOW_GIT_MS } from '../local-merge/merge.js';

/** The trailer every Lock in merge carries: the branch and the checked commit. */
export const LOCKIN_TRAILER = 'Mx-Office-Lock-In';

export interface MergeAsk {
  sha: string;
  checks: readonly LockInCheck[];
  accepted: readonly string[];
  impact: readonly string[];
  by: string;
  identity: { name: string; email: string };
}

export type MergeAnswer = { ok: true; merge: string; into: string; commits: number; newer: number } | { ok: false; status: number; error: string };

const ref = async (git: ProofGit, dir: string, name: string) => (await git(['rev-parse', '--verify', '--quiet', `${name}^{commit}`], dir).catch(() => '')).trim();
const isAncestor = (git: ProofGit, dir: string, a: string, b: string) => git(['merge-base', '--is-ancestor', a, b], dir).then(() => true, () => false);

/** The branch Lock in merges into: main, else master; main when neither exists yet. */
export async function mainBranchOf(git: ProofGit, dir: string): Promise<string> {
  if (await ref(git, dir, 'refs/heads/main')) return 'main';
  if (await ref(git, dir, 'refs/heads/master')) return 'master';
  return 'main';
}

/** The merge commit's message: the receipt. */
export function receiptMessage(a: Pick<MergeAsk, 'sha' | 'checks' | 'accepted' | 'impact' | 'by'>, main: string, commits: number, newer: number): string {
  const lines = a.checks.map((c) => `- ${c.name}: ${STATUS_WORDS[c.status].toLowerCase()}, ${c.summary}${c.record ? ` (${c.record})` : ''}`);
  const out = [
    `Lock in: merge ${SESSION_BRANCH} @${a.sha.slice(0, 7)} into ${main} (${commits} commit${commits === 1 ? '' : 's'})`,
    '',
    `Checks recorded at ${a.sha.slice(0, 12)}:`,
    ...lines,
  ];
  if (a.accepted.length) out.push('', `Accepted by ${a.by} as known failures: ${a.accepted.join(', ')}`);
  if (a.impact.length) out.push('', `Data impact confirmed by ${a.by}: ${a.impact.join('; ')}`);
  if (newer) out.push('', `${newer} newer commit${newer === 1 ? '' : 's'} on ${SESSION_BRANCH} not included.`);
  out.push('', `Merged by ${a.by} in Mx Office (Expert mode).`, `${LOCKIN_TRAILER}: ${SESSION_BRANCH}@${a.sha}`);
  return out.join('\n');
}

/** Why the merge stopped on a conflict, in words: the files, and what to do. Nothing was resolved. */
export function conflictWords(sha: string, main: string, files: readonly string[]): string {
  const where = files.length ? ` in ${files.length} file${files.length === 1 ? '' : 's'} (${files.slice(0, 4).join(', ')}${files.length > 4 ? ', …' : ''})` : '';
  return `Not merged: @${sha.slice(0, 7)} conflicts with ${main}${where}. Nothing was changed or resolved. Ask the session to merge ${main} into ${SESSION_BRANCH} and settle it, then run Lock in again.`;
}

/** Merges the checked commit `a.sha` of session/main into main. Never a force. */
export async function mergeChecked(git: ProofGit, dir: string, a: MergeAsk): Promise<MergeAnswer> {
  const held = await gitHeld(git, dir);
  if (held) return { ok: false, status: 409, error: `Not merged: ${held}. Try again in a moment` };
  const full = await ref(git, dir, a.sha);
  if (!full) return { ok: false, status: 404, error: `The commit @${a.sha.slice(0, 7)} isn't in the project any more: run the checks again` };
  const head = await ref(git, dir, `refs/heads/${SESSION_BRANCH}`);
  if (!head || (head !== full && !(await isAncestor(git, dir, full, head)))) return { ok: false, status: 409, error: `@${full.slice(0, 7)} is no longer on ${SESSION_BRANCH}: run the checks again` };
  const main = await mainBranchOf(git, dir);
  const base = await ref(git, dir, `refs/heads/${main}`);
  if (base && (await isAncestor(git, dir, full, base))) return { ok: false, status: 409, error: `@${full.slice(0, 7)} is on ${main} already: nothing to merge` };
  // main checked out in a worktree of its own would be left behind by the ref moving: said, not done.
  const wts = await git(['worktree', 'list', '--porcelain'], dir).catch(() => '');
  if (wts.split(/\r?\n/).some((l) => l.trim() === `branch refs/heads/${main}`)) return { ok: false, status: 409, error: `Not merged: ${main} is checked out in a folder of its own (git worktree list). Switch that folder to another branch first` };
  const newer = Number((await git(['rev-list', '--count', `${full}..${head}`], dir).catch(() => '0')).trim()) || 0;
  const commits = Number((await git(['rev-list', '--count', base ? `${base}..${full}` : full], dir).catch(() => '0')).trim()) || 0;
  const id = ['-c', `user.name=${a.identity.name}`, '-c', `user.email=${a.identity.email}`, '-c', 'commit.gpgsign=false', '-c', 'core.safecrlf=false'];
  if (!base) {
    // No main yet: it starts at the checked commit (nothing to merge into, nothing overwritten).
    await git(['update-ref', `refs/heads/${main}`, full, '0'.repeat(40)], dir);
    return { ok: true, merge: full, into: main, commits, newer };
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mx-lockin-'));
  const wt = path.join(tmp, 'wt');
  let merge = '';
  try {
    await git(['worktree', 'prune'], dir).catch(() => '');
    await git(['worktree', 'add', '--quiet', '--detach', wt, base], dir, { timeoutMs: SLOW_GIT_MS });
    try {
      await git([...id, 'merge', '--no-ff', '--quiet', '-m', receiptMessage(a, main, commits, newer), full], wt, { timeoutMs: SLOW_GIT_MS });
    } catch {
      const files = (await git(['diff', '--name-only', '--diff-filter=U'], wt).catch(() => '')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      await git(['merge', '--abort'], wt).catch(() => '');
      return { ok: false, status: 409, error: conflictWords(full, main, files) };
    }
    merge = (await git(['rev-parse', 'HEAD'], wt)).trim();
    try {
      // Compare-and-swap, never a force: main must still be where the merge started.
      await git(['update-ref', '-m', `Lock in: merge ${SESSION_BRANCH}@${full.slice(0, 7)}`, `refs/heads/${main}`, merge, base], dir);
    } catch (err) {
      return { ok: false, status: 409, error: `Not merged: ${main} moved meanwhile (${(err as Error).message.slice(0, 160)}). Run Lock in again` };
    }
  } finally {
    await git(['worktree', 'remove', '--force', wt], dir, { timeoutMs: SLOW_GIT_MS }).catch(() => '');
    rmSync(tmp, { recursive: true, force: true });
  }
  return { ok: true, merge, into: main, commits, newer };
}
