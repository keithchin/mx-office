// What each member is on, so the office's own messages never replace it. A standup, a settings notice,
// a decision or a relay used to end an agent's turn where it was: it answered and stopped, its task left
// open until someone noticed (the live floor sat idle for 25 minutes that way). So every message the office
// composes ends with the resume line, "When you've done this, carry on with: <task>", and an agent with no
// task is told what to do instead. The task is the office's own record, not WorkerInfo.task: that one is
// named from the latest prompts, which a standup's prompt rewrites into "posting a standup".
//
// A member's task (MemberRecord.task) is what it was last given to do: its hire's task, a prompt the
// Project Manager typed to it, or a Coordinator's `office-workers tell`. A short reply ("yes, go ahead")
// or a question ("What's blocking?") isn't a task. How it ended is task-outcome.ts: delivered when its PR
// merged or its issue closed as completed, cancelled when the issue closed as not planned; a PR closed
// without merging (and not replaced) waits on the Project Manager's decision, and an agent's own
// `task done` is a claim pending verification. Either of those stops the nudges, as finishing does.

import type { WorkerInfo } from '../../shared/protocol.js';
import type { RoleId } from '../../shared/roster/roles.js';
import type { Roster } from './index.js';
import { managerRole } from './coverage.js';
import type { TeamFloor } from './types.js';
import type { VerificationPolicy } from '../../shared/testing/policy.js';
import type { TaskVerification } from '../../shared/testing/verify.js';
import { reviveVerifyFields } from './task-verify.js';
import { outcomesSince } from './closed-since.js';
import { closedPrAsk, outcome, OUTCOME_V, type FinalOutcome, type Outcome, type PendingOutcome, type PullLook } from './task-outcome.js';

export interface Assignment {
  /** What to carry on with, one line: "work on GitHub issue #1 (Discovery)". */
  text: string;
  at: number;
  by: string;
  /** The issue it names, when it names one: closing that issue finishes it. */
  issue?: number;
  /** When the office saw it was finished, and how. */
  doneAt?: number;
  doneWhy?: string;
  /** The version of the fields below (OUTCOME_V); a doneAt without them is a legacy record. */
  v?: number;
  /** How it finished, with doneAt: only integrated and delivered are delivery. */
  outcome?: FinalOutcome;
  /** The PR that finished it, or GitHub's reason for closing its issue. */
  pr?: number;
  closeReason?: string;
  /** Not finished, not open: a claim pending verification, or a closed-unmerged PR awaiting the Project Manager. */
  pending?: { kind: PendingOutcome; at: number; why: string; pr?: number; escalationId?: string };
  /** Its PR was closed unmerged and a newer one from the same worker replaced it. */
  superseded?: { pr: number; by: number };
  /** Testing release 2 (task-verify.ts): this task's own verification policy, beating the project's. */
  policy?: VerificationPolicy;
  /** Testing release 2: an integrated task judged on its merge commit (only "verified" is delivered). */
  verify?: TaskVerification;
}

/** A task's provenance: open, pending, or how it finished ("legacy": finished before outcomes were kept). */
export function outcomeOf(t: Assignment): FinalOutcome | PendingOutcome | 'legacy' | 'open' {
  if (t.doneAt !== undefined) return t.outcome ?? 'legacy';
  return t.pending?.kind ?? 'open';
}

/** Shorter than this and it's a reply within a task, not a new one. */
const MIN_CHARS = 24;
const TEXT_MAX = 160;
/** How every resume line starts: a message that already has one doesn't get two. */
export const RESUME_HEAD = "When you've done this";
/** What an agent says at the end of a turn to mark its task finished (the back-to-work nudge asks for it). */
export const TASK_DONE = /\btask done\b/i;

/**
 * A task from what someone sent an agent, or undefined when it's a reply, a question or a slash command.
 * `hire`: a hire's task counts however short or however phrased ("Set up e2e").
 */
