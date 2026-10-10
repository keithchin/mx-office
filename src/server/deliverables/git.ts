// The few git calls the deliverables scan makes, read-only, every one started off the event loop
// (offloop/exec.ts: on Windows starting a process holds the thread that asks, often 50–400 ms each):
// which office branches there are (one for-each-ref), what each one changed since it forked from main
// (one `diff --raw base...branch`, cached by both commits, so asking again costs nothing until someone
// pushes), what a worktree has that its commit hasn't (one `status`), what's at a commit (ls-tree,
// cached by the commit), the sizes of a set of blobs (one cat-file --batch-check, cached by blob id),
// and one file's bytes from a branch. A scan of travel-approval made 133 git calls one after another
// (20 s cold, 9–14 s warm, 2026-10-11); it makes about 30 cold and a dozen warm now, a few at a time.

import { spawnOff, execFileOff } from '../offloop/exec.js';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

/** How many git processes one scan runs at once. */
export const GIT_PARALLEL = 6;

function run(args: string[], cwd: string, opts: { maxBuffer?: number; input?: string } = {}): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFileOff('git', args, { cwd, maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024, timeout: 20_000, env: ENV, windowsHide: true, input: opts.input }, (err, out) => resolve(err ? undefined : out));
  });
}

/** A file's bytes, at most `max` (more is an error, not a cut). Started off the event loop too. */
export function gitBytes(args: string[], cwd: string, max: number): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const child = spawnOff('git', args, { cwd, env: ENV, windowsHide: true, binary: true });
    const parts: Buffer[] = [];
    let size = 0;
    let over = false;
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on('stdout', (d: Uint8Array | string) => {
      if (over) return;
      const b = typeof d === 'string' ? Buffer.from(d) : Buffer.from(d.buffer, d.byteOffset, d.byteLength);
      size += b.length;
      if (size > max) {
        over = true;
        child.kill();
        return;
      }
      parts.push(b);
    });
    child.on('error', () => undefined);
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve(over || code !== 0 ? undefined : Buffer.concat(parts));
    });
  });
}

/** Runs `fn` over `items`, at most `n` at once, in order of the answers' places. */
export async function pool<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
  return out;
}

/** Keeps a map to its newest `max` entries. */
function bound<K, V>(m: Map<K, V>, max: number) {
  while (m.size > max) m.delete(m.keys().next().value!);
}

export interface WorktreeState {
  /** The commit it has checked out (undefined before its first commit). */
  head?: string;
  /** Paths changed since that commit, staged or not, and new ones (not ignored). */
  dirty: Set<string>;
  /** Paths deleted from the folder or the index. */
  gone: Set<string>;
}

/**
 * What a checkout has that its commit hasn't, in one `git status` (porcelain v2): its HEAD, what's
 * changed or new, and what's gone. Together with the tree at HEAD (treeAt, cached), that's every file
 * the checkout counts, and which of them are the committed blob. Undefined when it isn't a git checkout.
 */
