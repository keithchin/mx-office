// Whether two AWAITING-PM items are the same ask in other words (continuity, docs/site/using-the-office/
// needs-you.md): only ever asked of two items from the same role's journal (server/asks/awaiting.ts) or
// two escalations the office filed from it (./duplicates.ts), never across roles or sources, because a
// merge on a guess is worse than two cards. The rule, conservative on purpose:
//   - Explicit ids (#98, PR 98, OW-1, OQ-07, J-08, ESC-4): when both name ids, they are the same item only
//     when they name exactly the same ids; different ids are different decisions whatever the words. An
//     escalation id the agent quotes ("in escalation a7ca4009c8") is a pointer, not what the ask is about:
//     it counts as neither an id nor a word.
//   - Otherwise the words, normalised (lower case, parentheticals, backticks and punctuation out, ids out,
//     stop words dropped): the same when they overlap highly (Jaccard >= 0.8), or when every word of the
//     shorter (two words at least) is in the longer, unless the shorter is only one side of an "and" or
//     "+" in the longer ("preview restart" is not "preview restart + Withdraw rebuild": that's a combined
//     ask). "GenAI key" is "GenAI Text Generation resource + key"; "row-62 proofs" is "OK for the row-62
//     failure proofs". Pure.

import { explicitIds } from './ids.js';

/** Words that say nothing about which ask it is. */
const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'on', 'in', 'at', 'and', 'or', 'ok', 'okay', 'please', 'yes', 'no', 'my', 'our', 'your', 'this', 'that', 'these', 'those', 'with', 'from', 'by', 'is', 'are', 'be', 'it', 'its', 'me', 'us', 'we', 'i', 'you', 'pm', 'still', 'also', 'any', 'some', 'via', 'as', 'when', 'if', 'then', 'so']);

/** Jaccard overlap two word sets need on their own. */
export const SAME_JACCARD = 0.8;

/** An escalation id the office printed (randomBytes(5) hex): ten hex characters with a digit and a letter. */
const ESC_HEX = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{10}\b/g;

/** Every explicit id an item names, as one sorted list ("#98", "OW-1", "J-08"). */
export function itemIds(text: string): string[] {
  const x = explicitIds(text);
  return [...new Set([...x.prs.map((n) => `#${n}`), ...x.ids, ...x.journeys])].sort();
}

/** Text with bracketed parts taken out (balanced, nested ones too). */
export function stripBrackets(s: string): string {
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_"“”‘’]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w));

/** The words an item is compared on: brackets, ids and stop words out. */
export function itemWords(text: string): string[] {
  let t = stripBrackets(text).replace(/https?:\/\/\S+/g, ' ').replace(ESC_HEX, ' ');
  t = t.replace(/(?:^|[^\w&/#])#\d{1,6}\b/g, ' ').replace(/\bPR\s+#?\d{1,6}\b/gi, ' ').replace(/(?<![\w-])[A-Z]{1,4}\d{0,2}-\d{1,3}(?![\w-])/g, ' ');
  return [...new Set(tokens(t))];
}

/** The longer text's sides around an "and", "&" or "+" (outside brackets), as word sets. */
const sides = (text: string) => stripBrackets(text).split(/\s+(?:and|&|\+)\s+|\s*\+\s*/i).map((p) => new Set(tokens(p))).filter((p) => p.size);

/** Whether two items from the same role's AWAITING-PM line are the same ask (the rule above). */
export function sameItem(a: string, b: string): boolean {
  const ia = itemIds(a);
  const ib = itemIds(b);
  if (ia.length && ib.length) return ia.join(' ') === ib.join(' ');
  const wa = itemWords(a);
  const wb = itemWords(b);
  if (!wa.length || !wb.length) return false;
  const A = new Set(wa);
  const B = new Set(wb);
  const inter = wa.filter((w) => B.has(w)).length;
  const jac = inter / new Set([...wa, ...wb]).size;
  if (jac >= SAME_JACCARD) return true;
  const [short, long, longText] = A.size <= B.size ? [A, B, b] : [B, A, a];
  if (short.size < 2 || ![...short].every((w) => long.has(w))) return false;
  // One side of a combined ask in the longer isn't the same ask.
  const parts = sides(longText);
  return !(parts.length > 1 && parts.some((p) => [...short].every((w) => p.has(w))));
}