export function assignmentFrom(raw: unknown, by: string, at: number, hire = false): Assignment | undefined {
  if (typeof raw !== 'string') return undefined;
  const clean = raw.replace(/\r\n?/g, '\n').trim();
  if (!clean || (!hire && clean.length < MIN_CHARS) || /^\/\S+$/.test(clean)) return undefined;
  // A short question is answered in the turn it starts ("What's blocking the team right now?").
  if (!hire && /\?\s*$/.test(clean) && clean.length < 400) return undefined;
  const first = clean.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) ?? '';
  if (!first) return undefined;
  const issue = /(?:issue\s*#?|#)(\d{1,6})\b/i.exec(clean)?.[1];
  const text = first.length > TEXT_MAX ? `${first.slice(0, TEXT_MAX - 1)}…` : first;
  return { text, at, by, ...(issue ? { issue: Number(issue) } : {}) };
}

/** A task as it was saved, or undefined when it's malformed. */
export function reviveAssignment(raw: unknown): Assignment | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<Assignment>;
  if (typeof r.text !== 'string' || !r.text.trim() || typeof r.at !== 'number') return undefined;
  return {
    text: r.text.slice(0, TEXT_MAX),
    at: r.at,
    by: typeof r.by === 'string' ? r.by.slice(0, 80) : 'someone',
    ...(typeof r.issue === 'number' && Number.isInteger(r.issue) ? { issue: r.issue } : {}),
    ...(typeof r.doneAt === 'number' ? { doneAt: r.doneAt, doneWhy: typeof r.doneWhy === 'string' ? r.doneWhy.slice(0, 120) : 'finished' } : {}),
    ...reviveOutcome(r),
    ...reviveVerifyFields(r),
  };
}

const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** The outcome fields (OUTCOME_V), each only when it's well formed; none on an older record. */
function reviveOutcome(r: Partial<Assignment>): Partial<Assignment> {
  const out: Partial<Assignment> = {};
  if (int(r.v)) out.v = r.v;
  if (typeof r.doneAt === 'number' && (r.outcome === 'integrated' || r.outcome === 'delivered' || r.outcome === 'cancelled')) out.outcome = r.outcome;
  if (int(r.pr)) out.pr = r.pr;
  if (typeof r.closeReason === 'string') out.closeReason = r.closeReason.slice(0, 40);
  const p = r.pending;
  if (typeof r.doneAt !== 'number' && p && (p.kind === 'claimed' || p.kind === 'decision') && typeof p.at === 'number') {
    out.pending = { kind: p.kind, at: p.at, why: typeof p.why === 'string' ? p.why.slice(0, 120) : p.kind, ...(int(p.pr) ? { pr: p.pr } : {}), ...(typeof p.escalationId === 'string' ? { escalationId: p.escalationId.slice(0, 40) } : {}) };
  }
  const s = r.superseded;
  if (s && int(s.pr) && int(s.by)) out.superseded = { pr: s.pr, by: s.by };
  return out;
}

/** The line the office's messages end with: carry on with the task, or what to do without one. */
export function resumeLine(task: string | undefined, coordinates = false): string {
  if (task) return `${RESUME_HEAD}, carry on with: ${task.replace(/[.\s]+$/, '')}.`;
  return `${RESUME_HEAD}: you have no task yet. ${coordinates ? 'Say in one line what you will do next, or escalate if you need the Project Manager.' : 'Tell the Coordinator what you will do next, or escalate if you are blocked.'}`;
}

/** `text` with the resume line at its end, unless it has one already. */
export function withResume(text: string, line: string): string {
  return text.includes(RESUME_HEAD) ? text : `${text}\n\n${line}`;
}

/** What tells the office how a task ended, from what it knows. */
export interface FinishLook {
  task: Assignment;
  /** The worker's pull request. */
  pr?: { number: number };
  /** The floor's PR list: open, merged and closed-unmerged ones (an empty one isn't loaded yet). */
  pulls?: readonly PullLook[];
  /** The worker's worktree branch: a newer PR from it replaces one closed unmerged. */
  branch?: string;
  /** Issues the office knows are closed on the floor, each with GitHub's close reason ('' when none). */
  closed?: ReadonlyMap<number, string>;
  /** What the agent said last. */
  lastWords?: string;
  /** PRs closed unmerged before this raise no decision (task-outcome.ts OutcomeLook.closedSince). */
  closedSince?: number;
}

