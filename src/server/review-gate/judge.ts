// The review gate's look at a floor's merged pull requests (docs/site/using-the-office/review-gate.md):
// an agent's PR merged without a review by another agent recorded on it, reviewed only by its own
// opener, merged within minutes of opening without the person's approval, merged with failing or
// running checks, or called "(reviewed)" with no review behind it, is flagged as a Needs-you info card,
// and its task stays "integrated (unreviewed)", never verified. Deterministic, from the PR list the office
// already reads (review-gate/fields.ts). It can't block anything on GitHub; it says what happened. Pure.

import type { AskItem } from '../../shared/asks.js';
import type { GhPull } from '../../shared/protocol.js';
import type { Assignment } from '../roster/resume.js';
import { agentFromAuthor, claimsReviewed, openerFromBody, parseReview, reviewComplete, REVIEW_MIN_MINUTES } from '../../shared/review-gate.js';

export type GateFlag = 'no-review' | 'self-review' | 'fast' | 'checks-failing' | 'checks-pending' | 'reviewed-claim';

/** Only PRs merged this recently are looked at: older history isn't news. */
export const GATE_DAYS = 7;

export interface JudgeLook {
  /** The floor's agents by name (its team members and workers). */
  agents: readonly string[];
  /** The agent working on a branch, when the office knows. */
  branchOwner?(branch: string): string | undefined;
  minMinutes?: number;
}

export interface PullJudgement {
  pr: number;
  opener?: string;
  flags: GateFlag[];
  /** Who reviewed it in a way that counts. */
  reviewers: string[];
  /** `Review:` comments that named someone else but listed no checks with results, or no files read. */
  incomplete: string[];
  /** No review that counts: its task stays integrated (unreviewed). */
  unreviewed: boolean;
  /** From opening to merge (ms). */
  tookMs?: number;
}

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);

/** The agent who opened it: the PR body's "Opened by … via Mx Office", else whoever works on its branch, else an agent commit author. */
export function openerOf(p: GhPull, look: Pick<JudgeLook, 'branchOwner'>): string | undefined {
  return openerFromBody(p.body) ?? look.branchOwner?.(p.headRefName) ?? (p.commitAuthors ?? []).map(agentFromAuthor).find(Boolean);
}

/** A PR an agent opened: one it names, or one from an office worktree branch (office/<name>-<id>). */
const agentPull = (p: GhPull, opener: string | undefined) => !!opener || /^office\//.test(p.headRefName ?? '');

/** The gate's verdict on one merged PR, or undefined when it isn't an agent's merged PR. */
export function judgePull(p: GhPull, look: JudgeLook): PullJudgement | undefined {
  if (p.state !== 'MERGED' || !p.mergedAt) return undefined;
  const opener = openerOf(p, look);
  if (!agentPull(p, opener)) return undefined;
  const mergedAt = ms(p.mergedAt);
  const reviewers: string[] = [];
  const incomplete: string[] = [];
  let selfReviewed = false;
  let approved = false;
  for (const n of p.reviewNotes ?? []) {
    const at = ms(n.at);
    if (!(at <= mergedAt)) continue; // a review after the merge didn't gate it
    const otherAccount = !!n.author && !!p.author && n.author !== p.author;
    if (otherAccount && (n.state === 'APPROVED' || /^\s*\**approved?\b/i.test(n.body))) approved = true;
    const r = parseReview(n.body);
    if (!r) continue;
    if (same(r.reviewer, opener)) {
      selfReviewed = true;
      continue;
    }
    const known = look.agents.some((a) => same(a, r.reviewer)) || otherAccount;
    if (!known) continue;
    if (reviewComplete(r)) reviewers.push(r.reviewer);
    else incomplete.push(r.reviewer || '(nobody named)');
  }
  const flags: GateFlag[] = [];
  const reviewed = reviewers.length > 0;
  if (!reviewed) flags.push(selfReviewed ? 'self-review' : 'no-review');
  const tookMs = mergedAt - ms(p.createdAt);
  const fast = Number.isFinite(tookMs) && tookMs < (look.minMinutes ?? REVIEW_MIN_MINUTES) * 60_000 && !approved;
  if (fast) flags.push('fast');
  if (p.checks === 'fail') flags.push('checks-failing');
  else if (p.checks === 'pending') flags.push('checks-pending');
  if (!reviewed && (claimsReviewed(p.title) || (p.claims?.length ?? 0) > 0)) flags.push('reviewed-claim');
  return { pr: p.number, ...(opener ? { opener } : {}), flags, reviewers, incomplete, unreviewed: !reviewed, ...(Number.isFinite(tookMs) ? { tookMs } : {}) };
}

