// git for Expert mode's background proof: started off the event loop (offloop/exec.ts), never with a prompt
// (no terminal, no credential window), one local operation at a time per repository (serial), and never while
// git itself holds the repository (an index.lock, a merge or rebase under way).

import { access } from 'node:fs/promises';
import path from 'node:path';
import { execFileOff } from '../offloop/exec.js';

/** git with `args` in `cwd`: its stdout, or a rejection with git's last error line. */
export type ProofGit = (args: string[], cwd: string, o?: { timeoutMs?: number; env?: Record<string, string | undefined> }) => Promise<string>;

/** A quick local git read or write. */
export const LOCAL_GIT_MS = 60_000;

/** No prompts anywhere: a refused credential fails at once instead of opening a window on the office's desktop. */
export const NO_PROMPTS = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } as const;

/** The office's git runner. */
export const runProofGit: ProofGit = (args, cwd, o = {}) =>
  new Promise((resolve, reject) => {
    execFileOff('git', args, { cwd, timeout: o.timeoutMs ?? LOCAL_GIT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, ...NO_PROMPTS, ...o.env } }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const lines = String(stderr || err.message).trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const said = lines.find((l) => /^(fatal|error):/.test(l)) ?? lines.at(-1) ?? 'git failed';
      // A push's refusal is on stdout with --porcelain ("!  refs/heads/x  [rejected] (non-fast-forward)").
      const refused = String(stdout ?? '').split(/\r?\n/).find((l) => /\[(remote )?rejected\]/.test(l));
      const why = refused ? `${said} ${refused.trim()}` : said;
      reject(Object.assign(new Error(why), { code: err.code, killed: err.killed }));
    });
  });

const gitDirs = new Map<string, Promise<string | undefined>>();

/** The repository's .git folder (cached per folder). */
export function gitDirOf(git: ProofGit, dir: string): Promise<string | undefined> {
  const key = path.resolve(dir);
  let p = gitDirs.get(key);
  if (!p) {
    p = git(['rev-parse', '--absolute-git-dir'], dir).then(
      (out) => out.trim() || undefined,
      () => undefined,
    );
    gitDirs.set(key, p);
    void p.then((d) => (d ? undefined : gitDirs.delete(key)));
  }
  return p;
}

/** For tests: forget the cached .git folders. */
export const forgetGitDirs = () => gitDirs.clear();

const exists = (f: string) => access(f).then(
  () => true,
  () => false,
);

/** What git is in the middle of here, in words; undefined when the repository is free. */
const HELD: [string, string][] = [
  ['index.lock', 'git is busy here (index.lock)'],
  ['HEAD.lock', 'git is busy here (HEAD.lock)'],
  ['MERGE_HEAD', 'a merge is under way'],
  ['rebase-merge', 'a rebase is under way'],
  ['rebase-apply', 'a rebase is under way'],
  ['CHERRY_PICK_HEAD', 'a cherry-pick is under way'],
  ['REVERT_HEAD', 'a revert is under way'],
];

/** Why the repository mustn't be touched now (a git lock, a merge or rebase under way), or undefined. */
export async function gitHeld(git: ProofGit, dir: string): Promise<string | undefined> {
  const gd = await gitDirOf(git, dir);
  if (!gd) return 'not a git repository';
  const found = await Promise.all(HELD.map(([f]) => exists(path.join(gd, f))));
  const i = found.indexOf(true);
  return i >= 0 ? HELD[i][1] : undefined;
}

const chains = new Map<string, Promise<unknown>>();

/** Runs `fn` once every earlier operation on the same repository has ended: one at a time per repository. */
export function serial<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(dir).toLowerCase();
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}
