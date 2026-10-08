// What each member is on, so the office's own messages never replace it. A standup, a settings notice,
// a decision or a relay used to end an agent's turn where it was: it answered and stopped, its task left
// open until someone noticed (the live floor sat idle for 25 minutes that way). So every message the office
// composes ends with the resume line, "When you've done this, carry on with: <task>", and an agent with no
// task is told what to do instead. The task is the office's own record, not WorkerInfo.task: that one is
// named from the latest prompts, which a standup's prompt rewrites into "posting a standup".
//
// A member's task (MemberRecord.task) is what it was last given to do: its hire's task, a prompt the
// Project Manager typed to it, or a Coordinator's `office-workers tell`. A short reply ("yes, go ahead")
// or a question ("What's blocking?") isn't a task. It's finished when the office can tell: its issue was
// closed, its pull request is no longer open, or the agent said `task done` at the end of a turn.

import type { WorkerInfo } from '../../shared/protocol.js';
import type { RoleId } from '../../shared/roster/roles.js';
import type { Roster } from './index.js';
import { managerRole } from './coverage.js';
import type { TeamFloor } from './types.js';

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
    ...(typeof r.doneAt === 'number' ? { doneAt: r.doneAt, doneWhy: typeof r.doneWhy === 'string' ? r.doneWhy.slice(0, 80) : 'finished' } : {}),
  };
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

/** What tells the office a task is finished, from what it knows; undefined while it's open. */
export interface FinishLook {
  task: Assignment;
  /** The worker's pull request, and whether it's still open (undefined: the office hasn't seen the list). */
  pr?: { number: number; open: boolean | undefined };
  /** Issues the office knows are closed on the floor. */
  closed?: ReadonlySet<number>;
  /** What the agent said last. */
  lastWords?: string;
}

export function finishedWhy(l: FinishLook): string | undefined {
  if (l.task.doneAt !== undefined) return l.task.doneWhy ?? 'finished';
  if (l.task.issue !== undefined && l.closed?.has(l.task.issue)) return `issue #${l.task.issue} closed`;
  if (l.pr && l.pr.open === false) return `PR #${l.pr.number} is no longer open`;
  if (l.lastWords && TASK_DONE.test(l.lastWords.slice(-600))) return 'it said task done';
  return undefined;
}

/** The member a worker is, and its task record. */
function memberOf(roster: Roster, floor: TeamFloor, workerId: string) {
  const role = roster.roleOf(floor, workerId);
  return role ? { role, m: roster.data(floor.id).members[role] } : undefined;
}

/**
 * The office's task book for a floor: who's on what, and whether it's finished. Issues it learns are
 * closed come from the floor's issue list (Roster.onIssues), so finishing needs no lookups of its own.
 */
export class Tasks {
  private closed = new Map<string, Set<number>>();

  constructor(private roster: Roster) {}

  /** The floor's issues came back from GitHub: the closed ones finish the tasks that name them. */
  onIssues(floorId: string, issues: readonly { number: number; state: string }[]) {
    this.closed.set(floorId, new Set(issues.filter((i) => i.state !== 'OPEN').map((i) => i.number)));
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

  /** Why the member's task is finished, marking it so, or undefined while it's open (or it has none). */
  finished(floor: TeamFloor, w: WorkerInfo): string | undefined {
    const t = memberOf(this.roster, floor, w.id)?.m.task;
    if (!t) return undefined;
    const pulls = floor.openPulls();
    const why = finishedWhy({
      task: t,
      // An empty list may just not be loaded yet: only a list with something in it says a PR closed.
      pr: w.pr && { number: w.pr.number, open: pulls.length ? pulls.some((p) => p.number === w.pr!.number) : undefined },
      closed: this.closed.get(floor.id),
      lastWords: floor.lastWords?.(w),
    });
    if (why && t.doneAt === undefined) {
      t.doneAt = this.roster.deps.now();
      t.doneWhy = why;
      this.roster.touch(floor, true);
    }
    return why;
  }

  /** What the worker is on, while that's open: a member's task, else (not a member) what its card says. */
  current(floor: TeamFloor, w: WorkerInfo): string | undefined {
    const mm = memberOf(this.roster, floor, w.id);
    if (!mm) return w.task?.name;
    const t = mm.m.task;
    return t && t.doneAt === undefined ? t.text : undefined;
  }

  /** The resume line for this worker now. */
  line(floor: TeamFloor, w: WorkerInfo): string {
    const role = this.roster.roleOf(floor, w.id);
    return resumeLine(this.current(floor, w), !!role && role === managerRole(this.roster.data(floor.id)));
  }
}
