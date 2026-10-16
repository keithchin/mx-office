// The comparisons of Recorded as given (Slice 1B-2), pure, so the tests drive them with fixtures.
//
// A question: the merged question's recorded fields (the collector reads answer / resolution, decision /
// assumption, consentBy, consentAt and the status from the BRD) against what each sent revision asked to be
// recorded (PmAnswer.expected, from shared/questions.ts expectedOf, the values the message carried). The
// toolkit's resolved state alone never counts: the words are compared.
//
// An escalation: every `Decided per ESC-<id> rev <n>` line in the texts read (journals, PROJECT.md). The
// citation only locates the evidence and never establishes agreement: what is compared is the line's answer
// part (shared/recorded-answer.ts answerPart: after the citation's colon, to the end of the line or the
// table cell), exactly, with the revision's option or words (sameAnswer). The rest of the paragraph or row
// is kept as the recorded text, to show, and is never read as the answer.
//
// Both: exact is "recorded"; not exact but mentioning the expected words somewhere (a negation, a
// condition, a quotation, a paraphrase with commentary, a legacy line) is "needs-review"; anything else is
// "recorded differently". Neither of the last two settles anything.

import { escalationExpected, RECORDED_TEXT_MAX, type RecordedOutcome } from '../../shared/followthrough.js';
import { answerPart, CITE_RE, mentions, normText, sameAnswer } from '../../shared/recorded-answer.js';
import type { AnswerRevision } from '../../shared/dispatch.js';
import type { PmAnswer, QExpected, Question } from '../../shared/questions.js';
import { isResolved, openState } from '../../shared/questions.js';

export interface Judged {
  outcome: RecordedOutcome;
  rev?: number;
  text?: string;
  /** The answer value compared (an escalation citation's answer part). */
  answer?: string;
}

const cut = (s: string) => (s.length > RECORDED_TEXT_MAX ? `${s.slice(0, RECORDED_TEXT_MAX - 1)}…` : s);

/** Two consentAt values the same to the minute (2026-10-13T14:05Z and 2026-10-13T14:05:00Z are one). */
function sameMinute(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return !a && !b;
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return Math.floor(x / 60_000) === Math.floor(y / 60_000);
  return normText(a) === normText(b);
}

/** What the BRD says of a question, as one line ("ANSWERED: Monthly, by the 5th"). */
export function recordedOf(q: Question): string {
  if (q.state === 'ASSUMED') return cut(`ASSUMED: ${q.assumption ?? ''}${q.consentBy || q.consentAt ? ` (consent: ${[q.consentBy, q.consentAt].filter(Boolean).join(', ')})` : ''}`);
  if (q.state === 'MOOT') return cut(q.rawStatus || 'MOOT');
  return cut(`${q.state}: ${q.answer ?? q.assumption ?? ''}`);
}

/** What revision `rev` asks to be recorded when the person accepted the BRD's record as it is (Accept as recorded). */
export function expectedFromRecord(q: Question, rev: number): QExpected {
  return { rev, state: q.state, ...(q.answer || q.assumption ? { answer: q.answer ?? q.assumption } : {}), ...(q.assumption ? { decision: q.assumption } : {}), ...(q.consentBy ? { consentBy: q.consentBy } : {}), ...(q.consentAt ? { consentAt: q.consentAt } : {}), ...(q.state === 'MOOT' && q.rawStatus ? { reason: q.rawStatus } : {}) };
}

/** What a revision asked for, as one line ("ANSWERED: Monthly"; "ASSUMED: … (consent: Keith, 2026-10-13T14:05Z)"). */
export function expectedWords(e: QExpected | undefined): string {
  if (!e) return '';
  if (e.state === 'ASSUMED') return `ASSUMED: ${e.decision ?? ''} (consent: ${[e.consentBy, e.consentAt].filter(Boolean).join(', ')})`;
  if (e.state === 'MOOT') return `MOOT${e.reason ? ` - ${e.reason}` : ''}`;
  return `${e.state}: ${e.answer ?? ''}`;
}

/** Whether the question's record is exactly what `e` asked for: its answer / decision field is the answer value (MOOT's status is `MOOT - <reason>`). */
export function matchesExpected(q: Question, e: QExpected): boolean {
  if (q.state !== e.state) return false;
  if (e.state === 'ANSWERED') return sameAnswer(q.answer ?? q.assumption, e.answer);
  if (e.state === 'ASSUMED') return sameAnswer(q.assumption, e.decision) && normText(q.consentBy ?? '') === normText(e.consentBy ?? '') && sameMinute(q.consentAt, e.consentAt);
  if (e.state === 'MOOT') return !e.reason || sameAnswer(q.rawStatus, `MOOT - ${e.reason}`) || sameAnswer(q.rawStatus, e.reason);
  return false;
}

