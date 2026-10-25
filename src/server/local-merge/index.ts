// The Project Manager's merge for local-only projects (real-build fix, docs/mockups/product-assessment/
// real-build-test.md P1-3). A project created with "Keep this project off GitHub" has no pull requests, so
// the merge gate (server/merge-gate/, PR-based) never offers a Merge, and under Guided ("you decide merges")
// the work reached main only because someone asked the lead in chat. Here the same gate in local git:
//
//   review   the PM reviews a team branch at the exact head they saw (a review bound to the head: a branch
//            that moved since needs a new one), never by one of its commits' authors (the E5 rule);
//   merge    only with an approving review of the branch's head now: merged into the local default branch with
//            `git merge --no-ff` in a temporary worktree off origin/<default>, committed as the office's own
//            identity (workers/git-identity.ts), then pushed to the project's local origin without force (a
//            main that moved meanwhile refuses the push: nothing changes). A conflict aborts and says so.
//            Recorded here (<data>/local-merge/<project>.json) and in the audit log, and the review gate counts
//            the merge commit as reviewed (review-gate/index.ts), not as "reached main without a pull request".
//
// Admins only (the routes). Nothing here runs gh or touches GitHub; the project's folder moves to the new main
// only when it is on the default branch with nothing uncommitted (fast-forward only).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { gitGraphsOf, runGit, type Git } from '../gitgraph/index.js';
import { localOnlyAt } from '../local-only.js';
import { writeJsonAtomic } from '../flow/store.js';
import { audit, byWhom } from '../audit/index.js';
import { officeGitEnv } from '../workers/git-identity.js';
import { rosterOf } from '../roster/adapter.js';
import { AUTONOMY, needsApproval, type AutonomyLevel } from '../../shared/roster/autonomy.js';
import type { LocalMergeBranch, LocalMergeReview, LocalMergeView } from '../../shared/local-merge.js';

export interface LocalMergeBook {
  reviews: LocalMergeReview[];
  merges: { branch: string; sha: string; merge: string; into: string; by: string; at: number }[];
}

const KEEP = 200;
const fileOf = (dataDir: string, floorId: string) => path.join(dataDir, 'local-merge', `${floorId.replace(/[^A-Za-z0-9_.-]/g, '-')}.json`);
const books = new Map<string, LocalMergeBook>();

/** The project's reviews and merges (kept in memory once read). */
export function bookOf(dataDir: string, floorId: string): LocalMergeBook {
  const f = fileOf(dataDir, floorId);
  let b = books.get(f);
  if (b) return b;
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as Partial<LocalMergeBook>;
    b = { reviews: Array.isArray(raw.reviews) ? raw.reviews : [], merges: Array.isArray(raw.merges) ? raw.merges : [] };
  } catch {
    b = { reviews: [], merges: [] };
  }
  books.set(f, b);
  return b;
}

function save(dataDir: string, floorId: string, b: LocalMergeBook) {
  b.reviews = b.reviews.slice(-KEEP);
  b.merges = b.merges.slice(-KEEP);
  writeJsonAtomic(fileOf(dataDir, floorId), b);
}

/** The merge commits the office made for local-only projects: the review gate counts them as reviewed merges. */
export function localMergeCommits(dataDir: string, floorId: string): string[] {
  return bookOf(dataDir, floorId).merges.map((m) => m.merge);
}

/** Tests: forget what was read. */
export const forgetLocalMerges = () => books.clear();

const sameSha = (a: string, b: string) => a.length >= 7 && b.length >= 7 && (a.toLowerCase().startsWith(b.toLowerCase()) || b.toLowerCase().startsWith(a.toLowerCase()));

/** The approving review of exactly this head, if there is one (a review of an older head doesn't count). */
export function reviewOfHead(reviews: readonly LocalMergeReview[], branch: string, head: string): LocalMergeReview | undefined {
  return [...reviews].reverse().find((r) => r.branch === branch && sameSha(r.sha, head));
}

/** Seams for the tests: git and the clock. */
export interface LocalMergeDeps {
  git: Git;
  now: () => number;
}

/** The autonomy level of the project's team (Guided when there's no team). */
function levelOf(ctx: Ctx, floor: Floor): AutonomyLevel {
  try {
    if (!ctx.floors?.has(floor.id)) return 2;
    return rosterOf(ctx).data(floor.id).settings.autonomy;
  } catch {
    return 2;
  }
}

