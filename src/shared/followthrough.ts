// Recorded as given (Slice 1B-2, docs/site/using-the-office/needs-you.md): after the person decides and the
// office hands the answer on (server/dispatch/), it looks for the agent's record of it and compares what is
// written there with what was decided. A BRD question's record is its fields (answer / decision, consentBy,
// consentAt); an escalation's is the line that cites it, `Decided per ESC-<id> rev <n>: <answer>`, in a team
// journal or PROJECT.md's Decisions. Finding the citation only locates the evidence: the answer value is
// compared exactly (shared/recorded-answer.ts) before anything reads "Recorded as given"; a record that
// mentions the decision without stating it exactly needs review. Where it was found is kept apart: a
// working copy, a commit on a branch, or merged into main.
//
// Faithful recording (what may clear a dependent item by itself) is recorded as given, at the current
// revision, merged into main. Needs review and recorded differently never are. Pure: the browser imports
// the words.

import type { AnswerRevisionKind, DecisionRef, DispatchState } from './dispatch.js';
import { stateWords } from './dispatch.js';
import type { DecisionLinks } from './task-links.js';

/** What the office found of a decision's record. */
export type RecordedOutcome = 'recorded' | 'needs-review' | 'recorded-differently' | 'recorded-older-rev' | 'not-recorded-yet';
export const RECORDED_OUTCOMES: readonly RecordedOutcome[] = ['recorded', 'needs-review', 'recorded-differently', 'recorded-older-rev', 'not-recorded-yet'];

/** A finding the person may look at and act on (Accept as recorded, Send correction): anything written that isn't as given. */
export const reviewable = (r: Pick<Recording, 'outcome'>) => r.outcome === 'needs-review' || r.outcome === 'recorded-differently' || r.outcome === 'recorded-older-rev';

export type RecordedWhere = 'working-copy' | 'committed-on-branch' | 'merged-into-main';

/** Where a record was found, each part its own field: the commit and the file's blob are never the same thing. */
export interface RecordedLocation {
  /** The file, relative to the project (docs/team/development.md, analysis/F002.brd.json). */
  path: string;
  /** The commit whose tree holds the recorded content; none for a working copy. */
  commitSha?: string;
  /** `git rev-parse <commitSha>:<path>`: the file's blob in that commit. */
  blobId?: string;
  where: RecordedWhere;
  /** The branch, for committed-on-branch (and main's name, for merged-into-main). */
  branch?: string;
  /** Whose copy it was read from ("Ada", "the project folder"). */
  who?: string;
}

/** The office's finding about one decision's record. */
export interface Recording {
  outcome: RecordedOutcome;
  /** The revision the record is for: the current one (recorded, differently), the older one it cites (older-rev). */
  rev?: number;
  /** What is written there, as found (the citation's paragraph or row; the BRD's fields), at most 2,000 characters. */
  text?: string;
  /** The answer value read from the citation's line (what was compared), when the line has one. */
  answer?: string;
  location?: RecordedLocation;
  /** When the office worked this out. */
  at: number;
}

export const RECORDED_TEXT_MAX = 2000;

/** Recorded as given, at the current revision, merged into main: the only finding that may clear a dependent item by itself. */
export const faithful = (r: Recording | undefined, currentRev: number) => !!r && r.outcome === 'recorded' && r.rev === currentRev && r.location?.where === 'merged-into-main';

// ---- What an answer may be recorded as (each compared exactly: shared/recorded-answer.ts sameAnswer) --------

/**
 * The answer values an escalation's revision may be recorded as: its option, its text as sent, its text
 * without the office's own "Go with:" prefix and without an option key such as "(A) ", or the verdict word
 * when it has no text. Each is a whole answer, never a fragment to look for inside a record.
 */
export function escalationExpected(r: { text: string; kind: AnswerRevisionKind; option?: string }): string[] {
  const out: string[] = [];
  const t = r.text.trim();
  if (r.option) out.push(r.option);
  const core = t.replace(/^go with:\s*/i, '').trim();
  if (core) out.push(core);
  const keyless = core.replace(/^\(?[A-Za-z0-9]\)?[.):]\s+/, '').trim();
  if (keyless && keyless !== core) out.push(keyless);
  if (t && t !== core) out.push(t);
  if (!t && r.kind === 'approve') out.push('approved', 'approve');
  if (!t && r.kind === 'reject') out.push('rejected', 'reject');
  return out;
}