/**
 * How the task ended (task-outcome.ts), or undefined while it's open. A finished one keeps its recorded
 * end (a legacy record, with no outcome, reads as delivered here: outcomeOf tells them apart). A pending
 * one stands until something stronger says otherwise: a claim until its PR merges or its issue closes,
 * a closed-PR decision until then or until the worker's PR is open again (reopened, or a new one).
 */
export function taskOutcome(l: FinishLook): Outcome | undefined {
  const t = l.task;
  if (t.doneAt !== undefined) return { kind: t.outcome ?? 'delivered', why: t.doneWhy ?? 'finished' };
  const o = outcome({ issue: t.issue, pr: l.pr?.number, pulls: l.pulls, branch: l.branch, closed: l.closed, lastWords: l.lastWords, claim: TASK_DONE, closedSince: l.closedSince });
  if (o || !t.pending) return o;
  const open = !!l.pr && !!l.pulls?.some((p) => p.number === l.pr!.number && p.state === 'OPEN');
  if (t.pending.kind === 'decision' && open) return undefined;
  return { kind: t.pending.kind, why: t.pending.why, ...(t.pending.pr !== undefined ? { pr: t.pending.pr } : {}) };
}

/**
 * Why the task needs no nudge back to it: finished (delivered, cancelled), or waiting on the person (a
 * claim pending verification, a closed PR awaiting a decision). Undefined while it's open, or while a
 * newer PR carries on the work of one closed unmerged.
 */
export function finishedWhy(l: FinishLook): string | undefined {
  const o = taskOutcome(l);
  return o && o.kind !== 'superseded' ? o.why : undefined;
}

/** The member a worker is, and its task record. */
function memberOf(roster: Roster, floor: TeamFloor, workerId: string) {
  const role = roster.roleOf(floor, workerId);
  return role ? { role, m: roster.data(floor.id).members[role] } : undefined;
}

/**
 * The office's task book for a floor: who's on what, and how it ended. Issues it learns are closed come
 * from the floor's issue list (Roster.onIssues) and PR states from the floor's PR list, so finishing
 * needs no lookups of its own.
 */
export class Tasks {
  /** Each floor's closed issues, with GitHub's reason for closing each ('' when it gave none). */
  private closed = new Map<string, Map<number, string>>();

  constructor(private roster: Roster) {}

  /** The floor's issues came back from GitHub: the closed ones finish (or cancel) the tasks that name them. */
  onIssues(floorId: string, issues: readonly { number: number; state: string; stateReason?: string }[]) {
    this.closed.set(floorId, new Map(issues.filter((i) => i.state !== 'OPEN').map((i) => [i.number, i.stateReason ?? ''])));
  }

  /** Records what a member was given to do; false when it isn't a member or it isn't a task. */
  assign(floor: TeamFloor, workerId: string, raw: unknown, by: string): boolean {
    const mm = memberOf(this.roster, floor, workerId);
    const a = mm && assignmentFrom(raw, by, this.roster.deps.now());
    if (!mm || !a) return false;
    mm.m.task = a;
    this.roster.touch(floor, true);
    return true;
  }

  /** A role's task from its hire (members.ts), before its worker is known. */
  assignRole(floor: TeamFloor, role: RoleId, raw: unknown, by: string) {
    const a = assignmentFrom(raw, by, this.roster.deps.now(), true);
    if (a) this.roster.data(floor.id).members[role].task = a;
  }

  private look(floor: TeamFloor, w: WorkerInfo, task: Assignment, words: boolean): FinishLook {
    return {
      task,
      pr: w.pr && { number: w.pr.number },
      // A floor without the full list (an older seam) knows only the open ones: a closed PR is then just unknown.
      pulls: floor.pulls?.() ?? floor.openPulls().map((p) => ({ ...p, state: 'OPEN' })),
      branch: w.worktree?.branch,
      closed: this.closed.get(floor.id),
      ...(words ? { lastWords: floor.lastWords?.(w) } : {}),
      closedSince: outcomesSince(),
    };
  }

