// Commits that reached the default branch without a pull request, and force pushes (the review gate,
// docs/site/using-the-office/review-gate.md). Each look compares origin's default branch with where the
// office last saw it (kept per project in <data>/review-gate/<floor>.json): moved to a commit that doesn't
// contain the old one is a force push; otherwise each first-parent commit since is checked, and one that
// is no PR's merge commit and wasn't committed by GitHub (its merge button and API commit as
// noreply@github.com) is a direct push. The baseline is on disk, so it outlives a restart: the first look
// after a start compares with where the office last saw the branch, and flags every commit that landed
// while it was down. A project's very first look (no file yet) has no earlier record: it records where the
// branch is as `unchecked` (commits up to there weren't checked), shown as one card until someone reconciles
// it (baseline.ts), never taken quietly as the starting point. A move the office can't follow
// (it no longer has the old tip) is an event of its own, never a silent new baseline. Local git only, off
// the event loop; never a fetch, never a GitHub call (push-watch/ fetches on a timer when nothing else does).

import { mkdir, readFile } from 'node:fs/promises';
import { writeTextDurable } from '../durable/write.js';
import path from 'node:path';
import type { AskItem } from '../../shared/asks.js';
import { git } from '../asks/sources.js';

export interface PushEvent {
  /** unknown: the branch moved from a tip the office no longer has, so it can't tell which commits skipped a PR. */
  kind: 'direct' | 'force' | 'unknown';
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
  /** When the baseline was first recorded (the project's first look), and when the office last looked. */
  since?: number;
  seenAt?: number;
  /**
   * The office has no earlier record of the branch: commits up to and including `from` were never checked.
   * Set by a project's first look (or a renamed default branch) and kept until someone reconciles it
   * (review-gate/baseline.ts: check the last commits, or an admin accepts `from` as the starting point).
   */
  unchecked?: { from: string; at: number };
  /** How the unchecked range was settled, and by whom. */
  reconciled?: { how: 'scan' | 'accept'; from: string; by: string; at: number; scanned?: number; found?: number };
  events: PushEvent[];
}

/** One look: every event kept, the ones this look found, and whether it was the project's first (a baseline only). */
export interface PushLook {
  events: PushEvent[];
  fresh: PushEvent[];
  first: boolean;
  /** Commits up to `from` weren't checked and nobody reconciled them yet. */
  unchecked?: { from: string; at: number };
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

export const KEEP = 30;
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
    return { ...(typeof r.branch === 'string' ? { branch: r.branch } : {}), ...(typeof r.tip === 'string' ? { tip: r.tip } : {}), ...(typeof r.since === 'number' ? { since: r.since } : {}), ...(typeof r.seenAt === 'number' ? { seenAt: r.seenAt } : {}), ...(r.unchecked && typeof r.unchecked.from === 'string' ? { unchecked: { from: r.unchecked.from, at: Number(r.unchecked.at) || 0 } } : {}), ...(r.reconciled && typeof r.reconciled.from === 'string' ? { reconciled: r.reconciled } : {}), events: Array.isArray(r.events) ? r.events.filter((e: any) => e && typeof e.sha === 'string').slice(-KEEP) : [] };
  } catch {
    return { events: [] };
  }
}

async function writeState(file: string, s: PushState) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeTextDurable(file, JSON.stringify(s, null, 2));
}

/** The project's baseline as kept on disk (the tests', and the push watch's). */
export const readPushState = (dataDir: string, floorId: string): Promise<PushState> => readState(fileOf(dataDir, floorId));

const locks = new Map<string, Promise<unknown>>();

/** Runs `fn` after every look or change of the project's baseline already going (one at a time per project). */
function locked<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const p = (locks.get(file) ?? Promise.resolve()).then(fn, fn);
  const tail = p.catch(() => undefined);
  locks.set(file, tail);
  void tail.then(() => locks.get(file) === tail && locks.delete(file));
  return p;
}

