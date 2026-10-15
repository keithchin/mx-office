// What the office keeps of a floor's questions (<data>/questions/<floor>.json, written atomically): the
// last collection (so the page shows something at once after a restart), the person's answers with their
// write-back status (pending → sent → recorded), when each question was first seen, and the batch count
// Needs you keys its one notification on. The transitions are here and pure, so the tests drive them.

import type { AnswerKind, PmAnswer, QExpected, Question, QuestionSet, QState } from '../../shared/questions.js';
import { expectedOf, isResolved, openState } from '../../shared/questions.js';
import { faithful } from '../../shared/followthrough.js';
import { judgeQuestion } from '../followthrough/judge.js';

export interface BookData {
  set?: QuestionSet;
  mtimes: Record<string, number>;
  answers: Record<string, PmAnswer>;
  /** When the office first saw each question (ms). */
  seen: Record<string, number>;
  /** Every question that has ever waited on the person: a new one starts a new batch. */
  known: string[];
  batch: number;
  batchSince?: number;
}

export const emptyBook = (): BookData => ({ mtimes: {}, answers: {}, seen: {}, known: [], batch: 0 });

/** A saved book read back: anything missing is empty. */
export function reviveBook(v: unknown): BookData {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<BookData>;
  return {
    ...(o.set && Array.isArray(o.set.questions) ? { set: o.set } : {}),
    mtimes: o.mtimes && typeof o.mtimes === 'object' ? o.mtimes : {},
    answers: o.answers && typeof o.answers === 'object' ? o.answers : {},
    seen: o.seen && typeof o.seen === 'object' ? o.seen : {},
    known: Array.isArray(o.known) ? o.known.filter((k) => typeof k === 'string') : [],
    batch: typeof o.batch === 'number' ? o.batch : 0,
    ...(typeof o.batchSince === 'number' ? { batchSince: o.batchSince } : {}),
  };
}

export interface Taken {
  /** Questions that started waiting on the person since the last collection (a new batch when any). */
  fresh: Question[];
  /** Answers the toolkit now shows recorded (legacy answers, with no answer revision: by the toolkit's state, as before). */
  recorded: PmAnswer[];
  /** Sent answers with an answer revision, compared with what was sent (Slice 1B-2): located next, then settleJudged. */
  judged: { a: PmAnswer; q: Question }[];
}

/** How many sent revisions' expectations an answer keeps. */
const EXPECTED_KEPT = 5;

/** Keeps what revision `e.rev` asked to be recorded (replacing an earlier copy of the same revision). */
export function pushExpected(a: PmAnswer, e: QExpected) {
  a.expected = [...(a.expected ?? []).filter((x) => x.rev !== e.rev), e].slice(-EXPECTED_KEPT);
}

/** A new collection taken in: first-seen times, the batch, and sent answers the toolkit now shows ANSWERED, ASSUMED or MOOT. */
export function takeCollection(d: BookData, set: QuestionSet, mtimes: Record<string, number>, now: number): Taken {
  // A failed reading of the files says nothing about the answers: keep what was there.
  d.set = set;
  d.mtimes = mtimes;
  for (const q of set.questions) d.seen[q.key] ??= now;
  const known = new Set(d.known);
  const fresh = set.questions.filter((q) => openState(q.state) && !d.answers[q.key] && !known.has(q.key));
  if (fresh.length) {
    d.batch++;
    d.batchSince = now;
    for (const q of fresh) known.add(q.key);
    d.known = [...known];
  }
  const recorded: PmAnswer[] = [];
  const judged: { a: PmAnswer; q: Question }[] = [];
  for (const q of set.questions) {
    const a = d.answers[q.key];
    if (a?.status !== 'sent') continue;
    if (a.answerRev !== undefined && a.expected?.length) {
      // Never the resolved state alone: what's written is compared with what was sent.
      const j = judgeQuestion(q, a);
      a.recording = { outcome: j.outcome, ...(j.rev !== undefined ? { rev: j.rev } : {}), ...(j.text ? { text: j.text } : {}), at: now };
      judged.push({ a, q });
      continue;
    }
    // Legacy (no answer revision): the toolkit's state, as before.
    if (!isResolved(q.state)) continue;
    a.status = 'recorded';
    a.recordedAt = now;
    a.recordedState = q.state as QState;
    recorded.push(a);
  }
  return { fresh, recorded, judged };
}

/** The judged answers recorded faithfully (as given, at their current revision, merged into main) marked recorded. */
export function settleJudged(judged: readonly { a: PmAnswer; q: Question }[], now: number): PmAnswer[] {
  const out: PmAnswer[] = [];
  for (const { a, q } of judged) {
    if (a.status !== 'sent' || !faithful(a.recording, a.answerRev ?? -1)) continue;
    a.status = 'recorded';
    a.recordedAt = now;
    a.recordedState = q.state as QState;
    out.push(a);
  }
  return out;
}

/** When a question has waited since: the date it was raised, else the earlier of the office first seeing it and its file's time. */
export function sinceOf(d: BookData, q: Question): number | undefined {
  if (q.since !== undefined) return q.since;
  const seen = d.seen[q.key];
  const mtime = d.mtimes[q.key] || undefined;
  return seen !== undefined && mtime !== undefined ? Math.min(seen, mtime) : (seen ?? mtime);
}

export interface AnswerInput {
  kind: AnswerKind | 'clear';
  text?: string;
  option?: string;
  by: string;
  at: number;
  fromClient?: { by: string; at: number };
}

/** The person's answer to `q` set (or cleared): the error, or undefined when it's kept. */
export function setAnswer(d: BookData, q: Question, i: AnswerInput): string | undefined {
  const had = d.answers[q.key];
  if (i.kind === 'clear') {
    if (had?.status === 'sent' || had?.status === 'recorded') return 'That answer was already sent';
    delete d.answers[q.key];
    return undefined;
  }
  if (had?.status === 'sent') return 'That answer was already sent; it shows as recorded once the analyst records it';
  if (isResolved(q.state)) return `It's already ${q.state} in the BRD`;
  const t = i.text?.trim().slice(0, 4000) ?? '';
  if (i.kind === 'moot' && !t) return 'Say why it is not relevant';
  if (i.kind === 'answer' && !t && !i.option) return 'Write the answer first';
  if (i.kind === 'accept' && !q.proposedPosition) return 'There is no proposed position to accept';
  if (i.option && q.options && !q.options.includes(i.option)) return 'That is not one of its options';
  d.answers[q.key] = {
    key: q.key,
    id: q.id,
    file: q.file,
    kind: i.kind,
    ...(t ? { text: t } : {}),
    ...(i.option ? { option: i.option } : {}),
    by: i.by,
    at: i.at,
    ...(i.fromClient ? { fromClient: i.fromClient } : {}),
    status: 'pending',
  };
  return undefined;
}

/** The answers ready to send (Ask the client stays for the export). */
export const ready = (d: BookData) => Object.values(d.answers).filter((a) => a.status === 'pending' && a.kind !== 'ask-client');

/** Marks answers sent to `to`; each with an answer revision keeps what that revision asks to be recorded (Slice 1B-2). */
export function markSent(d: BookData, keys: readonly string[], to: string, at: number) {
  const qs = new Map((d.set?.questions ?? []).map((q) => [q.key, q]));
  for (const k of keys) {
    const a = d.answers[k];
    if (!a) continue;
    Object.assign(a, { status: 'sent', sentAt: at, sentTo: to });
    if (a.answerRev !== undefined && a.kind !== 'ask-client') pushExpected(a, expectedOf(a, qs.get(k), a.answerRev));
  }
}
