// The review gate wired to the office (docs/site/using-the-office/review-gate.md). Two seams:
//   - every PR list (office/floors.ts pullsChanged): the tasks whose PR merged without a review that
//     counts are marked integrated (unreviewed), so they never read as verified (markUnreviewed);
//   - every surfaced-asks look (asks/main.ts): the info cards for Needs you, one per flagged PR, one per
//     direct or force push to the default branch, and one for the week's baseline resets and waivers.
// Deterministic, no LLM. This looks after the merge; before it, the office's own Merge button asks the merge
// gate (server/merge-gate/), and only GitHub branch protection requiring its status can stop an agent's gh.

import type { AskItem } from '../../shared/asks.js';
import type { GhPull } from '../../shared/protocol.js';
import { ROLES } from '../../shared/roster/roles.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { everHired } from '../roster/store.js';
import { flaggedPulls, markTasks, pullItem, type JudgeLook } from './judge.js';
import { lookPushes, pushItem } from './pushes.js';
import { lookWaivers, waiverItem } from './waivers.js';
import { countedReviewer, gateAsks } from '../merge-gate/index.js';

/** Who the floor's agents are, and who works on a branch: its team members' names and its workers'. */
export function judgeLookOf(ctx: Ctx, floor: Floor): JudgeLook {
  const workers = floor.workers.list().filter((w) => w.kind === 'agent');
  const names = new Set(workers.map((w) => w.name));
  try {
    const d = rosterOf(ctx).data(floor.id);
    for (const r of ROLES) if (everHired(d.members[r.id])) names.add(d.members[r.id].name);
  } catch {
    // no team on this floor
  }
  return {
    agents: [...names],
    branchOwner: (branch) => workers.find((w) => w.worktree?.branch === branch || w.worktree?.made === branch)?.name,
    // A review the merge gate counts for the merged head (server/merge-gate/), the Project Manager's own among them.
    counted: (p, opener) => countedReviewer(ctx, floor.id, p, opener),
  };
}

/** Marks the tasks whose PR merged without a review that counts as integrated (unreviewed); true when any changed. */
export function markUnreviewed(ctx: Ctx, floor: Floor, now = Date.now()): boolean {
  const flagged = flaggedPulls(floor.github.pulls.items, judgeLookOf(ctx, floor), now).filter((f) => f.j.unreviewed);
  if (!flagged.length) return false;
  let changed = false;
  try {
    const roster = rosterOf(ctx);
    const d = roster.data(floor.id);
    changed = markTasks(ROLES.flatMap((r) => [d.members[r.id].task, ...(d.members[r.id].prevTasks ?? [])]), flagged, now);
    if (changed) roster.touch(teamFloor(ctx, floor), true);
  } catch {
    // no team on this floor: nothing to mark
  }
  return changed;
}

/** PR merge commits on the floor's list: a first-parent commit that is one came through a pull request. */
const mergesOf = (pulls: readonly GhPull[]) => new Set(pulls.flatMap((p) => (p.state === 'MERGED' && p.mergeCommit ? [p.mergeCommit] : [])));

/** The review gate's info cards for a floor, for the surfaced asks' look (`main`: origin's default branch, when known). */
export async function gateItemsOf(ctx: Ctx, floorId: string, main: { branch: string; sha: string; remote: boolean } | undefined, lead?: string, now = Date.now()): Promise<AskItem[]> {
  const floor = ctx.floors.get(floorId);
  if (!floor) return [];
  const pulls = floor.github.pulls.items;
  const prs = flaggedPulls(pulls, judgeLookOf(ctx, floor), now).map(({ pull, j }) => pullItem(pull, j, lead));
  const [pushes, waivers] = await Promise.all([
    main?.remote ? lookPushes(ctx.cfg.dataDir, floor.id, floor.dir, main, mergesOf(pulls)).catch(() => []) : Promise.resolve([]),
    lookWaivers(floor.dir, now).catch(() => []),
  ]);
  const waived = waiverItem(waivers, lead);
  return [...gateAsks(ctx, floor.id), ...prs, ...pushes.map((e) => pushItem(e, lead)), ...(waived ? [waived] : [])];
}
