// The office's own model check at the exact commit a merge is about (release 82, team flow #3): agents rarely
// recorded an mx check at the commit they asked to merge, so the Project Manager ran it by hand. Now:
//   - when an agent asks for a merge or a review of a named commit (a merge ask or review request, card-sweep/
//     rules.ts commitAskOf), the office starts Mendix's `mx check` at that commit itself;
//   - when the Project Manager opens a local merge's confirm step (local-merge/index.ts confirmLocal), the office
//     starts one at that commit if none is recorded or running, and the confirm shows its state.
// The check is the security gate's (security-gate/check.ts runMxCheck through SecurityGate.startCheck): off the
// event loop in the office's own copy of the app at that commit, one at a time office-wide, kept per commit in
// <data>/security/<project>.json and audited `security.mxcheck`, so the Security tab and the gates read the same
// record. mxbuild is not run: a full build is minutes more and the live app and Developer change gates do it.
// A commit with no .mpr (notes only) gets no check.

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { runGit, type Git } from '../gitgraph/index.js';
import { mainOf } from '../testing/repo.js';
import type { MxCheckResult } from '../../shared/security.js';
import type { MergeCheckView } from '../../shared/merge-check.js';
import { commitAskOf } from '../card-sweep/rules.js';
import { onEscalationRaised } from '../roster/raise-hooks.js';
import type { Escalation } from '../../shared/roster/escalation.js';

/** What the office's mx check needs (the security gate in the office; fakes in the tests). */
export interface MergeCheckDeps {
  git: Git;
  checkAt(floorId: string, sha: string): Promise<MxCheckResult | undefined>;
  runningOn(floorId: string): { commit: string; since: number } | undefined;
  start(floor: Pick<Floor, 'id' | 'dir'>, sha: string, by: string): Promise<MxCheckResult>;
}

/** Whether the commit has a Mendix app at its root (`*.mpr`). */
export async function hasApp(git: Git, dir: string, sha: string): Promise<boolean> {
  const tree = await git(['ls-tree', '--name-only', sha], dir).catch(() => '');
  return tree.split('\n').some((l) => /\.mpr$/i.test(l.trim()));
}

/** The view of a check result. */
export const viewOf = (r: MxCheckResult): MergeCheckView => ({
  status: r.status,
  commit: r.commit,
  at: r.at,
  by: r.by,
  ...(r.errors !== undefined ? { errors: r.errors } : {}),
  ...(r.codes?.length ? { codes: r.codes.slice(0, 3).map((c) => c.code) } : {}),
  ...(r.why ? { why: r.why.slice(0, 300) } : {}),
});

/**
 * The model check at exactly `sha`: the recorded one, the one running, or one started now (`start`: false only
 * looks). Never throws: a failure to start reads as an error with why.
 */
export async function ensureCheck(d: MergeCheckDeps, floor: Pick<Floor, 'id' | 'dir'>, sha: string, by: string, start = true): Promise<MergeCheckView> {
  const had = await d.checkAt(floor.id, sha).catch(() => undefined);
  if (had) return viewOf(had);
  if (d.runningOn(floor.id)?.commit === sha) return { status: 'running', commit: sha };
  if (!(await hasApp(d.git, floor.dir, sha))) return { status: 'no-app', commit: sha };
  if (!start) return { status: 'none', commit: sha };
  // Off the event loop and one at a time office-wide (security-gate/check.ts); the record is written when it ends.
  void d.start(floor, sha, by).catch(() => undefined);
  return { status: 'running', commit: sha, started: true };
}

/** The security gate as the merge check's deps. */
export async function officeDeps(ctx: Ctx): Promise<MergeCheckDeps> {
  const { securityOf } = await import('../security-gate/index.js');
  const g = securityOf(ctx);
  return { git: runGit, checkAt: (f, s) => g.checkAt(f, s), runningOn: (f) => g.runningOn(f), start: (floor, sha, by) => g.startCheck(floor, sha, by) };
}

/** An agent's merge ask or review request: mx check at each named commit that exists and isn't on main yet (two at most). */
export async function checkAsked(d: MergeCheckDeps, floor: Pick<Floor, 'id' | 'dir'>, e: Pick<Escalation, 'id' | 'by' | 'at' | 'title' | 'details' | 'options' | 'recommendation' | 'status' | 'permission' | 'from' | 'sourceGone' | 'told' | 'workerId' | 'role' | 'resolution'>): Promise<MergeCheckView[]> {
  const ask = commitAskOf(e);
  if (!ask?.shas.length) return [];
  const out: MergeCheckView[] = [];
  const main = (await mainOf(floor.dir).catch(() => undefined))?.sha;
  for (const s of ask.shas.slice(0, 2)) {
    const sha = (await d.git(['rev-parse', '--verify', '--quiet', `${s}^{commit}`], floor.dir).catch(() => '')).trim();
    if (!sha) continue;
    // Already on main: the card sweep closes the ask; nothing to check for a merge.
    if (main && (sha === main || (await d.git(['merge-base', '--is-ancestor', sha, main], floor.dir).then(() => true, () => false)))) continue;
    out.push(await ensureCheck(d, floor, sha, `Mx Office (${e.by}'s merge ask ESC-${e.id})`));
  }
  return out;
}

/** Starts listening for merge asks; returns what stops it. */
export function startMergeCheck(ctx: Ctx): () => void {
  return onEscalationRaised((floorId, e) => {
    const floor = ctx.floors.get(floorId);
    if (!floor || !commitAskOf(e)?.shas.length) return;
    void officeDeps(ctx)
      .then((d) => checkAsked(d, floor, e))
      .catch((err: Error) => console.error(`agent-office: merge check on ${floorId}: ${err.message}`));
  });
}
