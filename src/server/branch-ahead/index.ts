// "main is behind the work" (shared/branch-ahead.ts): the agents' and open PRs' branches that have commits
// main hasn't and change the model (.mpr, mprcontents/, mdlsource/ against where they left main), with
// their PR and its review state from the review gate's rules, and [Ask the lead to review], told through
// the team's durable tell (roster/interrupts.ts, as the stage card's "Ask the lead to fix the paperwork").
// Read from the Git tab's graph (gitgraph/: the refs the office already fetches, at most once a minute),
// with git off the event loop; the model-change count is kept per (fork, tip), so a look costs nothing
// new until a branch moves.

import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { gitGraphsOf, runGit } from '../gitgraph/index.js';
import { aheadLine, reviewAsk, type AheadBranch, type AheadView } from '../../shared/branch-ahead.js';
import { openerFromBody, parseReview, reviewComplete } from '../../shared/review-gate.js';
import type { GhPull } from '../../shared/protocol.js';
import { audit, byWhom } from '../audit/index.js';
import { managerRole } from '../roster/coverage.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';

/** At most this many branches on the banner. */
const SHOWN = 4;
const MODEL_PATHS = [':(glob)**/*.mpr', ':(glob)**/mprcontents/**', 'mdlsource/'];

const counted = new Map<string, Promise<number>>();

/** Model files a branch changes since it left main. */
function modelFiles(dir: string, fork: string, tip: string): Promise<number> {
  const key = `${dir}|${fork}|${tip}`;
  let p = counted.get(key);
  if (!p) {
    p = runGit(['diff', '--name-only', '--no-renames', fork, tip, '--', ...MODEL_PATHS], dir)
      .then((out) => out.split('\n').filter((l) => l.trim()).length)
      .catch(() => 0);
    counted.set(key, p);
    if (counted.size > 500) counted.delete(counted.keys().next().value!);
  }
  return p;
}

/** The review gate's rule on an open PR: a complete `Review:` by someone other than its opener. */
export function reviewOf(p: GhPull | undefined, opener: string | undefined): AheadBranch['review'] {
  if (!p) return { state: 'no-pr' };
  const by = new Set<string>();
  for (const n of p.reviewNotes ?? []) {
    const r = parseReview(n.body);
    if (!r || !reviewComplete(r)) continue;
    if (opener && r.reviewer.trim().toLowerCase() === opener.trim().toLowerCase()) continue;
    by.add(r.reviewer);
  }
  return by.size ? { state: 'reviewed', by: [...by] } : { state: 'not-reviewed' };
}

/** Whoever covers Management, when at work. */
function leadOf(ctx: Ctx, floor: Floor): string | undefined {
  try {
    const d = rosterOf(ctx).data(floor.id);
    const m = d.members[managerRole(d)];
    return m && m.phase === 'active' ? m.name : undefined;
  } catch {
    return undefined;
  }
}

/** The banner's view for a floor (no branches: nothing to show). */
export async function aheadOf(ctx: Ctx, floor: Floor): Promise<AheadView> {
  const g = await gitGraphsOf(ctx).graph(floor);
  const pulls = floor.github.pulls.items;
  const candidates = g.branches.filter((b) => !b.merged && b.ahead > 0 && (b.worker || b.pr?.state === 'OPEN'));
  const withModel = await Promise.all(
    candidates.map(async (b) => {
      const n = await modelFiles(floor.dir, b.fork ?? g.defaultRef, b.sha);
      if (!n) return undefined;
      const pull = b.pr ? pulls.find((p) => p.number === b.pr!.number) : undefined;
      const owner = b.worker?.name ?? openerFromBody(pull?.body);
      const open = b.pr?.state === 'OPEN' ? b.pr : undefined;
      const one: AheadBranch = { branch: b.name, sha: b.sha, ...(owner ? { owner } : {}), ahead: b.ahead, modelFiles: n, ...(open ? { pr: { number: open.number, url: open.url, ...(open.isDraft ? { draft: true } : {}) } } : {}), review: reviewOf(open ? pull : undefined, owner) };
      return one;
    }),
  );
  const branches = withModel.filter((b): b is AheadBranch => !!b).sort((a, b) => b.ahead - a.ahead).slice(0, SHOWN);
  const lead = leadOf(ctx, floor);
  return { floor: floor.id, main: g.defaultBranch, branches, ...(lead ? { lead } : {}), at: Date.now() };
}

export type AskReviewResult = { ok: true; lead: string; message: string } | { ok: false; status: 404 | 409; error: string };

/** Tells the lead, after their turn, to have the branch reviewed per the review gate. */
export async function askReview(ctx: Ctx, floor: Floor, branch: string, by: string, owner: string | undefined): Promise<AskReviewResult> {
  const v = await aheadOf(ctx, floor);
  const b = v.branches.find((x) => x.branch === branch);
  if (!b) return { ok: false, status: 409, error: `${branch} has no model changes ahead of ${v.main} now: nothing to ask` };
  if (b.review.state === 'reviewed') return { ok: false, status: 409, error: `PR #${b.pr?.number} is reviewed already (${(b.review.by ?? []).join(', ')})` };
  if (!v.lead) return { ok: false, status: 409, error: "This project's team lead isn't at work to ask: hire or wake them first" };
  const message = reviewAsk(v.main, b);
  const err = await rosterOf(ctx).interrupts.tell(teamFloor(ctx, floor), message, by, 'after', {}, owner, `tell:review-ahead-${b.sha.slice(0, 12)}`);
  if (err) return { ok: false, status: 409, error: err };
  audit.record({ floor: floor.id, actor: byWhom(by, owner), action: 'review.asked', target: { kind: 'branch', id: b.branch, label: b.pr ? `PR #${b.pr.number}` : b.branch }, summary: `Asked ${v.lead} for a review of ${b.pr ? `PR #${b.pr.number}` : b.branch}: ${aheadLine({ main: v.main, branches: [b] })}`, severity: 'info' });
  return { ok: true, lead: v.lead, message };
}
