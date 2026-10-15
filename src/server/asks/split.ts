// Splitting an AWAITING-PM line into its items (surface asks, S4; continuity, docs/site/using-the-office/
// needs-you.md). Only clear list separators split: a new line or a bulleted / numbered list under it, a
// semicolon, a " · ", a numbered "(1) … (2) …", and never inside brackets or backticks, so a comma or a
// semicolon in "(volumes, retention; or none)" stays where it is. Then each part is tidied so no item is
// a fragment:
//   - "all items are in open escalations (merge #98; GenAI key; …)" lists the items inside the brackets;
//   - a closing note in brackets after the last full stop ("… #91. (#98 is escalation …, separate.)") and
//     a trailing ", both already in open escalations" are the agent's commentary, not items;
//   - a short clause that only points back ("Ada has it", "it is with the PM") stays with the item before;
//   - "merge #98 and run the LF conversion (issue #91)": two asks naming one different id each, split;
//   - brackets left unbalanced are dropped, and a part under three characters is nothing.
// Pure.

import { explicitIds } from '../../shared/decisions/ids.js';

const SEP = '\u0001';

/** Splits at `SEP`, ";" and " · " outside brackets and backticks. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let tick = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '`') tick = !tick;
    else if (!tick && (ch === '(' || ch === '[')) depth++;
    else if (!tick && (ch === ')' || ch === ']') && depth > 0) depth--;
    const top = depth === 0 && !tick;
    if (top && (ch === SEP || ch === ';')) {
      out.push(cur);
      cur = '';
      continue;
    }
    if (top && s.startsWith(' · ', i)) {
      out.push(cur);
      cur = '';
      i += 2;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Whether brackets in `s` balance. */
function balanced(s: string): boolean {
  let d = 0;
  for (const ch of s) {
    if (ch === '(' || ch === '[') d++;
    else if (ch === ')' || ch === ']') if (--d < 0) return false;
  }
  return d === 0;
}

/** `s` with any bracket that has no partner taken out. */
function dropUnmatched(s: string): string {
  const open: number[] = [];
  const drop = new Set<number>();
  [...s].forEach((ch, i) => {
    if (ch === '(' || ch === '[') open.push(i);
    else if (ch === ')' || ch === ']') {
      if (open.length) open.pop();
      else drop.add(i);
    }
  });
  for (const i of open) drop.add(i);
  return [...s].filter((_, i) => !drop.has(i)).join('').replace(/\s{2,}/g, ' ');
}

/** A closing commentary clause: ", both already in open escalations", ", in escalation ad42308139". */
const COMMENT_TAIL = /,\s*(?:both|all|each|these|those|which|they|it)?\s*(?:are\s+|is\s+)?(?:already\s+|still\s+)?(?:in|raised\s+(?:as|in)|filed\s+(?:as|in)|tracked\s+in)\s+(?:an?\s+|the\s+)?(?:open\s+)?escalations?\b[^,;]*$/i;

/** A short clause that only points back at the item before it ("Ada has it", "it is with the PM"). */
const pointsBack = (p: string) => p.split(/\s+/).length <= 5 && /\b(?:it|this|that|these|those|both|them|same)\b/i.test(p) && !/[#]\d|\b[A-Z]{1,4}\d{0,2}-\d/.test(p);

/** "merge #98 and run X (issue #91)": two asks with one different explicit id each. */
function splitAnd(p: string): string[] {
  let depth = 0;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && p.startsWith(' and ', i)) {
      const a = p.slice(0, i).trim();
      const b = p.slice(i + 5).trim();
      const ia = explicitIds(a);
      const ib = explicitIds(b);
      const one = (x: typeof ia) => x.prs.length + x.ids.length + x.journeys.length === 1;
      const key = (x: typeof ia) => [...x.prs.map((n) => `#${n}`), ...x.ids, ...x.journeys][0];
      if (one(ia) && one(ib) && key(ia) !== key(ib) && a.split(/\s+/).length >= 2 && b.split(/\s+/).length >= 2) return [a, b];
    }
  }
  return [p];
}

const tidy = (p: string) => p.replace(/^\s*(?:and|also)\s+/i, '').replace(/[.;,\s]+$/, '').trim();

/** The items of one AWAITING-PM line's text (what follows "AWAITING-PM:"). */
export function splitAwaitingLine(raw: string): string[] {
  let line = raw.replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
  if (!line || /^(?:none|n\/?a)\b/i.test(line)) return [];
  // "All items are in open escalations (a; b; c)": the items are the ones in the brackets.
  const wrapped = /^(?:all|both|every|each)\b[^()]*\bescalations?\b[^()]*\((.*)\)\s*\.?$/i.exec(line);
  if (wrapped && balanced(wrapped[1])) line = wrapped[1];
  // A numbered list: "(1) a (2) b", or "1. a 2. b" from the start.
  line = line.replace(/(?:^|\s)\(\d{1,2}\)\s+/g, SEP);
  if (/^1[.)]\s/.test(line)) line = line.replace(/(?:^|\s)\d{1,2}[.)]\s+/g, SEP);
  // A note in brackets after the last item's full stop is commentary.
  line = line.replace(/\.\s*[([][^()[\]]*[)\]]\s*\.?$/, '');
  const parts: string[] = [];
  for (const piece of splitTop(line)) {
    let p = tidy(piece.replace(COMMENT_TAIL, ''));
    if (!p) continue;
    if (!balanced(p)) p = tidy(dropUnmatched(p));
    if (parts.length && pointsBack(p)) {
      parts[parts.length - 1] = `${parts[parts.length - 1]}; ${p}`;
      continue;
    }
    parts.push(...splitAnd(p).map(tidy));
  }
  return parts.filter((p) => p.length > 2 && /[\p{L}\p{N}]/u.test(p));
}

/** `AWAITING-PM: <what>` lines, with a bulleted or numbered list under an empty one. */
const LINE = /^[\s>*_-]*AWAITING[- ]PM[*_]*\s*:[*_]*\s*(.*)$/i;
const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+(.*)$/;

/** Every item an entry's AWAITING-PM lines name, each once (case aside). */
export function awaitingItemsOf(body: string): string[] {
  const out: string[] = [];
  const add = (xs: string[]) => {
    for (const x of xs) if (!out.some((o) => o.toLowerCase() === x.toLowerCase())) out.push(x);
  };
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]);
    if (!m) continue;
    const rest = m[1].replace(/`/g, '').trim();
    if (rest) {
      add(splitAwaitingLine(rest));
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const b = BULLET.exec(lines[j]);
      if (!b) break;
      add(splitAwaitingLine(b[1].replace(/`/g, '')));
    }
  }
  return out;
}
