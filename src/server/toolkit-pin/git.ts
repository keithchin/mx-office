// git for the toolkit pins, always off the event loop (offloop/exec.ts): starting git can take a second
// on Windows, and the setup panel asks for a project's toolkit line while people are moving about.

import { execFileOff } from '../offloop/exec.js';

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

export interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

/** git `args` in `cwd`; never throws. */
export function gitRun(args: string[], cwd: string, timeout = 30_000): Promise<GitResult> {
  return new Promise((resolve) => {
    execFileOff('git', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, env: ENV, windowsHide: true }, (err, out, stderr) => resolve({ ok: !err, out: out ?? '', err: (stderr || err?.message || '').trim() }));
  });
}

/** Its output trimmed, or undefined when it failed. */
export async function git(args: string[], cwd: string, timeout?: number): Promise<string | undefined> {
  const r = await gitRun(args, cwd, timeout);
  return r.ok ? r.out.trim() : undefined;
}

/** The full sha `ref` names in `dir`, or undefined. */
export const revParse = (dir: string, ref: string) => git(['rev-parse', '--verify', '-q', `${ref}^{commit}`], dir);

/** The clone's default branch on `remote` (its HEAD, else main, else master), or undefined. */
export async function remoteDefault(dir: string, remote = 'origin'): Promise<string | undefined> {
  const head = await git(['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`], dir);
  if (head?.startsWith(`refs/remotes/${remote}/`)) return head.slice(`refs/remotes/${remote}/`.length);
  for (const b of ['main', 'master']) if (await revParse(dir, `refs/remotes/${remote}/${b}`)) return b;
  return undefined;
}

/** Whether `a` is an ancestor of (or the same as) `b`. */
export async function isAncestor(dir: string, a: string, b: string): Promise<boolean> {
  return (await gitRun(['merge-base', '--is-ancestor', a, b], dir)).ok;
}
