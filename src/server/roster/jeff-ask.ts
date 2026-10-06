// Jeff's "is it waiting on you?" kept honest: the model's say-so alone raised escalations for
// progress reports ("Still running: …", "I also told Keith …"). Before Jeff raises one himself, the
// end of the agent's message must actually ask the Project Manager something: a question, a request
// or approval put to them, or an AWAITING-PM line. And an ask the worker already raised (open, or just
// answered) isn't raised again. Pure, so the tests can feed it real last messages.

import type { JeffWaitingPolicy } from '../../shared/judge.js';

/** How much of the end of the message counts: its last paragraphs (a report's ask comes last). */
const TAIL_PARAGRAPHS = 3;

/** `AWAITING-PM: <what>` (the handoff note's line, see bench.ts), unless it says none. */
const AWAITING_PM = /^[\s>*_-]*AWAITING[- ]PM[*_]*\s*:[*_]*\s*(.*)$/gim;

/**
 * Phrases that put something to the Project Manager now. Checked per sentence; a sentence that is only
 * a condition or the future ("If you …, tell me", "Merging it will need your approval when …") isn't one.
 */
const REQUEST = new RegExp(
  [
    String.raw`\bplease\b`,
    String.raw`\b(could|can|would|will) you\b`,
    String.raw`\bdo you (want|prefer|agree)\b`,
    String.raw`\b(shall|should) I\b`,
    String.raw`\blet me know\b`,
    String.raw`\btell me (which|whether|what|how)\b`,
    String.raw`\bneeds? your (approval|decision|answer|sign-?off|go-ahead|ok|okay|confirmation|input|review|call)\b`,
    String.raw`\b(awaiting|waiting (on|for)) (you|your|the PM|the Project Manager)\b`,
    String.raw`\buntil you (answer|decide|approve|confirm|reply|say)\b`,
    String.raw`\bfor you to (decide|approve|merge|answer|confirm|review|set|sign)\b`,
    String.raw`\b(decision|question) for you\b`,
    String.raw`\bthe decision is yours\b`,
    String.raw`\bto unblock (this|me|it|us|them)\b`,
    String.raw`\basks? you to\b`,
    String.raw`\bI need you to\b`,
  ].join('|'),
  'i',
);
/** A sentence that only says what happens if or when something else does. */
const CONDITIONAL = /^\W*(if|when|once|after|as soon as|whenever)\b/i;
const FUTURE = /\b(will|would|'ll) (need|want|ask)\b/i;
/** Someone else's question reported, not one put to the Project Manager. */
const REPORTED = /\b(asked|asks|asking|wondered|told)\b/i;

/** The message with code, quotes and markdown emphasis out of the way: a `?` in them asks nothing. */
function plain(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, 'code')
    .replace(/"[^"\n]*"|“[^”\n]*”/g, 'quote')
    .replace(/[*_]{1,3}/g, '');
}

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.?!:])\s+(?=[A-Z0-9#(-])/)
    .map((s) => s.replace(/^[\s>#-]+|^\d+[.)]\s*/g, '').trim())
    .filter(Boolean);
}

/**
 * What in the end of an agent's last message actually asks the Project Manager something: a question
 * put to them, a request or approval, or an AWAITING-PM line. Undefined for a report, a plan or a
 * conditional ("if you meant something else, tell me"). Conservative on purpose: Jeff only raises an
 * escalation the office's own rule missed when this finds one.
 */
export function realAsk(text: string): string | undefined {
  for (const m of text.matchAll(AWAITING_PM)) {
    const what = m[1].replace(/[*_`]/g, '').trim();
    if (what && !/^none\b/i.test(what)) return `AWAITING-PM: ${what}`.slice(0, 160);
  }
  const paragraphs = plain(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const tail = paragraphs.slice(-TAIL_PARAGRAPHS).join('\n');
  for (const s of sentences(tail)) {
    if (/\?\W*$/.test(s) && !REPORTED.test(s)) return s.slice(0, 160);
    if (REQUEST.test(s) && !CONDITIONAL.test(s) && !FUTURE.test(s)) return s.slice(0, 160);
  }
  return undefined;
}

/** What Jeff does with a turn that ended: raise an escalation, or not, and why he held back when he says it's waiting. */
export interface WaitingCall {
  escalate: boolean;
  /** He says it's waiting and the rule doesn't, but he didn't raise it: no real ask in the message, or the worker already raised the same. */
  held?: 'no-ask' | 'duplicate';
}

/**
 * The rule already saying it's waiting means an escalation is open (or it's asking at its terminal):
 * nothing to raise. Otherwise, under 'agree' (the default) Jeff raises one only when he says it's
 * waiting and its message really asks something; under 'model' his say-so is enough (how he was).
 */
export function waitingCall(o: { policy: JeffWaitingPolicy; says: boolean; rule: boolean; ask: string | undefined; duplicate: boolean }): WaitingCall {
  if (!o.says || o.rule) return { escalate: false };
  if (o.policy === 'agree' && !o.ask) return { escalate: false, held: 'no-ask' };
  if (o.duplicate) return { escalate: false, held: 'duplicate' };
  return { escalate: true };
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'its', 'it’s', "it's", 'you', 'your', 'are', 'was', 'has', 'have', 'from', 'into', 'still', 'can', 'not', 'but', 'all', 'one', 'now']);

/** The words a title is about, lower case, without punctuation, markdown or filler. */
export function titleWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[*_`"“”'’]+(?=\s|$)|(?<=\s|^)[*_`"“”'’]+/g, '')
    .split(/[^a-z0-9#_./-]+/)
    .map((w) => w.replace(/^[./-]+|[./-]+$/g, ''))
    .filter((w) => w && !STOP.has(w) && (w.length >= 3 || w.startsWith('#') || /\d/.test(w)));
  return new Set(words);
}

/** Two escalation titles about the same thing: the same words, or nearly (three quarters of them shared). */
export function sameAsk(a: string, b: string): boolean {
  const x = titleWords(a);
  const y = titleWords(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared) >= 0.75;
}
