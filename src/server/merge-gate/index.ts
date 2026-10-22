// The merge gate wired to the office (docs/site/using-the-office/review-gate.md#the-merge-gate). Seams:
//   - the PR window's Merge (ws/handlers/github.ts gh.merge): checkMerge refuses without a counting review;
//   - every PR list (office/floors.ts pullsChanged): onPulls evaluates the open PRs that moved, posts the
//     `mx-office/review` status, and clears "unreviewed" marks a counting review (or a close) settled;
//   - the review gate's look at merged PRs (review-gate/index.ts judgeLookOf): countedReviewer;
//   - the review gate's Needs-you cards (review-gate/index.ts gateItemsOf): gateAsks;
//   - its HTTP routes (http/routes/merge-gate.ts).

import type { AskItem } from '../../shared/asks.js';
import type { GhPull } from '../../shared/protocol.js';
import { headReview, short } from '../../shared/merge-gate.js';
import { agentFromAuthor } from '../../shared/review-gate.js';
import { ROLES } from '../../shared/roster/roles.js';
import type { Floor } from '../floor.js';
import { gh } from '../github.js';
import type { Ctx } from '../office/context.js';
import { audit, human } from '../audit/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { everHired } from '../roster/store.js';
import type { Assignment } from '../roster/resume.js';
import type { CollectLook } from './collect.js';
import { MergeGate, type GateFloor } from './service.js';

const gates = new WeakMap<object, MergeGate>();

/** The office's merge gate (one per office). */
export function mergeGateOf(ctx: Pick<Ctx, 'cfg'>): MergeGate {
  let g = gates.get(ctx.cfg);
  if (!g) gates.set(ctx.cfg, (g = new MergeGate(ctx.cfg.dataDir, (args, cwd) => gh(args, cwd))));
  return g;
}

const floorsAs = new WeakMap<object, (floor: Floor) => GateFloor>();

/** A test's own gate (a fake gh), and how it sees a project (no roster). */
export function useMergeGate(ctx: Pick<Ctx, 'cfg'>, gate: MergeGate, floorOf?: (floor: Floor) => GateFloor) {
  gates.set(ctx.cfg, gate);
  if (floorOf) floorsAs.set(ctx.cfg, floorOf);
}

/** The project's agents by name (team members ever hired, and its agent workers), and who works on a branch. */
export function lookOf(ctx: Ctx, floor: Floor): CollectLook {
  const workers = floor.workers.list().filter((w) => w.kind === 'agent');
  const names = new Set(workers.map((w) => w.name));
  try {
    const d = rosterOf(ctx).data(floor.id);
    for (const r of ROLES) if (everHired(d.members[r.id])) names.add(d.members[r.id].name);
  } catch {
    // no team on this project
  }
  return { agents: [...names], branchOwner: (branch) => workers.find((w) => w.worktree?.branch === branch || w.worktree?.made === branch)?.name };
}

/** No other agent can review: a Solo team, or a team with one member hired. */
export function personReviews(ctx: Ctx, floorId: string): boolean {
  try {
    const d = rosterOf(ctx).data(floorId);
    return d.shape === 'solo' || ROLES.filter((r) => d.members[r.id].phase !== 'none').length <= 1;
  } catch {
    return false;
  }
}

export function gateFloorOf(ctx: Ctx, floor: Floor): GateFloor {
  const own = floorsAs.get(ctx.cfg);
  if (own) return own(floor);
  return { id: floor.id, dir: floor.dir, look: lookOf(ctx, floor), personReviews: personReviews(ctx, floor.id) };
}

/** Who reviewed a merged PR's final head in a way that counts (from the gate's records), for the review gate. */
export function countedReviewer(ctx: Pick<Ctx, 'cfg'>, floorId: string, p: GhPull, opener: string | undefined): string | undefined {
  const book = mergeGateOf(ctx).store.loaded(floorId);
  if (!book || !p.headRefOid) return undefined;
  const records = [...book.reviews.values()].filter((r) => r.pr === p.number);
  if (!records.length) return undefined;
  const authors = [...(opener ? [opener] : []), ...(p.commitAuthors ?? []).map((a) => agentFromAuthor(a) ?? a)];
  const r = headReview({ head: p.headRefOid, commits: [], records, authors });
  return r.state === 'reviewed' ? r.record?.reviewer.name : undefined;
}

/** The tasks marked unreviewed, with their PRs. */
function markedTasks(ctx: Ctx, floorId: string): Assignment[] {
  if (floorsAs.has(ctx.cfg)) return []; // a test's gate: no roster
  try {
    const d = rosterOf(ctx).data(floorId);
    return ROLES.flatMap((r) => [d.members[r.id].task, ...(d.members[r.id].prevTasks ?? [])]).filter((t): t is Assignment => !!t?.unreviewed);
  } catch {
    return [];
  }
}

/** A task the gate settled: its mark, and why it went. */
export interface Settled {
  task: Assignment;
  pr: number;
  why: string;
  was: NonNullable<Assignment['unreviewed']>;
}

/**
 * Takes the "unreviewed" mark off the tasks whose PR a counting review of the merged head (`counted`)
 * or a close without merging settled, and the "(unreviewed)" off their outcome. What it settled.
 */
