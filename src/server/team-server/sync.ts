// Bringing a project's main and its Team Server repository together, fast-forward only, never forced (the
// toolkit's skills/platform-link.md and teamserver-alignment.md). The project's `origin` main is what the team
// merges into (the bare repository on this machine, or GitHub for a mirrored project); Team Server's main is what
// Studio Pro and deployments read. One look:
//   - the same commit: nothing to do;
//   - Team Server's main is behind: main is pushed there (tuned for a big first push), then checked with
//     ls-remote, because a push that died in the transport has been seen to say it succeeded;
//   - Team Server's main is ahead (someone committed in Studio Pro): its commits go to origin's main, fast-forward;
//   - both moved: nothing is pushed anywhere, and the person is told to merge Team Server's main into main.
// The Studio Pro history notes (refs/notes/mx_metadata) follow main to Team Server when they fast-forward.

import { TEAMSERVER_REMOTE, type TeamServerRecord, type TeamServerSync } from '../../shared/team-server.js';
import { gitRefusalWords, PUSH_TUNING, type TsGit } from './git.js';

const NOTES = 'refs/notes/mx_metadata';
const MIN = 60_000;

const short = (sha: string) => sha.slice(0, 7);

/** The remote set to the record's plain URL (added, or its URL put right); never a URL with a token. */
export async function ensureRemote(g: TsGit, dir: string, rec: Pick<TeamServerRecord, 'url' | 'remote'>): Promise<void> {
  const remote = rec.remote || TEAMSERVER_REMOTE;
  const now = (await g.plain(dir, ['remote', 'get-url', remote], { allowFail: true })).stdout.trim();
  if (now === rec.url) return;
  await g.plain(dir, now ? ['remote', 'set-url', remote, rec.url] : ['remote', 'add', remote, rec.url]);
}

/** Team Server's main after a fetch (undefined: the repository has no main yet). */
async function fetchTeamServer(g: TsGit, dir: string, remote: string): Promise<string | undefined> {
  const r = await g.auth(dir, ['fetch', '--quiet', remote, `+refs/heads/main:refs/remotes/${remote}/main`], { timeoutMs: 5 * MIN, allowFail: true });
  if (r.code !== 0) {
    // An empty repository has no main to fetch: that's not a refusal.
    const empty = await g.auth(dir, ['ls-remote', '--heads', remote], { timeoutMs: 2 * MIN, allowFail: true });
    if (empty.code === 0 && !empty.stdout.trim()) return undefined;
    throw new Error(gitRefusalWords(r.tail.join(' ') || empty.tail.join(' ') || `git fetch exit ${r.code}`));
  }
  return (await g.plain(dir, ['rev-parse', `refs/remotes/${remote}/main`])).stdout.trim();
}

const isAncestor = async (g: TsGit, dir: string, a: string, b: string) => (await g.plain(dir, ['merge-base', '--is-ancestor', a, b], { allowFail: true })).code === 0;

/** Team Server's main, as ls-remote says it now (the confirmation after a push). */
async function remoteMain(g: TsGit, dir: string, remote: string): Promise<string | undefined> {
  const r = await g.auth(dir, ['ls-remote', remote, 'refs/heads/main'], { timeoutMs: 2 * MIN, allowFail: true });
  return r.code === 0 ? r.stdout.trim().split(/\s+/)[0] || undefined : undefined;
}

/** Pushes `sha` to Team Server's main without force, and confirms it landed. */
export async function pushToTeamServer(g: TsGit, dir: string, remote: string, sha: string): Promise<void> {
  const r = await g.auth(dir, [...PUSH_TUNING, 'push', '--no-progress', remote, `${sha}:refs/heads/main`], { timeoutMs: 20 * MIN, allowFail: true });
  const landed = await remoteMain(g, dir, remote);
  if (landed === sha) return;
  if (r.code !== 0) throw new Error(gitRefusalWords(r.tail.join(' ') || `git push exit ${r.code}`));
  throw new Error(`git said the push to Team Server went, but Team Server's main is ${landed ? short(landed) : 'missing'}, not ${short(sha)}: nothing was forced. Try again; if it keeps happening, see platform-link.md trap 5`);
}

/** The Studio Pro history notes to Team Server, when they fast-forward there (merged by the toolkit's sync otherwise). A line about it. */
export async function pushNotes(g: TsGit, dir: string, remote: string): Promise<string> {
  const have = await g.plain(dir, ['rev-parse', '--verify', '--quiet', NOTES], { allowFail: true });
  if (have.code !== 0) return '';
  const r = await g.auth(dir, ['push', '--no-progress', remote, `${NOTES}:${NOTES}`], { timeoutMs: 5 * MIN, allowFail: true });
  return r.code === 0 ? 'history notes pushed' : 'history notes not pushed (Team Server has notes this checkout lacks: the toolkit’s mx-metadata-note.py sync merges them)';
}

export interface SyncDeps {
  g: TsGit;
  /** The project's main checkout. */
  dir: string;
  rec: TeamServerRecord;
  /** The branch the team merges into. */
  main?: string;
  now?: () => number;
}

/** One look, as above. Never throws: a failure is the result's state and words (token-free). */
export async function syncMain(d: SyncDeps): Promise<TeamServerSync> {
  const { g, dir, rec } = d;
  const main = d.main ?? 'main';
  const at = (d.now ?? Date.now)();
  const remote = rec.remote || TEAMSERVER_REMOTE;
  try {
    await ensureRemote(g, dir, rec);
    await g.plain(dir, ['fetch', '--quiet', 'origin', `+refs/heads/${main}:refs/remotes/origin/${main}`], { timeoutMs: 5 * MIN });
    const local = (await g.plain(dir, ['rev-parse', `refs/remotes/origin/${main}`])).stdout.trim();
    const ts = await fetchTeamServer(g, dir, remote);
    if (ts === local) return { at, state: 'same', sha: local, message: `Team Server is up to date with ${main} (${short(local)}).` };
    if (!ts || (await isAncestor(g, dir, ts, local))) {
      await pushToTeamServer(g, dir, remote, local);
      const notes = await pushNotes(g, dir, remote);
      return { at, state: 'pushed', sha: local, message: `Pushed ${main} (${short(local)}) to Team Server${ts ? ` (it was at ${short(ts)})` : ''}${notes ? `; ${notes}` : ''}.` };
    }
    if (await isAncestor(g, dir, local, ts)) {
      // Studio Pro commits on Team Server: they come to origin's main, fast-forward (a moved main refuses it).
      const r = await g.plain(dir, ['push', '--no-progress', 'origin', `${ts}:refs/heads/${main}`], { timeoutMs: 10 * MIN, allowFail: true });
      if (r.code !== 0) return { at, state: 'failed', sha: local, message: `Team Server has newer commits (${short(ts)}) than ${main} (${short(local)}), but they couldn’t be brought to ${main}: ${r.tail.slice(-2).join(' ').slice(0, 200)}` };
      await g.plain(dir, ['fetch', '--quiet', 'origin'], { allowFail: true });
      return { at, state: 'pulled', sha: ts, message: `Team Server had newer commits (from Studio Pro): ${main} moved from ${short(local)} to ${short(ts)}.` };
    }
    return { at, state: 'diverged', sha: local, message: `Team Server's main (${short(ts)}) and ${main} (${short(local)}) have both moved: someone committed in Studio Pro while the team merged. Nothing was pushed. Merge ${remote}/main into ${main} (a person, or ask the Lead), then push again.` };
  } catch (err) {
    return { at, state: 'failed', message: g.hide((err as Error).message).slice(0, 400) };
  }
}
