// One repository's worktree cleanup: the git worktrees under its .agent-office/worktrees/ that no
// worker of the office has any more (sent home, gone), whose branch is merged into the branch pull
// requests go to (a merge, a rebase or a squash: the content is there), with no uncommitted or untracked
// changes, are removed with their branch. Anything else is kept and said why; worktrees made outside
// .agent-office/worktrees/ (a temp folder, next to the project) are only reported, except the setup
// panel's own ao-gates-* gate-check worktrees left in the temp folder (sweepGateLeftovers). Before git removes a
// folder, every symlink and junction in it is unlinked without being followed, so a node_modules
// junction's target (another checkout's packages) is never touched.

import { lstat, readdir, rm, rmdir, unlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SweepItem } from '../../shared/connections.js';
import { WORKTREES_DIR, gitError } from '../worktrees.js';
import { execFileOffP } from '../offloop/exec.js';

export async function git(args: string[], cwd: string): Promise<string> {
  // Started off the event loop: on Windows each start held it (offloop/exec.ts; the busy office check, 2026-10-08).
  const { stdout } = await execFileOffP('git', args, { cwd, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return stdout.trim();
}
const ok = (args: string[], cwd: string) => git(args, cwd).then(() => true, () => false);

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
export const within = (root: string, p: string) => {
  const rel = path.relative(norm(root), norm(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
export const samePath = (a: string, b: string) => norm(a) === norm(b);

export interface ListedTree {
  path: string;
  branch?: string;
  head?: string;
  locked?: boolean;
  /** Its folder is gone (git worktree prune would forget it). */
  prunable?: boolean;
  /** The repository's own checkout (the first one git lists). */
  main?: boolean;
}

/** `git worktree list --porcelain`, every entry. */
export async function listWorktrees(dir: string): Promise<ListedTree[]> {
  const out: ListedTree[] = [];
  let cur: ListedTree | undefined;
  for (const line of (await git(['worktree', 'list', '--porcelain'], dir)).split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: path.resolve(line.slice(9).trim()), main: out.length === 0 };
      out.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim();
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    else if (line.startsWith('locked')) cur.locked = true;
    else if (line.startsWith('prunable')) cur.prunable = true;
  }
  return out;
}

/** The refs pull requests land on: origin's copy of the branch the project is on, and origin's default branch. */
export async function targetRefs(dir: string): Promise<string[]> {
  const refs: string[] = [];
  const has = (ref: string) => ok(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], dir);
  const current = await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).catch(() => '');
  if (current && current !== 'HEAD' && (await has(`refs/remotes/origin/${current}`))) refs.push(`refs/remotes/origin/${current}`);
  const head = await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], dir).catch(() => '');
  if (head && !refs.includes(head)) refs.push(head);
  for (const b of ['main', 'master']) if (!refs.length && (await has(`refs/remotes/origin/${b}`))) refs.push(`refs/remotes/origin/${b}`);
  // No origin at all: the project's own branch.
  if (!refs.length && current && current !== 'HEAD') refs.push(`refs/heads/${current}`);
  return refs;
}

/** The identity for commits the office makes only to compare trees (never pushed, never on a branch). */
const SYNTHETIC_COMMITTER = ['-c', 'user.name=Agent Office', '-c', 'user.email=agent-office@localhost', '-c', 'commit.gpgsign=false'];

/**
 * Whether everything on `branch` is in `into`: it's an ancestor (merged, fast-forwarded), or its changes
 * since they parted are one commit's worth that `into` already has (squash- or rebase-merged), found
 * the way `git cherry` finds a patch that's already upstream.
 */
export async function isMerged(dir: string, branch: string, into: string): Promise<boolean> {
  if (await ok(['merge-base', '--is-ancestor', branch, into], dir)) return true;
  try {
    const base = await git(['merge-base', into, branch], dir);
    const tree = await git(['rev-parse', `${branch}^{tree}`], dir);
    if (tree === (await git(['rev-parse', `${base}^{tree}`], dir))) return true;
    // A throwaway commit only `git cherry` reads, never a ref: its own identity (and no signing), so the
    // check works on a machine with no git user configured (a CI runner, a fresh office machine), where
    // commit-tree would fail and every squash-merged worktree would be kept as "not merged".
    const squashed = await git([...SYNTHETIC_COMMITTER, 'commit-tree', tree, '-p', base, '-m', 'agent-office: squash check'], dir);
    return (await git(['cherry', into, squashed], dir)).startsWith('-');
  } catch {
    return false;
  }
}

/** Unlinks a symlink or junction itself, never what it points at. */
async function unlinkLink(p: string) {
  try {
    await unlink(p);
  } catch {
    // A directory junction or symlink on Windows: rmdir takes the link away and leaves its target.
    await rmdir(p);
  }
}

/** Takes every symlink and junction out of `dir` (not following any), so deleting what's left can't reach outside it. */
export async function unlinkLinks(dir: string): Promise<number> {
  let n = 0;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const p = path.join(dir, name);
    const st = await lstat(p).catch(() => undefined);
    if (!st) continue;
    if (st.isSymbolicLink()) {
      await unlinkLink(p);
      n++;
    } else if (st.isDirectory() && name !== '.git') n += await unlinkLinks(p);
  }
  return n;
}

/** The setup panel's gate-check runs in temporary detached worktrees named so (wizard/gate-source.ts). */
export const GATE_PREFIX = 'ao-gates-';
/** A gate-check gives up after 5 minutes; one this old can't be running any more. */
export const GATE_STALE_MS = 15 * 60_000;