export async function worktreeState(dir: string): Promise<WorktreeState | undefined> {
  const out = await run(['-c', 'core.quotepath=off', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--no-renames'], dir);
  return out === undefined ? undefined : parseStatus(out);
}

/** `git status --porcelain=v2 --branch -z` read. */
export function parseStatus(out: string): WorktreeState {
  const st: WorktreeState = { dirty: new Set(), gone: new Set() };
  const recs = out.split('\0');
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (!rec) continue;
    const kind = rec[0];
    if (kind === '#') {
      const m = /^# branch\.oid ([0-9a-f]{40,64})$/.exec(rec);
      if (m) st.head = m[1];
      continue;
    }
    if (kind === '?') {
      st.dirty.add(rec.slice(2));
      continue;
    }
    // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>; 2 … <Xscore> <path>\0<orig>; u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
    const fields = kind === '1' ? 8 : kind === '2' ? 9 : kind === 'u' ? 10 : -1;
    if (fields < 0) continue;
    let at = 0;
    for (let f = 0; f < fields && at >= 0; f++) at = rec.indexOf(' ', at + 1);
    if (at < 0) continue;
    const p = rec.slice(at + 1);
    const xy = rec.slice(2, 4);
    if (kind === '2') {
      // A rename (only when asked for them): the old path is gone.
      st.gone.add(recs[++i] ?? '');
    }
    if (xy.includes('D')) st.gone.add(p);
    else st.dirty.add(p);
  }
  return st;
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

const KEPT = 400;
const forks = new Map<string, Promise<Map<string, string> | undefined>>();

/**
 * What commit `sha` changed since it forked from commit `base` (`git diff --raw base...sha`: from their
 * merge base): each file it added or changed, with its blob id there (a file it deleted isn't listed).
 * Its own work, not the older copies of files main has moved on from. Cached by both commits (pass
 * commit ids, not names). Undefined when git can't say (no common history).
 */
export function forkChanges(dir: string, base: string, sha: string): Promise<Map<string, string> | undefined> {
  const key = `${dir}\0${base}\0${sha}`;
  let p = forks.get(key);
  if (!p) {
    p = run(['-c', 'core.quotepath=off', 'diff', '--raw', '-z', '--no-renames', '--no-abbrev', '--no-textconv', '--no-ext-diff', `${base}...${sha}`], dir).then((out) => (out === undefined ? undefined : parseRaw(out)));
    forks.set(key, p);
    bound(forks, KEPT);
  }
  return p;
}

/** `git diff --raw -z` read: path → its new blob, for what was added or changed. */
export function parseRaw(out: string): Map<string, string> {
  const files = new Map<string, string>();
  const recs = out.split('\0');
  for (let i = 0; i + 1 < recs.length; i += 2) {
    // :<old mode> <new mode> <old oid> <new oid> <status>
    const meta = recs[i].split(' ');
    const p = recs[i + 1];
    const status = meta[4]?.[0];
    if (!p || !status || status === 'D') continue;
    files.set(p, meta[3]);
  }
  return files;
}

const times = new Map<string, Promise<number>>();

/** When commit `sha` was made, ms. Cached: a commit never changes. */
export function commitTime(dir: string, sha: string): Promise<number> {
  const key = `${dir}\0${sha}`;
  let p = times.get(key);
  if (!p) {
    p = run(['log', '-1', '--format=%ct', sha], dir).then((out) => Number(out?.trim()) * 1000 || 0);
    times.set(key, p);
    bound(times, KEPT);
  }
  return p;
}

/** The commit a checkout has checked out. */
export const headOf = async (dir: string) => (await run(['rev-parse', '-q', '--verify', 'HEAD'], dir))?.trim() || undefined;

export interface TreeFile {
  path: string;
  size: number;
  /** Its blob id. */
  oid: string;
}

const trees = new Map<string, Promise<TreeFile[]>>();

/** Every file at commit `sha` with its size. Cached by sha: a commit never changes. */
export function treeAt(dir: string, sha: string): Promise<TreeFile[]> {
  const key = `${dir}\0${sha}`;
  const hit = trees.get(key);
  if (hit) return hit;
  const p = run(['-c', 'core.quotepath=off', 'ls-tree', '-r', '-l', '-z', '--full-tree', sha], dir).then((out) => {
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
  bound(trees, KEPT);
  return p;
}

const sizes = new Map<string, number>();

/** The sizes of blobs `oids`, in one `cat-file --batch-check` for the ones not asked before (a blob never changes). */
export async function blobSizes(dir: string, oids: Iterable<string>): Promise<Map<string, number>> {
  const want = [...new Set(oids)].filter((o) => /^[0-9a-f]{40,64}$/.test(o));
  const ask = want.filter((o) => !sizes.has(o));
  if (ask.length) {
    const out = await run(['cat-file', '--batch-check=%(objectname) %(objectsize)'], dir, { input: `${ask.join('\n')}\n` });
    for (const line of (out ?? '').split('\n')) {
      const [oid, n] = line.split(' ');
      if (oid && /^\d+$/.test(n ?? '')) sizes.set(oid, Number(n));
    }
    bound(sizes, 20_000);
  }
  return new Map(want.filter((o) => sizes.has(o)).map((o) => [o, sizes.get(o)!]));
}

/** The size of `path` on a branch, or undefined when it isn't there. */
export async function sizeOnBranch(dir: string, branch: string, path: string): Promise<number | undefined> {
  const out = await run(['cat-file', '-s', `${branch}:${path}`], dir, { maxBuffer: 1024 });
  const n = Number(out?.trim());
  return out === undefined || !Number.isFinite(n) ? undefined : n;
}

/** `path`'s bytes on a branch (`cat-file`, not `show`: no textconv filters), at most `max`. */
export function blobOnBranch(dir: string, branch: string, path: string, max: number): Promise<Buffer | undefined> {
  return gitBytes(['cat-file', 'blob', `${branch}:${path}`], dir, max);
}
