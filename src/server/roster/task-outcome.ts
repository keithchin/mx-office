// How a member's task ended, from what the office already knows: its pull request's state (the floor's
// PR list, which holds open, merged and closed-unmerged ones), the floor's closed issues with why GitHub
// says they closed, and what the agent said last. Pure, so the tests walk every case.
//
// Only a merged PR or an issue closed as completed is delivery (the issue only when the task's own PR, if
// it has one, isn't left unmerged). A PR closed without merging is never
// success: a newer PR from the same worker supersedes it, otherwise the Project Manager decides (rework,
// cancel, or replaced?). An issue closed as not planned (or a duplicate) cancels the task. An agent that
// says `task done` with neither is a claim, pending verification. Both of those stop the back-to-work
// nudge and wait for the person, as a finished task does; a later merge or close upgrades them.
//
// Records saved before this (a doneAt with no outcome) are left as they are: "legacy" in outcomeOf.
//
// A merged PR is this task's delivery only with evidence that it is (project audit, 16 Oct: six tasks
// read "PR #3 merged" though PR #3 merged before any of them existed): it merged after the task was given
// (Assignment.at, this attempt), and it carries the task's id, a `Task: tsk_…` line in its body (a PR
// opened from the desk writes one) or in one of its commits (pr-task-ids.ts). A worker's PR that merged
// before the task is not this task's at all; one merged after it without the id is only "associated
// (unconfirmed)": the task stays open, and the agent is nudged as for any open task.

/** A pull request as the floor's list has it: OPEN, MERGED or CLOSED (closed without merging). */
export interface PullLook {
  number: number;
  state: string;
  headRefName?: string;
  /** Issues it closes, as GitHub links them. */
  closes?: readonly number[];
  /** When GitHub says it closed (ISO time); a closed-unmerged PR older than OutcomeLook.closedSince raises no decision. */
  closedAt?: string;
  /** When it merged (ISO time): a merge from before the task can't be the task's. */
  mergedAt?: string;
  /** Its description: a `Task: tsk_…` line there says which task it delivers. */
  body?: string;
  headRefOid?: string;
  mergeCommit?: string;
}

/** Ends that finish the task for good (doneAt is set). */
export type FinalOutcome = 'integrated' | 'delivered' | 'cancelled';
/** Ends the office can't count as delivered yet: they stop the nudges and wait for the person. */
export type PendingOutcome = 'claimed' | 'decision';

export type Outcome =
  | { kind: FinalOutcome; why: string; pr?: number; issue?: number; closeReason?: string; supersedes?: number }
  | { kind: PendingOutcome; why: string; pr?: number }
  /** Its PR was closed unmerged, but a newer open one from the same worker carries the work: still open. */
  | { kind: 'superseded'; why: string; pr: number; by: number }
  /** A PR merged after the task without carrying its id: shown, never counted; the task stays open. */
  | { kind: 'associated'; why: string; pr: number };

/** The version of the outcome fields on an Assignment (resume.ts). */
export const OUTCOME_V = 2;

/** Why GitHub closed an issue (gh's stateReason) means the work was dropped, not done. */
export const dropped = (reason: string | undefined) => reason === 'NOT_PLANNED' || reason === 'DUPLICATE';

export interface OutcomeLook {
  issue?: number;
  /** The worker's pull request (its number), and the floor's PR list; an empty list isn't loaded yet. */
  pr?: number;
  pulls?: readonly PullLook[];
  /** The worker's worktree branch: a newer PR from it supersedes a closed one. */
  branch?: string;
  /** The floor's closed issues, each with GitHub's stateReason ('' when it gave none). */
  closed?: ReadonlyMap<number, string>;
  /** What the agent said last; undefined skips the claim (a pending task is re-checked without it). */
  lastWords?: string;
  /** What marks a claim. */
  claim: RegExp;
  /**
   * When task outcomes started on this office (roster/closed-since.ts): a PR closed without merging
   * before then (or with no known close time) is no decision, and the task reads as it did. Undefined:
   * every closed PR counts.
   */
  closedSince?: number;
  /** When this attempt at the task was given (ms): only a PR merged (or closed) after it can be its end. */
  since?: number;
  /** The task's durable id: a merged PR must carry it to count. None (a legacy task): no merge counts. */
  taskId?: string;
  /** The task ids a PR's commits carry, or undefined while that isn't known (pr-task-ids.ts). */
  carries?: (p: PullLook) => ReadonlySet<string> | undefined;
}

/** How a merged PR stands to a task: its delivery, merged before the task, or merged after it without its id. */
export type PullEvidence = 'confirmed' | 'predates' | 'unconfirmed';

const TASK_LINE = (id: string) => new RegExp(`^\\s*Task:\\s*${id}\\s*$`, 'im');

/** Whether a merged PR is evidence for the task (see the head of this file). */
export function pullEvidence(p: PullLook, l: Pick<OutcomeLook, 'since' | 'taskId' | 'carries'>): PullEvidence {
  const merged = p.mergedAt ? Date.parse(p.mergedAt) : NaN;
  if (l.since !== undefined && Number.isFinite(merged) && merged < l.since) return 'predates';
  if (!Number.isFinite(merged) || !l.taskId) return 'unconfirmed';
  if (p.body && TASK_LINE(l.taskId).test(p.body)) return 'confirmed';
  return l.carries?.(p)?.has(l.taskId) ? 'confirmed' : 'unconfirmed';
}

