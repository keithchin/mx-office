// The local merge itself (./index.ts): exactly the reviewed commit, never whatever the branch's head is now. The
// rebuild test found the old merge took the moving head: five races and unreviewed work in progress merged. Now
// "Approve at @sha" pins the commit and Merge merges that commit with `git merge --no-ff <sha>` in a temporary
// worktree off origin/<main>, as the office's identity (workers/git-identity.ts), pushed to the project's local
// origin without force (a main that moved meanwhile refuses the push: nothing changes). Newer commits stay on the
// branch for a later review, and the answer says so: "Merged @3d6ca6b (reviewed). The branch has 2 newer commits,
// not included." A commit that's gone, off the branch, already on main or conflicting is refused with the reason.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { gitGraphsOf, runGit } from '../gitgraph/index.js';
import { localOnlyAt } from '../local-only.js';
import { audit, byWhom } from '../audit/index.js';
import { officeGitEnv } from '../workers/git-identity.js';
import { needsApproval } from '../../shared/roster/autonomy.js';
import { mergedWords, type LocalMergeDone } from '../../shared/local-merge.js';
import { BRANCH_OK, bookOf, commitOn, levelOf, ref, reviewAt, saveBook, type LocalMergeDeps } from './index.js';
import { dcsOf, kindAt } from './describe.js';
import { tellMainNow } from './tell.js';
import { settleMergeAsks } from './asks.js';
import { refusalWords } from '../../shared/merge-refusal.js';
import { originNews } from '../floor-sync/bus.js';

