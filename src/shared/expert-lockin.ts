// Expert mode's Lock in (server/expert-lockin/, docs/mockups/expert-mode slice 7): the person chooses the moment
// (a phase end, or before a deploy; never automatic, never per change). Step 1 runs the full checks at the session
// branch's head (a full mx check, all microflow tests, the journeys that are due, lint against the baseline), each
// recorded in the ledger at that exact commit. Step 2 offers what the results allow: merge session/main into main
// with a receipt, publish (a Free App: Studio Pro opens on the merged revision and the person presses Publish), or
// a deploy request for a licensed node (to approval, blocked while demo users are on). Pure: the page imports it.

/** The checks Lock in runs, in the panel's order. */
export type LockInCheckKind = 'mx-check' | 'microflow-tests' | 'journeys' | 'lint';
export const LOCKIN_KINDS: readonly LockInCheckKind[] = ['mx-check', 'microflow-tests', 'journeys', 'lint'];
export const KIND_NAMES: Record<LockInCheckKind, string> = { 'mx-check': 'mx check', 'microflow-tests': 'Microflow tests', journeys: 'Journeys', lint: 'Lint' };

/**
 * waiting/running: not done yet. passed. warn: fine for a merge, worth a look (no tests in the app, a new lint
 * warning). failed: it found problems. not-run: it couldn't run here (no mxcli, no runtime): it proves nothing,
 * so it holds a merge like a failure until the person accepts it by name.
 */
export type LockInStatus = 'waiting' | 'running' | 'passed' | 'warn' | 'failed' | 'not-run';

export interface LockInCheck {
  kind: LockInCheckKind;
  name: string;
  status: LockInStatus;
  /** One line: "0 errors", "33 of 34 passed". */
  summary: string;
  /** What it found or why it couldn't run. */
  detail?: string;
  /** The ledger record (tr_…) that holds it at the commit. */
  record?: string;
  /** A prompt for the session that would fix it (copied, never typed into the session). */
  prompt?: string;
}

/** One Lock in's checks, at exactly `commit`. */
export interface LockInRun {
  id: string;
  commit: string;
  by: string;
  startedAt: number;
  finishedAt?: number;
  checks: LockInCheck[];
  /** What was committed first (slice 2's commit path) so the checks saw everything. */
  committed?: { sha: string; files: number };
}

export type LockInPush = 'pending' | 'ok' | 'failed' | 'off';

/** How session/main carried on after the merge: from the new main, never rewritten. */
export type SessionAfter = 'fast-forward' | 'merged-main' | 'waiting' | 'left';

export interface LockInMerge {
  merge: string;
  /** The checked commit that was merged. */
  sha: string;
  into: string;
  by: string;
  at: number;
  /** Commits on session/main after the checked one: not part of this merge. */
  newer: number;
  /** Commits it brought into main. */
  commits: number;
  push: LockInPush;
  pushError?: string;
  session: SessionAfter;
  sessionNote?: string;
  /** Failed or not-run checks the person accepted by name. */
  accepted?: string[];
  /** The data impact the person confirmed. */
  impact?: string[];
}

/** What Lock in wrote to the decision log (each one counts in the proof strip's DECISIONS). */
export type LockInAction = 'checks' | 'override' | 'impact' | 'merge' | 'publish' | 'deploy-request' | 'phase-close';
export interface LockInDecision {
  at: number;
  by: string;
  action: LockInAction;
  text: string;
  commit?: string;
}

/** Free App (no deploy API: Studio Pro's Publish), licensed (Deploy, through approval), or not known. */
export type Licence = 'free' | 'licensed' | 'unknown';

export interface LockInPhase {
  id: string;
  name: string;
  order: number;
  of: number;
  rowsDone: number;
  rows: number;
  /** Every row done: "Close phase N" is offered after a merge. */
  complete: boolean;
}

export interface LockInView {
  floor: string;
  branch: string;
  /** session/main's head now. */
  head: string | null;
  main: string | null;
  /** Commits on session/main that main hasn't got. */
  ahead: number;
  /** Why Lock in can't start now (the session is working, git is busy), in words. */
  busy?: string;
  run?: LockInRun;
  running: boolean;
  /** The run's commit is no longer session/main's head (newer commits come in a later Lock in). */
  newer: number;
  /** Data impact between main and the checked commit (the existing detection). */
  impact?: { status: 'clear' | 'impact' | 'unknown' | 'none'; lines: string[] };
  merged?: LockInMerge;
  licence: Licence;
  /** Demo users in the app's model now: they block a deploy request, nothing else. */
  demoUsers: { on: boolean; count?: number; known: boolean };
  deploy: { allowed: boolean; why?: string; requested?: { id: string; at: number; merge: string } };
  phase?: LockInPhase;
  /** The phase Lock in closed after this merge. */
  closed?: { id: string; name: string };
  last?: { at: number; merge: string; commits: number };
  decisions: number;
}

/** The checks that hold a merge: failed or couldn't run. */
export const holding = (checks: readonly LockInCheck[]) => checks.filter((c) => c.status === 'failed' || c.status === 'not-run');
export const runDone = (r: LockInRun | undefined) => !!r && !!r.finishedAt;

/** Why a merge of the run isn't allowed with what the person said, or undefined. */
export function mergeRefusal(v: Pick<LockInView, 'run' | 'running' | 'impact' | 'merged'>, said: { commit?: string; accept?: readonly string[]; confirmImpact?: boolean }): string | undefined {
  const r = v.run;
  if (!r) return 'Run the checks first: Lock in merges only a commit it checked';
  if (v.running || !r.finishedAt) return 'The checks are still running: wait for them';
  if (said.commit && said.commit !== r.commit) return `The checks ran at ${r.commit.slice(0, 7)}, not ${said.commit.slice(0, 7)}: run them again`;
  if (v.merged && v.merged.sha === r.commit) return `${r.commit.slice(0, 7)} is merged already`;
  const held = holding(r.checks).map((c) => c.name);
  const accepted = new Set((said.accept ?? []).map((n) => n.toLowerCase()));
  const open = held.filter((n) => !accepted.has(n.toLowerCase()));
  if (open.length) return `Not merged: ${open.join(', ')} did not pass. Fix ${open.length === 1 ? 'it' : 'them'} in the session, or accept ${open.length === 1 ? 'it' : 'them'} by name to merge anyway`;
  if (v.impact?.status === 'impact' && !said.confirmImpact) return `Not merged: this change may affect stored data (${v.impact.lines.slice(0, 3).join('; ')}). Confirm the data impact to merge`;
  return undefined;
}

export const STATUS_WORDS: Record<LockInStatus, string> = { waiting: 'Waiting', running: 'Running', passed: 'Passed', warn: 'Look', failed: 'Failed', 'not-run': 'Not run' };

/** The plain steps after Studio Pro opens on the merged revision of a Free App. */
export const FREE_APP_STEPS: readonly string[] = ['Studio Pro opens on the merged main.', 'Press Run once to check it starts.', 'Then press Publish: Studio Pro puts it on your Free App sandbox.'];

/** What the deploy card says for each licence. */
export function publishWords(l: Licence): string {
  if (l === 'free') return 'Free App: the office opens Studio Pro on the merged revision and you press Publish. There is no deploy API for Free Apps.';
  if (l === 'licensed') return 'Licensed app: use Deploy. Request it here; the node owner approves.';
  return 'The office couldn’t read the app’s licence: Studio Pro opens on the merged revision; publish or deploy from there.';
}
