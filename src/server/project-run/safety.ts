// The safety checks before ▶ Resume project wakes an agent: is its worktree still there, has its branch
// already landed, is it behind or holding uncommitted changes, and can its session be carried on. Pure
// (assess) over what a probe found (probeAgent asks git), so each case can be tested without a repo.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ResumeAction, SafetyNote } from '../../shared/project-run.js';

export interface Probe {
  /** Its folder is there (a worker in the checkout always is). */
  worktree: boolean;
  /** Its branch is already in origin/<default> (its PR merged): nothing left for it to do there. */
  merged: boolean;
  /** Commits on origin/<default> it doesn't have. */
  behind: number;
  /** Files changed and not committed. */
  dirty: number;
  /** Its session can be carried on (Claude still has the conversation). */
  resumable: boolean;
  /** The default branch it was compared with. */
  base?: string;
}

export const okProbe = (): Probe => ({ worktree: true, merged: false, behind: 0, dirty: 0, resumable: true });

export interface Assessed {
  checks: SafetyNote[];
  /** What it may do, the first being what it does by default when it has work. */
  options: ResumeAction[];
}

/**
 * What the checks say for one agent. `member`: it's on the team, so a missing worktree or a session
 * that can't be carried on is re-hired fresh from its handoff note (the roster's hire); a worker
 * outside the team is woken anyway (a fresh session) or, with no folder, left for its card's rebuild.
 */
export function assess(p: Probe, member: boolean): Assessed {
  const checks: SafetyNote[] = [];
  const base = p.base ?? 'the default branch';
  if (!p.worktree) checks.push({ kind: 'missing-worktree', text: member ? 'Its worktree is gone: re-hire it fresh from its handoff note' : 'Its worktree is gone: rebuild it from its card first' });
  if (p.merged) checks.push({ kind: 'merged', text: `Its branch is already merged into ${base}: send it home instead?` });
  if (p.worktree && p.behind > 0) checks.push({ kind: 'behind', text: `${p.behind} commit${p.behind === 1 ? '' : 's'} behind ${base}: told to rebase first` });
  if (p.worktree && p.dirty > 0) checks.push({ kind: 'dirty', text: `${p.dirty} uncommitted change${p.dirty === 1 ? '' : 's'}: told to look before anything else` });
  if (p.worktree && !p.resumable) checks.push({ kind: 'no-session', text: member ? 'Its session can’t be carried on: re-hire it with its handoff note' : 'Its session can’t be carried on: it starts a fresh one' });
  const options: ResumeAction[] = [];
  if (!p.worktree || !p.resumable) {
    if (member) options.push('rehire');
    else if (p.worktree) options.push('wake');
  } else options.push('wake');
  if (p.merged) options.unshift('send-home');
  return { checks, options: [...new Set(options)] };
}

const git = (cwd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 20_000, encoding: 'utf8', windowsHide: true }, (err, out) => (err ? reject(err) : resolve(out.trim())));
  });

/**
 * Looks at an agent's folder with git: there at all, ahead of / behind origin/<base>, already merged,
 * uncommitted changes. `mergedPr`: the floor's list says its PR merged. Best effort: what git can't
 * answer is left as fine.
 */
export async function probeAgent(cwd: string, o: { base?: string; worktree: boolean; mergedPr: boolean; resumable: boolean }): Promise<Probe> {
  const p: Probe = { ...okProbe(), resumable: o.resumable, base: o.base ? `origin/${o.base}` : undefined };
  if (!existsSync(cwd)) return { ...p, worktree: false, merged: o.mergedPr };
  p.merged = o.mergedPr;
  try {
    p.dirty = (await git(cwd, ['status', '--porcelain'])).split('\n').filter(Boolean).length;
  } catch {
    // not a repository: nothing to say
  }
  if (!o.base || !o.worktree) return p;
  try {
    p.behind = Number(await git(cwd, ['rev-list', '--count', `HEAD..origin/${o.base}`])) || 0;
    const ahead = Number(await git(cwd, ['rev-list', '--count', `origin/${o.base}..HEAD`])) || 0;
    // Everything it has is on the default branch, and it had a PR that merged: done there.
    if (!ahead && o.mergedPr) p.merged = true;
    if (ahead && p.merged) p.merged = false;
  } catch {
    // no such remote branch: leave it
  }
  return p;
}

/** Subjects of the commits on origin/<base> since `since` (the agent's last turn): what landed while it slept. */
export async function mergesSince(cwd: string, base: string | undefined, since: number): Promise<string[]> {
  if (!base || !existsSync(cwd)) return [];
  try {
    const out = await git(cwd, ['log', `origin/${base}`, '--first-parent', `--since=${new Date(since).toISOString()}`, '--format=%s', '-n', '12']);
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