/** The branches the team has ahead of main, with their review at the head. Empty for a project that isn't local only. */
export async function localMergeView(ctx: Ctx, floor: Floor): Promise<LocalMergeView> {
  const level = levelOf(ctx, floor);
  const base: LocalMergeView = { floor: floor.id, localOnly: localOnlyAt(floor.dir), main: 'main', branches: [], level, levelName: AUTONOMY[level].name, pmDecides: needsApproval(level, 'merge') };
  if (!base.localOnly) return base;
  const g = await gitGraphsOf(ctx).graph(floor);
  const book = bookOf(ctx.cfg.dataDir, floor.id);
  const git = runGit;
  const main = g.defaultBranch;
  const target = (await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${main}^{commit}`], floor.dir).catch(() => '')).trim() || main;
  // The graph names the branches (cached up to a minute); each head and how far ahead it is are read now, so a review
  // and a merge always name the head as it is.
  const listed = g.branches.filter((b) => b.name !== main && (b.worker || b.where !== 'remote')).slice(0, 12);
  const fresh = await Promise.all(
    listed.map(async (b): Promise<LocalMergeBranch | undefined> => {
      const sha = (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${b.name}^{commit}`], floor.dir).catch(() => '')).trim();
      if (!sha) return undefined;
      const [ahead, behind] = (await git(['rev-list', '--left-right', '--count', `${sha}...${target}`], floor.dir).catch(() => '0 0')).trim().split(/\s+/).map(Number);
      if (!ahead) return undefined;
      const subject = sha === b.sha ? b.subject : (await git(['log', '-1', '--format=%s', sha], floor.dir).catch(() => '')).trim();
      const review = reviewOfHead(book.reviews, b.name, sha);
      return { branch: b.name, sha, ahead, behind: behind || 0, subject, ...(b.worker ? { owner: b.worker.name } : {}), ...(review ? { review } : {}) };
    }),
  );
  return { ...base, main, branches: fresh.filter((b): b is LocalMergeBranch => !!b).slice(0, 6) };
}

/** The branch's head now, and its commits' authors since it left main (local git only). */
async function headOf(git: Git, dir: string, main: string, branch: string): Promise<{ head: string; authors: string[] } | undefined> {
  const head = (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`], dir).catch(() => '')).trim();
  if (!head) return undefined;
  const base = (await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${main}^{commit}`], dir).catch(() => '')).trim() || main;
  const authors = (await git(['log', '--format=%an', `${base}..${head}`], dir).catch(() => ''))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return { head, authors: [...new Set(authors)] };
}

const BRANCH_OK = /^[\w./-]{1,200}$/;

/** A person's review of the branch head they saw. Refuses a head that moved on, and a reviewer who authored commits on it. */
export async function reviewLocal(
  ctx: Ctx,
  floor: Floor,
  r: { branch: string; sha: string; verdict: 'approve' | 'changes'; note?: string },
  by: { name: string; id?: string },
  deps: Partial<LocalMergeDeps> = {},
): Promise<{ ok: true; review: LocalMergeReview } | { ok: false; status: number; error: string }> {
  const git = deps.git ?? runGit;
  const now = deps.now ?? Date.now;
  if (!localOnlyAt(floor.dir)) return { ok: false, status: 409, error: 'This project is on GitHub: review and merge its pull requests in the PR window' };
  if (!BRANCH_OK.test(r.branch)) return { ok: false, status: 400, error: 'Not a branch name' };
  const main = (await gitGraphsOf(ctx).graph(floor)).defaultBranch;
  const h = await headOf(git, floor.dir, main, r.branch);
  if (!h) return { ok: false, status: 404, error: `There's no branch ${r.branch} in the project` };
  if (!sameSha(h.head, r.sha)) return { ok: false, status: 409, error: `${r.branch} moved on: you reviewed ${r.sha.slice(0, 7) || 'nothing'}, its head is now ${h.head.slice(0, 7)}. Look at the new commits and review again.` };
  if (h.authors.some((a) => a.toLowerCase() === by.name.trim().toLowerCase())) return { ok: false, status: 409, error: `${by.name} authored commits on ${r.branch}, so that review wouldn't be independent` };
  const review: LocalMergeReview = { branch: r.branch, sha: h.head, verdict: r.verdict, by: by.name, ...(by.id ? { byId: by.id } : {}), at: now(), ...(r.note ? { note: r.note.replace(/\s+/g, ' ').trim().slice(0, 500) } : {}) };
  const b = bookOf(ctx.cfg.dataDir, floor.id);
  b.reviews.push(review);
  save(ctx.cfg.dataDir, floor.id, b);
  audit.record({ floor: floor.id, actor: byWhom(by.name, by.id), action: 'local-merge.review', target: { kind: 'branch', id: r.branch, label: r.branch }, summary: `${by.name} ${r.verdict === 'approve' ? 'approved' : 'asked for changes on'} ${r.branch} at ${h.head.slice(0, 7)}`, details: { sha: h.head, verdict: r.verdict } });
  return { ok: true, review };
}

