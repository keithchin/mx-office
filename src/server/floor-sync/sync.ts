// Bringing a floor's own checkout (the folder the wizard cloned, which Studio Pro opens) up to date with
// GitHub, but only ever by a fast-forward nobody can lose anything to. Agents work in worktrees cut from
// origin/<default> and their pull requests merge on GitHub, so nothing else ever moves the folder's own
// main: travel-approval's sat 386 commits behind, without the project.mpr main had had for days, and
// "Edit in Studio Pro" found nothing to open (2026-10-11).
//
// It moves the folder only when every one of these holds, and otherwise says which one didn't and what
// to do about it:
//   - it's on the default branch (not detached, not another branch);
//   - no merge, rebase, cherry-pick or revert is in progress;
//   - its main is an ancestor of origin's (a pure fast-forward: nothing of its own GitHub hasn't got);
//   - `git status` is clean: nothing staged, changed or untracked outside what's ignored (the office's
//     .agent-office/ folder, with the agents' worktrees in it, is in .git/info/exclude);
//   - Studio Pro doesn't have the project open (the office never changes files under an open Studio Pro);
//   - no agent is mid-turn in the folder itself (one without a worktree of its own).
// Then `git merge --ff-only origin/<default>`. Every git call is off the event loop (offloop/exec.ts),
// and the logic takes its git and its checks as deps, so the tests run it on real temporary repos.

import type { FloorSyncRefusal, FloorSyncState } from '../../shared/studio.js';

export type GitAnswer = { ok: true; out: string } | { ok: false; err: string };

export interface SyncDeps {
  /** Runs git in `cwd` (off the event loop in the office). */
  git(args: string[], cwd: string, timeout?: number): Promise<GitAnswer>;
  /** Whether a path is there. */
  exists(p: string): Promise<boolean>;
  /** Whether Studio Pro has the floor's project open right now. */
  studioOpen(): Promise<boolean>;
  /** The agents mid-turn in the folder itself (not in a worktree of their own), by name. */
  busyHere(): string[];
  now(): number;
}

/** How long the fast-forward may take: a few hundred commits of a Mendix project on Windows is seconds, not minutes. */
const MERGE_TIMEOUT_MS = 180_000;
/** The changes named in a refusal. */
const FILES_SHOWN = 3;

const short = (sha: string) => sha.slice(0, 7);
const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;

/** The paths in `git status --porcelain` output. */
export function changedPaths(porcelain: string): string[] {
  const out: string[] = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.length < 4) continue;
    let p = line.slice(3);
    if (p.includes(' -> ')) p = p.slice(p.indexOf(' -> ') + 4);
    out.push(p.replace(/^"(.*)"$/, '$1'));
  }
  return out;
}

/** "a, b and c" / "a, b, c and 4 more". */
function listOf(files: string[]): string {
  const shown = files.slice(0, FILES_SHOWN);
  const more = files.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0] ?? '';
}

