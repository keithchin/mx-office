// The claims check wired to the office (docs/site/using-the-office/claims-check.md). Three seams:
//   - every surfaced-asks look (asks/main.ts): the project's one card for Needs you (card.ts), with
//     "Ask <agent> to fix" (the team's durable tell, asks/detect.ts actMessage) and "Hide";
//   - the build progress (wizard/build-evidence.ts): the rows a claim on the default branch names that git
//     doesn't back read "claimed, not evidenced", never built on main (shared/build-progress.ts withClaimed);
//   - the team's tasks: one closed on such a claim (its PR, or a "Task: tsk_…" line in the commit) stays
//     claimed (unverified) until the evidence is there (roster/task-verify.ts).
// Deterministic, no LLM, read-only git off the event loop (repo.ts); worked out once per state of the refs.

import type { AskItem } from '../../shared/asks.js';
import type { ClaimMismatch } from '../../shared/claims.js';
import { ROLES } from '../../shared/roster/roles.js';
import type { Ctx } from '../office/context.js';
import type { Assignment } from '../roster/resume.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { claimsItem, linksFrom, verdictWords } from './card.js';
import { claimsCheck } from './check.js';

/**
 * Marks the finished tasks a mismatch's claim closed (the PR it came by, or the task its commit names) as
 * claimed (unverified), and clears the mark from those whose claim is backed now. True when any changed.
 */
export function markClaimTasks(tasks: Iterable<Assignment | undefined>, ms: readonly ClaimMismatch[], now: number): boolean {
  let changed = false;
  for (const t of tasks) {
    if (!t || t.doneAt === undefined || t.outcome === 'cancelled') continue;
    const hit = ms.find((m) => (m.pr !== undefined && t.pr === m.pr) || (!!t.taskId && (m.tasks ?? []).includes(t.taskId)));
    if (hit) {
      if (t.claimUnverified?.commit === hit.commit) continue;
      t.claimUnverified = { commit: hit.commit, why: `${hit.who}: ${verdictWords(hit)} (commit ${hit.commit.slice(0, 7)})`, at: now };
      if (t.doneWhy && !/unverified/.test(t.doneWhy)) t.doneWhy = `${t.doneWhy} (claimed, unverified)`.slice(0, 120);
      changed = true;
    } else if (t.claimUnverified) {
      delete t.claimUnverified;
      if (t.doneWhy) t.doneWhy = t.doneWhy.replace(/ \(claimed, unverified\)$/, '');
      changed = true;
    }
  }
  return changed;
}

/** The claims check's card for a floor, for the surfaced asks' look (`main`: origin's default branch, when known). */
export async function claimsItemsOf(ctx: Ctx, floorId: string, main: { branch: string; sha: string } | undefined, now = Date.now()): Promise<AskItem[]> {
  const floor = ctx.floors.get(floorId);
  if (!floor || !main) return [];
  const pulls = floor.github.pulls.items;
  const ms = await claimsCheck(floor.dir, main, pulls, now);
  if (!ms) return [];
  try {
    const roster = rosterOf(ctx);
    const d = roster.data(floor.id);
    if (markClaimTasks(ROLES.flatMap((r) => [d.members[r.id].task, ...(d.members[r.id].prevTasks ?? [])]), ms, now)) roster.touch(teamFloor(ctx, floor), true);
  } catch {
    // no team on this floor: nothing to mark
  }
  const item = claimsItem(ms, linksFrom(pulls.find((p) => p.url)?.url));
  return item ? [item] : [];
}
