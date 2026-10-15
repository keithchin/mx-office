// Change answer (Slice 1B-3, docs/site/teams-and-agents/escalations.md): the Project Manager replaces an
// answer already given (a resolved escalation, a BRD question sent or recorded) with a new one. The new
// answer is the next revision in the answer store (server/answers/), superseding the one before, and it is
// handed on through the 1B-1 dispatcher with a message that says plainly what it replaces and the
// citation to use now. Follow-through then tracks the new revision; the old one's outcome stays in the
// history. The work that used the old revision is listed honestly: only links the office has recorded
// (or text it read, labelled inferred), and never "no impact" when it found none.
// Pure: the browser imports the types and the words.

import type { AnswerRevisionKind, DecisionRef, DispatchState } from './dispatch.js';
import type { EscalationVerdict } from './roster/escalation.js';
import { VERDICT_WORD } from './roster/escalation.js';
import type { RecordedOutcome } from './followthrough.js';
import { recordedWords } from './followthrough.js';
import { stateWords } from './dispatch.js';
import { NO_LINKS_FOUND, type DecisionLinks } from './task-links.js';

/** How a linked piece of work is known: a field that points at the decision, or text the office read. */
export type LinkStrength = 'recorded' | 'inferred';

export type LinkKind = 'question' | 'decision' | 'pr' | 'stage' | 'stuck' | 'journey' | 'waiting' | 'verification' | 'model-change' | 'blocks' | 'escalation';

/** One piece of work that used (or may have used) the decision. */
export interface LinkedWork {
  kind: LinkKind;
  /** "BRD question F001.brd.json#OQ-01", "Ada is waiting on it", "MCR-3". */
  label: string;
  /** Where the link is: "Escalation refs", "Ada's task", "the request's text". */
  source: string;
  strength: LinkStrength;
}

/** Words for a link's strength. */
export const LINK_WORDS: Record<LinkStrength, string> = { recorded: 'Recorded link', inferred: 'Inferred' };

/** What shows when nothing is linked: never "no impact", never "no work needed" (Slice 1B-4 shared/task-links.ts). */
export const NO_LINKS = NO_LINKS_FOUND;

/** One revision as the history shows it: full text, who and when, how it was handed on and what came of it. */
export interface HistoryRev {
  rev: number;
  kind: AnswerRevisionKind;
  option?: string;
  text: string;
  by: string;
  at: number;
  supersedes?: number;
  basis?: 'recorded-differently';
  /** The dispatches that carried it (a person's confirmation shown as such). */
  dispatch: { state: DispatchState; confirmedBy?: 'system' | 'person'; to?: string }[];
  /** What follow-through found for it: the current revision's finding, an older one's as it was when replaced. */
  outcome?: { outcome: RecordedOutcome; rev?: number };
}

/** What a question's answer may be changed to (the same shape as the original). */
export type QChangeKind = 'answer' | 'accept' | 'moot';
export const Q_CHANGE_KINDS: readonly QChangeKind[] = ['answer', 'accept', 'moot'];
/** What an escalation's answer may be changed to (Noted only for an FYI). */
export const ESC_CHANGE_VERDICTS: readonly EscalationVerdict[] = ['reply', 'approve', 'reject', 'dismiss'];

/** GET /api/answers/detail: one decision's current answer, its history, and the work that used it. */
export interface AnswerDetail {
  floor: string;
  decision: DecisionRef;
  /** ESC-3f9c2a1b7e, Q OQ-01. */
  label: string;
  title: string;
  /** The revision the decision's own record points at (what expectedRev must be). */
  rev: number;
  /** Every revision in the answer store, oldest first. */
  revs: HistoryRev[];
  links: LinkedWork[];
  /** Slice 1B-4: the revision's task links with their strength and evidence (none when it couldn't be worked out). */
  taskLinks?: DecisionLinks;
  /** What the new answer's input offers: an escalation's options and whether it's an FYI; a question's options and proposal. */
  input: { kind: 'esc'; options: string[]; recommendation?: string; fyi: boolean } | { kind: 'q'; options: string[]; proposedPosition?: string };
  /** Why it can't be changed now (still open, a duplicate closed, not sent yet), when it can't. */
  blocked?: string;
}

/** POST /api/answers/change. */
export interface ChangeBody {
  floor: string;
  decision: DecisionRef;
  expectedRev: number;
  verdict?: EscalationVerdict;
  kind?: QChangeKind;
  text?: string;
  option?: string;
  /** Slice 1B-4: "No implementation work required": the answer as it stands, restated as a new revision of that kind, `text` its reason. */
  noWork?: boolean;
}

/** "History (3 revisions)". */
export const historyTitle = (n: number) => `History (${n} revision${n === 1 ? '' : 's'})`;

/** A revision kind in a few words. */
export const KIND_WORDS: Record<AnswerRevisionKind, string> = {
  answer: 'Answer',
  'accept-proposal': 'Accepted the proposal',
  moot: 'Not relevant / dismissed',
  noted: 'Noted',
  done: 'Done',
  approve: 'Approved',
  reject: 'Rejected',
  reply: 'Reply',
  'accept-as-recorded': 'Accepted as recorded',
  correction: 'Correction',
  'no-work-required': 'No implementation work required',
};

/** What an escalation's answer says, as the agent reads it: "APPROVED — Use SSO", or the reply itself. */
export function escAnswerWords(verdict: EscalationVerdict, text: string): string {
  const t = text.trim();
  if (verdict === 'reply') return t;
  return t ? `${VERDICT_WORD[verdict]} — ${t}` : VERDICT_WORD[verdict];
}

/** The line every escalation change carries: what it replaces and the citation to use now. */
export const escChangeLine = (escId: string, oldRev: number, newRev: number, words: string) => `This replaces my answer rev ${oldRev} to ESC-${escId}: ${words.replace(/\s+/g, ' ').trim()}. Record it as \`Decided per ESC-${escId} rev ${newRev}\`.`;

/** The analogous line for a BRD question, with its key. */
export const qChangeLine = (key: string, oldRev: number, newRev: number, words: string) => `This replaces my answer rev ${oldRev} to question ${key}: ${words.replace(/\s+/g, ' ').trim()}. Record it as rev ${newRev} of ${key}, exactly as below, in place of what rev ${oldRev} asked for.`;

/** How a revision was handed on: each dispatch's state (a person's confirmation shown as such), or why none shows. */
export function revDispatchWords(r: Pick<HistoryRev, 'dispatch' | 'kind'>): string {
  if (!r.dispatch.length) return r.kind === 'accept-as-recorded' ? 'Nothing sent (accepted as recorded)' : r.kind === 'noted' || r.kind === 'moot' ? 'Nothing sent' : 'No dispatch record kept';
  return r.dispatch.map((d) => `${stateWords(d)}${d.to ? ` to ${d.to}` : ''}`).join('; ');
}

/** What follow-through found for a revision ("Recorded for rev 1"), or that nothing was kept. */
export const revOutcomeWords = (r: Pick<HistoryRev, 'outcome'>) => (r.outcome ? recordedWords(r.outcome) : 'No finding kept');