export interface GateSweepOptions {
  /** A gate-check is running for this floor now (gate-source.ts's lock), so none of its worktrees are touched. */
  busy?: () => boolean;
  /** When this office started: a gate worktree made before then belongs to no running gate-check. */
  startedAt: number;
  now?: number;
  /** Where gate-check makes them (the system's temp folder). */
  tmpRoot?: string;
  floor?: string;
}

/**
 * Gate-check worktrees left behind by an office that stopped mid-run: detached worktrees under the temp
 * folder named ao-gates-*, made before this office started or longer ago than any gate-check runs, while
 * no gate-check of this floor is running. Each is removed (links unlinked first, never followed; it's a
 * throwaway checkout of a commit, so whatever gate-check wrote in it goes too), then `git worktree prune`.
 */
export async function sweepGateLeftovers(dir: string, opts: GateSweepOptions): Promise<SweepItem[]> {
  const items: SweepItem[] = [];
  if (opts.busy?.()) return items;
  const tmpRoot = real(opts.tmpRoot ?? os.tmpdir());
  const now = opts.now ?? Date.now();
  let trees: ListedTree[];
  try {
    trees = await listWorktrees(dir);
  } catch {
    return items;
  }
  for (const wt of trees) {
    if (wt.main || wt.branch || !path.basename(wt.path).startsWith(GATE_PREFIX) || !within(tmpRoot, real(wt.path))) continue;
    if (wt.prunable) continue; // its folder is gone: the prune below forgets it
    const st = await lstat(wt.path).catch(() => undefined);
    if (!st || st.isSymbolicLink()) continue;
    const made = Math.min(st.birthtimeMs || st.mtimeMs, st.mtimeMs);
    if (made >= opts.startedAt && now - made < GATE_STALE_MS) continue;
    if (opts.busy?.()) break;
    try {
      await unlinkLinks(wt.path);
      await git(['worktree', 'remove', '--force', '--force', wt.path], dir).catch(() => undefined);
      await rm(wt.path, { recursive: true, force: true });
      items.push({ floor: opts.floor, path: wt.path, action: 'removed', why: 'a gate-check worktree left behind by an office that stopped mid-run' });
    } catch (err) {
      items.push({ floor: opts.floor, path: wt.path, action: 'failed', why: gitError(err) });
    }
  }
  await git(['worktree', 'prune'], dir).catch(() => undefined);
  return items;
}

export interface SweepOptions {
  /** Whether a worker of the office has the worktree at this path (or the workspace it's in). */
  owned(abs: string): boolean;
  floor?: string;
  dryRun?: boolean;
}

/** Sweeps one repository (`dir`, a floor's checkout). */
export async function sweepRepo(dir: string, opts: SweepOptions): Promise<SweepItem[]> {
  const root = real(dir);
  const home = path.join(root, WORKTREES_DIR);
  const items: SweepItem[] = [];
  const item = (wt: ListedTree, action: SweepItem['action'], why: string) => items.push({ floor: opts.floor, path: wt.path, branch: wt.branch, action, why });
  let trees: ListedTree[];
  try {
    trees = await listWorktrees(dir);
  } catch (err) {
    return [{ floor: opts.floor, path: dir, action: 'failed', why: `couldn’t list its worktrees: ${gitError(err)}` }];
  }
  let into: string[] | undefined;
  for (const wt of trees) {
    if (wt.main || wt.prunable || samePath(wt.path, root)) continue;
    if (path.basename(wt.path).startsWith(GATE_PREFIX) && !wt.branch) continue; // the gate-check's own (sweepGateLeftovers)
    if (!within(home, wt.path)) {
      // Another floor's workspace (a worker across repositories) is that office's to look after.
      if (!/[\\/]\.agent-office[\\/]worktrees[\\/]/i.test(wt.path)) item(wt, 'outside', 'made outside the project’s .agent-office/worktrees/, so the office doesn’t remove it: delete it with git worktree remove once you’re sure');
      continue;
    }
    if (opts.owned(wt.path)) continue;
    if (wt.locked) {
      item(wt, 'kept', 'locked (git worktree lock)');
      continue;
    }
    if (!wt.branch) {
      item(wt, 'kept', 'not on a branch (detached HEAD)');
      continue;
    }
    const st = await lstat(wt.path).catch(() => undefined);
    if (!st || st.isSymbolicLink()) {
      item(wt, 'kept', 'its folder is a link, not a folder');
      continue;
    }
    const dirty = await git(['status', '--porcelain'], wt.path).then((s) => s.split('\n').filter(Boolean).length, () => -1);
    if (dirty) {
      item(wt, 'kept', dirty < 0 ? 'couldn’t read its status' : `${dirty} uncommitted or untracked change${dirty === 1 ? '' : 's'}`);
      continue;
    }
    into ??= await targetRefs(dir);
    let merged = false;
    for (const ref of into) if (!merged) merged = await isMerged(dir, wt.branch, ref);
    if (!merged) {
      item(wt, 'kept', into.length ? `not merged into ${into.map((r) => r.replace(/^refs\/(remotes\/|heads\/)/, '')).join(' or ')}` : 'no branch to compare it with');
      continue;
    }
    if (opts.dryRun) {
      item(wt, 'removed', 'merged, clean and no worker has it (dry run)');
      continue;
    }
    try {
      const links = await unlinkLinks(wt.path);
      // It was clean a moment ago: if git now sees a change, it's a tracked symlink just unlinked.
      await git(['worktree', 'remove', wt.path], dir).catch((err) => (links ? git(['worktree', 'remove', '--force', wt.path], dir) : Promise.reject(err)));
      await git(['branch', '-D', wt.branch], dir).catch(() => undefined);
      item(wt, 'removed', 'merged, clean and no worker has it');
    } catch (err) {
      item(wt, 'failed', gitError(err));
    }
  }
  return items;
}