const unconfirmedWhy = (p: PullLook, l: Pick<OutcomeLook, 'taskId'>) =>
  `PR #${p.number} merged, associated (unconfirmed): ${l.taskId ? `it doesn't carry Task: ${l.taskId}` : 'the task has no id to carry'}`;

/** Whether a closed-unmerged PR closed late enough to ask for a decision on it. */
export function closedRecently(pull: Pick<PullLook, 'closedAt'>, since: number | undefined): boolean {
  if (since === undefined) return true;
  const t = pull.closedAt ? Date.parse(pull.closedAt) : NaN;
  return Number.isFinite(t) && t >= since;
}

/** Whether a closed PR closed after the task was given (no known time: it may have). */
const closedAfter = (p: PullLook, since: number | undefined) => {
  const t = p.closedAt ? Date.parse(p.closedAt) : NaN;
  return since === undefined || !Number.isFinite(t) || t >= since;
};

/** How the task ended, or undefined while it's open. */
export function outcome(l: OutcomeLook): Outcome | undefined {
  let pull = l.pr !== undefined ? l.pulls?.find((p) => p.number === l.pr) : undefined;
  let associated: Outcome | undefined;
  if (pull?.state === 'MERGED') {
    const e = pullEvidence(pull, l);
    if (e === 'confirmed') return { kind: 'integrated', why: `PR #${pull.number} merged`, pr: pull.number };
    if (e === 'unconfirmed') associated = { kind: 'associated', why: unconfirmedWhy(pull, l), pr: pull.number };
    // Merged before the task: not this task's PR at all.
    pull = undefined;
  } else if (pull?.state === 'CLOSED' && !closedAfter(pull, l.since)) pull = undefined;
  // A closed one replaced by a newer PR from the same worker: that one's merge counts as above.
  const by = pull?.state === 'CLOSED' ? supersedingPull(pull, l) : undefined;
  const byEvidence = by?.state === 'MERGED' ? pullEvidence(by, l) : undefined;
  if (pull && by && byEvidence === 'confirmed') return { kind: 'integrated', why: `PR #${by.number} merged (it replaced PR #${pull.number}, closed unmerged)`, pr: by.number, supersedes: pull.number };
  // Another merged PR that names the task in its description (opened from the desk, or by hand).
  const named = l.taskId ? l.pulls?.find((p) => p.state === 'MERGED' && p.number !== l.pr && pullEvidence(p, { since: l.since, taskId: l.taskId }) === 'confirmed') : undefined;
  if (named) return { kind: 'integrated', why: `PR #${named.number} merged`, pr: named.number };
  if (l.issue !== undefined && l.closed?.has(l.issue)) {
    const reason = l.closed.get(l.issue) || undefined;
    if (dropped(reason)) return { kind: 'cancelled', why: `issue #${l.issue} closed as ${reason === 'DUPLICATE' ? 'a duplicate' : 'not planned'}`, issue: l.issue, closeReason: reason };
    // A closed issue isn't delivery while the task's own PR is unmerged (open, or closed without merging): that PR decides.
    if (!pull) return { kind: 'delivered', why: `issue #${l.issue} closed`, issue: l.issue, ...(reason ? { closeReason: reason } : {}) };
  }
  if (pull?.state === 'CLOSED') {
    const e = byEvidence;
    // Replaced by a merge that doesn't carry the task: no decision to ask for, and not delivered either.
    if (by && e === 'unconfirmed') associated ??= { kind: 'associated', why: unconfirmedWhy(by, l), pr: by.number };
    else if (by && !e) return { kind: 'superseded', why: `PR #${pull.number} was closed unmerged; PR #${by.number} replaces it`, pr: pull.number, by: by.number };
    // Closed before outcomes started here: no decision card; the task stays as it was (a claim still counts).
    else if (closedRecently(pull, l.closedSince)) return { kind: 'decision', why: `PR #${pull.number} was closed without merging`, pr: pull.number };
  }
  if (l.lastWords && l.claim.test(l.lastWords.slice(-600))) return { kind: 'claimed', why: 'it said task done (pending verification)' };
  return associated;
}

/** A newer open or merged PR from the same worker, for the same issue, that replaces a closed one. */
function supersedingPull(closed: PullLook, l: OutcomeLook): PullLook | undefined {
  const branches = new Set([closed.headRefName, l.branch].filter((b): b is string => !!b));
  return (l.pulls ?? [])
    .filter((p) => p.number > closed.number && (p.state === 'OPEN' || p.state === 'MERGED'))
    .filter((p) => !!p.headRefName && branches.has(p.headRefName))
    .filter((p) => l.issue === undefined || !p.closes?.length || p.closes.includes(l.issue))
    .sort((a, b) => (a.state === 'MERGED' ? 0 : 1) - (b.state === 'MERGED' ? 0 : 1) || b.number - a.number)[0];
}

/** The ask the Project Manager gets for a PR closed without merging. */
export function closedPrAsk(name: string, task: string, pr: number) {
  return {
    urgency: 'important' as const,
    trigger: 'blocked' as const,
    title: `PR #${pr} was closed without merging: rework, cancel, or replaced?`,
    details: `${name}'s pull request #${pr} was closed on GitHub without being merged, so its task isn't delivered: ${task}\n\nThe office has stopped nudging ${name} about it. Say whether to rework it, cancel the task, or which PR replaced it.`,
    options: ['Rework it', 'Cancel the task', 'Replaced by another PR'],
  };
}
