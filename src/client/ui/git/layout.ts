// Where everything on the Git tab's metro map goes (no DOM, so the tests can check it): the default
// branch as a trunk line left to right, oldest commit first, a station per commit. Each branch still
// out is a line of its own dropping below the trunk where it left it, a station per commit it has (up
// to a few), ending at its tip; each merged one loops above the trunk, from where it left to the merge
// that brought it back. Lines share a row when they don't overlap, and a line drops through another
// one's row only where it can't help it.

import type { GitBranch, GitCommit, GitGraph } from '../../../shared/gitgraph';

export const COL = 44;
export const PAD_L = 64;
/** Where the trunk runs with no merged loops over it; each row of loops pushes it down by UP_H. */
export const TRUNK_Y = 74;
export const UP_H = 60;
/** How far the first row of lines is from the trunk, and the rows below after it. */
export const LANES_GAP = 76;
export const LANE_H = 70;
export const DOT_STEP = 26;
export const MAX_DOTS = 5;
/** Room kept right of a line's end for its label. */
export const LABEL_W = 250;
/** How round a line's corners are. */
const R = 14;

export interface Station {
  commit: GitCommit;
  x: number;
  merge: boolean;
}

export interface Lane {
  branch: GitBranch;
  /** Its row, counted away from the trunk: below it, or above it when `up` (a merged loop). */
  row: number;
  up: boolean;
  y: number;
  /** Where it leaves the trunk; `older` when that's before the oldest commit shown. */
  forkX: number;
  older: boolean;
  /** Its stations, and how many more commits it has than are drawn. */
  dots: number[];
  more: number;
  /** Where its line ends: its tip, where the worker stands. */
  tipX: number;
  /** Where it climbs back onto the trunk, for a merged branch whose merge is shown. */
  joinX?: number;
  /** Merged some other way (a squashed pull request): a dashed line ending in ✅. */
  squashed: boolean;
  path: string;
}

export interface Layout {
  width: number;
  height: number;
  trunkY: number;
  stations: Station[];
  lanes: Lane[];
  /** Where the trunk's newest station (the default branch's tip) is. */
  headX: number;
}

/** Commits a branch has that are drawn as stations. */
const commitsOf = (b: GitBranch) => (b.merged ? (b.commits ?? Math.max(1, b.ahead)) : b.ahead);

export function layout(g: Pick<GitGraph, 'history' | 'branches'>): Layout {
  const oldestFirst = [...g.history].reverse();
  const stations: Station[] = oldestFirst.map((commit, i) => ({ commit, x: PAD_L + i * COL, merge: commit.parents.length > 1 }));
  const xOf = new Map(stations.map((s) => [s.commit.sha, s.x]));
  const headX = stations.length ? stations[stations.length - 1].x : PAD_L;
  // The stretches taken in each row, and where lines drop to their rows: below the trunk and above it.
  const down = { rows: [] as [number, number][][], drops: [] as [number, number][] };
  const up = { rows: [] as [number, number][][], drops: [] as [number, number][] };
  const lanes: Omit<Lane, 'y' | 'path'>[] = [];
  // Lines leaving at the same station sit side by side rather than on top of each other.
  const leaving = new Map<number, number>();

  for (const b of g.branches) {
    const at = b.fork !== undefined ? xOf.get(b.fork) : undefined;
    const older = at === undefined;
    const base = older ? PAD_L - COL * 0.7 : at;
    const nth = leaving.get(base) ?? 0;
    leaving.set(base, nth + 1);
    const forkX = base + Math.min(nth, 3) * 6;
    const n = commitsOf(b);
    const shown = Math.min(n, MAX_DOTS);
    const join = b.merged && b.mergedBy ? xOf.get(b.mergedBy) : undefined;
    const joinX = join !== undefined && join > forkX ? join : undefined;
    const start = forkX + COL * 0.7;
    // Between leaving and coming back, the stations squeeze up to fit.
    const step = joinX !== undefined && shown > 1 ? Math.min(DOT_STEP, Math.max(joinX - start - COL * 0.6, 0) / (shown - 1)) : DOT_STEP;
    const dots = Array.from({ length: shown }, (_, i) => start + i * step);
    const tipX = dots.length ? dots[dots.length - 1] : start;
    const side = joinX !== undefined ? up : down;
    const row = rowFor(side.rows, forkX, (joinX ?? tipX) + LABEL_W, side.drops);
    lanes.push({ branch: b, row, up: joinX !== undefined, forkX, older, dots, more: n - shown, tipX, joinX, squashed: b.merged && joinX === undefined });
  }
  const trunkY = TRUNK_Y + up.rows.length * UP_H;
  const placed: Lane[] = lanes.map((l) => {
    const y = l.up ? trunkY - LANES_GAP + 16 - l.row * UP_H : trunkY + LANES_GAP + l.row * LANE_H;
    return { ...l, y, path: lanePath(l.forkX, y, l.tipX, l.joinX, trunkY) };
  });
  const right = Math.max(headX + 200, ...placed.map((l) => (l.joinX ?? l.tipX) + LABEL_W));
  const bottom = down.rows.length ? trunkY + LANES_GAP + (down.rows.length - 1) * LANE_H + 50 : trunkY + 60;
  return { width: Math.ceil(right), height: Math.ceil(bottom), trunkY, stations, lanes: placed, headX };
}

