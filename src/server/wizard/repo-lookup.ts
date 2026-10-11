// Asking GitHub whether a repository is there, as three answers rather than two: found (with its
// immutable id), not found, or unknown (a timeout, a login that doesn't work, a 403, GitHub or the
// network down). The setup's repo step creates a repository only on "not found", and Cancel & undo
// deletes one only when "found" shows the id the setup recorded: a lookup that couldn't say is never
// taken as either. gh's exit code and what it printed decide it.

import type { Gh } from '../project-delete/repo.js';
import type { RunResult } from './run.js';
import type { RepoProvenance } from '../../shared/setup-provenance.js';

export type RepoLookup = { state: 'found'; nameWithOwner?: string; githubId?: string } | { state: 'not-found' } | { state: 'unknown'; reason: string };

/** Something that means gh couldn't tell (checked first: a 403 page can say "not found" too). */
const UNKNOWN = /HTTP 40[13]\b|HTTP 429\b|HTTP 5\d\d\b|\b401\b|\b403\b|authenticat|auth login|not logged in|bad credentials|forbidden|rate limit|\bsaml\b|took longer|timed? ?out|etimedout|econnreset|econnrefused|enotfound|eai_again|could not connect|connection (?:refused|reset)|\bnetwork\b|\btls\b|certificate|sign-in stopped working|isn't signed in|not installed|ended \(process/i;
/** gh's own words for a repository that isn't there (a 404, or GraphQL's "Could not resolve"), and github.ts's friendly line for them. */
const NOT_FOUND = /could not resolve to a repository|HTTP 404\b|\b404 Not Found\b|can't find this repository on GitHub/i;

/** What a failed lookup's words mean: not found only when gh says so plainly; everything else is unknown. */
export function classifyLookupFailure(text: string, repo = ''): RepoLookup {
  const said = text.replace(/\s+/g, ' ').trim();
  if (!said) return { state: 'unknown', reason: 'gh said nothing' };
  // The repository's own name is left out first: acme/network-tools mustn't read as a network failure.
  let t = said.toLowerCase();
  for (const n of [repo, ...repo.split('/')].filter((x) => x.length > 1).sort((a, b) => b.length - a.length)) t = t.split(n.toLowerCase()).join('<repo>');
  if (UNKNOWN.test(t) || !NOT_FOUND.test(t)) return { state: 'unknown', reason: said.slice(0, 300) };
  return { state: 'not-found' };
}

/** A successful `gh repo view --json id,nameWithOwner`. */
function foundOf(stdout: string): RepoLookup {
  try {
    const j = JSON.parse(stdout) as { id?: unknown; nameWithOwner?: unknown };
    return { state: 'found', ...(typeof j.nameWithOwner === 'string' ? { nameWithOwner: j.nameWithOwner } : {}), ...(typeof j.id === 'string' && j.id ? { githubId: j.id } : {}) };
  } catch {
    return { state: 'found' };
  }
}

export const LOOKUP_ARGS = (repo: string) => ['repo', 'view', repo, '--json', 'id,nameWithOwner'];

/** The setup's lookup, through runCommand (allowFail): its exit code and output, or the error it threw (a timeout, gh missing). */
export async function lookupWithRun(run: (args: string[]) => Promise<Pick<RunResult, 'code' | 'tail' | 'stdout'>>, repo: string): Promise<RepoLookup> {
  let r: Pick<RunResult, 'code' | 'tail' | 'stdout'>;
  try {
    r = await run(LOOKUP_ARGS(repo));
  } catch (err) {
    return { state: 'unknown', reason: (err as Error).message || String(err) };
  }
  if (r.code === 0) return foundOf(r.stdout);
  if (r.code === null) return { state: 'unknown', reason: 'gh was stopped before it answered' };
  return classifyLookupFailure(r.tail.join(' '), repo);
}

/** Cancel & undo's lookup, through the office's gh (which throws with what gh said). */
export async function lookupWithGh(gh: Gh, repo: string): Promise<RepoLookup> {
  try {
    return foundOf(await gh(LOOKUP_ARGS(repo)));
  } catch (err) {
    return classifyLookupFailure((err as Error).message || String(err), repo);
  }
}

/**
 * What the repo step records for a repository it found there: the setup's own record kept when it made
 * this very repository on an earlier try (same name, same id), otherwise "there already", never the setup's.
 */
export function recordFound(prior: RepoProvenance | undefined, repo: string, look: Extract<RepoLookup, { state: 'found' }>, at: number): RepoProvenance {
  const nameWithOwner = look.nameWithOwner ?? repo;
  // A record without an id stays as it was: it never gives deletion authority, and an id isn't filled in later.
  if (prior?.createdBySetup && prior.nameWithOwner.toLowerCase() === nameWithOwner.toLowerCase() && (!prior.githubId || prior.githubId === look.githubId)) return prior;
  return { createdBySetup: false, preExisting: true, nameWithOwner, ...(look.githubId ? { githubId: look.githubId } : {}), at };
}

/** The step's message when GitHub couldn't say. */
export const couldntCheck = (repo: string, reason: string) =>
  `Couldn't check whether ${repo} exists on GitHub: ${reason}. Check the office's GitHub login in 🔌 Connections, then Retry`;