/** origin/HEAD's branch, else main or master when origin has it; undefined with no remote default. */
async function defaultBranch(dir: string, d: SyncDeps): Promise<string | undefined> {
  const head = await d.git(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], dir);
  if (head.ok && head.out.trim().startsWith('refs/remotes/origin/')) return head.out.trim().slice('refs/remotes/origin/'.length);
  for (const b of ['main', 'master']) if ((await d.git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${b}^{commit}`], dir)).ok) return b;
  return undefined;
}

async function count(dir: string, range: string, d: SyncDeps): Promise<number> {
  const r = await d.git(['rev-list', '--count', range], dir);
  return r.ok ? Number(r.out.trim()) || 0 : 0;
}

/** A merge, rebase, cherry-pick or revert half done in the folder. */
async function inProgress(dir: string, d: SyncDeps): Promise<string | undefined> {
  const names: [string, string][] = [
    ['MERGE_HEAD', 'a merge'],
    ['rebase-merge', 'a rebase'],
    ['rebase-apply', 'a rebase'],
    ['CHERRY_PICK_HEAD', 'a cherry-pick'],
    ['REVERT_HEAD', 'a revert'],
  ];
  for (const [name, what] of names) {
    const p = await d.git(['rev-parse', '--git-path', name], dir);
    if (!p.ok) continue;
    const at = p.out.trim();
    const full = /^([a-zA-Z]:)?[\\/]/.test(at) ? at : `${dir.replace(/[\\/]+$/, '')}/${at}`;
    if (await d.exists(full)) return what;
  }
  return undefined;
}

/**
 * One look at the floor's folder against origin/<default> (fetched already: this never fetches), and a
 * fast-forward when it's behind and every condition above holds. Never throws.
 */
export async function syncFloor(floor: string, dir: string, d: SyncDeps): Promise<FloorSyncState> {
  const at = d.now();
  const refused = (reason: FloorSyncRefusal, message: string, extra: Partial<FloorSyncState> & { behind: number }): FloorSyncState => ({ floor, state: 'refused', reason, message, at, ...extra });
  try {
    const branch = await defaultBranch(dir, d);
    if (!branch) return { floor, state: 'no-remote', behind: 0, at };
    const origin = await d.git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}^{commit}`], dir);
    if (!origin.ok) return { floor, state: 'no-remote', behind: 0, at };
    const to = origin.out.trim();
    const remote = `refs/remotes/origin/${branch}`;
    const behind = await count(dir, `HEAD..${remote}`, d);
    const base = { branch, behind };

    const what = await inProgress(dir, d);
    if (what) return refused('in-progress', `${what[0].toUpperCase()}${what.slice(1)} is in progress in the project folder — finish or abort it, then try again`, base);

    const head = await d.git(['symbolic-ref', '-q', 'HEAD'], dir);
    if (!head.ok) {
      const sha = await d.git(['rev-parse', '--short', 'HEAD'], dir);
      return refused('detached', `The project folder isn't on a branch (it's at ${sha.ok ? sha.out.trim() : 'a commit'}) — switch it to ${branch} (git switch ${branch}), then try again`, base);
    }
    const on = head.out.trim().replace(/^refs\/heads\//, '');
    if (on !== branch) return refused('branch', `The project folder is on branch ${on}, not ${branch} — switch it to ${branch} (git switch ${branch}), then try again`, { ...base, on });

    const ahead = await count(dir, `${remote}..HEAD`, d);
    if (behind === 0) return { floor, state: 'current', ...base, ...(ahead ? { ahead } : {}), at };
    if (ahead > 0) return refused('diverged', `The project folder's ${branch} has ${commits(ahead)} GitHub hasn't got and is ${commits(behind)} behind it — push them (or open a pull request) and reset ${branch} to origin/${branch}, then try again`, { ...base, ahead });

    if (await d.studioOpen()) return refused('studio-open', `The project folder is ${commits(behind)} behind GitHub, but Studio Pro has the project open — close Studio Pro (and commit what you changed), then try again`, base);

    const status = await d.git(['status', '--porcelain', '--untracked-files=all'], dir, 30_000);
    if (!status.ok) return refused('failed', `Couldn't ask git about the project folder's changes: ${status.err}`, base);
    const files = changedPaths(status.out);
    if (files.length) return refused('dirty', `Your project folder is ${commits(behind)} behind GitHub and has local changes in ${listOf(files)} — commit or stash them, then try again`, { ...base, files: files.slice(0, 10) });

    const busy = d.busyHere();
    if (busy.length) return refused('agent-busy', `The project folder is ${commits(behind)} behind GitHub, but ${listOf(busy)} ${busy.length === 1 ? 'is' : 'are'} working in it right now — try again when their turn ends`, base);

    const was = await d.git(['rev-parse', 'HEAD'], dir);
    const from = was.ok ? was.out.trim() : '';
    const merged = await d.git(['merge', '--ff-only', '--quiet', remote], dir, MERGE_TIMEOUT_MS);
    if (!merged.ok) return refused('failed', `Couldn't fast-forward the project folder to origin/${branch}: ${merged.err}`, base);
    const now = await d.git(['rev-parse', 'HEAD'], dir);
    if (!now.ok || now.out.trim() !== to) return refused('failed', `The project folder didn't end up at origin/${branch} (${short(to)}) after the fast-forward`, base);
    return { floor, state: 'moved', branch, behind: 0, from, to, commits: behind, at };
  } catch (err) {
    return { floor, state: 'refused', reason: 'failed', message: `Couldn't bring the project folder up to date: ${(err as Error).message}`, behind: 0, at };
  }
}

/** What a refusal is, for not saying the same thing twice in the audit log: the reason, and the branch it's on. */
export const refusalKey = (s: FloorSyncState): string | undefined => (s.state === 'refused' ? `${s.reason}|${s.on ?? ''}` : undefined);

/**
 * Why there's no .mpr to open, in words a person can act on: never just "no .mpr found". `dir` is the
 * floor's folder, `s` the sync's look just before.
 */
export function whyNoMpr(dir: string, s: FloorSyncState | undefined): string {
  if (!s || s.state === 'no-remote') return `No Mendix project (.mpr) in the project folder (${dir}), and it has no GitHub remote to bring one from — add the project in Studio Pro, or check the folder is the right one`;
  if (s.state === 'refused') return `No Mendix project (.mpr) in the project folder yet, and the office couldn't bring it up to date with GitHub. ${s.message}`;
  const at = s.to ? ` (${s.to.slice(0, 7)})` : '';
  return `No Mendix project (.mpr) in the project folder, even up to date with origin/${s.branch ?? 'main'}${at}: GitHub doesn't have one either yet — it comes with the team's first Mendix step, or create it in Studio Pro`;
}
