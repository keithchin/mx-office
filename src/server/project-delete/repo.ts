// Deleting a project's GitHub repository: only when the office's token has the delete_repo scope (asked
// with `gh api -i user`, which shows the classic token's X-OAuth-Scopes; gh runs off the event loop).
// A token without it (a fine-grained token says nothing) can't, and the dialog sends you to the
// repository's settings page instead. Never a Mendix Portal or Team Server app: those are left to you.

import { execFile } from 'node:child_process';
import { normalizeRepo } from '../../shared/floors.js';

export type Gh = (args: string[]) => Promise<string>;

const CACHE_MS = 60_000;
let cached: { at: number; scopes: string[] | null } | undefined;

/** Forgets the scopes asked for (tests, and a token change). */
export const forgetScopes = () => (cached = undefined);

/** The token's OAuth scopes; null when GitHub doesn't say (a fine-grained token or an app's). */
export async function tokenScopes(gh: Gh, now = Date.now()): Promise<string[] | null> {
  if (cached && now - cached.at < CACHE_MS) return cached.scopes;
  const out = await gh(['api', '-i', 'user']);
  const m = /^x-oauth-scopes:[ \t]*(.*)$/im.exec(out);
  const scopes = m
    ? m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  cached = { at: now, scopes };
  return scopes;
}

export const repoSettingsUrl = (repo: string) => `https://github.com/${repo}/settings`;

/** The project folder's origin URL ('' when there is none or git can't say), off the event loop. */
export function originUrl(dir: string): Promise<string> {
  return new Promise((resolve) => execFile('git', ['-C', dir, 'remote', 'get-url', 'origin'], { windowsHide: true, timeout: 15_000 }, (err, out) => resolve(err ? '' : String(out).trim())));
}

/** Whether origin is `repo` on GitHub: a local-only or Team Server project's owner/name says nothing about GitHub. */
export const originIsGithubRepo = (url: string, repo: string) => {
  const m = /github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(url);
  return !!m && m[1].toLowerCase() === repo.toLowerCase();
};

/**
 * Whether the office's token can delete `repo`, and why not. With `dir`, only when the project's origin
 * really is that repository on GitHub: a local-only or Team Server-only project shares the owner/name
 * shape, and a same-named GitHub repository must never be deleted for it.
 */
export async function canDeleteRepo(gh: Gh, repo: string | undefined, dir?: string): Promise<{ possible: boolean; why?: string; settingsUrl?: string }> {
  const r = normalizeRepo(repo);
  if (!r) return { possible: false, why: 'the project has no GitHub repository' };
  if (dir !== undefined && !originIsGithubRepo(await originUrl(dir), r)) return { possible: false, why: 'the project’s code isn’t on GitHub (its origin is on this machine or Team Server), so there is no GitHub repository to delete' };
  const settingsUrl = repoSettingsUrl(r);
  try {
    const scopes = await tokenScopes(gh);
    if (scopes?.includes('delete_repo')) return { possible: true, settingsUrl };
    return {
      possible: false,
      why: `the token can’t delete repositories (it has no delete_repo scope); delete it on GitHub: ${settingsUrl}`,
      settingsUrl,
    };
  } catch (err) {
    return {
      possible: false,
      why: `couldn’t ask GitHub what the token may do (${(err as Error).message.split('\n')[0]}); delete it on GitHub: ${settingsUrl}`,
      settingsUrl,
    };
  }
}

/** Deletes the repository. A 404 is taken as already gone (a retry after it went). */
export async function deleteRepo(gh: Gh, repo: string): Promise<'deleted' | 'gone'> {
  const r = normalizeRepo(repo);
  if (!r) throw new Error(`not a repository: ${repo}`);
  try {
    await gh(['api', '-X', 'DELETE', `repos/${r}`]);
    return 'deleted';
  } catch (err) {
    const msg = (err as Error).message;
    if (/\b404\b|Not Found/i.test(msg)) return 'gone';
    throw new Error(`GitHub wouldn’t delete ${r}: ${msg.split('\n')[0]}`);
  }
}
