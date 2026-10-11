// How a member's task ended, from what the office already knows: its pull request's state (the floor's
// PR list, which holds open, merged and closed-unmerged ones), the floor's closed issues with why GitHub
// says they closed, and what the agent said last. Pure, so the tests walk every case.
//
// Only a merged PR or an issue closed as completed is delivery. A PR closed without merging is never
// success: a newer PR from the same worker supersedes it, otherwise the Project Manager decides (rework,
// cancel, or replaced?). An issue closed as not planned (or a duplicate) cancels the task. An agent that
// says `task done` with neither is a claim, pending verification. Both of those stop the back-to-work
// nudge and wait for the person, as a finished task does; a later merge or close upgrades them.
//
// Records saved before this (a doneAt with no outcome) are left as they are: "legacy" in outcomeOf.

/** A pull request as the floor's list has it: OPEN, MERGED or CLOSED (closed without merging). */
export interface PullLook {
  number: number;
  state: string;
  headRefName?: string;
  /** Issues it closes, as GitHub links them. */
  closes?: readonly number[];
}

/** Ends that finish the task for good (doneAt is set). */
export type FinalOutcome = 'integrated' | 'delivered' | 'cancelled';
/** Ends the office can't count as delivered yet: they stop the nudges and wait for the person. */
export type PendingOutcome = 'claimed' | 'decision';

export type Outcome =
  | { kind: FinalOutcome; why: string; pr?: number; issue?: number; closeReason?: string; supersedes?: number }
  | { kind: PendingOutcome; why: string; pr?: number }
  /** Its PR was closed unmerged, but a newer open one from the same worker carries the work: still open. */
  | { kind: 'superseded'; why: string; pr: number; by: number };

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
}

/** How the task ended, or undefined while it's open. */
export function outcome(l: OutcomeLook): Outcome | undefined {
  const pull = l.pr !== undefined ? l.pulls?.find((p) => p.number === l.pr) : undefined;
  if (pull?.state === 'MERGED') return { kind: 'integrated', why: `PR #${pull.number} merged`, pr: pull.number };
  if (l.issue !== undefined && l.closed?.has(l.issue)) {
    const reason = l.closed.get(l.issue) || undefined;
    if (dropped(reason)) return { kind: 'cancelled', why: `issue #${l.issue} closed as ${reason === 'DUPLICATE' ? 'a duplicate' : 'not planned'}`, issue: l.issue, closeReason: reason };
    return { kind: 'delivered', why: `issue #${l.issue} closed`, issue: l.issue, ...(reason ? { closeReason: reason } : {}) };
  }
  if (pull?.state === 'CLOSED') {
    const by = supersedingPull(pull, l);
    if (by?.state === 'MERGED') return { kind: 'integrated', why: `PR #${by.number} merged (it replaced PR #${pull.number}, closed unmerged)`, pr: by.number, supersedes: pull.number };
    if (by) return { kind: 'superseded', why: `PR #${pull.number} was closed unmerged; PR #${by.number} replaces it`, pr: pull.number, by: by.number };
    return { kind: 'decision', why: `PR #${pull.number} was closed without merging`, pr: pull.number };
  }
  if (l.lastWords && l.claim.test(l.lastWords.slice(-600))) return { kind: 'claimed', why: 'it said task done (pending verification)' };
  return undefined;
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