/** Whether the record mentions what `e` asked for without being it: needs a person's review, never recorded. */
function mentionsExpected(q: Question, e: QExpected): boolean {
  if (q.state !== e.state) return false;
  const want = e.state === 'ANSWERED' ? e.answer : e.state === 'ASSUMED' ? e.decision : e.reason;
  const got = e.state === 'MOOT' ? q.rawStatus : e.state === 'ASSUMED' ? q.assumption : (q.answer ?? q.assumption);
  return !!want && !!got && mentions(got, want);
}

/** A sent answer's record: as given for the current revision, an earlier revision's, different, or not yet. */
export function judgeQuestion(q: Question, a: Pick<PmAnswer, 'answerRev' | 'expected'>): Judged {
  const all = a.expected ?? [];
  const current = all.find((e) => e.rev === a.answerRev) ?? all[all.length - 1];
  if (openState(q.state) || !isResolved(q.state)) return { outcome: 'not-recorded-yet' };
  if (current && matchesExpected(q, current)) return { outcome: 'recorded', rev: current.rev, text: recordedOf(q) };
  const older = [...all].reverse().find((e) => e !== current && e.rev < (current?.rev ?? Infinity) && matchesExpected(q, e));
  if (older) return { outcome: 'recorded-older-rev', rev: older.rev, text: recordedOf(q) };
  return { outcome: current && mentionsExpected(q, current) ? 'needs-review' : 'recorded-differently', rev: current?.rev, text: recordedOf(q) };
}

// ---- Escalation citations --------------------------------------------------------------------------------

/** `Decided per ESC-<id> rev <n>` (shared/recorded-answer.ts). */
const CITE = CITE_RE;

export interface Citation {
  id: string;
  rev: number;
  /** The citation's line and the rest of its paragraph, or its table row, exactly as written (\n line ends). */
  block: string;
  /** The answer part of the citation's line (recorded-answer.ts answerPart); undefined when no colon follows the citation. */
  answer?: string;
  /** 1-based. */
  line: number;
}

const isBreak = (l: string) => !l.trim() || /^\s*#/.test(l) || /^\s*([-*+]|\d+[.)])\s/.test(l) || /^\s*\|/.test(l);

/** Every citation in a file's text, with its evidence block. */
export function citations(text: string): Citation[] {
  if (!/decided per esc-/i.test(text)) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: Citation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    CITE.lastIndex = 0;
    let m: RegExpExecArray | null;
    const found: { id: string; rev: number; answer?: string }[] = [];
    while ((m = CITE.exec(l))) {
      const answer = answerPart(l, m.index, m.index + m[0].length);
      found.push({ id: m[1], rev: Number(m[2]), ...(answer !== undefined ? { answer } : {}) });
    }
    if (!found.length) continue;
    let block = l;
    // A table row is its own record; a paragraph or a list item runs on to the next break.
    if (!/^\s*\|/.test(l)) for (let j = i + 1; j < lines.length && !isBreak(lines[j]); j++) block += `\n${lines[j]}`;
    for (const f of found) out.push({ ...f, block, line: i + 1 });
  }
  return out;
}

/** The recorded words of a block: the citation itself taken out. */
export const recordedWordsOf = (block: string) =>
  block
    .replace(/Decided per ESC-[A-Za-z0-9_-]+ rev \d+\s*[:.\-–—]?\s*/gi, '')
    // A list item's marker and a table row's pipes aren't words.
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * One citation of an escalation judged against its revisions: older than `current` (and not the revision an
 * accept-as-recorded took over) is "recorded for rev n"; the current one as given only when its answer part
 * is exactly the revision's option or words (an accept-as-recorded revision: also the very words the person
 * accepted, the whole record as it was shown to them); needs review when the record only mentions them;
 * else recorded differently. A citation of a revision that doesn't exist says nothing.
 */
export function judgeCitation(c: Pick<Citation, 'rev' | 'block' | 'answer'>, history: readonly Pick<AnswerRevision, 'rev' | 'kind' | 'text' | 'option' | 'supersedes' | 'basis'>[]): Judged | undefined {
  const current = history[history.length - 1];
  if (!current) return undefined;
  const text = cut(recordedWordsOf(c.block));
  // Accepting a record as it was written makes a new revision of the words that cite the one before.
  const covers = new Set([current.rev, ...(current.kind === 'accept-as-recorded' && current.supersedes ? [current.supersedes] : [])]);
  const answer = c.answer !== undefined ? { answer: cut(c.answer) } : {};
  if (!covers.has(c.rev)) {
    if (c.rev < current.rev && history.some((h) => h.rev === c.rev)) return { outcome: 'recorded-older-rev', rev: c.rev, text, ...answer };
    return undefined;
  }
  const expected = escalationExpected(current);
  const exact = expected.some((e) => sameAnswer(c.answer, e)) || (current.kind === 'accept-as-recorded' && sameAnswer(text, current.text));
  if (exact) return { outcome: 'recorded', rev: current.rev, text, ...answer };
  return { outcome: expected.some((e) => mentions(text, e)) ? 'needs-review' : 'recorded-differently', rev: current.rev, text, ...answer };
}
