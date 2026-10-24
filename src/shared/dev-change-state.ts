// A Developer change's execution fact (shared/dev-changes.ts has the record): where the work is, derived each time
// from what the office keeps, never stored as one field. The other three facts (verification, preview
// availability, human review) are in dev-change-facts.ts, each from its own source, so a merged change never reads
// as accepted or as available to try. Pure.
//
//   Queued (+why)        saved, waiting: another change is active, no lead at work, paused, the spend cap, the lead
//                        asleep, the hand-over refused just now, the active change held for possible data impact,
//                        or (by the project's policy) an overlapping earlier change nobody has tried yet
//   Needs clarification  what it points at is gone at main's head: not started blindly
//   Working              handed to the team (a task id), no candidate yet
//   Working · candidate  a head seen on dev/DC-n or a PR with its Task: line; not merged
//   Implemented          a candidate merged into main (merge commit M, from its PR or from git ancestry). Merged ≠ accepted
//   Needs attention      the worker that had it is gone and there's no PR: Cancel or Retry
//   Abandoned            its PR was closed without merging and its task is done
//   Candidate not found  the team finished and nothing follows the branch convention: said, never guessed
//   Cancelled            before it started, or while the team had it (the worker stopped first)
//   Superseded           a person marked it replaced by a correction linked with `of:`

import type { Candidate, DevChange, DevChangeEvent, QueueWhy, StopResult } from './dev-changes.js';

export type ChangeState = 'queued' | 'clarify' | 'working' | 'candidate' | 'implemented' | 'attention' | 'abandoned' | 'not-found' | 'cancelled' | 'superseded';

export const CHANGE_WORDS: Record<ChangeState, string> = {
  queued: 'Queued',
  clarify: 'Needs clarification',
  working: 'Working',
  candidate: 'Working · candidate',
  implemented: 'Implemented',
  attention: 'Needs attention',
  abandoned: 'Abandoned',
  'not-found': 'Candidate not found',
  cancelled: 'Cancelled',
  superseded: 'Superseded',
};

export type Tone = 'idle' | 'busy' | 'good' | 'bad' | 'warn';

/** The pill's tone per state (the Developer view's .aw-pill classes). */
export const CHANGE_TONE: Record<ChangeState, Tone> = {
  queued: 'idle',
  clarify: 'warn',
  working: 'busy',
  candidate: 'busy',
  implemented: 'good',
  attention: 'warn',
  abandoned: 'bad',
  'not-found': 'warn',
  cancelled: 'bad',
  superseded: 'idle',
};

/** The states that name a revision (the candidate C, or the merge commit M). */
export const NAMES_REVISION: ReadonlySet<ChangeState> = new Set(['candidate', 'implemented']);

/** The words for why a change waits. */
export function queueWhyWords(why: QueueWhy, ahead?: string): string {
  switch (why) {
    case 'behind':
      return `${ahead ?? 'Another change'} is with the team: this one starts when that one is implemented, cancelled or settled.`;
    case 'no-lead':
      return 'No team lead is at work: it starts when the team is started in Project Management.';
    case 'paused':
      return 'The project is paused: it starts when the project is resumed.';
    case 'cap':
      return 'The team’s daily spend cap is reached: it starts when the cap allows work again.';
    case 'asleep':
      return 'The team lead is asleep: it starts when the lead is back at work.';
    case 'refused':
      return 'The office couldn’t hand it to the team lead just now: it tries again when the team moves.';
    case 'held':
      return `${ahead ?? 'The active change'} is merged but held for possible data impact: this one starts once that hold is approved or cleared.`;
    case 'depends':
      return `It overlaps ${ahead ?? 'an earlier change'}, which nobody has tried yet, and this project’s policy waits for that review.`;
  }
}

/** What the execution fact is worked out from (server/dev-changes/view.ts gathers it). */
export interface ChangeFacts {
  queue: DevChange['queue'];
  /** Queued: why it waits, its place (1 = next) and the change ahead. */
  why?: QueueWhy;
  position?: number;
  ahead?: string;
  clarify?: string;
  /** The record's cancellation: who, and whether the team had it (with how its worker was stopped). */
  cancelled?: { by: string; active?: true; stop?: StopResult };
  superseded?: { by: string; follow: string };
  /** The record's settlement, when the queue is over for it. */
  settled?: Extract<DevChangeEvent, { type: 'settled' }>['why'];
  /** The task's last end on its record, and the member's task's outcome. */
  ended?: 'completed' | 'cancelled' | 'superseded';
  outcome?: 'open' | 'claimed' | 'decision' | 'integrated' | 'delivered' | 'cancelled' | 'legacy';
  /** The newest candidate seen in time (late ones aside). */
  candidate?: Candidate;
  /** Its PR (on dev/DC-n, or carrying its Task: line): open, merged with its merge commit, or closed. */
  pr?: { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; mergeCommit?: string };
  /** Merged into main: from its PR's merge commit, or (no PR) the first commit on main's first-parent line that contains the candidate. */
  merged?: { sha: string; via: 'pr' | 'git' };
  /** The worker it was handed to is gone (not on the project any more). */
  workerGone?: boolean;
  /** The live app: serving revision S, or not running. */
  preview?: { running: boolean; served?: string };
  /** Whether S contains the merge commit (undefined: couldn't tell). */
  inServed?: boolean;
}

