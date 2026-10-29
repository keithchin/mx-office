// The Project Manager's merge for local-only projects (real-build fix, docs/mockups/product-assessment/
// real-build-test.md P1-3; made safe after the rebuild test, docs/mockups/rebuild-apac/slice-build-report.md).
// A project created with "Keep this project off GitHub" has no pull requests, so the merge gate (server/merge-gate/,
// PR-based) never offers a Merge. Here the same gate in local git:
//
//   review   the PM reviews one commit of a team branch, the one they saw ("Approve at @sha"): a review pins that
//            commit (it must be on the branch and not on main yet), never by one of its commits' authors (E5);
//   merge    exactly the reviewed commit (./merge.ts), even if the branch moved on since: newer commits stay on the
//            branch for a later review, and the merge says so. --no-ff, as the office's identity, never forced,
//            audited, admins only (the routes); then the team is told "main is now @M" (./tell.ts);
//   describe what a branch is (./describe.ts): its DC(s) and the request's title, and whether it is notes only
//            (journal or docs, no model or code changes), plus the confirm step's facts for one commit.
//
// Recorded in <data>/local-merge/<project>.json and the audit log; the review gate counts the merge commits as
// reviewed (review-gate/index.ts). Nothing here runs gh or touches GitHub.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { gitGraphsOf, runGit, type Git } from '../gitgraph/index.js';
import { localOnlyAt, offGitHubAt } from '../local-only.js';
import { writeJsonAtomic } from '../flow/store.js';
import { audit, byWhom } from '../audit/index.js';
import { rosterOf } from '../roster/adapter.js';
import { AUTONOMY, needsApproval, type AutonomyLevel } from '../../shared/roster/autonomy.js';
import type { LocalMergeBranch, LocalMergeConfirm, LocalMergeReview, LocalMergeView } from '../../shared/local-merge.js';
import { dcsOf, impactAt, kindAt, resultsAt, somePaths, unitsAt } from './describe.js';
import { mergeAsks, settleMergeAsks } from './asks.js';
import { fixText } from '../../shared/text-repair.js';

export { mergeLocal } from './merge.js';

