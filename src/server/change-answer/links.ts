// The work that used a decision's revision (Slice 1B-3), honest: only what the office has today. A
// recorded link is a field that names the decision (the escalation's refs, a member's task waiting on it,
// a task's verification raised as it, an escalation whose refs name the question); an inferred one is text
// the office read (a model change request whose words name it, a BRD question's free-text "blocks"). Task
// links come with task ids (1B-4); until then an empty list says so, never "no impact". Pure.

import type { LinkedWork } from '../../shared/change-answer.js';
import type { Escalation } from '../../shared/roster/escalation.js';

/** A member's task as the links read it. */
export interface TaskLike {
  member: string;
  text: string;
  pending?: { escalationId?: string; pr?: number; why?: string };
  verify?: { escalationId?: string; pr?: number };
}

export interface LinkSources {
  escalations: readonly Escalation[];
  tasks: readonly TaskLike[];
  changeRequests: readonly { id: string; request: string }[];
  /** A BRD question's "blocks" by key (free text). */
  blocks(key: string): string | undefined;
}

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Each explicit ref of an escalation, as a recorded link. */
function refLinks(e: Escalation, blocks: LinkSources['blocks']): LinkedWork[] {
  const r = e.refs ?? {};
  const src = 'Escalation refs';
  const out: LinkedWork[] = [];
  if (r.questionKey) out.push({ kind: 'question', label: `BRD question ${r.questionKey}`, source: src, strength: 'recorded' });
  if (r.decisionId) out.push({ kind: 'decision', label: `Register decision ${r.decisionId}`, source: src, strength: 'recorded' });
  if (r.pr) out.push({ kind: 'pr', label: `PR #${r.pr}`, source: src, strength: 'recorded' });
  if (r.stageId) out.push({ kind: 'stage', label: `Stage ${r.stageId}`, source: src, strength: 'recorded' });
  if (r.stuckId) out.push({ kind: 'stuck', label: `Stuck item ${r.stuckId}`, source: src, strength: 'recorded' });
  if (r.journeyId) out.push({ kind: 'journey', label: `Journey ${r.journeyId}`, source: src, strength: 'recorded' });
  const b = r.questionKey ? blocks(r.questionKey) : undefined;
  if (b) out.push({ kind: 'blocks', label: `Blocks: ${short(b)}`, source: `${r.questionKey}'s "blocks" (free text)`, strength: 'inferred' });
  return out;
}

/** The linked work of an escalation's answer. */
export function escalationLinks(e: Escalation, s: LinkSources): LinkedWork[] {
  const out = refLinks(e, s.blocks);
  for (const t of s.tasks) {
    if (t.pending?.escalationId === e.id) out.push({ kind: 'waiting', label: `${t.member} is waiting on it: ${short(t.text)}`, source: `${t.member}'s task`, strength: 'recorded' });
    if (t.verify?.escalationId === e.id) out.push({ kind: 'verification', label: `Verification of ${t.member}'s task${t.verify.pr ? ` (PR #${t.verify.pr})` : ''}`, source: `${t.member}'s task verification`, strength: 'recorded' });
  }
  const needle = `ESC-${e.id}`.toLowerCase();
  for (const c of s.changeRequests) if (c.request.toLowerCase().includes(needle)) out.push({ kind: 'model-change', label: `${c.id}: ${short(c.request)}`, source: "the request's text names it", strength: 'inferred' });
  return out;
}

/** The linked work of a BRD question's answer. */
export function questionLinks(key: string, s: LinkSources): LinkedWork[] {
  const out: LinkedWork[] = [];
  for (const e of s.escalations) if (e.refs?.questionKey === key) out.push({ kind: 'escalation', label: `ESC-${e.id}: ${short(e.title)}`, source: "the escalation's refs", strength: 'recorded' });
  const b = s.blocks(key);
  if (b) out.push({ kind: 'blocks', label: `Blocks: ${short(b)}`, source: 'the BRD\'s "blocks" (free text)', strength: 'inferred' });
  const needle = key.toLowerCase();
  for (const c of s.changeRequests) if (c.request.toLowerCase().includes(needle)) out.push({ kind: 'model-change', label: `${c.id}: ${short(c.request)}`, source: "the request's text names it", strength: 'inferred' });
  return out;
}
