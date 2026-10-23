// Decision cards (docs/site/using-the-office/needs-you.md): every Needs-you item as a card that says what
// is asked, by whom, the options and the recommendation, the evidence, what it blocks and what happens
// after you answer. A projection, never a register of its own: each card is built afresh from what the
// office already keeps (escalations, the Questions page, stuck detection, surfaced asks, proposals, ✋
// sign-offs, PR checks), and sources fold into one card only on an explicit id (./ids.ts). The only thing
// kept is the person's "Separate" choices (server/decisions/). Pure: the page, the server and the tests
// import it.

import type { NeedItem, NeedTarget } from '../needsyou.js';
import type { DuplicateGroup } from './duplicates.js';
import type { DecisionArtifact } from './artifact.js';
import type { EscalationTrigger } from '../roster/autonomy.js';

/**
 * decision: only you can choose (options, Reply in my words, Ask the lead). hands-on: something only a
 * person can do (I've done it, Can't now, Ask). fyi: for your information (Noted, which approves nothing).
 * status: what the office noticed (a PR stale, checks failing, an agent finished): its own button.
 */
export type DecisionKind = 'decision' | 'hands-on' | 'fyi' | 'status';

export type SourceType = 'escalation' | 'question' | 'stuck' | 'ask' | 'approval' | 'signoff' | 'pr-check' | 'brain' | 'other';

/** One place a card's decision was found. */
export interface DecisionSource {
  /** Namespaced: esc:<id>, q:<file>#<id>, stuck:<id>, ask:<id>, appr:<id>, stage:<id>, pr:<n>, or the item's key. */
  id: string;
  type: SourceType;
  /** "AWAITING-PM in Ada's journal", "stuck detection", "Questions page". */
  label: string;
  /** Its own words, when they differ from the card's question. */
  text?: string;
  /** Said beside it: "couldn't re-read at 14:02", "filed as FYI", "recorded before decision cards". */
  note?: string;
  /** Where its own button goes (the compact row's). */
  target: NeedTarget;
  /** The escalation it is, for answering every escalation on the card at once. */
  escalation?: string;
  /** The escalation is FYI as its kind (Noted is its answer when the card is answered). */
  fyi?: boolean;
}

export interface DecisionEvidence {
  label: string;
  /** A file and line, a link, or a place ("Ada's worktree"). */
  where?: string;
  /** The revision it was read at, when known. */
  revision?: string;
}

export interface DecisionBlock {
  label: string;
  ref?: string;
}

export interface DecisionCard {
  /** The primary source's id (namespaced, see DecisionSource.id): stable while that source is open. */
  id: string;
  kind: DecisionKind;
  /** What is asked, in one line. */
  question: string;
  /** More of it, a paragraph at most. */
  detail?: string;
  /** An escalation's `Tried:` section (shared/roster/handadd.ts): what the agent tried before asking, shown first. */
  tried?: string[];
  options?: string[];
  recommendation?: string;
  why?: string;
  evidence: DecisionEvidence[];
  blocks: DecisionBlock[];
  /** Who asked, and who acts on the answer. */
  owner: string;
  /** Every source, the primary first. */
  sources: DecisionSource[];
  /** "After you answer: …" (./words.ts). */
  after: string;
  since?: number;
  level: 'block' | 'warn' | 'info';
  /** Small print: filed as FYI, recorded before decision cards, couldn't re-read the source. */
  notes: string[];
  /** Possibly related, never merged: a free-text test name another card mentions. */
  related: { label: string; card: string }[];
  /** The primary escalation, when the card is one (its buttons answer it). */
  escalation?: string;
  /** The primary question's key (its Answer opens the Questions page there). */
  questionKey?: string;
  /** The AWAITING-PM line it came from is gone: Resolved / Still needed. */
  gone?: { at: number; what: string; asked?: number };
  /** A question you answered, not recorded yet. */
  answered?: { status: 'pending' | 'sent'; to?: string };
  /**
   * A tool call Claude Code's permission layer denied (shared/roster/permission-denial.ts): a settings action,
   * Allow this command / Keep blocked, open until the command is seen to run.
   */
  permission?: { command: string; rule: string; suggested?: string; count: number; who: string; allowed?: { at: number; by: string; file: string } };
  /** The clean-up card's groups of likely duplicates (./duplicates-card.ts): Close duplicates / Review one by one. */
  duplicates?: DuplicateGroup[];
  /** What to look at to answer it, only when the decision names it explicitly (./artifact.ts): never guessed. */
  artifact?: DecisionArtifact;
  /** The primary escalation's trigger, when it has one (the App Workspace's business filter reads it). */
  trigger?: EscalationTrigger;
  /** The compact row (NeedItem) for the strip, the phone and Teams. */
  need: NeedItem;
}

/** A Separate the person chose: `sourceId` is not grouped into card `cardId` any more. */
export interface DecisionSplit {
  cardId: string;
  sourceId: string;
  by?: string;
  at?: number;
}

/** GET /api/decisions?floor=: the splits the cards are built with. */
export interface DecisionsView {
  floor: string;
  splits: DecisionSplit[];
  admin: boolean;
}
