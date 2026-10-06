// The phone version's Status tab (GET /api/m/status): per project, who's working, asleep or asking, the
// gate or stage a toolkit project is at, open escalations, the team's spend against its cap (the Budget
// feature's chip takes this slot once it lands), a ⏸ pause with its latest resume or pause run, and a
// 🔁 safe restart while one is going (read-only: no restart from the phone).

import { countStatuses, restartShown, stageLine, type ProjectStatus, type StatusView } from '../../shared/mobile.js';
import { projectRunsOf } from '../project-run/adapter.js';
import { safeRestartOf } from '../restart/office.js';
import { capAt } from '../../shared/roster/autonomy.js';
import type { Ctx } from '../office/context.js';
import { floorNeeds } from '../notify-teams/gather.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';

/** The whole Status tab: every project, and a safe restart while one is going. */
export async function statusView(ctx: Ctx): Promise<StatusView> {
  const projects = await projectStatuses(ctx);
  const r = safeRestartOf(ctx).view(false);
  return { projects, ...(restartShown(r.phase) ? { restart: { phase: r.phase, ...(r.by ? { by: r.by } : {}), waitingOn: r.waitingOn } } : {}) };
}

export async function projectStatuses(ctx: Ctx): Promise<ProjectStatus[]> {
  const out: ProjectStatus[] = [];
  const roster = rosterOf(ctx);
  for (const floor of ctx.floors.values()) {
    const agents = floor.workers.list().filter((w) => w.kind === 'agent');
    const d = roster.data(floor.id);
    const paused = roster.pauseOf(d);
    let stage: string | undefined;
    try {
      // The setup panel's stages, read from git at most every couple of minutes (notify-teams' cache).
      const setup = (await floorNeeds(ctx, floor)).input.setup;
      stage = setup?.show ? stageLine(setup.stages) : undefined;
    } catch {
      // no stage line, then
    }
    const run = projectRunsOf(ctx).view(floor.id, false);
    // A run that finished more than ten minutes ago is old news.
    const fresh = run.run && (!run.run.finishedAt || Date.now() - run.run.finishedAt < 10 * 60_000) ? run.run : undefined;
    out.push({
      floor: floor.id,
      ...(run.pause ? { pause: run.pause } : {}),
      ...(fresh ? { run: fresh } : {}),
      name: floor.def.name,
      ...countStatuses(agents.map((w) => w.status)),
      ...(stage ? { stage } : {}),
      ...(paused ? { paused } : {}),
      spend: { usd: d.spend.usd, ...(capAt(d.settings.costCaps, d.settings.autonomy) !== undefined ? { cap: capAt(d.settings.costCaps, d.settings.autonomy) } : {}) },
      escalations: roster.escalations.view(teamFloor(ctx, floor)).filter((e) => e.status === 'open' && !e.fyi).length,
    });
  }
  return out;
}
