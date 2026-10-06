// The phone version's Status tab (GET /api/m/status): per project, who's working, asleep or asking, the
// gate or stage a toolkit project is at, open escalations, the team's spend against its cap (the Budget
// feature's chip takes this slot once it lands) and whether the floor is paused.

import { countStatuses, stageLine, type ProjectStatus } from '../../shared/mobile.js';
import { capAt } from '../../shared/roster/autonomy.js';
import type { Ctx } from '../office/context.js';
import { floorNeeds } from '../notify-teams/gather.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';

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
    out.push({
      floor: floor.id,
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