  /** Writes down how the task ended: a final end once, a pending one while it lasts, a replaced PR. */
  private settle(floor: TeamFloor, w: WorkerInfo, t: Assignment, o: Outcome | undefined): Outcome | undefined {
    if (t.doneAt !== undefined) return o;
    const now = this.roster.deps.now();
    if (o && (o.kind === 'integrated' || o.kind === 'delivered' || o.kind === 'cancelled')) {
      Object.assign(t, { doneAt: now, doneWhy: o.why, outcome: o.kind, v: OUTCOME_V }, o.pr !== undefined ? { pr: o.pr } : {}, o.closeReason ? { closeReason: o.closeReason } : {});
      if (o.supersedes !== undefined && o.pr !== undefined) t.superseded = { pr: o.supersedes, by: o.pr };
      delete t.pending;
      this.roster.touch(floor, true);
      return o;
    }
    const before = JSON.stringify([t.pending, t.superseded]);
    if (o?.kind === 'superseded') t.superseded = { pr: o.pr, by: o.by };
    if (o && (o.kind === 'claimed' || o.kind === 'decision')) {
      if (t.pending?.kind !== o.kind || t.pending.pr !== o.pr) {
        t.pending = { kind: o.kind, at: now, why: o.why, ...(o.pr !== undefined ? { pr: o.pr } : {}) };
        if (o.kind === 'decision') this.askDecision(floor, w, t, t.pending, o.pr!);
        else floor.activity?.(`📝 ${w.name} says its task is done (${t.text}): pending verification, not counted as delivered until its PR merges or its issue closes`);
      }
    } else delete t.pending;
    if (JSON.stringify([t.pending, t.superseded]) !== before) {
      t.v = OUTCOME_V;
      this.roster.touch(floor, true);
    }
    return o;
  }

  /** A PR closed without merging, and nothing replaced it: the Project Manager decides, in Needs you. */
  private askDecision(floor: TeamFloor, w: WorkerInfo, t: Assignment, pending: NonNullable<Assignment['pending']>, pr: number) {
    const role = this.roster.roleOf(floor, w.id);
    const e = this.roster.escalations.raiseFor(floor, { workerId: w.id, by: w.name, ...(role ? { role } : {}) }, closedPrAsk(w.name, t.text, pr), `🔀 ${w.name}'s PR #${pr} was closed without merging: the office asked the Project Manager whether to rework it, cancel the task, or which PR replaced it`);
    pending.escalationId = e.id;
  }

  /** How the member's task ended (writing it down), or undefined while it's open (or it has none). */
  outcome(floor: TeamFloor, w: WorkerInfo): Outcome | undefined {
    const t = memberOf(this.roster, floor, w.id)?.m.task;
    return t && this.settle(floor, w, t, taskOutcome(this.look(floor, w, t, true)));
  }

  /** Why the member's task needs no nudge back to it (finished, or waiting on the person), or undefined while it's open. */
  finished(floor: TeamFloor, w: WorkerInfo): string | undefined {
    const o = this.outcome(floor, w);
    return o && o.kind !== 'superseded' ? o.why : undefined;
  }

  /**
   * What the worker is on, while that's open: a member's task, else (not a member) what its card says.
   * A pending one is looked at again first (without the agent's words): a merge, a closed issue, or its
   * PR open again settles it.
   */
  current(floor: TeamFloor, w: WorkerInfo): string | undefined {
    const mm = memberOf(this.roster, floor, w.id);
    if (!mm) return w.task?.name;
    const t = mm.m.task;
    if (!t || t.doneAt !== undefined) return undefined;
    if (t.pending) {
      const o = this.settle(floor, w, t, taskOutcome(this.look(floor, w, t, false)));
      if (o && o.kind !== 'superseded') return undefined;
    }
    return t.text;
  }

  /** The resume line for this worker now: a task waiting on the person isn't one to carry on with. */
  line(floor: TeamFloor, w: WorkerInfo): string {
    const role = this.roster.roleOf(floor, w.id);
    const coordinates = !!role && role === managerRole(this.roster.data(floor.id));
    const task = this.current(floor, w);
    const held = !task && role ? this.roster.data(floor.id).members[role].task?.pending : undefined;
    if (held) return `${RESUME_HEAD}: your last task waits on the Project Manager (${held.why}), so don't carry on with it until they answer. ${coordinates ? 'Say in one line what you will do next.' : 'Tell the Coordinator what you will do next, or wait.'}`;
    return resumeLine(task, coordinates);
  }
}