export interface LocalMergeBook {
  reviews: LocalMergeReview[];
  merges: { branch: string; sha: string; merge: string; into: string; by: string; at: number; newer?: number }[];
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

export function saveBook(dataDir: string, floorId: string, b: LocalMergeBook) {
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

export const sameSha = (a: string, b: string) => a.length >= 7 && b.length >= 7 && (a.toLowerCase().startsWith(b.toLowerCase()) || b.toLowerCase().startsWith(a.toLowerCase()));

/** The newest review of exactly this commit on the branch, if there is one. */
export function reviewAt(reviews: readonly LocalMergeReview[], branch: string, sha: string): LocalMergeReview | undefined {
  return [...reviews].reverse().find((r) => r.branch === branch && sameSha(r.sha, sha));
}

/** Seams for the tests: git, the clock, and who hears "main is now @M" (./tell.ts). */
export interface LocalMergeDeps {
  git: Git;
  now: () => number;
  /** Delivers the office's note to a worker of the project: undefined when it went in or was held, else why not. */
  deliver?: (workerId: string, text: string, id: string) => string | undefined;
  /** The workers to tell after a merge: the branch's own and the team lead's. */
  recipients?: (ownerId: string | undefined) => { id: string; name: string }[];
}

/** The autonomy level of the project's team (Guided when there's no team). */
export function levelOf(ctx: Ctx, floor: Floor): AutonomyLevel {
  try {
    if (!ctx.floors?.has(floor.id)) return 2;
    return rosterOf(ctx).data(floor.id).settings.autonomy;
  } catch {
    return 2;
  }
}

export const ref = async (git: Git, dir: string, name: string) => (await git(['rev-parse', '--verify', '--quiet', `${name}^{commit}`], dir).catch(() => '')).trim();
const ancestry = new Map<string, Promise<boolean>>();
/** Whether commit `a` is in `b`'s history (kept per pair of full shas, which never change; names are asked anew). */
export const isAncestor = (git: Git, dir: string, a: string, b: string): Promise<boolean> => {
  const fixed = /^[0-9a-f]{40}$/i.test(a) && /^[0-9a-f]{40}$/i.test(b);
  const key = `${dir}|${a}|${b}`;
  const had = fixed ? ancestry.get(key) : undefined;
  if (had) return had;
  const p = git(['merge-base', '--is-ancestor', a, b], dir).then(
    () => true,
    () => false,
  );
  if (fixed) {
    ancestry.set(key, p);
    if (ancestry.size > 1000) ancestry.delete(ancestry.keys().next().value!);
  }
  return p;
};
/** What branches merge into: origin/<main>, else the local <main>. */
export const targetOf = async (git: Git, dir: string, main: string) => (await ref(git, dir, `refs/remotes/origin/${main}`)) || main;

/** The newest review of a commit still on the branch (the head or an ancestor) that main hasn't got yet. */
async function liveReview(git: Git, dir: string, book: LocalMergeBook, branch: string, head: string, target: string): Promise<LocalMergeReview | undefined> {
  const mine = book.reviews.filter((r) => r.branch === branch).slice(-6).reverse();
  for (const r of mine) {
    if (sameSha(r.sha, head)) return r;
    if ((await isAncestor(git, dir, r.sha, head)) && !(await isAncestor(git, dir, r.sha, target))) return r;
  }
  return undefined;
}

/** The task id the worker is on, from the roster (none for a project without a team). */
function taskOf(ctx: Ctx, floor: Floor, workerId: string): string | undefined {
  try {
    if (!ctx.floors?.has(floor.id)) return undefined;
    const members = Object.values(rosterOf(ctx).data(floor.id).members) as { workerId?: string; task?: { taskId?: string } }[];
    return members.find((m) => m.workerId === workerId)?.task?.taskId;
  } catch {
    return undefined;
  }
}

/** One branch's row as it is now (its head read now), or undefined when it has nothing main hasn't. */
export async function rowOf(ctx: Ctx, floor: Floor, branch: string, owner: { id?: string; name?: string } = {}, git: Git = runGit, main?: string, tip?: { sha: string; subject: string }): Promise<LocalMergeBranch | undefined> {
  const m = main ?? (await gitGraphsOf(ctx).graph(floor)).defaultBranch;
  const target = await targetOf(git, floor.dir, m);
  const sha = await ref(git, floor.dir, `refs/heads/${branch}`);
  if (!sha) return undefined;
  const [ahead, behind] = (await git(['rev-list', '--left-right', '--count', `${sha}...${target}`], floor.dir).catch(() => '0 0')).trim().split(/\s+/).map(Number);
  if (!ahead) return undefined;
  const [subject, what, dcs, review] = await Promise.all([
    tip?.sha === sha
      ? Promise.resolve(tip.subject)
      : git(['log', '-1', '--format=%s', sha], floor.dir).then(
          (s) => s.trim(),
          () => '',
        ),
    kindAt(git, floor.dir, target, sha),
    dcsOf(ctx, floor.id, branch, owner.id),
    liveReview(git, floor.dir, bookOf(ctx.cfg.dataDir, floor.id), branch, sha, target),
  ]);
  const newer = review && !sameSha(review.sha, sha) ? Number((await git(['rev-list', '--count', `${review.sha}..${sha}`], floor.dir).catch(() => '0')).trim()) || 0 : 0;
  const task = owner.id ? taskOf(ctx, floor, owner.id) : undefined;
  // Its earlier commits, so an older one (the one an agent asked for, under a newer journal commit) can be approved on its own.
  const commits = ahead > 1 ? await commitsOn(git, floor.dir, target, sha) : [];
  const asked = await askedOn(ctx, floor, git, sha, branch, target);
  return { branch, sha, ahead, behind: behind || 0, subject, ...(owner.name ? { owner: owner.name } : {}), ...(dcs.length ? { dcs } : {}), ...(task ? { task } : {}), kind: what.kind, files: what.files, ...(review ? { review } : {}), ...(newer ? { newer } : {}), ...(commits.length ? { commits } : {}), ...(asked ? { asked } : {}) };
}

/** The branch's commits main hasn't got, newest first, without its head (at most 10). */
async function commitsOn(git: Git, dir: string, target: string, sha: string): Promise<{ sha: string; subject: string }[]> {
  const out = await git(['log', '-n11', '--format=%H%x00%s', `${target}..${sha}`], dir).catch(() => '');
  return out
    .split('\n')
    .map((l) => l.split('\u0000'))
    .filter((p) => /^[0-9a-f]{40}$/.test(p[0] ?? ''))
    .map(([s, subject]) => ({ sha: s, subject: (subject ?? '').slice(0, 120) }))
    .filter((c) => c.sha !== sha)
    .slice(0, 10);
}

/** The newest commit on the branch (not on main) that an agent asked to have merged, and who. */
async function askedOn(ctx: Ctx, floor: Floor, git: Git, head: string, branch: string, target: string): Promise<{ sha: string; by: string } | undefined> {
  for (const a of mergeAsks(ctx, floor.id).slice(0, 20)) {
    if (a.branches.length && !a.branches.includes(branch)) continue;
    for (const s of a.shas) {
      const full = await ref(git, floor.dir, s);
      if (!full) continue;
      if ((full === head || (await isAncestor(git, floor.dir, full, head))) && !(await isAncestor(git, floor.dir, full, target))) return { sha: full, by: a.by };
    }
  }
  return undefined;
}

/** The branches the team has ahead of main, with what they are and their review. Empty for a project that isn't local only. */
export async function localMergeView(ctx: Ctx, floor: Floor): Promise<LocalMergeView> {
  const level = levelOf(ctx, floor);
  const base: LocalMergeView = { floor: floor.id, localOnly: localOnlyAt(floor.dir), ...(offGitHubAt(floor.dir) === 'teamserver' ? { teamServer: true } : {}), main: 'main', branches: [], level, levelName: AUTONOMY[level].name, pmDecides: needsApproval(level, 'merge') };
  if (!base.localOnly) return base;
  const g = await gitGraphsOf(ctx).graph(floor);
  const main = g.defaultBranch;
  const mainSha = await ref(runGit, floor.dir, await targetOf(runGit, floor.dir, main));
  // The graph names the branches (cached up to a minute); each head, review and kind are read now.
  const listed = g.branches.filter((b) => b.name !== main && (b.worker || b.where !== 'remote')).slice(0, 12);
  const rows = await Promise.all(listed.map((b) => rowOf(ctx, floor, b.name, b.worker ? { id: b.worker.id, name: b.worker.name } : {}, runGit, main, { sha: b.sha, subject: b.subject })));
  // Merge asks for commits that are on main now are marked gone (./asks.ts), at most once a minute.
  void settleMergeAsks(ctx, floor, runGit, await targetOf(runGit, floor.dir, main), main);
  return { ...base, main, ...(mainSha ? { mainSha } : {}), branches: rows.filter((b): b is LocalMergeBranch => !!b).slice(0, 10) };
}

/** The branch's head now, the reviewed commit in full, and the authors of the commits it brings in (local git only). */
export async function commitOn(git: Git, dir: string, main: string, branch: string, sha: string): Promise<{ head: string; full: string; target: string; authors: string[] } | { status: number; error: string }> {
  const head = await ref(git, dir, `refs/heads/${branch}`);
  if (!head) return { status: 404, error: `There's no branch ${branch} in the project` };
  const full = /^[0-9a-f]{7,40}$/i.test(sha) ? await ref(git, dir, sha) : '';
  if (!full) return { status: 404, error: `The commit @${sha.slice(0, 7) || '?'} doesn't exist in the project any more (was the branch rewritten?): review what ${branch} has now` };
  if (full !== head && !(await isAncestor(git, dir, full, head))) return { status: 409, error: `@${full.slice(0, 7)} is no longer on ${branch} (its history was rewritten): review its head @${head.slice(0, 7)} instead` };
  const target = await targetOf(git, dir, main);
  if (await isAncestor(git, dir, full, target)) return { status: 409, error: `@${full.slice(0, 7)} is on ${main} already: nothing to merge` };
  const authors = (await git(['log', '--format=%an', `${target}..${full}`], dir).catch(() => ''))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return { head, full, target, authors: [...new Set(authors)] };
}

export const BRANCH_OK = /^[\w./-]{1,200}$/;

/** A person's review of the commit they saw. Refuses a commit not on the branch or on main already, and a reviewer who authored commits in it. */
export async function reviewLocal(
  ctx: Ctx,
  floor: Floor,
  r: { branch: string; sha: string; verdict: 'approve' | 'changes'; note?: string },
  by: { name: string; id?: string },
  deps: Partial<LocalMergeDeps> = {},
): Promise<{ ok: true; review: LocalMergeReview; branch?: LocalMergeBranch } | { ok: false; status: number; error: string }> {
  const git = deps.git ?? runGit;
  const now = deps.now ?? Date.now;
  if (!localOnlyAt(floor.dir)) return { ok: false, status: 409, error: 'This project is on GitHub: review and merge its pull requests in the PR window' };
  if (!BRANCH_OK.test(r.branch)) return { ok: false, status: 400, error: 'Not a branch name' };
  const g = await gitGraphsOf(ctx).graph(floor);
  const main = g.defaultBranch;
  const c = await commitOn(git, floor.dir, main, r.branch, r.sha);
  if ('error' in c) return { ok: false, ...c };
  if (c.authors.some((a) => a.toLowerCase() === by.name.trim().toLowerCase())) return { ok: false, status: 409, error: `${by.name} authored commits on ${r.branch}, so that review wouldn't be independent` };
  const review: LocalMergeReview = { branch: r.branch, sha: c.full, verdict: r.verdict, by: by.name, ...(by.id ? { byId: by.id } : {}), at: now(), ...(r.note ? { note: fixText(r.note).replace(/\s+/g, ' ').trim().slice(0, 500) } : {}) };
  const b = bookOf(ctx.cfg.dataDir, floor.id);
  b.reviews.push(review);
  saveBook(ctx.cfg.dataDir, floor.id, b);
  const later = c.full === c.head ? '' : ` (the head is @${c.head.slice(0, 7)}: newer commits aren't part of this review)`;
  audit.record({ floor: floor.id, actor: byWhom(by.name, by.id), action: 'local-merge.review', target: { kind: 'branch', id: r.branch, label: r.branch }, summary: `${by.name} ${r.verdict === 'approve' ? 'approved' : 'asked for changes on'} ${r.branch} at ${c.full.slice(0, 7)}${later}`, details: { sha: c.full, head: c.head, verdict: r.verdict } });
  // The row as it is now, for the panel to show at once (no second look, no lag).
  const w = g.branches.find((x) => x.name === r.branch)?.worker;
  const row = await rowOf(ctx, floor, r.branch, w ? { id: w.id, name: w.name } : {}, git, main).catch(() => undefined);
  return { ok: true, review, ...(row ? { branch: row } : {}) };
}

/** The confirm step's facts for merging `sha` of `branch`: refused like the merge would be when it can't. */
export async function confirmLocal(ctx: Ctx, floor: Floor, branch: string, sha: string, deps: Partial<LocalMergeDeps> = {}): Promise<{ ok: true; confirm: LocalMergeConfirm } | { ok: false; status: number; error: string }> {
  const git = deps.git ?? runGit;
  if (!localOnlyAt(floor.dir)) return { ok: false, status: 409, error: 'This project is on GitHub: merge its pull requests in the PR window' };
  if (!BRANCH_OK.test(branch)) return { ok: false, status: 400, error: 'Not a branch name' };
  const g = await gitGraphsOf(ctx).graph(floor);
  const main = g.defaultBranch;
  const c = await commitOn(git, floor.dir, main, branch, sha);
  if ('error' in c) return { ok: false, ...c };
  const w = g.branches.find((x) => x.name === branch)?.worker;
  const what = await kindAt(git, floor.dir, c.target, c.full);
  const [subject, newer, dcs, results, units, impact] = await Promise.all([
    git(['log', '-1', '--format=%s', c.full], floor.dir).then(
      (s) => s.trim(),
      () => '',
    ),
    git(['rev-list', '--count', `${c.full}..${c.head}`], floor.dir).then(
      (s) => Number(s.trim()) || 0,
      () => 0,
    ),
    dcsOf(ctx, floor.id, branch, w?.id),
    resultsAt(ctx, floor.id, c.full),
    what.fork && what.files.model ? unitsAt(ctx, floor, what.fork, c.full) : Promise.resolve([] as string[]),
    impactAt(ctx, floor, git, what.fork, c.full, what.files),
  ]);
  const level = levelOf(ctx, floor);
  const review = reviewAt(bookOf(ctx.cfg.dataDir, floor.id).reviews, branch, c.full);
  return {
    ok: true,
    confirm: { floor: floor.id, branch, main, sha: c.full, subject, head: c.head, newer, kind: what.kind, files: what.files, paths: somePaths(what.paths), units, dcs, checks: results.checks, journeys: results.journeys, dataImpact: impact, ...(review ? { review } : {}), levelName: AUTONOMY[level].name, pmDecides: needsApproval(level, 'merge') },
  };
}
