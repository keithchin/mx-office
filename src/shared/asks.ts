// What the office surfaces for the Project Manager from where the team's words are (server/asks/): work
// that never reached main, assumptions made without their consent, the toolkit's gate advisories that only
// ever went to an agent's stderr, what is ready for their review, and what skipped the review gate
// (server/review-gate/). Each becomes a Needs-you row with its buttons; the AWAITING-PM items become
// escalations instead (they're answered like any other).
// Pure: the browser imports it too.

import type { NeedItem } from './needsyou.js';

export type AskKind = 'offmain' | 'assumption' | 'advisory' | 'review' | 'gate' | 'claims';

/**
 * A button on an item. docs-pr: ask whoever covers Management to open a docs PR; agree: record your
 * consent to the assumptions listed; discuss: ask for an escalation with options; ask-lead: ask the lead
 * to deal with the advisory; documents: open the Documents page; seen: hide it until it changes.
 */
export type AskAct = 'docs-pr' | 'agree' | 'discuss' | 'ask-lead' | 'documents' | 'seen';
export const ASK_ACTS: readonly AskAct[] = ['docs-pr', 'agree', 'discuss', 'ask-lead', 'documents', 'seen'];
export const isAskAct = (v: unknown): v is AskAct => typeof v === 'string' && (ASK_ACTS as readonly string[]).includes(v);

export interface AskItem {
  /** Stable while the condition is the same; a new set of artifacts or assumptions is a new id. */
  id: string;
  kind: AskKind;
  text: string;
  level: 'warn' | 'info';
  since?: number;
  /** What it lists, one line each (per agent, each assumption). */
  lines?: string[];
  /** What backs it, a line each with its link (the claims check: the commit, branch, PR and result file), for its decision card. */
  evidence?: { label: string; where?: string; revision?: string }[];
  /** Its buttons, the first one the row's. */
  acts: { act: AskAct; label: string }[];
}

/** The newest standup page on the lead's branch, when it's newer than main's. */
export interface BranchStandup {
  who: string;
  branch: string;
  file: string;
  date: string;
  /** Its "Blocked on you" lines. */
  blocked: string[];
}

export interface AsksView {
  floor: string;
  items: AskItem[];
  standup?: BranchStandup;
  /** When the office last looked (ms). */
  at?: number;
  /** When a look last failed to read the team's files: the items are kept from the look before. */
  unreadAt?: number;
  admin?: boolean;
}

/** What Needs you reads of it. */
export interface AsksNeed {
  floor: string;
  items: readonly AskItem[];
  /** The last look could not re-read the team's files: the items are as they were then (nothing settles on a failed read). */
  unreadAt?: number;
}

export const ASK_ICON: Record<AskKind, string> = { offmain: '📤', assumption: '🤝', advisory: '⚠️', review: '👀', gate: '🚦', claims: '🚦' };
const ASK_TAG: Record<AskKind, string> = { offmain: 'Not on main', assumption: 'Consent', advisory: 'Advisory', review: 'Review', gate: 'Review gate', claims: 'Claims check' };

/** The label "from Ada's branch, not on main yet" a standup line read off a branch carries. */
export const branchLabel = (who: string) => `from ${who}'s branch, not on main yet`;

/** The items as Needs-you rows: warn ones (consent, advisories) before info ones, each with its first button and a second. */
export function askNeeds(a: AsksNeed | undefined, floor: string | undefined): NeedItem[] {
  if (!a || a.floor !== floor) return [];
  const rows = [...a.items].sort((x, y) => (x.level === y.level ? 0 : x.level === 'warn' ? -1 : 1));
  return rows.map((it) => {
    const [first, second] = it.acts;
    return {
      key: `asks-${it.id}`,
      kind: it.kind,
      icon: ASK_ICON[it.kind],
      tag: ASK_TAG[it.kind],
      text: it.text,
      ...(it.since ? { since: it.since } : {}),
      level: it.level,
      action: first?.label ?? 'View',
      target: { to: 'ask', id: it.id, act: first?.act ?? 'seen' },
      ...(second ? { alt: { action: second.label, target: { to: 'ask', id: it.id, act: second.act } } } : {}),
    } satisfies NeedItem;
  });
}