/** Merges the reviewed commit `sha` of the branch into the local default branch. Never a force. */
export async function mergeLocal(
  ctx: Ctx,
  floor: Floor,
  r: { branch: string; sha: string },
  by: { name: string; id?: string },
  deps: Partial<LocalMergeDeps> = {},
): Promise<LocalMergeDone | { ok: false; status: number; error: string }> {
  const git = deps.git ?? runGit;
  const now = deps.now ?? Date.now;
  if (!localOnlyAt(floor.dir)) return { ok: false, status: 409, error: 'This project is on GitHub: merge its pull requests in the PR window, through the merge gate' };
  if (!BRANCH_OK.test(r.branch)) return { ok: false, status: 400, error: 'Not a branch name' };
  const graph = await gitGraphsOf(ctx).graph(floor);
  const main = graph.defaultBranch;
  if (r.branch === main) return { ok: false, status: 400, error: `${main} can't be merged into itself` };
  const c = await commitOn(git, floor.dir, main, r.branch, r.sha);
  if ('error' in c) return { ok: false, status: c.status, error: `Not merged: ${c.error}` };
  const book = bookOf(ctx.cfg.dataDir, floor.id);
  // The review binds the exact commit (E5): the newest review of it must approve.
  const review = reviewAt(book.reviews, r.branch, c.full);
  if (!review) return { ok: false, status: 409, error: `Not merged: @${c.full.slice(0, 7)} of ${r.branch} has no review. Approve exactly that commit first.` };
  if (review.verdict !== 'approve') return { ok: false, status: 409, error: `Not merged: the review of @${c.full.slice(0, 7)} asked for changes` };
  const level = levelOf(ctx, floor);
  // In a temporary worktree off origin/<main>: the project's folder (Studio Pro, the live app) is never mid-merge.
  await git(['fetch', 'origin', '--quiet'], floor.dir).catch(() => '');
  const base = await ref(git, floor.dir, `refs/remotes/origin/${main}`);
  if (!base) return { ok: false, status: 409, error: `The project's local origin has no ${main} to merge into` };
  const newer = Number((await git(['rev-list', '--count', `${c.full}..${c.head}`], floor.dir).catch(() => '0')).trim()) || 0;
  const what = await kindAt(git, floor.dir, base, c.full);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mx-local-merge-'));
  const wt = path.join(tmp, 'wt');
  const env = officeGitEnv();
  const id = ['-c', `user.name=${env.GIT_COMMITTER_NAME}`, '-c', `user.email=${env.GIT_COMMITTER_EMAIL}`, '-c', 'commit.gpgsign=false', '-c', 'core.safecrlf=false'];
  let merge = '';
  try {
    await git(['worktree', 'add', '--detach', wt, base], floor.dir);
    const later = newer ? `\n${newer} newer commit${newer === 1 ? '' : 's'} on ${r.branch} (up to ${c.head.slice(0, 12)}) not included.` : '';
    const notes = what.kind === 'notes' ? ' (notes only)' : '';
    const msg = `Merge ${r.branch} @${c.full.slice(0, 7)} into ${main}${notes} (local merge)\n\nReviewed at ${c.full.slice(0, 12)} by ${review.by}; merged by ${by.name} in Mx Office.${later}\nMx-Office-Local-Merge: ${r.branch}@${c.full}`;
    try {
      await git([...id, 'merge', '--no-ff', '-m', msg, c.full], wt);
    } catch (err) {
      // Which files conflict, in words; never git's own command line (it carries the merge message and its trailer).
      const files = (await git(['diff', '--name-only', '--diff-filter=U'], wt).catch(() => '')).split('\n').map((l) => l.trim()).filter(Boolean);
      await git(['merge', '--abort'], wt).catch(() => '');
      return { ok: false, status: 409, error: refusalWords(c.full, r.branch, main, files, (err as Error).message) };
    }
    merge = (await git(['rev-parse', 'HEAD'], wt)).trim();
    try {
      // No force, ever: a main that moved since the fetch refuses this, and the merge is dropped with the worktree.
      await git(['push', 'origin', `HEAD:refs/heads/${main}`], wt);
    } catch (err) {
      return { ok: false, status: 409, error: `Not merged: ${main} moved on in the project's origin meanwhile (${(err as Error).message.slice(0, 160)}). Try again.` };
    }
  } finally {
    await git(['worktree', 'remove', '--force', wt], floor.dir).catch(() => '');
    rmSync(tmp, { recursive: true, force: true });
  }
  // The team's view of main follows: origin/<main>, the local <main> when no worktree has it checked out (a
  // non-forced refspec: fast-forward only), and the project's folder when it's on main with nothing uncommitted.
  await git(['fetch', 'origin', '--quiet'], floor.dir).catch(() => '');
  await git(['fetch', 'origin', '--quiet', `refs/heads/${main}:refs/heads/${main}`], floor.dir).catch(() => '');
  const cur = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], floor.dir).catch(() => '')).trim();
  const dirty = (await git(['status', '--porcelain', '--untracked-files=no'], floor.dir).catch(() => 'x')).trim();
  if (cur === main && !dirty) await git(['merge', '--ff-only', `origin/${main}`], floor.dir).catch(() => '');
  // origin's main moved: whoever follows it hears (a project on Team Server pushes it there soon: team-server/).
  originNews(floor.dir);
  book.merges.push({ branch: r.branch, sha: c.full, merge, into: main, by: by.name, at: now(), ...(newer ? { newer } : {}) });
  saveBook(ctx.cfg.dataDir, floor.id, book);
  const owner = graph.branches.find((b) => b.name === r.branch)?.worker;
  const dcs = await dcsOf(ctx, floor.id, r.branch, owner?.id);
  const told = tellMainNow(ctx, floor, { main, merge, branch: r.branch, sha: c.full, dcs, newer, reviewedBy: review.by }, owner?.id, deps);
  // Agents' asks to merge what is on main now are marked gone (./asks.ts): the person says Resolved or Still needed.
  // In the background: the answer (and the dialog) doesn't wait for it once main has moved.
  void settleMergeAsks(ctx, floor, git, `refs/remotes/origin/${main}`, main, { force: true }).catch((err: Error) => console.error(`agent-office: couldn't settle ${floor.id}'s merge asks: ${err.message}`));
  const words = mergedWords(c.full, newer);
  audit.record({
    floor: floor.id,
    actor: byWhom(by.name, by.id),
    action: 'local-merge.merge',
    target: { kind: 'branch', id: r.branch, label: r.branch },
    summary: `${by.name} merged ${r.branch} at ${c.full.slice(0, 7)} (reviewed by ${review.by}${what.kind === 'notes' ? ', notes only' : ''}) into ${main} with --no-ff as ${merge.slice(0, 7)}${newer ? `; ${newer} newer commit${newer === 1 ? '' : 's'} not included` : ''}: merged in the office, no GitHub`,
    details: { sha: c.full, head: c.head, newer, merge, into: main, kind: what.kind, dcs: dcs.map((d) => d.id), reviewedBy: review.by, told, autonomy: level, pmDecides: needsApproval(level, 'merge') },
    severity: 'notice',
  });
  return { ok: true, merge, into: main, sha: c.full, newer, words, told };
}