/** Changes the project's baseline (a reconcile), after any look going; `fn` returns the new state, or undefined to leave it. */
export function editPushState(dataDir: string, floorId: string, fn: (s: PushState) => Promise<PushState | undefined>): Promise<PushState> {
  const file = fileOf(dataDir, floorId);
  return locked(file, async () => {
    const s = await readState(file);
    const next = await fn(s);
    if (!next) return s;
    await writeState(file, next);
    return next;
  });
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

const looking = new Map<string, Promise<PushLook>>();

/**
 * Looks at the default branch now (`main`: origin's, by name and commit) against the baseline on disk: the
 * events it found, and every one kept. One look per project at a time (the asks look and the push watch
 * share it), so two never read the same old tip and flag a commit twice.
 */
/** Told of a move that brought commits without a pull request (from the old tip to the new one): the data-impact guard's external check. */
export type ExternalMove = (m: { branch: string; base: string; target: string; direct: PushEvent[] }) => void;

export function checkPushes(dataDir: string, floorId: string, dir: string, main: { branch: string; sha: string }, merges: ReadonlySet<string>, now = Date.now(), onExternal?: ExternalMove): Promise<PushLook> {
  const file = fileOf(dataDir, floorId);
  const going = looking.get(file);
  if (going) return going;
  const p = locked(file, async (): Promise<PushLook> => {
    const s = await readState(file);
    if (s.tip === main.sha && s.branch === main.branch) return { events: s.events, fresh: [], first: false, ...(s.unchecked ? { unchecked: s.unchecked } : {}) };
    const first = !s.tip;
    let fresh: PushEvent[] = [];
    let unchecked = s.unchecked;
    if (s.tip && s.branch === main.branch) {
      fresh = (await movedBy(dir, main.branch, s.tip, main.sha, merges)) ?? [{ kind: 'unknown', sha: main.sha, was: s.tip, branch: main.branch, author: 'unknown', committer: 'unknown', subject: '', at: now }];
    } else {
      // No earlier record of this branch (the project's first look, or a renamed default branch): nothing up to
      // here was checked. Never taken quietly as the starting point: it stays unchecked until reconciled.
      unchecked = { from: main.sha, at: now };
    }
    const next: PushState = { branch: main.branch, tip: main.sha, since: s.since ?? now, seenAt: now, ...(unchecked ? { unchecked } : {}), ...(s.reconciled ? { reconciled: s.reconciled } : {}), events: [...s.events, ...fresh].slice(-KEEP) };
    await writeState(file, next).catch((err) => console.error(`agent-office: couldn't keep where ${main.branch} is for the push check (${(err as Error).message})`));
    // External commits (no PR) from the persisted baseline's tip: the data-impact guard flags their range (data-impact/external.ts).
    const direct = fresh.filter((e) => e.kind === 'direct');
    if (onExternal && direct.length && s.tip) onExternal({ branch: main.branch, base: s.tip, target: main.sha, direct });
    return { events: next.events, fresh, first, ...(unchecked ? { unchecked } : {}) };
  }).finally(() => looking.delete(file));
  looking.set(file, p);
  return p;
}

/** Looks at the default branch now; returns every event kept for the project. */
export async function lookPushes(dataDir: string, floorId: string, dir: string, main: { branch: string; sha: string }, merges: ReadonlySet<string>): Promise<PushEvent[]> {
  return (await checkPushes(dataDir, floorId, dir, main, merges)).events;
}

const short = (sha: string) => sha.slice(0, 7);

/** The Needs-you info card for a push event. */
export function pushItem(e: PushEvent, lead?: string): AskItem {
  const acts: AskItem['acts'] = [...(lead ? [{ act: 'ask-lead' as const, label: `Ask ${lead} about it` }] : []), { act: 'seen', label: 'Hide' }];
  if (e.kind === 'unknown')
    return {
      id: `gate-moved-${short(e.was ?? '')}-${short(e.sha)}`,
      kind: 'gate',
      level: 'info',
      text: `${e.branch} moved from ${short(e.was ?? '')} to ${short(e.sha)}, and the office can't tell which commits skipped a pull request`,
      lines: [`The office no longer has ${short(e.was ?? '')}, where it last saw ${e.branch}, so it can't list what landed since.`, `Look at ${e.branch}'s history on GitHub for commits that didn't come through a pull request.`],
      acts,
    };
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