/**
 * Merges the branch into the local default branch, with an approving review of its head now. Never a force:
 * a main that moved meanwhile refuses the push and nothing changes.
 */
export async function mergeLocal(
  ctx: Ctx,
  floor: Floor,
  r: { branch: string; sha: string },
  by: { name: string; id?: string },
  deps: Partial<LocalMergeDeps> = {},
): Promise<{ ok: true; merge: string; into: string } | { ok: false; status: number; error: string }> {
  const git = deps.git ?? runGit;
  const now = deps.now ?? Date.now;
  if (!localOnlyAt(floor.dir)) return { ok: false, status: 409, error: 'This project is on GitHub: merge its pull requests in the PR window, through the merge gate' };
  if (!BRANCH_OK.test(r.branch)) return { ok: false, status: 400, error: 'Not a branch name' };
  const graph = await gitGraphsOf(ctx).graph(floor);
  const main = graph.defaultBranch;
  if (r.branch === main) return { ok: false, status: 400, error: `${main} can't be merged into itself` };
  const h = await headOf(git, floor.dir, main, r.branch);
  if (!h) return { ok: false, status: 404, error: `There's no branch ${r.branch} in the project` };
  if (!sameSha(h.head, r.sha)) return { ok: false, status: 409, error: `${r.branch} moved on since you looked (${r.sha.slice(0, 7)} → ${h.head.slice(0, 7)}): review its new head first` };
  const book = bookOf(ctx.cfg.dataDir, floor.id);
  const review = reviewOfHead(book.reviews, r.branch, h.head);
  if (!review) return { ok: false, status: 409, error: `Not merged: ${r.branch} has no review of its head ${h.head.slice(0, 7)}. Review it first (a review of an older head doesn't count).` };
  if (review.verdict !== 'approve') return { ok: false, status: 409, error: `Not merged: the review of ${h.head.slice(0, 7)} asked for changes` };
  const level = levelOf(ctx, floor);
  // In a temporary worktree off origin/<main>: the project's folder (Studio Pro, the live app) is never mid-merge.
  await git(['fetch', 'origin', '--quiet'], floor.dir).catch(() => '');
  const base = (await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${main}^{commit}`], floor.dir).catch(() => '')).trim();
  if (!base) return { ok: false, status: 409, error: `The project's local origin has no ${main} to merge into` };
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mx-local-merge-'));
  const wt = path.join(tmp, 'wt');
  const env = officeGitEnv();
  const id = ['-c', `user.name=${env.GIT_COMMITTER_NAME}`, '-c', `user.email=${env.GIT_COMMITTER_EMAIL}`, '-c', 'commit.gpgsign=false', '-c', 'core.safecrlf=false'];
  let merge = '';
  try {
    await git(['worktree', 'add', '--detach', wt, base], floor.dir);
    const msg = `Merge ${r.branch} into ${main} (local only)\n\nReviewed at ${h.head.slice(0, 12)} by ${review.by}; merged by ${by.name} in Mx Office.\nMx-Office-Local-Merge: ${r.branch}@${h.head}`;
    try {
      await git([...id, 'merge', '--no-ff', '-m', msg, h.head], wt);
    } catch (err) {
      await git(['merge', '--abort'], wt).catch(() => '');
      return { ok: false, status: 409, error: `Not merged: ${r.branch} conflicts with ${main} (${(err as Error).message.slice(0, 160)}). Ask the lead to bring ${main} into the branch, then review its new head.` };
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
  // The project's folder follows when it's on main with nothing uncommitted: fast-forward only.
  await git(['fetch', 'origin', '--quiet'], floor.dir).catch(() => '');
  const cur = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], floor.dir).catch(() => '')).trim();
  const dirty = (await git(['status', '--porcelain', '--untracked-files=no'], floor.dir).catch(() => 'x')).trim();
  if (cur === main && !dirty) await git(['merge', '--ff-only', `origin/${main}`], floor.dir).catch(() => '');
  book.merges.push({ branch: r.branch, sha: h.head, merge, into: main, by: by.name, at: now() });
  save(ctx.cfg.dataDir, floor.id, book);
  audit.record({
    floor: floor.id,
    actor: byWhom(by.name, by.id),
    action: 'local-merge.merge',
    target: { kind: 'branch', id: r.branch, label: r.branch },
    summary: `${by.name} merged ${r.branch} (${h.head.slice(0, 7)}, reviewed by ${review.by}) into ${main} with --no-ff as ${merge.slice(0, 7)}: local only, no GitHub`,
    details: { sha: h.head, merge, into: main, reviewedBy: review.by, autonomy: level, pmDecides: needsApproval(level, 'merge') },
    severity: 'notice',
  });
  return { ok: true, merge, into: main };
}
