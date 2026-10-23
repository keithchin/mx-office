// The App Workspace's words and stage (C3 of the App Workspace proposal, sections 5.2 and 5.3): plain
// business language, never the engineering process's. Pure, so the page and the tests share it.
//
// - BANNED_TERMS: what the App Workspace's own text never says (tests/app-workspace-words.test.ts scans
//   every string the workspace draws). Text the team wrote (a decision's question, a change's title) is
//   shown as written.
// - plainMissing: the business status's "what's missing" lines (shared/business-status.ts, worded for the
//   Engineering view) said in business words. Wording only: the status itself is the shared function's.
// - workspaceStage: which of the proposal's stages the project is at, read from the business status and
//   the progress bar's current phase (what the office already derives), never stored.

import type { BusinessState } from '../business-status.js';

/** Engineering words the App Workspace's own text never uses (a whole word, any case, unless marked exact). */
export const BANNED_TERMS: readonly { term: string; exact?: boolean }[] = [
  { term: 'agent' },
  { term: 'agents' },
  { term: 'subagent' },
  { term: 'PR', exact: true },
  { term: 'PRs', exact: true },
  { term: 'pull request' },
  { term: 'commit' },
  { term: 'commits' },
  { term: 'merge' },
  { term: 'merged' },
  { term: 'merges' },
  { term: 'branch' },
  { term: 'branches' },
  { term: 'CI', exact: true },
  { term: 'worktree' },
  { term: 'floor' },
  { term: 'floors' },
  { term: 'repository' },
  { term: 'repo' },
  { term: 'git' },
  { term: 'GitHub' },
  { term: 'SHA', exact: true },
  { term: 'lint' },
  { term: 'model' },
  { term: 'terminal' },
  { term: 'mxcli' },
  { term: 'escalation' },
  { term: 'BUILD row' },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = BANNED_TERMS.map((b) => ({ term: b.term, re: new RegExp(`(^|[^A-Za-z0-9_])${escape(b.term).replace(/ /g, '\\s+')}(?=$|[^A-Za-z0-9_])`, b.exact ? '' : 'i') }));

/** The banned terms `text` uses (empty: none). */
export function bannedIn(text: string): string[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.term);
}

/** One missing line in business words. */
function plainLine(line: string): string {
  if (/live app (hasn't run|isn't running)/i.test(line)) return 'The app isn’t running yet';
  if (/main's head couldn't be read/i.test(line)) return 'The office couldn’t read where the work is';
  if (/journey/i.test(line)) return 'No guided check has run on this version yet';
  if (/security baseline/i.test(line)) return 'The security checks haven’t passed on this version yet';
  if (/required checks?/i.test(line)) return 'Some required checks have no result on this version yet';
  if (/unreviewed|review that counts|review state/i.test(line)) return 'Some finished work still needs a second look by the team';
  if (/BUILD rows?|merged to main|branch|PR #|not built|in the running build yet|of the plan/i.test(line)) return 'Some agreed work isn’t in the running app yet';
  if (/open tasks?/i.test(line)) return 'The team has work in progress';
  if (/no deployment recorded/i.test(line)) return 'No deployment recorded yet';
  if (/not accepted|accept the next version/i.test(line)) return 'This version isn’t accepted yet';
  if (/release review|approver/i.test(line)) return 'Waiting for the release review';
  if (/no milestone/i.test(line)) return 'This part of the plan isn’t known yet';
  return bannedIn(line).length ? 'More detail is on the Engineering view' : line;
}

/** The business status's missing lines in business words, each once, in their order. */
export function plainMissing(lines: readonly string[]): string[] {
  return [...new Set(lines.map(plainLine))];
}

// ---- The stage ----------------------------------------------------------------------------------------

export type WorkspaceStage = 'before' | 'building' | 'validation' | 'accepted' | 'awaiting' | 'released';

export interface StageDef {
  id: WorkspaceStage;
  label: string;
  /** What the canvas shows at this stage. */
  canvas: string;
  /** What the side panel puts first. */
  panel: string;
  /** The stage's primary action, in words. */
  primary: string;
  /** Only with an approval policy on. */
  policy?: boolean;
}

/** The stages in their order (proposal section 5.2). Awaiting approval only exists under an approval policy. */
export const STAGES: readonly StageDef[] = [
  { id: 'before', label: 'Before the build', canvas: 'The problem statement, then the brief', panel: 'The brief and its open questions', primary: 'Approve the scope' },
  { id: 'building', label: 'Building', canvas: 'The running app at the latest finished version', panel: 'The changes you asked for and their state', primary: 'Request a change' },
  { id: 'validation', label: 'Business validation', canvas: 'The app and the scenarios to try on this version', panel: 'Findings and what has been checked', primary: 'Accept, or request a correction' },
  { id: 'accepted', label: 'Accepted', canvas: 'A summary of the accepted version', panel: 'The evidence for that version', primary: 'Record the deployment' },
  { id: 'awaiting', label: 'Awaiting approval', canvas: 'The submitted version and its review', panel: 'Findings and what must be checked again', primary: 'Respond to feedback', policy: true },
  { id: 'released', label: 'Released', canvas: 'The released version', panel: 'What is live, and since when', primary: 'Start a new change' },
];

export const stageDef = (id: WorkspaceStage): StageDef => STAGES.find((s) => s.id === id)!;

/** The toolkit's stages before the build (Kickoff to Build Plan). */
const BEFORE_BUILD = new Set(['P', '0', '1', '2', '3', '4']);

export interface StageInput {
  /** The project's business status (shared/business-status.ts), once known. */
  business?: BusinessState;
  /** A toolkit project (the progress bar's phases are its stages). */
  toolkit?: boolean;
  /** The progress bar's current phase id (a stage id P, 0–7, or delivery/handover/accepted). */
  phase?: string;
}

/** Where the project is, from what the office already derives (never stored). */
export function workspaceStage(i: StageInput): WorkspaceStage {
  switch (i.business) {
    case 'deployed-recorded':
      return 'released';
    case 'submitted':
    case 'changes-requested':
      return 'awaiting';
    case 'accepted':
    case 'release-approved':
      return 'accepted';
    case 'ready-for-review':
    case 'verification-incomplete':
    case 'verification-passed':
      return 'validation';
  }
  if (i.toolkit && i.phase && BEFORE_BUILD.has(i.phase)) return 'before';
  return 'building';
}

/** The stages the stage switch lists: Awaiting approval only when the project is there (the policy is on). */
export const shownStages = (current: WorkspaceStage): StageDef[] => STAGES.filter((s) => !s.policy || s.id === current);
