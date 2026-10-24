// A Developer change's four facts, kept apart (assessment §12.2), each from its own source and never folded into
// one another:
//
//   execution      where the work is (dev-change-state.ts): Queued → Working → Implemented (merged @M) | Cancelled
//                  | Superseded (and Abandoned, Needs attention, Candidate not found)
//   verification   the checks at the relevant revision (the newest candidate, or the merge commit once merged):
//                  passed, failed, or incomplete. No checks, missing ones or no CI are incomplete, never passed
//   preview        whether the running preview has it: in the preview @S, behind, not running, held (the data-impact
//                  guard holds it), or runs main (an unmerged candidate is never in the preview)
//   review         a person's "Looks right for revision X" (or "Something's wrong"), or none. Never release acceptance
//
// Merged never reads as accepted or as available to try: only `preview: in` says it can be tried, and only a review
// says it looks right. Pure.

import type { ChangeState, Tone } from './dev-change-state.js';
import type { CandidateChecks, ChangeReview } from './dev-changes.js';

export type VerifyStatus = 'none' | 'passed' | 'failed' | 'incomplete';
export type PreviewStatus = 'none' | 'main' | 'in' | 'behind' | 'off' | 'held' | 'unknown';
export type ReviewStatus = 'none' | 'works' | 'wrong';

export interface Fact<S extends string> {
  status: S;
  /** The fact in a few words ("Incomplete @c0ffee1", "Held: possible data impact"). */
  words: string;
  tone: Tone;
  /** The revision it is about, when it names one. */
  revision?: string;
}

export interface ChangeFour {
  execution: Fact<ChangeState>;
  verification: Fact<VerifyStatus>;
  preview: Fact<PreviewStatus> & { /** The data-impact hold, when held: its environment, reason and how many findings. */ held?: HeldOn };
  review: Fact<ReviewStatus>;
}

/** A data-impact hold that keeps this change from running (server/data-impact/: env candidate:DC-n, or the live preview's). */
export interface HeldOn {
  env: string;
  reason: string;
  findings: number;
}

export interface FourInput {
  state: ChangeState;
  words: string;
  tone: Tone;
  /** The candidate C or merge commit M the execution names. */
  revision?: string;
  merged?: string;
  checks?: CandidateChecks;
  hasCI?: boolean;
  preview?: { running: boolean; served?: string };
  inServed?: boolean;
  held?: HeldOn;
  reviews?: readonly ChangeReview[];
}

const short = (sha?: string) => (sha ?? '').slice(0, 7);
const OVER = new Set<ChangeState>(['cancelled', 'superseded', 'abandoned', 'not-found']);

/** The verification fact: only results at exactly the relevant revision; none, partial or no CI is incomplete. */
export function verificationFact(i: Pick<FourInput, 'state' | 'revision' | 'checks' | 'hasCI'>): Fact<VerifyStatus> {
  if (!i.revision || OVER.has(i.state)) return { status: 'none', words: 'Nothing to check', tone: 'idle' };
  const rev = i.revision;
  const on = i.checks && i.checks.candidate === rev ? i.checks.on : [];
  if (!on.length) return { status: 'incomplete', words: i.hasCI ? `Incomplete @${short(rev)}: no checks reported` : `Incomplete @${short(rev)}: no CI`, tone: 'warn', revision: rev };
  const failed = on.filter((r) => r.verdict === 'failed').length;
  if (failed) return { status: 'failed', words: `Failed @${short(rev)}: ${failed} of ${on.length}`, tone: 'bad', revision: rev };
  if (on.every((r) => r.verdict === 'passed')) return { status: 'passed', words: `Passed @${short(rev)}: ${on.length} check${on.length === 1 ? '' : 's'}`, tone: 'good', revision: rev };
  return { status: 'incomplete', words: `Incomplete @${short(rev)}: ${on.filter((r) => r.verdict === 'passed').length} of ${on.length} passed`, tone: 'warn', revision: rev };
}

/** The preview fact: held first (the guard keeps it off), then whether the served revision contains the merge. */
export function previewFact(i: Pick<FourInput, 'state' | 'merged' | 'preview' | 'inServed' | 'held'>): ChangeFour['preview'] {
  if (OVER.has(i.state) || i.state === 'queued' || i.state === 'clarify' || i.state === 'working' || i.state === 'attention') return { status: 'none', words: 'Nothing to try yet', tone: 'idle' };
  if (i.held) return { status: 'held', words: 'Held: possible data impact', tone: 'warn', held: i.held };
  if (i.state === 'candidate') return { status: 'main', words: 'Runs main, not this candidate', tone: 'idle' };
  if (i.preview && !i.preview.running) return { status: 'off', words: 'Preview not running', tone: 'idle' };
  if (i.inServed === true) return { status: 'in', words: `In the preview @${short(i.preview?.served)}`, tone: 'good', ...(i.preview?.served ? { revision: i.preview.served } : {}) };
  if (i.inServed === false) return { status: 'behind', words: `Preview behind: runs @${short(i.preview?.served)}`, tone: 'warn', ...(i.preview?.served ? { revision: i.preview.served } : {}) };
  return { status: 'unknown', words: 'Whether the preview has it couldn’t be told', tone: 'idle' };
}

/** The review fact: the newest scoped review, for the exact revision tried. Never acceptance. */
export function reviewFact(reviews: readonly ChangeReview[] | undefined): Fact<ReviewStatus> {
  const r = reviews?.at(-1);
  if (!r) return { status: 'none', words: 'No review yet', tone: 'idle' };
  if (r.verdict === 'works') return { status: 'works', words: `Looks right for @${short(r.revision)} (${r.by})`, tone: 'good', revision: r.revision };
  return { status: 'wrong', words: `Something’s wrong on @${short(r.revision)} (${r.by})${r.correction ? `: ${r.correction}` : ''}`, tone: 'warn', revision: r.revision };
}

/** All four, apart. */
export function changeFour(i: FourInput): ChangeFour {
  return {
    execution: { status: i.state, words: `${i.words}${i.revision && (i.state === 'candidate' || i.state === 'implemented') ? ` @${short(i.revision)}` : ''}`, tone: i.tone, ...(i.revision ? { revision: i.revision } : {}) },
    verification: verificationFact(i),
    preview: previewFact(i),
    review: reviewFact(i.reviews),
  };
}

/** The labels the receipts and Approvals' list show the four facts under. */
export const FACT_LABEL: Record<keyof ChangeFour, string> = { execution: 'Work', verification: 'Checks', preview: 'Preview', review: 'Your review' };