/** The one answer value the office asks an agent to write for a revision: its option, its words without "Go with:", or the verdict word. */
export function primaryAnswer(r: { text: string; kind: AnswerRevisionKind; option?: string }): string {
  if (r.option) return r.option;
  const core = r.text.replace(/^go with:\s*/i, '').replace(/\s+/g, ' ').trim();
  if (core) return core;
  return r.kind === 'approve' ? 'APPROVED' : r.kind === 'reject' ? 'REJECTED' : '';
}

// ---- The follow-through feed -----------------------------------------------------------------------------

/** One answered decision still being followed through (GET /api/followthrough). */
export interface FollowItem {
  decision: DecisionRef;
  kind: 'esc' | 'q';
  /** ESC-3f9c2a1b7e, Q OQ-05. */
  label: string;
  title: string;
  /** The decision's current revision, and what it says. */
  rev: number;
  decided: string;
  /** The dispatch that carried it (server/dispatch/). */
  sent?: { state: DispatchState; confirmedBy?: 'system' | 'person'; to?: string; /** Typed into the terminal (dispatch record's typedAt). */ typedAt?: number };
  recording: Recording;
  /** A question's key, an escalation's id: where its own page is. */
  ref: string;
  /** Slice 1B-4: the revision's task links and their evidence, as last worked out. */
  taskLinks?: DecisionLinks;
}

export interface FollowView {
  floor: string;
  admin: boolean;
  items: FollowItem[];
}

export type FollowAction = 'accept-as-recorded' | 'send-correction' | 'dismiss';
export const FOLLOW_ACTIONS: readonly FollowAction[] = ['accept-as-recorded', 'send-correction', 'dismiss'];
export const isFollowAction = (v: unknown): v is FollowAction => typeof v === 'string' && (FOLLOW_ACTIONS as readonly string[]).includes(v);

/** "Recorded as given" / "Needs review: not worded exactly as given" / "Recorded differently" / "Recorded for rev 1" / "Not recorded yet". */
export function recordedWords(r: Pick<Recording, 'outcome' | 'rev'>): string {
  switch (r.outcome) {
    case 'recorded':
      return 'Recorded as given';
    case 'needs-review':
      return 'Needs review: not worded exactly as given';
    case 'recorded-differently':
      return 'Recorded differently';
    case 'recorded-older-rev':
      return `Recorded for rev ${r.rev ?? '?'}`;
    default:
      return 'Not recorded yet';
  }
}

/** "In a working copy, not committed" / "Committed on office/dev" / "Merged into main". */
export function whereWords(l: RecordedLocation | undefined): string {
  if (!l) return '';
  if (l.where === 'working-copy') return `In a working copy, not committed${l.who ? ` (${l.who})` : ''}`;
  if (l.where === 'committed-on-branch') return `Committed on ${l.branch ?? 'a branch'}`;
  return 'Merged into main';
}

/**
 * "Sent (Received (the office saw it arrive))", a person's confirmation shown as such; what hasn't arrived (typed,
 * not received yet; held; outcome unknown) is never called sent.
 */
export function sentWords(s: FollowItem['sent']): string {
  if (!s) return 'Sent';
  if (s.state === 'submitted' || s.state === 'person-confirmed-sent') return `Sent (${stateWords(s)})`;
  return stateWords(s);
}

/** The plan's line: Decided (rev n) · Sent (…) · Recorded … · where. */
export function followLine(i: Pick<FollowItem, 'rev' | 'sent' | 'recording'>): string {
  return [`Decided (rev ${i.rev})`, sentWords(i.sent), recordedWords(i.recording), whereWords(i.recording.location)].filter(Boolean).join(' · ');
}

/** Status-level, never counted as waiting on you; warn when the record needs review, differs or cites an older revision. */
export const followLevel = (r: Pick<Recording, 'outcome'>): 'warn' | 'status' => (reviewable(r) ? 'warn' : 'status');

/** "docs/team/development.md @ 1a2b3c4 (blob 9f8e7d6)". */
export function locationWords(l: RecordedLocation | undefined): string {
  if (!l) return '';
  return `${l.path}${l.commitSha ? ` @ ${l.commitSha.slice(0, 7)}` : ''}${l.blobId ? ` (blob ${l.blobId.slice(0, 7)})` : ''}`;
}
