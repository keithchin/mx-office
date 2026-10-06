// The Lead review loop's bound: each subagent gets the floor's level's revision rounds
// (REVIEW_POLICY.maxRevisions) on a task, and the office counts them from the Lead's verdicts
// (`office-workers subagent review`), so a loop of send-back, redo, send-back can't go on forever on
// the Playbook's say-so alone. Reworks in a row count; an accept ends the task and starts the count
// again. One rework past the allowance is "revisions-exhausted": the office raises one escalation for
// the Lead (subagents.ts), stops the review nudge for that subagent (nudge.ts), and the count starts
// again once the Project Manager has answered. Pure, on the subagent's record.

import type { SubagentRecord } from '../../shared/roster/subagents.js';

export type RoundOutcome = 'ok' | 'exhausted' | 'still-exhausted';

/** Counts a verdict on the record: 'exhausted' the first time the reworks in a row pass `max`. */
export function countRound(rec: SubagentRecord, verdict: 'accept' | 'rework', max: number, now: number): RoundOutcome {
  if (verdict === 'accept') {
    delete rec.reworks;
    delete rec.exhaustedAt;
    delete rec.exhaustedEscalation;
    return 'ok';
  }
  rec.reworks = (rec.reworks ?? 0) + 1;
  if (rec.exhaustedAt !== undefined) return 'still-exhausted';
  if (rec.reworks <= max) return 'ok';
  rec.exhaustedAt = now;
  return 'exhausted';
}

/** The Project Manager answered the escalation: the subagent's count starts again. */
export function resetRounds(rec: SubagentRecord) {
  delete rec.reworks;
  delete rec.exhaustedAt;
  delete rec.exhaustedEscalation;
}

/** What the Lead is told with its verdict: which round that was, or that it's out of them. */
export function roundsLine(rec: SubagentRecord, max: number, level: number): string {
  if (rec.exhaustedAt !== undefined) return ` Out of revision rounds (${max} at autonomy level ${level}): the office escalated it to the Project Manager${rec.exhaustedEscalation ? ` (${rec.exhaustedEscalation})` : ''}. Don't send it back again: carry on with whatever it doesn't block until they answer.`;
  if (rec.reworks) return ` Revision round ${rec.reworks} of ${max} on this task.`;
  return '';
}
