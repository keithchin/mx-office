// The home page's 🗺️ 2D Overview tab: every floor of the building as its own little pixel office, side
// by side on one canvas (client/home/overview.ts). What GET /api/home/overview answers with (built by
// server/overview.ts), and how the floors are laid out in a grid. Pure code, no DOM or Node.

import type { FloorPlan } from './floorplan.js';
import type { WorkerKind, WorkerStatus } from './protocol.js';
import type { MemberStatus, MemberView } from './roster/types.js';
import type { FloorHelper } from './roster/subagent-cards.js';

/** A worker as the overview draws it: at its desk, how it's doing, and a line or two for its hover card. */
export interface OverviewWorker {
  id: string;
  kind: WorkerKind;
  name: string;
  color: string;
  status: WorkerStatus;
  deskId: string;
  acked: boolean;
  /** What it's on: its task's name, its title, or its prompt, clipped. */
  task?: string;
  /** What it's doing now (or what it's asking), clipped. */
  now?: string;
  pr?: number;
}

/** A member of the floor's project team: enough to dress its Lead and name the zone's signpost. */
export type OverviewMember = Pick<MemberView, 'role' | 'team' | 'title' | 'name' | 'icon' | 'workerId'> & { status: MemberStatus };

export interface OverviewFloor {
  id: string;
  name: string;
  /** Its card color on the Projects tab (shared/floors.ts floorPalette). */
  palette: number;
  /** How far the back office is built out, and the signs on the desks. */
  plan: FloorPlan;
  workers: OverviewWorker[];
  /** Empty when the office has no team view for it. */
  members: OverviewMember[];
  /** The Leads' subagents that have run: at work beside their Leads' desks, or about the office (shared/roster/subagent-cards.ts). */
  helpers?: FloorHelper[];
  working: number;
  waiting: number;
  prsOpen: number;
}

export interface Overview {
  generatedAt: number;
  floors: OverviewFloor[];
}

/** Longest the task and now lines get. */
export const OVERVIEW_CLIP = { task: 90, now: 140 } as const;

// ---- The grid ------------------------------------------------------------------------------------

/** Art pixels between floors and round the edge, and of each floor's name banner over it. */
export const OVERVIEW_GAP = 40;
export const OVERVIEW_BANNER = 84;

/** One floor's place in the grid, in art pixels: its banner from (x, y), the floor itself under it. */
export interface OverviewCell {
  x: number;
  y: number;
  /** Where the floor's picture starts (under the banner). */
  floorY: number;
  w: number;
  h: number;
}

/**
 * How many floors abreast: on a narrow screen one above the other; otherwise up to three, however
 * many shows them biggest in a stage `stageW` × `stageH` (the fewer columns when it's even).
 */
export function overviewColumns(stageW: number, stageH: number, sizes: readonly { width: number; height: number }[]): number {
  if (stageW < 760 || sizes.length < 2) return 1;
  let best = 1, bestScale = 0;
  for (let cols = 1; cols <= Math.min(3, sizes.length); cols++) {
    const g = overviewGrid(sizes, cols);
    const scale = Math.min(stageW / g.width, stageH / g.height);
    if (scale > bestScale * 1.02) [best, bestScale] = [cols, scale];
  }
  return best;
}

/**
 * Lays floors of `sizes` (their pictures' sizes) out `cols` abreast, row after row: each column as
 * wide as the widest floor, each row as tall as its tallest, and the whole grid's size.
 */
export function overviewGrid(sizes: readonly { width: number; height: number }[], cols: number, gap = OVERVIEW_GAP, banner = OVERVIEW_BANNER): { cells: OverviewCell[]; width: number; height: number } {
  const n = Math.max(1, Math.min(cols, sizes.length || 1));
  const colW = Math.max(1, ...sizes.map((s) => s.width));
  const cells: OverviewCell[] = [];
  let y = gap;
  for (let row = 0; row * n < sizes.length; row++) {
    const inRow = sizes.slice(row * n, row * n + n);
    const rowH = Math.max(...inRow.map((s) => s.height));
    inRow.forEach((s, i) => cells.push({ x: gap + i * (colW + gap), y, floorY: y + banner, w: s.width, h: s.height }));
    y += banner + rowH + gap;
  }
  return { cells, width: gap + n * (colW + gap), height: sizes.length ? y : gap * 2 };
}

/** Which floor art point (x, y) is on, and whether on its banner or the floor itself. */
export function overviewHit(cells: readonly OverviewCell[], x: number, y: number): { index: number; part: 'banner' | 'floor' } | null {
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (x < c.x || x >= c.x + c.w || y < c.y || y >= c.floorY + c.h) continue;
    return { index: i, part: y < c.floorY ? 'banner' : 'floor' };
  }
  return null;
}

/** The banner's line of numbers: who's working, who's waiting on you, open PRs. */
export function overviewStats(f: Pick<OverviewFloor, 'workers' | 'working' | 'waiting' | 'prsOpen'>): string {
  const n = f.workers.length;
  return [`👷 ${f.working} working`, f.waiting ? `🙋 ${f.waiting} waiting` : '', `🔀 ${f.prsOpen} open PR${f.prsOpen === 1 ? '' : 's'}`, `💻 ${n} worker${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
}
