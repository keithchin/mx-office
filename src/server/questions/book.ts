// What the office keeps of a floor's questions (<data>/questions/<floor>.json, written atomically): the
// last collection (so the page shows something at once after a restart), the person's answers with their
// write-back status (pending → sent → recorded), when each question was first seen, and the batch count
// Needs you keys its one notification on. The transitions are here and pure, so the tests drive them.

import type { AnswerKind, PmAnswer, Question, QuestionSet, QState } from '../../shared/questions.js';
import { isResolved, openState } from '../../shared/questions.js';

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
  /** Answers the toolkit now shows recorded. */
  recorded: PmAnswer[];
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
  for (const q of set.questions) {
    const a = d.answers[q.key];
    if (a?.status !== 'sent' || !isResolved(q.state)) continue;
    a.status = 'recorded';
    a.recordedAt = now;
    a.recordedState = q.state as QState;
    recorded.push(a);
  }
  return { fresh, recorded };
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

/** Marks answers sent to `to`. */
export function markSent(d: BookData, keys: readonly string[], to: string, at: number) {
  for (const k of keys) {
    const a = d.answers[k];
    if (a) Object.assign(a, { status: 'sent', sentAt: at, sentTo: to });
  }
}
