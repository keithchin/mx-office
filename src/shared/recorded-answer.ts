// The answer a record states, and whether it is the decision (Recorded as given, Slice 1B-2; the exact-answer
// rule of the reliability pass, docs/site/teams-and-agents/escalations.md).
//
// A citation (`Decided per ESC-<id> rev <n>`) only locates a record: it never establishes agreement. What is
// compared is a dedicated answer value: for an escalation the answer part of the citation's own line, the
// text after `Decided per ESC-<id> rev <n>:` to the end of that line (in a table row, to the end of its
// cell); for a BRD question its answer / decision field. Rationale and commentary go on the next line (or in
// another cell) and are never read as the answer. The answer value must equal one of the revision's
// expected values after this normalisation, and nothing else:
//   - Unicode NFC (composed accents; never NFKC, which would turn "²" into "2");
//   - curly single quotes ‘ ’ ‚ ‛ to ', curly double quotes “ ” „ ‟ and guillemets « » to ";
//   - Unicode dashes and the minus sign (U+2010-2015, U+2212, U+FE58, U+FE63, U+FF0D) to an ASCII "-";
//   - every run of whitespace to one space, trimmed;
//   - one pair of quotes or backticks around the whole value dropped ("Merge now" is Merge now);
//   - one sentence-final full stop dropped ("Use SSO." is Use SSO, "..." keeps its dots);
//   - letter case (Merge now, merge now, MERGE NOW are one answer).
// Case and a final full stop are folded because neither can add a negation, a condition, a sign, a number
// or a word: only the letters' capitals and the sentence's end change. Everything else stays meaning-bearing:
// "-5" is not "5", "Do not merge now" is not "Merge now", "If CI passes, merge now" is not "Merge now", and
// `"Merge now" was rejected` is not "Merge now". There is no list of negation words and no model judging:
// anything that isn't exactly the answer needs a person's review. Pure: the browser imports it too.

const SINGLE = /[‘’‚‛]/g;
const DOUBLE = /[“”„‟«»]/g;
const DASH = /[‐-―−﹘﹣－]/g;
const WRAP = /^(["'`])(.*)\1$/s;

const finalStop = (s: string) => s.replace(/([^.\s])\.$/, '$1');

/** An answer value as the comparison reads it (exactly the normalisation documented above). */
export function answerKey(s: string): string {
  let t = s.normalize('NFC').replace(SINGLE, "'").replace(DOUBLE, '"').replace(DASH, '-').replace(/\s+/g, ' ').trim();
  t = finalStop(t);
  const w = WRAP.exec(t);
  if (w && w[2].trim()) t = finalStop(w[2].trim());
  return t.toLowerCase();
}

/** Whether a recorded answer value is the expected one (an empty or missing value never is). */
export function sameAnswer(recorded: string | undefined, expected: string | undefined): boolean {
  if (recorded === undefined || expected === undefined) return false;
  const e = answerKey(expected);
  return !!e && answerKey(recorded) === e;
}

/** Text reduced to its letters and digits, lowercased: only for telling "needs review" from "recorded differently", and for names. */
export function normText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’‘`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whether the expected words occur somewhere in the text, as whole words (the matching rule before the
 * reliability pass). It NEVER establishes agreement: "Do not merge now" mentions "Merge now". It only says a
 * record that isn't exact needs a person's review rather than reading as plainly different.
 */
export function mentions(text: string, expected: string): boolean {
  const e = normText(expected);
  return !!e && ` ${normText(text)} `.includes(` ${e} `);
}

/** `Decided per ESC-<id> rev <n>` (any case, the id as the marker writes it). */
export const CITE_RE = /Decided per ESC-([A-Za-z0-9][A-Za-z0-9_-]*) rev (\d+)/gi;

/**
 * The answer part of a citation's line: what follows the citation and its colon, to the end of the line, to
 * the end of the table cell (a row's line starts with "|"; "\|" is a pipe in the answer), or to another
 * citation on the same line. Markdown that opened before the citation and closes at the end of the answer
 * (`**…**`, `` `…` ``) isn't part of it. Undefined when no colon follows the citation (a loose or legacy line).
 */
export function answerPart(line: string, start: number, end: number): string | undefined {
  const rest = line.slice(end);
  const sep = /^\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?/.exec(rest);
  if (!sep) return undefined;
  let a = rest.slice(sep[0].length);
  const next = a.search(/Decided per ESC-/i);
  if (next >= 0) a = a.slice(0, next);
  if (/^\s*\|/.test(line)) a = a.split(/(?<!\\)\|/)[0].replace(/\\\|/g, '|');
  a = a.trim();
  const before = line.slice(0, start).trimEnd();
  for (const w of ['**', '__', '`']) if (before.endsWith(w) && a.endsWith(w)) a = a.slice(0, -w.length).trim();
  return a;
}

/** The line an agent writes for revision `rev` of ESC-`escId`: the citation, a colon, the answer, nothing else. */
export const recordLine = (escId: string, rev: number | string, answer: string) => `Decided per ESC-${escId} rev ${rev}: ${answer.replace(/\s+/g, ' ').trim()}`;
