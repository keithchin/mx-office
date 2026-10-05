// The home page's 🗺️ 2D Overview (GET /api/home/overview): every floor with what drawing it as a little
// pixel office needs. Its floor plan, its workers at their desks (how each is doing, and a line or two
// for its hover card) and its project team (to dress the Leads and name each zone's signpost), with
// the banner's numbers. One answer is kept for a few seconds, like the Statistics tab's.

import { OVERVIEW_CLIP, type Overview, type OverviewFloor, type OverviewMember, type OverviewWorker } from '../shared/overview.js';
import type { WorkerInfo } from '../shared/protocol.js';
import type { Floor } from './floor.js';
import type { Ctx } from './office/context.js';
import { rosterOf, teamFloor } from './roster/adapter.js';

/** How long one answer is reused. */
const FRESH_MS = 3_000;

const kept = new WeakMap<object, { at: number; overview: Overview }>();

/** Every floor as the overview draws it, at most FRESH_MS old. */
export function overview(ctx: Ctx): Overview {
  const hit = kept.get(ctx.cfg);
  const now = Date.now();
  if (hit && now - hit.at < FRESH_MS) return hit.overview;
  const out: Overview = { generatedAt: now, floors: [...ctx.floors.values()].map((f) => floorOf(ctx, f)) };
  kept.set(ctx.cfg, { at: now, overview: out });
  return out;
}

const clip = (text: string | undefined, max: number) => (text && text.length > max ? `${text.slice(0, max - 1)}…` : text) || undefined;

/** A worker cut down to what the overview draws and says of it. */
export function overviewWorker(w: WorkerInfo): OverviewWorker {
  const now = w.status === 'needs_input' ? (w.activity ?? 'Waiting on an answer') : w.status === 'done' ? w.task?.summary : (w.task?.summary ?? w.activity);
  return {
    id: w.id,
    kind: w.kind,
    name: w.name,
    color: w.color,
    status: w.status,
    deskId: w.deskId,
    acked: w.acked,
    task: clip(w.task?.name ?? w.title ?? w.prompt, OVERVIEW_CLIP.task),
    now: clip(now, OVERVIEW_CLIP.now),
    pr: w.pr?.number,
  };
}

function floorOf(ctx: Ctx, floor: Floor): OverviewFloor {
  const info = floor.info();
  return {
    id: floor.id,
    name: floor.def.name,
    palette: floor.def.palette,
    plan: floor.plan.state(),
    workers: floor.workers.list().map(overviewWorker),
    members: membersOf(ctx, floor),
    working: info.busy,
    waiting: info.waiting,
    prsOpen: floor.github.pulls.items.filter((p) => p.state === 'OPEN').length,
  };
}

/** The project team, what the drawing needs of it; none if the team view can't be had. */
function membersOf(ctx: Ctx, floor: Floor): OverviewMember[] {
  try {
    return rosterOf(ctx)
      .view(teamFloor(ctx, floor), false)
      .members.map((m) => ({ role: m.role, team: m.team, title: m.title, name: m.name, icon: m.icon, status: m.status, ...(m.workerId ? { workerId: m.workerId } : {}) }));
  } catch {
    return [];
  }
}
