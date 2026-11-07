// The background push of the session branch: to the project's Team Server remote (with the Mendix token, for one
// git command only: team-server/git.ts), or to origin when that is the repository's only remote. Never a force (no
// --force, no "+" refspec), with the 10-minute git limit big Mendix pushes need (local-merge SLOW_GIT_MS). A test
// office pushes only to a remote on this machine: never GitHub, never Team Server.

import { MENDIX_ENDPOINTS, TEAMSERVER_REMOTE, type TeamServerRecord } from '../../shared/team-server.js';
import { SLOW_GIT_MS } from '../local-merge/merge.js';
import { PUSH_TUNING, gitRefusalWords, teamServerGitEnv } from '../team-server/git.js';
import type { ProofGit } from './git.js';

export interface PushTarget {
  remote: string;
  /** Team Server's: pushed with the Mendix token. */
  teamServer: boolean;
}

/** Where a push goes, or why it's off. */
export type TargetAnswer = PushTarget | { off: string };

/** A remote on this machine (a path or file:// URL), as a test office may push to. */
export const localRemote = (url: string) => /^file:\/\//i.test(url) || /^[A-Za-z]:[\\/]/.test(url) || url.startsWith('/') || url.startsWith('.') || url.startsWith('\\\\');

const tsHost = (MENDIX_ENDPOINTS.git.replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'git.api.mendix.com').toLowerCase();

/**
 * Where the session branch is pushed: the Team Server remote (the project's record names it, or one is called
 * "teamserver" or points at Team Server), else origin when it is the only remote; off otherwise.
 */
export async function pushTarget(git: ProofGit, dir: string, o: { record?: TeamServerRecord; localOnly?: boolean } = {}): Promise<TargetAnswer> {
  const out = await git(['remote', '-v'], dir).catch(() => '');
  const urls = new Map<string, string>();
  for (const l of out.split(/\r?\n/)) {
    const m = /^(\S+)\s+(\S+)\s+\(push\)/.exec(l.trim());
    if (m) urls.set(m[1], m[2]);
  }
  if (!urls.size) return { off: 'Not pushed: the repository has no remote' };
  const names = [...urls.keys()];
  const ts = [o.record?.remote, TEAMSERVER_REMOTE].find((n): n is string => !!n && urls.has(n)) ?? names.find((n) => urls.get(n)!.toLowerCase().includes(tsHost));
  const pick: PushTarget | undefined = ts ? { remote: ts, teamServer: true } : names.length === 1 && names[0] === 'origin' ? { remote: 'origin', teamServer: false } : undefined;
  if (!pick) return { off: `Not pushed: no Team Server remote, and origin isn't the only remote (${names.join(', ')})` };
  if (o.localOnly && !localRemote(urls.get(pick.remote)!)) return { off: `Not pushed: this is a test office, and ${pick.remote} is not on this machine` };
  return pick;
}

/** Pushes `branch` to the target without force; rejects with words a person can read (the token never in them). */
export async function pushBranch(git: ProofGit, dir: string, t: PushTarget, branch: string, token?: () => string | undefined, timeoutMs = SLOW_GIT_MS): Promise<void> {
  const refspec = `refs/heads/${branch}:refs/heads/${branch}`;
  if (!t.teamServer) {
    await git(['push', '--no-progress', '--porcelain', t.remote, refspec], dir, { timeoutMs });
    return;
  }
  const tok = token?.();
  if (!tok) throw new Error('No Mendix token in Connections: Team Server pushes wait until one is set');
  const env = teamServerGitEnv(process.env, tok);
  try {
    await git([...PUSH_TUNING, 'push', '--no-progress', '--porcelain', t.remote, refspec], dir, { timeoutMs, env });
  } catch (err) {
    throw new Error(gitRefusalWords((err as Error).message.split(tok).join('***')));
  }
}

/** Why a push failed, short. */
export function pushError(err: unknown): string {
  const e = err as { message?: string; killed?: boolean };
  if (e?.killed) return `The push took longer than ${Math.round(SLOW_GIT_MS / 60_000)} minutes and was stopped; it is tried again`;
  const m = String(e?.message ?? err);
  if (/\[rejected\]|non-fast-forward|fetch first/i.test(m)) return `The remote's ${'session/main'} has commits this folder doesn't: nothing was forced. ${m.slice(0, 160)}`;
  return m.slice(0, 300);
}
