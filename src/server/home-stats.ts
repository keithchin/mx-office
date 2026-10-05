// The home page's 📊 Statistics tab (GET /api/home/stats): the whole office in numbers, and a row per
// project to compare them. Everything comes from what the office already keeps: each floor's project
// summary facts (server/summary/, without its narrative, so this never asks the small model), the
// project team's view (server/roster/) for how many Leads are hired, and the office's spend ledger.
// One answer is kept for a few seconds, so a page refreshing it, or a few people at once, cost nothing.

import { isAsleep } from '../shared/status.js';
import { shortStage, type HomeFloorStats, type HomeStats } from '../shared/home.js';
import type { Floor } from './floor.js';
import type { Ctx } from './office/context.js';
import { summaryOf } from './summary/index.js';
import { rosterOf, teamFloor } from './roster/adapter.js';

/** How long one answer is reused. */
const FRESH_MS = 5_000;
const WEEK_MS = 7 * 24 * 3_600_000;

const kept = new WeakMap<object, { at: number; stats: HomeStats }>();

/** The office's statistics, at most FRESH_MS old. */
export function homeStats(ctx: Ctx): HomeStats {
  const hit = kept.get(ctx.cfg);
  const now = Date.now();
  if (hit && now - hit.at < FRESH_MS) return hit.stats;
  const stats = build(ctx, now);
  kept.set(ctx.cfg, { at: now, stats });
  return stats;
}

function build(ctx: Ctx, now: number): HomeStats {
  const floors = [...ctx.floors.values()].map((f) => floorStats(ctx, f, now));
  const sum = (k: keyof HomeStats['totals'] & keyof HomeFloorStats) => floors.reduce((n, f) => n + (f[k] as number), 0);
  const usage = ctx.ledger.state();
  return {
    generatedAt: now,
    spend: { today: round(usage.today.cost), total: round(usage.total.cost), budget: usage.budget },
    totals: {
      agents: sum('agents'),
      working: sum('working'),
      waiting: sum('waiting'),
      asleep: sum('asleep'),
      issuesOpen: sum('issuesOpen'),
      prsOpen: sum('prsOpen'),
      mergedWeek: sum('mergedWeek'),
      queued: sum('queued'),
    },
    floors,
  };
}

function floorStats(ctx: Ctx, floor: Floor, now: number): HomeFloorStats {
  const s = summaryOf(ctx).facts(floor);
  const agents = floor.workers.list().filter((w) => w.kind === 'agent');
  const mergedWeek = floor.github.pulls.items.filter((p) => p.state === 'MERGED' && now - (Date.parse(p.updatedAt) || 0) < WEEK_MS).length;
  return {
    id: floor.id,
    name: floor.def.name,
    repo: floor.def.repo,
    stage: shortStage(s.phase?.label),
    issuesOpen: s.progress.issuesOpen,
    issuesClosed: s.progress.issuesClosed,
    issuesClosedCapped: s.progress.issuesClosedCapped,
    prsOpen: s.progress.prsOpen,
    prsMerged: s.progress.prsMerged,
    prsMergedCapped: s.progress.prsMergedCapped,
    mergedWeek,
    queued: s.progress.queued,
    running: s.progress.running,
    agents: agents.length,
    working: agents.filter((w) => w.status === 'working').length,
    waiting: s.needsHuman.count,
    asleep: agents.filter((w) => isAsleep(w.status)).length,
    leads: leadsOf(ctx, floor),
    spend: s.spend,
    lastActivity: s.activity[0]?.at,
  };
}

/** How the project team is staffed: Leads on the job, and benched. None if the team view can't be had. */
function leadsOf(ctx: Ctx, floor: Floor): HomeFloorStats['leads'] {
  try {
    const members = rosterOf(ctx).view(teamFloor(ctx, floor), false).members;
    return {
      hired: members.filter((m) => m.status !== 'not-hired' && m.status !== 'benched').length,
      benched: members.filter((m) => m.status === 'benched').length,
      total: members.length,
    };
  } catch {
    return undefined;
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
