// The phone version's Status tab (GET /api/m/status): per project, who's working, asleep or asking, the
// gate or stage a toolkit project is at, open escalations, the team's spend against its cap (the Budget
// feature's chip takes this slot once it lands), a ⏸ pause with its latest resume or pause run, and a
// 🔁 safe restart while one is going (read-only: no restart from the phone).
// Release 83: the projects are read side by side, and the projects' lines are kept: a look within STATUS_FRESH_MS
// of the last build is answered at once (a build starts in the background when the kept one is over STATUS_STALE_MS
// old, one at a time), so a loaded machine (microflow tests running: the phone timed out at 20 s) never holds it.

import { countStatuses, restartShown, stageLine, type ProjectStatus, type StatusView } from '../../shared/mobile.js';
import { stageHeadline } from '../../shared/stage-derive.js';
import { manualWaiting } from '../../shared/gate-play.js';
import { buildUnderWay } from '../../shared/build-progress.js';
import { projectRunsOf } from '../project-run/adapter.js';
import { safeRestartOf } from '../restart/office.js';
import { capAt } from '../../shared/roster/autonomy.js';
import { fyiNow } from '../../shared/roster/escalation.js';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { floorNeeds } from '../notify-teams/gather.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { businessSummaryOf } from '../business-status/index.js';

/** Kept lines older than this start a fresh build in the background (still answered at once). */
export const STATUS_STALE_MS = 5_000;
/** Kept lines older than this aren't given again: the look waits for a build. */
export const STATUS_FRESH_MS = 30_000;

const keptLines = new WeakMap<object, { at: number; projects?: Promise<ProjectStatus[]>; building?: Promise<ProjectStatus[]> }>();

/** The projects' lines: the kept ones while fresh (refreshed behind the answer once stale), else built now; one build at a time per office. */
export function projectLines(ctx: Ctx, now = Date.now(), read: () => Promise<ProjectStatus[]> = () => projectStatuses(ctx)): Promise<ProjectStatus[]> {
  let k = keptLines.get(ctx.floors);
  if (!k) keptLines.set(ctx.floors, (k = { at: 0 }));
  const kept = k;
  const build = () => {
    if (kept.building) return kept.building;
    const p = read();
    kept.building = p;
    p.then(
      () => {
        Object.assign(kept, { at: Date.now(), projects: p });
        if (kept.building === p) kept.building = undefined;
      },
      () => {
        if (kept.building === p) kept.building = undefined;
      },
    );
    return p;
  };
  if (kept.projects && now - kept.at < STATUS_FRESH_MS) {
    if (now - kept.at >= STATUS_STALE_MS) void build().catch(() => undefined);
    return kept.projects;
  }
  return build();
}

/** Tests: forget the kept lines. */
export const forgetStatusLines = (ctx: Pick<Ctx, 'floors'>) => keptLines.delete(ctx.floors);

/** The whole Status tab: every project, and a safe restart while one is going (that part is read live, it's memory). */
export async function statusView(ctx: Ctx): Promise<StatusView> {
  const projects = await projectLines(ctx);
  const r = safeRestartOf(ctx).view(false);
  return { projects, ...(restartShown(r.phase) ? { restart: { phase: r.phase, ...(r.by ? { by: r.by } : {}), waitingOn: r.waitingOn } } : {}) };
}

/** Every project's line, read now, the projects side by side. */
export async function projectStatuses(ctx: Ctx): Promise<ProjectStatus[]> {
  const roster = rosterOf(ctx);
  return Promise.all([...ctx.floors.values()].map((floor) => projectStatus(ctx, roster, floor)));
}

async function projectStatus(ctx: Ctx, roster: ReturnType<typeof rosterOf>, floor: Floor): Promise<ProjectStatus> {
  {
    const agents = floor.workers.list().filter((w) => w.kind === 'agent');
    const d = roster.data(floor.id);
    const paused = roster.pauseOf(d);
    let stage: string | undefined;
    try {
      // The setup panel's stages, read from git at most every couple of minutes (notify-teams' cache).
      const setup = (await floorNeeds(ctx, floor)).input.setup;
      // The office's own derivation and how fresh it is (shared/stage-derive.ts), past Stage 4 too; the setup panel's stages before it has one.
      const ev = setup?.stage;
      const v = ev?.stage && setup?.verdicts?.find((x) => x.id === ev.stage!.id);
      stage = ev?.stage ? `${stageHeadline(ev, Date.now())}${v && manualWaiting(setup!.verdicts!, v, setup!.decisions) && !buildUnderWay(ev.build) ? ' ✋ waiting for your sign-off' : ''}` : setup?.show ? stageLine(setup.stages, setup.decisions) : undefined;
    } catch {
      // no stage line, then
    }
    const business = await businessSummaryOf(ctx, floor);
    const run = projectRunsOf(ctx).view(floor.id, false);
    // A run that finished more than ten minutes ago is old news.
    const fresh = run.run && (!run.run.finishedAt || Date.now() - run.run.finishedAt < 10 * 60_000) ? run.run : undefined;
    return {
      floor: floor.id,
      ...(run.pause ? { pause: run.pause } : {}),
      ...(fresh ? { run: fresh } : {}),
      name: floor.def.name,
      ...countStatuses(agents.map((w) => w.status)),
      ...(business ? { business } : {}),
      ...(stage ? { stage } : {}),
      ...(paused ? { paused } : {}),
      spend: { usd: d.spend.usd, ...(capAt(d.settings.costCaps, d.settings.autonomy) !== undefined ? { cap: capAt(d.settings.costCaps, d.settings.autonomy) } : {}) },
      escalations: roster.escalations.view(teamFloor(ctx, floor)).filter((e) => e.status === 'open' && !fyiNow(e)).length,
    };
  }
}
