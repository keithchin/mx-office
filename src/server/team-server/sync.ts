// Bringing a project's main and its Team Server repository together, fast-forward only, never forced (the
// toolkit's skills/platform-link.md and teamserver-alignment.md). The project's `origin` main is what the team
// merges into (the bare repository on this machine, or GitHub for a mirrored project); Team Server's main is what
// Studio Pro and deployments read. One look:
//   - the same commit: nothing to do;
//   - Team Server's main is behind: main is pushed there (tuned for a big first push), then checked with
//     ls-remote, because a push that died in the transport has been seen to say it succeeded;
//   - Team Server's main is ahead (someone committed in Studio Pro): its commits go to origin's main, fast-forward;
//   - both moved: nothing is pushed anywhere, and the person is told to merge Team Server's main into main.
// The Studio Pro history notes (refs/notes/mx_metadata) follow main to Team Server: when Team Server has notes this
// checkout lacks (Studio Pro wrote some), they're merged first (git notes merge, Team Server's note winning for a
// commit both noted: it's the one Studio Pro reads), then pushed, still without force.
// A Team Server that doesn't answer (no network yet after a sleep, a dead connection) is `unreachable`, said
// quietly: a fetch that stalls is stopped by git's low-speed limit within a couple of minutes, and the office
// (./index.ts) waits for the network and backs off instead of failing every few minutes.

import { TEAMSERVER_REMOTE, studioPullWords, type TeamServerRecord, type TeamServerSync } from '../../shared/team-server.js';
import { gitRefusalWords, PUSH_TUNING, type TsGit } from './git.js';

const NOTES = 'refs/notes/mx_metadata';
/** Where Team Server's notes are fetched to before they're merged into ours. */
const TS_NOTES = 'refs/notes/teamserver-mx_metadata';
const MIN = 60_000;
/** A fetch that moves less than 1 KB/s for this long is dead (a connection that went to sleep with the machine). */
export const STALL_TUNING = ['-c', 'http.lowSpeedLimit=1024', '-c', 'http.lowSpeedTime=90'];
/** How long a fetch from Team Server may take at all. */
export const FETCH_MS = 4 * MIN;

/** The words of a git failure that mean "no network / no answer", not a refusal. */
export const UNREACHABLE = /took longer than|Could not resolve host|Failed to connect|Connection (timed out|refused|reset)|Operation timed out|timed out after|Network is unreachable|No route to host|SSL_ERROR_SYSCALL|Recv failure|transfer closed|Operation too slow|Couldn't connect|Could not connect/i;

/** A failure because Team Server didn't answer (TeamServerSync `unreachable`). */
export class Unreachable extends Error {
  override name = 'Unreachable';
}

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
  let r;
  try {
    r = await g.auth(dir, [...STALL_TUNING, 'fetch', '--quiet', remote, `+refs/heads/main:refs/remotes/${remote}/main`], { timeoutMs: FETCH_MS, allowFail: true });
  } catch (err) {
    // Stopped by the timeout: no answer, not a refusal.
    throw new Unreachable((err as Error).message);
  }
  if (r.code !== 0) {
    const said = r.tail.join(' ');
    if (UNREACHABLE.test(said)) throw new Unreachable(said);
    // An empty repository has no main to fetch: that's not a refusal.
    const empty = await g.auth(dir, ['ls-remote', '--heads', remote], { timeoutMs: 2 * MIN, allowFail: true });
    if (empty.code === 0 && !empty.stdout.trim()) return undefined;
    throw new Error(gitRefusalWords(said || empty.tail.join(' ') || `git fetch exit ${r.code}`));
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

/**
 * The Studio Pro history notes to Team Server. When Team Server has notes this checkout lacks (Studio Pro wrote
 * some), they're fetched and merged first (`git notes merge -s theirs`: for a commit both noted, Team Server's note,
 * the one Studio Pro reads), then pushed, fast-forward only. A push that still can't go is retried at the next
 * sync, and said quietly.
 */
export async function pushNotes(g: TsGit, dir: string, remote: string): Promise<string> {
  const have = await g.plain(dir, ['rev-parse', '--verify', '--quiet', NOTES], { allowFail: true });
  if (have.code !== 0) return '';
  const push = () => g.auth(dir, ['push', '--no-progress', remote, `${NOTES}:${NOTES}`], { timeoutMs: 5 * MIN, allowFail: true });
  if ((await push()).code === 0) return 'history notes pushed';
  const later = 'history notes go at the next sync';
  const fetched = await g.auth(dir, [...STALL_TUNING, 'fetch', '--quiet', remote, `+${NOTES}:${TS_NOTES}`], { timeoutMs: FETCH_MS, allowFail: true }).catch(() => undefined);
  if (fetched?.code !== 0) return later;
  const merged = await g.plain(dir, ['notes', `--ref=${NOTES}`, 'merge', '--quiet', '-s', 'theirs', TS_NOTES], { allowFail: true });
  if (merged.code !== 0) {
    // Never left half-merged.
    await g.plain(dir, ['notes', `--ref=${NOTES}`, 'merge', '--abort'], { allowFail: true });
    return later;
  }
  return (await push()).code === 0 ? 'history notes merged with Team Server’s and pushed' : later;
}

/** The commits that came from Team Server between `from` and `to`: how many, the newest one's subject and author, a Publish's. */
async function studioCommits(g: TsGit, dir: string, from: string, to: string): Promise<NonNullable<TeamServerSync['studio']>> {
  const count = Number((await g.plain(dir, ['rev-list', '--count', `${from}..${to}`], { allowFail: true })).stdout.trim()) || 1;
  const author = (await g.plain(dir, ['log', '-1', '--format=%an', to], { allowFail: true })).stdout.trim();
  const subjects = (await g.plain(dir, ['log', '--format=%s', `${from}..${to}`], { allowFail: true })).stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const subject = subjects[0];
  return { commits: count, ...(subject ? { subject: subject.slice(0, 200) } : {}), ...(author ? { author: author.slice(0, 80) } : {}), ...(subjects.some((l) => /Automatic commit of changes for cloud deployment/i.test(l)) ? { publish: true } : {}) };
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
    // (origin is GitHub for a mirrored project: a stalled connection there is stopped the same way.)
    await g.plain(dir, [...STALL_TUNING, 'fetch', '--quiet', 'origin', `+refs/heads/${main}:refs/remotes/origin/${main}`], { timeoutMs: FETCH_MS });
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
      const studio = await studioCommits(g, dir, local, ts);
      return { at, state: 'pulled', sha: ts, studio, message: studioPullWords(main, local, ts, studio) };
    }
    return { at, state: 'diverged', sha: local, message: `Team Server's main (${short(ts)}) and ${main} (${short(local)}) have both moved: someone committed in Studio Pro while the team merged. Nothing was pushed. Merge ${remote}/main into ${main} (a person, or ask the Lead), then push again.` };
  } catch (err) {
    const said = g.hide((err as Error).message);
    if (err instanceof Unreachable || UNREACHABLE.test(said)) return { at, state: 'unreachable', message: `Team Server didn’t answer (no network yet, or the connection went to sleep with the machine): the office tries again by itself. ${said.slice(0, 160)}`.trim() };
    return { at, state: 'failed', message: said.slice(0, 400) };
  }
}
