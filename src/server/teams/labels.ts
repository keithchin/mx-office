// The five `team:<team>` labels the sub-boards sort cards by (shared/roster/card-team.ts). GitHub would
// make a missing label itself when one is first put on an issue, but grey and without a description, so
// before the Project Manager first tags something the office makes any that are missing, in their team's color, as
// its own gh account. Once a floor has them all it doesn't look again until the office restarts.

import { TEAM_IDS, TEAM_META, teamLabel } from '../../shared/roster/card-team.js';
import type { Floor } from '../floor.js';
import { gh } from '../github.js';

const ready = new Set<string>();

export interface EnsureResult {
  /** The labels it made just now. */
  made: string[];
  /** Nothing was made because the office (or the floor's team settings) is in dry-run mode. */
  dryRun?: boolean;
  error?: string;
}

/** Makes the team labels the floor's repository hasn't got. `dryRun` only says which it would make. */
export async function ensureTeamLabels(floor: Floor, dryRun: boolean): Promise<EnsureResult> {
  if (ready.has(floor.id)) return { made: [] };
  let have: Set<string>;
  try {
    have = new Set((await floor.github.repoLabels()).map((l) => l.name.toLowerCase()));
  } catch (err) {
    return { made: [], error: (err as Error).message };
  }
  const missing = TEAM_IDS.filter((t) => !have.has(teamLabel(t)));
  if (dryRun) return { made: missing.map(teamLabel), dryRun: true };
  const made: string[] = [];
  for (const t of missing) {
    const m = TEAM_META[t];
    try {
      await gh(['api', '--method', 'POST', 'repos/{owner}/{repo}/labels', '-f', `name=${teamLabel(t)}`, '-f', `color=${m.labelColor}`, '-f', `description=${m.labelDescription}`], floor.dir);
      made.push(teamLabel(t));
    } catch (err) {
      // Someone made it in the meantime: that's what was wanted.
      if (!/already_exists|already exists/i.test((err as Error).message)) return { made, error: (err as Error).message };
    }
  }
  ready.add(floor.id);
  return { made };
}
