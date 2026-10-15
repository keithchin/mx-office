// Needs you's clean-up card, on the server (shared/decisions/duplicates.ts): "Close duplicates" closes what
// the person confirmed, and only that. The groups are worked out again here from the roster and the
// Separate choices, and every id the page sent must still be offered under the same kept one, else nothing
// is closed (a 409: the card changed). Each duplicate escalation is answered through the durable answer
// path (roster/escalation-answer.ts) as dismissed with the outcome `superseded` and the kept one's id:
// a dismissal has no dispatch target, so nothing is typed to any agent. A duplicate proposal is closed as
// rejected with the kept one's id beside it, and nobody is told. Every close is audited with its successor.

import { duplicateGroups, type DuplicateGroup } from '../../shared/decisions/duplicates.js';
import type { DecisionSplit } from '../../shared/decisions/types.js';
import { audit, human } from '../audit/index.js';
import type { AnswerResult } from '../dispatch/service.js';
import { answerGroup } from '../roster/escalation-answer.js';
import type { Roster } from '../roster/index.js';
import type { TeamFloor } from '../roster/types.js';

/** What the person confirmed: per group, the one kept and the ones to close. */
export interface CloseRequest {
  keep: string;
  close: string[];
}

export type CloseResult = { ok: true; closed: number } | { ok: false; error: string; status: number };

/** The request read from a body: at most 50 groups of 50 ids. */
export function readCloseRequest(v: unknown): CloseRequest[] {
  if (!Array.isArray(v)) return [];
  const id = (x: unknown) => (typeof x === 'string' && /^[\w-]{1,40}$/.test(x) ? x : undefined);
  return v.slice(0, 50).flatMap((g) => {
    const keep = id((g as CloseRequest)?.keep);
    const close = Array.isArray((g as CloseRequest)?.close) ? (g as CloseRequest).close.slice(0, 50).map(id).filter((x): x is string => !!x) : [];
    return keep && close.length ? [{ keep, close }] : [];
  });
}

const changed: CloseResult = { ok: false, error: 'These duplicates changed since you opened the card: look at it again', status: 409 };

/** Closes the confirmed duplicates; never more than what is still offered and was confirmed. */
export async function closeDuplicates(roster: Roster, tf: TeamFloor, req: readonly CloseRequest[], splits: readonly DecisionSplit[], by: string, owner?: string): Promise<CloseResult> {
  if (!req.length) return { ok: false, error: 'Which duplicates? Confirm the groups to close', status: 400 };
  const d = roster.data(tf.id);
  const groups = duplicateGroups(d.escalations, d.proposals, splits);
  const plan: { g: DuplicateGroup; ids: string[] }[] = [];
  for (const r of req) {
    const g = groups.find((x) => x.keep.id === r.keep);
    if (!g || !r.close.every((id) => g.close.some((c) => c.id === id))) return changed;
    plan.push({ g, ids: [...new Set(r.close)] });
  }
  const actor = human(by, owner);
  let closed = 0;
  for (const { g, ids } of plan) {
    if (g.kind === 'escalation') {
      const why = (id: string) => ({ id, by, verdict: 'dismiss' as const, raw: `Superseded by ${g.keep.id}: “${g.keep.title}” (a duplicate, closed by ${by})`, outcome: 'superseded' as const, supersededBy: g.keep.id, expectedRev: 0 });
      const [first, ...rest] = ids;
      const res: AnswerResult = await answerGroup(roster, tf, why(first), rest.map(why));
      if (!res.ok) return { ok: false, error: res.error, status: res.status };
      closed += ids.length;
    } else {
      for (const id of ids) {
        const p = d.proposals.find((x) => x.id === id && x.status === 'pending');
        if (!p) continue;
        p.status = 'rejected';
        p.reason = `A duplicate of the pending proposal ${g.keep.id}, which is kept`;
        p.supersededBy = g.keep.id;
        p.decidedBy = by;
        p.decidedAt = roster.deps.now();
        audit.record({ floor: tf.id, actor, action: 'proposal.superseded', target: { kind: 'proposal', id: p.id, label: p.title }, summary: `Closed a duplicate proposal, superseded by ${g.keep.id} (nobody told): ${p.title}`, details: { supersededBy: g.keep.id } });
        closed++;
      }
    }
  }
  audit.record({ floor: tf.id, actor, action: 'decisions.close-duplicates', target: { kind: 'decision', id: 'duplicates', label: `${closed} duplicates` }, summary: `Closed ${closed} duplicate${closed === 1 ? '' : 's'} in Needs you, each superseded by the one kept (nothing sent to the agents)`, details: { groups: plan.map((x) => ({ kind: x.g.kind, keep: x.g.keep.id, closed: x.ids })) } });
  roster.touch(tf);
  await roster
    .file(tf.id)
    .flushCritical()
    .catch(() => undefined);
  return { ok: true, closed };
}
