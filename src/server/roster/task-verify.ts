// Testing release 2 on a member's task (resume.ts Assignment): an integrated task (its PR merged) is
// judged on its merge commit against the verification policy (shared/testing/verify.ts), and only "Done
// (verified)" counts as delivered. "Merged, not verified" raises ONE Needs you item per task revision
// with what failed or is missing and the options (re-run checks / waive with a reason / send back for
// rework); nothing nudges the agent: an integrated task is finished (doneAt), and the back-to-work nudge
// already leaves finished tasks alone. A task's own policy, when it has one, beats the project's.
// Records from before release 2 have no verify field and read as they did: legacy stays legacy, and an
// integrated task not yet judged reads as "integrated".

import { blockingWords, cleanPolicy, policyWords, type VerificationPolicy } from '../../shared/testing/policy.js';
import { VERIFY_WORDS, type IntegratedResult, type TaskVerification, type VerifyState } from '../../shared/testing/verify.js';
import type { Roster } from './index.js';
import type { Assignment } from './resume.js';
import type { TeamFloor } from './types.js';

export type TaskState = 'open' | 'claimed' | 'decision' | 'cancelled' | 'delivered' | 'legacy' | 'integrated' | VerifyState;

/** Where a task stands, release 2 included: an integrated task by its verification, once judged. */
export function taskStateOf(t: Assignment): TaskState {
  if (t.doneAt === undefined) return t.pending?.kind ?? 'open';
  if (!t.outcome) return 'legacy';
  if (t.outcome === 'integrated') return t.verify?.state ?? 'integrated';
  return t.outcome;
}

/** Whether it counts as delivered: an issue closed as completed, or a merge verified on its merge commit (legacy as it always did). */
export function countsAsDelivered(t: Assignment): boolean {
  const s = taskStateOf(t);
  return s === 'delivered' || s === 'verified' || s === 'legacy';
}

const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const STATES: readonly VerifyState[] = ['verified', 'not-verified', 'head-only'];
const rev = (v: unknown) => (typeof v === 'string' && /^[0-9a-f]{7,64}$/i.test(v) ? v : undefined);

/** The release 2 fields of a saved task, each only when well formed. */
export function reviveVerifyFields(r: Partial<Assignment>): Partial<Assignment> {
  const out: Partial<Assignment> = {};
  const policy = cleanPolicy(r.policy);
  if (policy) out.policy = policy;
  const v = r.verify;
  if (v && typeof v === 'object' && STATES.includes(v.state) && int(v.pr) && typeof v.at === 'number') {
    out.verify = {
      v: 1,
      state: v.state,
      pr: v.pr,
      ...(rev(v.revision) ? { revision: v.revision } : {}),
      ...(rev(v.head) ? { head: v.head } : {}),
      at: v.at,
      checks: (Array.isArray(v.checks) ? v.checks : []).filter((c) => c && typeof c.key === 'string' && typeof c.state === 'string').slice(0, 12).map((c) => ({ key: c.key.slice(0, 40), state: c.state, ...(typeof c.waivedBy === 'string' ? { waivedBy: c.waivedBy.slice(0, 80) } : {}) })),
      ...(Array.isArray(v.criteria) ? { criteria: v.criteria.filter((x): x is string => typeof x === 'string').slice(0, 40) } : {}),
      ...(typeof v.escalationId === 'string' ? { escalationId: v.escalationId.slice(0, 40) } : {}),
      ...(typeof v.raisedFor === 'string' ? { raisedFor: v.raisedFor.slice(0, 80) } : {}),
    };
  }
  return out;
}

/** The Needs you item for "Merged, not verified". */
export function notVerifiedAsk(name: string, task: string, pr: number, r: IntegratedResult, policy: VerificationPolicy) {
  const at = r.merge.revision ? `merge commit ${r.merge.revision.slice(0, 7)}` : 'its merge commit (not known yet)';
  return {
    urgency: 'important' as const,
    title: `PR #${pr} merged, not verified: required checks didn't pass on ${at}`,
    details: [
      `${name}'s pull request #${pr} is merged, but its task isn't counted as delivered: ${task}`,
      '',
      `On ${at}: ${blockingWords(r.merge) || 'no required check passed'}.`,
      `The policy in force: ${policyWords(policy)}.`,
      '',
      'Your options:',
      '- Re-run checks: re-run the pr-checks workflow on the default branch on GitHub (Actions › pr-checks › Run workflow), or tell the agent to. The office never re-runs anything itself; it picks the new run up on its next look.',
      '- Waive (with a reason): App Insights › Testing › Verification, Waive, with your reason. It is audited and shown with your name.',
      `- Send back for rework: your answer goes to ${name} as its next prompt.`,
    ].join('\n'),
    options: ['Re-run checks', 'Waive (with a reason)', 'Send back for rework'],
  };
}

/** The task's verify record from a result. */
export function verificationOf(r: IntegratedResult, pr: number, head: string | undefined, criteria: string[], now: number, was?: TaskVerification): TaskVerification {
  return {
    v: 1,
    state: r.state,
    pr,
    ...(r.merge.revision ? { revision: r.merge.revision } : {}),
    ...(head ? { head } : {}),
    at: now,
    checks: r.merge.checks.map((c) => ({ key: c.key, state: c.state, ...(c.waiver ? { waivedBy: c.waiver.by } : {}) })),
    ...(criteria.length ? { criteria } : {}),
    ...(was?.escalationId ? { escalationId: was.escalationId } : {}),
    ...(was?.raisedFor ? { raisedFor: was.raisedFor } : {}),
  };
}

const same = (a: TaskVerification | undefined, b: TaskVerification) => !!a && JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

/**
 * Writes a member's verification down and, for "Merged, not verified", raises one Needs you item per
 * task revision (the PR and its merge commit). Never prompts the agent. True when anything changed.
 */
export function applyVerification(roster: Roster, floor: TeamFloor, who: { workerId: string; by: string; role?: Parameters<Roster['escalations']['raiseFor']>[1]['role'] }, t: Assignment, r: IntegratedResult, policy: VerificationPolicy, ctx: { pr: number; head?: string; criteria: string[] }): boolean {
  if (t.outcome !== 'integrated' || t.doneAt === undefined) return false;
  const now = roster.deps.now();
  const next = verificationOf(r, ctx.pr, ctx.head, ctx.criteria, now, t.verify);
  const key = `${ctx.pr}@${r.merge.revision ?? 'unknown'}`;
  let raised = false;
  if (r.state === 'not-verified' && next.raisedFor !== key) {
    const e = roster.escalations.raiseFor(floor, who, notVerifiedAsk(who.by, t.text, ctx.pr, r, policy), `🧪 ${who.by}'s PR #${ctx.pr} is merged but not verified on its merge commit: the office asked the Project Manager to re-run checks, waive (with a reason) or send it back for rework`);
    next.escalationId = e.id;
    next.raisedFor = key;
    raised = true;
  }
  const changed = raised || !same(t.verify, next);
  if (!changed) return false;
  const before = t.verify?.state;
  t.verify = next;
  if (before !== next.state && next.state !== 'not-verified') floor.activity?.(`🧪 ${who.by}'s task (${t.text}): ${VERIFY_WORDS[next.state]}`);
  roster.touch(floor, true);
  return true;
}
