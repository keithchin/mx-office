// What a team's page on the 1D view (ui/teams/page.ts) reads from the floor's project, besides the board
// and the roster: GET /api/teams/page?floor=<id>&team=<team> (server/teams/page-data.ts). Read from the
// floor's main checkout, so it's what has landed, not what a Lead is still writing in its worktree.

import type { DeliverablesView } from '../deliverables.js';
import type { TeamId } from './roles.js';

export interface TeamJournalEntry {
  heading: string;
  /** YYYY-MM-DD from the heading. */
  date: string;
  /** The entry's Markdown, clipped. */
  body: string;
}

export interface TeamPageData {
  team: TeamId;
  /** Where the journal is (docs/team/<team>.md), and its newest entries, newest first. */
  journalPath: string;
  journal: TeamJournalEntry[];
  /** The analysis team's memos and requirements: docs/insights/*.md and BRD-ish docs, newest first. */
  insights: string[];
  /** The design team's artifacts: files under design/ or docs/design/. */
  design: string[];
  /** The newest standup page (docs/standups/<date>.md), for Management. */
  standup?: string;
  /** The team's 📦 deliverables (server/deliverables/): main, its worktrees and the office branches. */
  deliverables?: DeliverablesView;
}

/** How many journal entries the page shows, and how much of each. */
export const JOURNAL_SHOWN = 6;
export const JOURNAL_BODY_MAX = 1500;