export interface ChangeStatus {
  state: ChangeState;
  words: string;
  /** One line under it, in plain words. */
  detail: string;
  /** The revision the state names: the candidate C, or the merge commit M. */
  revision?: string;
}

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const at = (state: ChangeState, detail: string, revision?: string): ChangeStatus => ({ state, words: CHANGE_WORDS[state], detail, ...(revision ? { revision } : {}) });

const STOP_WORDS: Record<StopResult['how'], string> = {
  slept: 'its worker was stopped mid-turn (its session kept)',
  idle: 'its worker was between turns, so nothing had to be stopped',
  asleep: 'its worker was already asleep',
  gone: 'its worker had already left the project',
};

/** How a stop went, in words. */
export const stopWords = (s: StopResult) => `${STOP_WORDS[s.how]}${s.dropped ? `; ${s.dropped} waiting message${s.dropped === 1 ? ' was' : 's were'} taken back` : ''}`;

const finishedOf = (f: ChangeFacts) => f.ended === 'completed' || f.ended === 'superseded' || f.outcome === 'integrated' || f.outcome === 'delivered';

/** Where the work is (the table at the top of this file). Missing facts never move it forward. */
export function changeState(f: ChangeFacts): ChangeStatus {
  if (f.queue === 'superseded' && f.superseded) return at('superseded', `Superseded by ${f.superseded.follow}, marked by ${f.superseded.by}.${f.merged ? ` It was implemented @${short(f.merged.sha)}; ${f.superseded.follow} replaces it.` : ''}`, f.merged?.sha);
  if (f.queue === 'cancelled') {
    const c = f.cancelled;
    if (c?.active) return at('cancelled', `Cancelled by ${c.by} while the team had it: ${c.stop ? stopWords(c.stop) : 'its worker was stopped'} before the next change could start. Anything it made is abandoned and never counted.`);
    return at('cancelled', `Cancelled${c ? ` by ${c.by}` : ''} before it started. Nothing was handed to the team.`);
  }
  if (f.queue === 'clarify') return at('clarify', f.clarify ?? 'What it points at isn’t in the app any more: say what you mean now, or cancel it.');
  if (f.queue === 'queued') {
    const place = f.position && f.position > 1 ? `Number ${f.position} in the queue. ` : '';
    return at('queued', `${place}${queueWhyWords(f.why ?? 'behind', f.ahead)}`);
  }
  if (f.merged) return at('implemented', `Merged into main @${short(f.merged.sha)}${f.merged.via === 'git' ? ' (found on main by git, no PR)' : ''}. Merged isn’t tried or reviewed: the preview and your review are facts of their own.`, f.merged.sha);
  if (f.ended === 'cancelled' || f.outcome === 'cancelled') return at('cancelled', 'The team cancelled its task. Ask the team lead why, or ask for it again.');
  const finished = finishedOf(f) || f.queue === 'settled';
  if (f.settled === 'abandoned' || (f.pr?.state === 'CLOSED' && finished)) return at('abandoned', `PR #${f.pr?.number ?? '?'} was closed without merging and the team says the task is done: abandoned. Nothing was merged; ask for it again if it’s still wanted.`);
  if (f.candidate) {
    const pr = f.pr ? ` · PR #${f.pr.number}${f.pr.state === 'CLOSED' ? ' (closed without merging)' : ''}` : '';
    return at('candidate', `Candidate @${short(f.candidate.sha)} on ${f.candidate.branch}${pr}. Not merged: the live preview runs main, not this.`, f.candidate.sha);
  }
  if (finished) return at('not-found', 'The team says it’s done or set it aside, but nothing was found on its branch or on a PR with its Task line. Ask the team lead where the work is.');
  if (f.workerGone && !f.pr && f.queue === 'active') return at('attention', 'The worker that had it has left the project and there’s no PR: cancel it, or Retry to hand it to the team lead again.');
  return at('working', f.outcome === 'decision' ? 'The team lead has it and waits on a decision of yours (under Decisions).' : 'The team lead has it. Nothing saved on its branch yet.');
}

/** Whether a change's turn is over for the queue (the next one may start), and why. Undefined: still active. */
export function settledWhy(f: ChangeFacts): Extract<DevChangeEvent, { type: 'settled' }>['why'] | undefined {
  if (f.merged) return 'merged';
  if (f.ended === 'cancelled' || f.outcome === 'cancelled') return 'cancelled';
  if (f.ended === 'superseded') return 'set-aside';
  const finished = f.ended === 'completed' || f.outcome === 'integrated' || f.outcome === 'delivered';
  if (finished && f.pr?.state === 'CLOSED') return 'abandoned';
  if (finished) return f.candidate ? undefined : 'not-found';
  return undefined;
}