/** The first row free from `x0` to `x1` whose line can drop to it at `x0` without crossing a line above. */
export function rowFor(rows: [number, number][][], x0: number, x1: number, drops: [number, number][] = []): number {
  const lo = x0 - 12;
  const fits = (r: number) => (rows[r] ?? []).every(([a, b]) => x1 < a || lo > b) && drops.every(([x, row]) => row <= r || x < lo - 8 || x > x1);
  // Its drop at x0 crosses every row above it: best where none of those is drawn there. When one
  // always is (it leaves the trunk under another line), it crosses that line, in the first row it fits.
  const clear = (r: number) => rows.slice(0, r).every((row) => row.every(([a, b]) => x0 < a - 8 || x0 > b));
  let r = 0;
  while (r < rows.length && !(fits(r) && clear(r))) r++;
  if (r === rows.length && !clear(r)) {
    r = 0;
    while (r < rows.length && !fits(r)) r++;
  }
  (rows[r] ?? (rows[r] = [])).push([lo, x1]);
  drops.push([x0, r]);
  return r;
}

/** Off the trunk, round a corner, along to the tip; and back onto the trunk when it's merged. */
export function lanePath(forkX: number, y: number, tipX: number, joinX?: number, trunkY = TRUNK_Y): string {
  // Below the trunk the corners turn down; above it, up.
  const r = y < trunkY ? -R : R;
  const d = [`M${forkX} ${trunkY}`, `L${forkX} ${y - r}`, `Q${forkX} ${y} ${forkX + R} ${y}`];
  if (joinX === undefined) {
    d.push(`L${Math.max(tipX, forkX + R)} ${y}`);
  } else {
    d.push(`L${joinX - R} ${y}`, `Q${joinX} ${y} ${joinX} ${y - r}`, `L${joinX} ${trunkY}`);
  }
  return d.join(' ');
}

export interface Tally {
  branches: number;
  withPr: number;
  stale: number;
}

/** What the strip over the map counts: open (unmerged) branches, those with an open PR, those far behind. */
export function tally(branches: readonly GitBranch[], staleBehind: number): Tally {
  const open = branches.filter((b) => !b.merged);
  return {
    branches: open.length,
    withPr: open.filter((b) => b.pr && b.pr.state === 'OPEN').length,
    stale: open.filter((b) => b.behind > staleBehind).length,
  };
}

/** "3d", "5h", "12m": how old an ISO date is, short. */
export function age(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
