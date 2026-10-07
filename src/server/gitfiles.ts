// Answers to the git questions the office asks most (which branch a checkout is on, where its origin
// points, which commit HEAD is, where its shared git folder is) read from the checkout's own files
// instead of running git. Each run of git costs 60–200 ms on Windows, and these were asked with
// execFileSync on the event loop: opening a floor, hiring into a worktree and reading the restart
// state each froze the office for that long (the performance guard's journey, 2026-10-07).
//
// Every reader gives `null` when the files don't settle it (no .git folder in `dir` itself, a
// `url.*.insteadOf` or `include` in the config that could change the answer, a ref git would have to
// work out): the caller then asks git as before, so the answer is always the one git gives.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Unknown: ask git. */
export type Maybe<T> = T | null;

const read = (p: string): string | undefined => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
};

/** The checkout's own git folder (`.git`, or where a worktree's `.git` file points), when `dir` is the top of one. */
export function gitDirOf(dir: string): Maybe<string> {
  const dotgit = path.join(dir, '.git');
  let st;
  try {
    st = statSync(dotgit);
  } catch {
    // Not the top of a checkout: git would look in the folders above, so let it.
    return null;
  }
  if (st.isDirectory()) return dotgit;
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(read(dotgit) ?? '');
  return m ? path.resolve(dir, m[1]) : null;
}

/** The git folder every worktree of the checkout shares (`git rev-parse --git-common-dir`, absolute). */
export function commonDirOf(dir: string): Maybe<string> {
  const g = gitDirOf(dir);
  if (!g) return null;
  const c = read(path.join(g, 'commondir'));
  return c === undefined ? g : path.resolve(g, c.trim());
}

/** What HEAD says: `{ ref }` (refs/heads/x) or `{ sha }` when detached. */
function headOf(dir: string): Maybe<{ ref: string } | { sha: string }> {
  const g = gitDirOf(dir);
  const head = g && read(path.join(g, 'HEAD'))?.trim();
  if (!head) return null;
  const m = /^ref:\s*(\S+)$/.exec(head);
  if (m) return { ref: m[1] };
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head) ? { sha: head } : null;
}

/** The commit a full ref name points at (loose, then packed-refs); undefined when it isn't there, null when that can't be told. */
export function refSha(dir: string, ref: string): Maybe<string | undefined> {
  const common = commonDirOf(dir);
  const g = gitDirOf(dir);
  if (!common || !g) return null;
  // Per-worktree refs (HEAD's own, bisect…) live in the worktree's folder; branches in the shared one.
  for (const base of ref.startsWith('refs/') ? [common] : [g, common]) {
    const loose = read(path.join(base, ...ref.split('/')))?.trim();
    if (loose !== undefined) return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(loose) ? loose : null;
  }
  const packed = read(path.join(common, 'packed-refs'));
  if (packed === undefined) return undefined;
  for (const line of packed.split('\n')) {
    const [sha, name] = line.trim().split(' ');
    if (name === ref && sha && /^[0-9a-f]{40}/.test(sha)) return sha;
  }
  return undefined;
}

/** `git rev-parse --abbrev-ref HEAD`: the branch, "HEAD" when detached, undefined when git would fail (no commit yet). */
export function headBranch(dir: string): Maybe<string | undefined> {
  const h = headOf(dir);
  if (!h) return null;
  if ('sha' in h) return 'HEAD';
  if (!h.ref.startsWith('refs/heads/')) return null;
  const sha = refSha(dir, h.ref);
  if (sha === null) return null;
  return sha ? h.ref.slice('refs/heads/'.length) : undefined;
}

/** `git rev-parse HEAD`: the commit, undefined when there's none yet. */
export function headSha(dir: string): Maybe<string | undefined> {
  const h = headOf(dir);
  if (!h) return null;
  return 'sha' in h ? h.sha : refSha(dir, h.ref);
}

/** Config text that could change what a plain read of it says. */
const tricky = (cfg: string) => /^\s*\[\s*(include|includeif)\b/im.test(cfg) || /insteadof\s*=|pushinsteadof\s*=/i.test(cfg);

/** `git remote get-url origin`: undefined when there's no origin. */
export function originUrl(dir: string): Maybe<string | undefined> {
  const common = commonDirOf(dir);
  if (!common) return null;
  const cfg = read(path.join(common, 'config'));
  if (cfg === undefined || tricky(cfg)) return null;
  // The person's own config can rewrite URLs too.
  for (const f of [path.join(os.homedir(), '.gitconfig'), path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'git', 'config')]) {
    const c = existsSync(f) ? read(f) : '';
    if (c === undefined || tricky(c)) return null;
  }
  if (existsSync(path.join(common, 'config.worktree'))) return null;
  let inOrigin = false;
  let url: string | undefined;
  for (const raw of cfg.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[\s*([^\]\s"]+)(?:\s+"([^"]*)")?\s*\]/.exec(line);
    if (sec) {
      inOrigin = sec[1].toLowerCase() === 'remote' && sec[2] === 'origin';
      continue;
    }
    const kv = /^([A-Za-z][\w-]*)\s*=\s*(.*)$/.exec(line);
    if (inOrigin && kv && kv[1].toLowerCase() === 'url') {
      // A quoted or escaped value is git's to read.
      if (/["\\]/.test(kv[2])) return null;
      url ??= kv[2].replace(/\s+[#;].*$/, '').trim();
    }
  }
  return url;
}

/** The files' answer, or git's (`ask`) when they didn't settle it. */
export function orGit<T>(v: Maybe<T>, ask: () => T): T {
  return v !== null ? v : ask();
}

/** The checkout's origin URL, from its files or else from git as before; undefined with none (or no checkout). */
export function originUrlOf(dir: string, timeout = 10_000): string | undefined {
  const v = originUrl(dir);
  if (v !== null) return v;
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout, windowsHide: true }).trim();
  } catch {
    return undefined;
  }
}