export function settleMarks(tasks: Iterable<Assignment | undefined>, pulls: readonly GhPull[], counted: (p: GhPull) => string | undefined): Settled[] {
  const out: Settled[] = [];
  for (const t of tasks) {
    const mark = t?.unreviewed;
    if (!t || !mark) continue;
    const p = pulls.find((x) => x.number === mark.pr);
    if (!p) continue;
    const who = p.state === 'MERGED' ? counted(p) : undefined;
    const why = p.state === 'CLOSED' ? `PR #${p.number} was closed without merging` : who ? `${who} reviewed PR #${p.number} at ${short(p.headRefOid)}, the revision that merged` : '';
    if (!why) continue;
    delete t.unreviewed;
    if (t.doneWhy) t.doneWhy = t.doneWhy.replace(/ \(unreviewed\)$/, '');
    out.push({ task: t, pr: p.number, why, was: mark });
  }
  return out;
}

/** Clears the "unreviewed" marks a counting review of the merged head (or a close without merging) settled; the history stays. */
export async function clearReviewed(ctx: Ctx, floor: Floor, now = Date.now()): Promise<number> {
  const gate = mergeGateOf(ctx);
  await gate.store.book(floor.id);
  const settled = settleMarks(markedTasks(ctx, floor.id), floor.github.pulls.items, (p) => countedReviewer(ctx, floor.id, p, undefined));
  for (const s of settled) {
    await gate.store.addCleared(floor.id, { pr: s.pr, ...(s.task.taskId ? { task: s.task.taskId } : {}), why: s.why, at: now }).catch(() => undefined);
    audit.record({ floor: floor.id, actor: { kind: 'office', name: 'Merge gate' }, action: 'pr.review.cleared', target: { kind: 'pr', id: `#${s.pr}` }, summary: `Cleared the unreviewed mark on PR #${s.pr}'s task: ${s.why}`, details: { was: s.was.why, markedAt: s.was.at } });
  }
  if (settled.length) {
    try {
      rosterOf(ctx).touch(teamFloor(ctx, floor), true);
    } catch {
      // no team
    }
  }
  return settled.length;
}

/** A new PR list: the open PRs that moved are evaluated (their status posted), then settled marks are cleared. */
export async function onPulls(ctx: Ctx, floor: Floor): Promise<void> {
  if (!floor.github?.pulls) return;
  const marked = markedTasks(ctx, floor.id).map((t) => t.unreviewed!.pr);
  await mergeGateOf(ctx).sweep(gateFloorOf(ctx, floor), floor.github.pulls.items, marked);
  await clearReviewed(ctx, floor);
  asksAgain(ctx, floor.id);
}

const askedFor = new Map<string, string>();

/** Needs you looks again soon when the PRs waiting for the person changed (not every 5 minutes later). */
export function asksAgain(ctx: Ctx, floorId: string) {
  if (floorsAs.has(ctx.cfg)) return; // a test's gate: no Needs you
  const ids = gateAsks(ctx, floorId).map((i) => i.id).sort().join(',');
  if ((askedFor.get(floorId) ?? '') === ids) return;
  askedFor.set(floorId, ids);
  // Loaded when needed: Needs you's look imports the review gate, which imports this module.
  void import('../asks/index.js').then((m) => m.asksOf(ctx).soon(floorId, 'the merge gate')).catch(() => undefined);
}

/** The office's Merge button asks first: undefined when it may merge, else why not (audited either way when it matters). */
export async function checkMerge(ctx: Ctx, floor: Floor, n: number, who: { name: string; id?: string }, auto: boolean): Promise<string | undefined> {
  const d = await mergeGateOf(ctx).check(gateFloorOf(ctx, floor), n, { auto });
  const target = { kind: 'pr', id: `#${n}`, label: `PR #${n}` };
  if (!d.allowed) {
    audit.record({ floor: floor.id, actor: human(who.name, who.id), action: 'pr.gate.refused', target, summary: `The merge gate refused to merge PR #${n}`, details: { reason: d.reason, head: d.head } });
    return d.reason;
  }
  if (d.override) audit.record({ floor: floor.id, actor: human(who.name, who.id), action: 'pr.gate.overriddenMerge', target, summary: `Merging PR #${n} under ${d.override.by.name}'s override of the merge gate`, details: { reason: d.override.reason, head: d.head }, severity: 'warning' });
  return undefined;
}

/** Needs you: an open PR only a person can review (no other agent can) whose head has no counting review. */
export function gateAsks(ctx: Pick<Ctx, 'cfg'>, floorId: string): AskItem[] {
  const out: AskItem[] = [];
  for (const [k, v] of mergeGateOf(ctx).views) {
    if (!k.startsWith(`${floorId}#`) || v.state !== 'OPEN' || !v.personReviews || v.checks === 'fail') continue;
    if (v.review.state !== 'none' && v.review.state !== 'stale') continue;
    out.push({
      id: `mg-review-${v.pr}-${short(v.head)}`,
      kind: 'review',
      level: 'warn',
      text: `PR #${v.pr} waits for your review of ${short(v.head)}${v.review.state === 'stale' ? ` (${v.review.text.replace(/^Stale: /, '')})` : ''}`,
      lines: [
        'No other agent on this team can review it, so you are the reviewer.',
        'Open it on the PR board and choose “Reviewed and approved this revision” (or request changes) under Review. It counts for this exact commit only.',
        ...(v.authors.length ? [`Authored by ${v.authors.join(', ')}.`] : []),
      ],
      acts: [{ act: 'seen', label: 'Hide' }],
    });
  }
  return out;
}
