// The few git calls the deliverables scan makes, read-only: what a checkout counts as its files, which
// office branches there are, what's on one (ls-tree, cached by the commit it points at, so asking
// again costs nothing until someone pushes), and one file's bytes from a branch.

import { execFile } from 'node:child_process';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

function run(args: string[], cwd: string, maxBuffer = 32 * 1024 * 1024): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer, timeout: 20_000, env: ENV, windowsHide: true }, (err, out) => resolve(err ? undefined : out));
  });
}

/** A file's bytes, at most `max` (more is an error, not a cut). */
export function gitBytes(args: string[], cwd: string, max: number): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'buffer', maxBuffer: max, timeout: 20_000, env: ENV, windowsHide: true }, (err, out) => resolve(err ? undefined : out));
  });
}

/** The checkout's files as git has them: tracked, or new and not ignored. Undefined when it isn't a git checkout. */
export async function checkoutFiles(dir: string): Promise<string[] | undefined> {
  const out = await run(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], dir);
  return out === undefined ? undefined : [...new Set(out.split('\0').filter(Boolean))];
}

/**
 * The blob each tracked file has in the index, without the ones changed in the working tree since
 * HEAD (or new): a file whose id matches a branch's is the same file, whatever line endings the
 * checkout gave it.
 */
export async function committedIds(dir: string): Promise<Map<string, string>> {
  const [staged, changed] = await Promise.all([run(['ls-files', '-s', '-z'], dir), run(['diff', '--name-only', '-z', 'HEAD'], dir)]);
  const out = new Map<string, string>();
  const dirty = new Set((changed ?? '').split('\0').filter(Boolean));
  for (const rec of (staged ?? '').split('\0')) {
    // <mode> SP <object> SP <stage> TAB <path>
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const p = rec.slice(tab + 1);
    if (!dirty.has(p)) out.set(p, rec.slice(0, tab).split(' ')[1]);
  }
  return out;
}

export interface BranchRef {
  /** office/pixel-31e0, or origin/office/x for one only on GitHub. */
  name: string;
  sha: string;
  /** Its last commit, ms. */
  at: number;
}

/** A branch name the office passes to git: no options, no revision syntax. */
export const safeBranch = (b: string) => /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(b) && !b.includes('..') && !b.endsWith('.lock') && !b.endsWith('/');

/**
 * The office's branches (office/*, local and on origin) and any others named in `also` (the team's
 * worktree branches), newest first, without the one checked out in `dir` and without a remote copy
 * of a local one.
 */
export async function officeBranches(dir: string, also: readonly string[] = [], max = 40): Promise<BranchRef[]> {
  const fmt = '%(refname)%00%(objectname)%00%(committerdate:unix)';
  const [out, head] = await Promise.all([run(['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes/origin/office'], dir), run(['symbolic-ref', '-q', '--short', 'HEAD'], dir)]);
  if (out === undefined) return [];
  const current = head?.trim();
  const wanted = new Set(also);
  const local = new Map<string, BranchRef>();
  const remote = new Map<string, BranchRef>();
  for (const line of out.split('\n')) {
    const [ref, sha, at] = line.split('\0');
    if (!ref || !sha) continue;
    const r = { sha, at: Number(at) * 1000 || 0 };
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice('refs/heads/'.length);
      if (name !== current && (name.startsWith('office/') || wanted.has(name)) && safeBranch(name)) local.set(name, { name, ...r });
    } else if (ref.startsWith('refs/remotes/origin/')) {
      const name = ref.slice('refs/remotes/origin/'.length);
      if (name !== current && safeBranch(name)) remote.set(name, { name: `origin/${name}`, ...r });
    }
  }
  for (const [name, r] of remote) if (!local.has(name)) local.set(name, r);
  return [...local.values()].sort((a, b) => b.at - a.at).slice(0, max);
}

const forks = new Map<string, Promise<Set<string> | undefined>>();

/**
 * The files a branch changed since it forked from what `dir` has checked out (the merge base of HEAD
 * (or `against`, origin/<default>'s commit) and `sha`): its own work, not the older copies of files main has moved on from. Cached by both
 * commits. Undefined when git can't say (no common history).
 */
export function changedSinceFork(dir: string, sha: string, against = 'HEAD'): Promise<Set<string> | undefined> {
  return run(['rev-parse', '-q', '--verify', `${against}^{commit}`], dir).then((head) => {
    const h = head?.trim();
    if (!h) return undefined;
    const key = `${dir}\0${h}\0${sha}`;
    let p = forks.get(key);
    if (!p) {
      p = (async () => {
        const base = (await run(['merge-base', h, sha], dir))?.trim();
        if (!base) return undefined;
        const out = await run(['diff', '--name-only', '-z', '--no-renames', base, sha], dir);
        return out === undefined ? undefined : new Set(out.split('\0').filter(Boolean));
      })();
      forks.set(key, p);
      if (forks.size > TREES_KEPT) forks.delete(forks.keys().next().value!);
    }
    return p;
  });
}

/** When commit `sha` was made, ms. */
export const commitTime = async (dir: string, sha: string) => Number((await run(['log', '-1', '--format=%ct', sha], dir))?.trim()) * 1000 || 0;

/** The commit a checkout has checked out. */
export const headOf = async (dir: string) => (await run(['rev-parse', '-q', '--verify', 'HEAD'], dir))?.trim() || undefined;

export interface TreeFile {
  path: string;
  size: number;
  /** Its blob id. */
  oid: string;
}

const trees = new Map<string, Promise<TreeFile[]>>();
const TREES_KEPT = 200;

/** Every file at commit `sha` with its size. Cached by sha: a commit never changes. */
export function treeAt(dir: string, sha: string): Promise<TreeFile[]> {
  const key = `${dir}\0${sha}`;
  const hit = trees.get(key);
  if (hit) return hit;
  const p = run(['ls-tree', '-r', '-l', '-z', '--full-tree', sha], dir).then((out) => {
    if (out === undefined) {
      trees.delete(key);
      return [];
    }
    const files: TreeFile[] = [];
    for (const rec of out.split('\0')) {
      // <mode> SP <type> SP <object> SP+ <size> TAB <path>
      const tab = rec.indexOf('\t');
      if (tab < 0) continue;
      const meta = rec.slice(0, tab).trim().split(/\s+/);
      if (meta[1] !== 'blob') continue;
      files.push({ path: rec.slice(tab + 1), size: Number(meta[3]) || 0, oid: meta[2] });
    }
    return files;
  });
  trees.set(key, p);
  if (trees.size > TREES_KEPT) trees.delete(trees.keys().next().value!);
  return p;
}

/** The size of `path` on a branch, or undefined when it isn't there. */
export async function sizeOnBranch(dir: string, branch: string, path: string): Promise<number | undefined> {
  const out = await run(['cat-file', '-s', `${branch}:${path}`], dir, 1024);
  const n = Number(out?.trim());
  return out === undefined || !Number.isFinite(n) ? undefined : n;
}

/** `path`'s bytes on a branch (`cat-file`, not `show`: no textconv filters), at most `max`. */
export function blobOnBranch(dir: string, branch: string, path: string, max: number): Promise<Buffer | undefined> {
  return gitBytes(['cat-file', 'blob', `${branch}:${path}`], dir, max + 1);
}