/**
 * Marks the integrated tasks a flagged PR delivered (its number, or its `Task: tsk_…` line in the PR body)
 * as integrated (unreviewed): never verified, whatever its checks say later. True when any changed.
 */
export function markTasks(tasks: Iterable<Assignment | undefined>, flagged: readonly { pull: GhPull; j: PullJudgement }[], now: number): boolean {
  let changed = false;
  for (const t of tasks) {
    if (!t || t.outcome !== 'integrated' || t.unreviewed) continue;
    const hit = flagged.find(({ pull, j }) => j.unreviewed && (t.pr === pull.number || (!!t.taskId && (pull.body ?? '').includes(`Task: ${t.taskId}`))));
    if (!hit) continue;
    t.unreviewed = { pr: hit.pull.number, why: `PR #${hit.pull.number} merged without a review by another lead`, at: now };
    if (t.doneWhy && !/unreviewed/.test(t.doneWhy)) t.doneWhy = `${t.doneWhy} (unreviewed)`.slice(0, 120);
    changed = true;
  }
  return changed;
}

/** "12 s", "4 min", "3 h". */
export function took(msTaken: number): string {
  const s = Math.max(0, Math.round(msTaken / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min` : `${Math.round(m / 60)} h`;
}

const REASON: Partial<Record<GateFlag, string>> = {
  'no-review': 'without a review by another lead',
  'self-review': 'reviewed only by its own author',
  'checks-failing': 'with failing checks',
  'checks-pending': 'with checks still running',
  'reviewed-claim': 'called “(reviewed)” with no Review comment behind it',
};

const joined = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The Needs-you info card for a flagged PR. */
export function pullItem(p: GhPull, j: PullJudgement, lead?: string, minMinutes = REVIEW_MIN_MINUTES): AskItem {
  const who = j.opener ? ` by ${j.opener}` : '';
  const fast = j.flags.includes('fast') && j.tookMs !== undefined;
  const reasons = j.flags.map((f) => REASON[f]).filter((r): r is string => !!r);
  const head = fast ? `PR #${p.number}${who} merged ${took(j.tookMs!)} after opening` : `PR #${p.number}${who} merged`;
  const text = reasons.length ? `${head}, ${joined(reasons)}` : `${head}, under ${minMinutes} minutes after opening, without your approval`;
  const oneAccount = !!p.mergedBy && p.mergedBy === p.author;
  const lines = [
    `“${p.title}”`,
    `On GitHub: opened by ${p.author || 'unknown'}${p.mergedBy ? `, merged by ${p.mergedBy}` : ''}${oneAccount ? ' (one account: the agents use the office’s GitHub token, so GitHub can’t show which agent merged it or that anyone approved)' : ''}.`,
    ...(p.commitAuthors?.length ? [`Commits authored as: ${p.commitAuthors.join(', ')}.`] : []),
    ...(p.claims?.length ? [`Commit titles claiming a review: ${p.claims.map((c) => `“${c}”`).join(', ')}.`] : []),
    ...(j.incomplete.length ? [`A Review comment by ${joined(j.incomplete)} lists no checks with their results or no files read, so it doesn’t count.`] : []),
    ...(j.reviewers.length ? [`Reviewed by ${joined(j.reviewers)}.`] : []),
    ...(j.unreviewed ? ['Its task stays integrated (unreviewed), never verified.'] : []),
    `The rule: another lead reviews before the merge and records it on the PR as a “Review:” comment listing the checks run (with results) and the files read; no merge within ${minMinutes} minutes of opening unless you approved it.`,
  ];
  return {
    id: `gate-pr-${p.number}-${j.flags.join('.')}`,
    kind: 'gate',
    level: 'info',
    text,
    ...(Number.isFinite(ms(p.mergedAt)) ? { since: ms(p.mergedAt) } : {}),
    lines,
    acts: [...(lead ? [{ act: 'ask-lead' as const, label: `Ask ${lead} about it` }] : []), { act: 'seen', label: 'Hide' }],
  };
}

/** The floor's flagged PRs merged in the last GATE_DAYS, newest first, with their verdicts. */
export function flaggedPulls(pulls: readonly GhPull[], look: JudgeLook, now: number): { pull: GhPull; j: PullJudgement }[] {
  const since = now - GATE_DAYS * 86_400_000;
  return pulls
    .filter((p) => p.state === 'MERGED' && ms(p.mergedAt) >= since)
    .flatMap((pull) => {
      const j = judgePull(pull, look);
      return j && j.flags.length ? [{ pull, j }] : [];
    })
    .sort((a, b) => ms(b.pull.mergedAt) - ms(a.pull.mergedAt));
}
