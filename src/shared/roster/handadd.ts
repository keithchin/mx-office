// The Studio Pro hand-add gate (PackTrack, 2026-10-16): the Lead Developer escalated "Studio Pro hand-add
// needed: photo upload control" because mxcli can't place Studio Pro's built-in Image uploader, while the
// Marketplace's pluggable File Uploader widget did it, found in one search once the agent was told. So an
// agent's escalation that asks for a Studio Pro hand-add, or says mxcli can't do something, reaches the
// Project Manager only with a `Tried:` section listing the standard alternatives it tried, each with its
// exact error; without one the office hands it back to the agent through the escalate tool's reply
// (hooks/office-escalate.ts). Every pattern is here, in one place, with its tests (tests/handadd.test.ts).
// Pure: the browser imports triedItems for the card.

import type { EscalationAsk } from './escalation.js';

/** The office-wide workarounds list, as the office copies it into each project (server/roster/playbook-workarounds.ts). */
export const WORKAROUNDS_PATH = '.ai-context/office/mendix-workarounds.md';
/** The project's own entries, which its agents may add to; the office never overwrites it. */
export const WORKAROUNDS_LOCAL_PATH = '.ai-context/office/mendix-workarounds.local.md';

const APOS = "['’]?";
const SP = 'studio[- ]?pro';

/**
 * What reads as "a person must do this in Studio Pro" or "mxcli can't do it": a hand-add or hand-off in
 * Studio Pro, "Studio Pro needed / required / only", something done by hand or manually in Studio Pro,
 * mxcli (or MDL) can't / doesn't support it. Deliberately not "Studio Pro" alone: a version check, a
 * review in Studio Pro or an installed Studio Pro is not an ask for a hand-add.
 */
export const HANDADD_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'studio-pro-hand-add', re: new RegExp(`\\b${SP}[- ](?:hand[- ]?(?:add|off)|handoff|hand[- ]?edit)`, 'i') },
  { name: 'hand-add', re: /\bhand[- ]?add(?:s|ed|ing)?\b/i },
  { name: 'studio-pro-needed', re: new RegExp(`\\b${SP}\\b[ \\t]*(?:is |are )?(?:needed|required|only)\\b`, 'i') },
  { name: 'only-in-studio-pro', re: new RegExp(`\\bonly (?:in |via |with |through )?${SP}\\b`, 'i') },
  { name: 'needs-studio-pro', re: new RegExp(`\\b(?:needs?|requires?)[ \\t]+(?:a[ \\t]+)?${SP}(?:[ \\t]*(?:$|[.:;,)—–-])|[ \\t]+(?:hand|step|change|edit|fix|work)\\b)`, 'im') },
  { name: 'by-hand-in-studio-pro', re: new RegExp(`\\b(?:by hand|manually)\\b[^.\\n]{0,40}\\b${SP}\\b|\\b${SP}\\b[^.\\n]{0,40}\\b(?:by hand|manually)\\b`, 'i') },
  { name: 'mxcli-cant', re: new RegExp(`\\bmxcli[ \\t]+(?:can${APOS}t|cannot|can not|doesn${APOS}t|does not|won${APOS}t|is unable to|isn${APOS}t able to)[ \\t]+(?:yet[ \\t]+)?(?:support|do|place|create|add|generate|set|configure|handle|express|build)\\b`, 'i') },
  { name: 'not-supported-by-mxcli', re: new RegExp(`\\b(?:not|isn${APOS}t|is not|un)[ \\t-]?supported[ \\t]+(?:by|in)[ \\t]+(?:mxcli|MDL)\\b`, 'i') },
  { name: 'mdl-cant', re: new RegExp(`\\bMDL[ \\t-]?(?:can${APOS}t|cannot|can not|doesn${APOS}t|does not)\\b`, 'i') },
];

/** The patterns an escalation's title and details match (their names), so a test or the audit can say why. */
export function handAddMatches(title: string, details: string): string[] {
  const s = `${title}\n${details}`;
  return HANDADD_PATTERNS.filter((p) => p.re.test(s)).map((p) => p.name);
}

/** Whether it asks for a Studio Pro hand-add or says mxcli can't do something. */
export const asksHandAdd = (title: string, details: string) => handAddMatches(title, details).length > 0;

const TRIED_HEAD = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?Tried(?:\*\*|__)?[ \t]*:(?:\*\*|__)?[ \t]*(.*)$/i;
const ITEM = /^[ \t]*(?:[-*•+]|\d{1,2}[.)])[ \t]+(.+)$/;
const EMPTY = /^(?:none|nothing|n\/?a|-+|tbd|todo)\.?$/i;

/**
 * The items of a `Tried:` section in `details`: what follows `Tried:` on its line, and the list items
 * (`- …`, `1. …`) on the lines after it. Empty when there's no such line or it lists nothing ("Tried: none").
 */
export function triedItems(details: string): string[] {
  const lines = details.replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => TRIED_HEAD.test(l));
  if (at < 0) return [];
  const out: string[] = [];
  const first = TRIED_HEAD.exec(lines[at])![1].trim();
  if (first) out.push(first);
  for (const l of lines.slice(at + 1)) {
    const m = ITEM.exec(l);
    if (m) out.push(m[1].trim());
    else if (/^[ \t]{2,}\S/.test(l) && out.length) out[out.length - 1] += ` ${l.trim()}`;
    else if (l.trim() || out.length > (first ? 1 : 0)) break;
  }
  return out.filter((x) => x.length >= 3 && !EMPTY.test(x));
}

/** What the agent is told when its hand-add escalation comes back to it, unraised. */
export const HANDADD_RETURN =
  'Before this reaches the Project Manager: list what you tried — mxcli syntax, widget list/describe, a Marketplace search for a pluggable widget or module, --engine legacy, and the office\'s workarounds list — each with its exact error, in a `Tried:` section, then escalate again. ' +
  `The workarounds list is \`${WORKAROUNDS_PATH}\` (and the project's own \`${WORKAROUNDS_LOCAL_PATH}\`). Not raised, nothing is waiting on the Project Manager; carry on with whatever it doesn't block.`;

/**
 * Why an agent's ask goes back to it instead of the Project Manager: it asks for a Studio Pro hand-add
 * (or says mxcli can't do something) with no `Tried:` section. Undefined: raise it as usual. The matched
 * pattern names come with it, for the audit.
 */
export function handAddReturn(ask: Pick<EscalationAsk, 'title' | 'details'>): { matched: string[] } | undefined {
  const matched = handAddMatches(ask.title, ask.details);
  if (!matched.length || triedItems(ask.details).length) return undefined;
  return { matched };
}
