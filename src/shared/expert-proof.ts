// Expert mode's background proof (server/expert/, docs/mockups/expert-mode slice 2): what the session's proof strip
// shows, from GET /api/expert/proof?floor=<id>. Pure: the browser imports it too.
//
// The session works on `session/main`; the office commits what the session changed once it goes idle (never
// amending, never twice: a commit the toolkit or Studio Pro made itself is left alone), pushes the branch in the
// background without force, and reads the budget, stuck detection and the toolkit's decision log beside it.
// Slice 6 adds the background checks' TESTS and LINT cells (shared/expert-checks.ts).

import type { ProofLint, ProofTests } from './expert-checks.js';

/** The branch an Expert session works on; Lock in merges it into main. */
export const SESSION_BRANCH = 'session/main';

/** The commit's push: landed, waiting (or being retried), refused, or no remote to push to. */
export type ProofPush = 'ok' | 'pending' | 'failed' | 'off';

/** The newest commit on the session branch (whoever made it) and whether the remote has it. */
export interface ProofCommit {
  sha: string;
  /** Its subject line. */
  message: string;
  /** When it was committed (ms). */
  at: number;
  push: ProofPush;
  /** Why the push failed or is off, or why the session isn't on its branch. */
  error?: string;
}

export interface ProofBudget {
  /** The project's spend so far, USD. */
  spentUsd: number;
  /** Its total budget, USD; null when none is set. */
  totalUsd: number | null;
  todayUsd: number;
  /** Paused at 100 %: the session sleeps once its turn is over (never stopped mid-write). */
  paused: boolean;
}

export interface ProofStuck {
  stuck: boolean;
  /** Seconds since the session last went idle (0 while it works). */
  idleSec: number;
  /** The first stuck item, in words. */
  reason?: string;
}

/** GET /api/expert/proof: exactly these fields. */
export interface ExpertProof {
  /** The branch the project folder is on (SESSION_BRANCH once taken). */
  branch: string;
  commit: ProofCommit | null;
  budget: ProofBudget | null;
  stuck: ProofStuck | null;
  /** Rows in the toolkit's decision log (PROJECT.md ## Decisions). */
  decisions: number;
  /** The background checks' microflow tests and journeys (slice 6); null until a run started. Optional for older answers. */
  tests?: ProofTests | null;
  /** The background lint delta against the baseline (slice 6); null until a run started. */
  lint?: ProofLint | null;
}

/** Whether a project record is an Expert project: its `mode` says so; no mode is a Team project. */
export const isExpertMode = (rec: { mode?: unknown } | undefined | null): boolean => rec?.mode === 'expert';

/** The strip's push words. */
export function pushWords(c: ProofCommit | null): string {
  if (!c) return 'No commits yet';
  switch (c.push) {
    case 'ok':
      return 'Pushed';
    case 'pending':
      return 'Push pending';
    case 'failed':
      return `Push failed${c.error ? `: ${c.error}` : ''}`;
    case 'off':
      return c.error ?? 'Not pushed: no remote';
  }
}
