// Commits that reached the default branch without a pull request, and force pushes (the review gate,
// docs/site/using-the-office/review-gate.md). Each look compares origin's default branch with where the
// office last saw it (kept per project in <data>/review-gate/<floor>.json): moved to a commit that doesn't
// contain the old one is a force push; otherwise each first-parent commit since is checked, and one that
// is no PR's merge commit and wasn't committed by GitHub (its merge button and API commit as
// noreply@github.com) is a direct push. The first look only records where the branch is: older history
// isn't news. Local git only, off the event loop; never a fetch, never a GitHub call.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AskItem } from '../../shared/asks.js';
import { git } from '../asks/sources.js';

export interface PushEvent {
  kind: 'direct' | 'force';
  /** The commit pushed (direct), or where the branch was forced to (force). */
  sha: string;
  /** Force: where it was before. */
  was?: string;
  branch: string;
  author: string;
  committer: string;
  subject: string;
  /** Its commit time (ms). */
  at: number;
}

export interface PushState {
  branch?: string;
  tip?: string;
  events: PushEvent[];
}

/** One first-parent commit as `git log` gives it. */
export interface FirstParent {
  sha: string;
  author: string;
  committer: string;
  committerEmail: string;
  at: number;
  subject: string;
}

const KEEP = 30;
const LOG_MAX = 200;
export const LOG_FORMAT = '%H%x00%an <%ae>%x00%cn%x00%ce%x00%ct%x00%s';

/** `git log --format=LOG_FORMAT` output, as commits. */
export function parseLog(out: string): FirstParent[] {
  return out
    .split('\n')
    .filter((l) => l.includes('\0'))
    .map((l) => {
      const [sha, author, committer, committerEmail, ct, ...subject] = l.split('\0');
      return { sha, author, committer, committerEmail, at: Number(ct) * 1000, subject: subject.join(' ') };
    });
}

/** Whether a first-parent commit came through a pull request: a PR's merge commit, or committed by GitHub itself. */
export const viaPull = (c: FirstParent, merges: ReadonlySet<string>) => merges.has(c.sha) || /^noreply@github\.com$/i.test(c.committerEmail) || /^Merge pull request #\d+/.test(c.subject);

/** The direct pushes among the first-parent commits since the last look. */
export function directPushes(commits: readonly FirstParent[], merges: ReadonlySet<string>, branch: string): PushEvent[] {
  return commits.filter((c) => !viaPull(c, merges)).map((c) => ({ kind: 'direct', sha: c.sha, branch, author: c.author, committer: `${c.committer} <${c.committerEmail}>`, subject: c.subject, at: c.at }));
}

const fileOf = (dataDir: string, floorId: string) => path.join(dataDir, 'review-gate', `${floorId}.json`);

async function readState(file: string): Promise<PushState> {
  try {
    const r = JSON.parse(await readFile(file, 'utf8'));
    return { ...(typeof r.branch === 'string' ? { branch: r.branch } : {}), ...(typeof r.tip === 'string' ? { tip: r.tip } : {}), events: Array.isArray(r.events) ? r.events.filter((e: any) => e && typeof e.sha === 'string').slice(-KEEP) : [] };
  } catch {
    return { events: [] };
  }
}

async function writeState(file: string, s: PushState) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, file);
}

/** How the branch moved from `was` to `now` in `dir`: the new events, or undefined when the office can't tell (it no longer has `was`). */
export async function movedBy(dir: string, branch: string, was: string, now: string, merges: ReadonlySet<string>): Promise<PushEvent[] | undefined> {
  if ((await git(['cat-file', '-e', `${was}^{commit}`], dir)) === undefined) return undefined;
  const ancestor = (await git(['merge-base', '--is-ancestor', was, now], dir)) !== undefined;
  if (!ancestor) {
    const tip = parseLog((await git(['log', '-1', `--format=${LOG_FORMAT}`, now], dir)) ?? '')[0];
    return [{ kind: 'force', sha: now, was, branch, author: tip?.author ?? 'unknown', committer: tip ? `${tip.committer} <${tip.committerEmail}>` : 'unknown', subject: tip?.subject ?? '', at: tip?.at ?? 0 }];
  }
  const out = await git(['log', '--first-parent', `-n${LOG_MAX}`, `--format=${LOG_FORMAT}`, `${was}..${now}`], dir);
  return out === undefined ? undefined : directPushes(parseLog(out).reverse(), merges, branch);
}

/** Looks at the default branch now (`main`: origin's, by name and commit); returns every event kept for the project. */
export async function lookPushes(dataDir: string, floorId: string, dir: string, main: { branch: string; sha: string }, merges: ReadonlySet<string>): Promise<PushEvent[]> {
  const file = fileOf(dataDir, floorId);
  const s = await readState(file);
  if (s.tip === main.sha && s.branch === main.branch) return s.events;
  const fresh = s.tip && s.branch === main.branch ? await movedBy(dir, main.branch, s.tip, main.sha, merges) : [];
  const next: PushState = { branch: main.branch, tip: main.sha, events: [...s.events, ...(fresh ?? [])].slice(-KEEP) };
  await writeState(file, next).catch(() => undefined);
  return next.events;
}

const short = (sha: string) => sha.slice(0, 7);

/** The Needs-you info card for a push event. */
export function pushItem(e: PushEvent, lead?: string): AskItem {
  const acts: AskItem['acts'] = [...(lead ? [{ act: 'ask-lead' as const, label: `Ask ${lead} about it` }] : []), { act: 'seen', label: 'Hide' }];
  if (e.kind === 'force')
    return {
      id: `gate-force-${short(e.was ?? '')}-${short(e.sha)}`,
      kind: 'gate',
      level: 'info',
      text: `${e.branch} was force-pushed: it moved from ${short(e.was ?? '')} to ${short(e.sha)}, which doesn't contain it`,
      ...(e.at ? { since: e.at } : {}),
      lines: [`Its new tip: ${short(e.sha)} “${e.subject}”, authored by ${e.author}, committed by ${e.committer}.`, `Commits that were on ${e.branch} after ${short(e.was ?? '')} may be gone from GitHub; the office’s copy of the project still has them.`, 'Nobody can review history that was rewritten: ask who did it and why.'],
      acts,
    };
  return {
    id: `gate-push-${short(e.sha)}`,
    kind: 'gate',
    level: 'info',
    text: `Commit ${short(e.sha)} reached ${e.branch} without a pull request (${e.author}: “${e.subject}”)`,
    ...(e.at ? { since: e.at } : {}),
    lines: [`Authored by ${e.author}, committed by ${e.committer}.`, 'A push straight to the default branch skips the pull request, its checks and its review.'],
    acts,
  };
}
