// Unfinished new-project setups (server/wizard/unfinished.ts, cancel.ts; ui/wizard/unfinished.ts,
// cancel.ts): a card for each on Home and at the top of the wizard's first page, with Retry (which says
// first what would stop it: a paused project, a safe restart, Studio Pro open), Cancel & undo, and Open
// project. Cancel & undo puts back what the setup did, in reverse, GitHub-style (type the repository's
// name): the project off the office through Delete project (server/project-delete/), then, when ticked,
// the local folder and the GitHub repository, but only what this setup recorded proof of making
// (shared/setup-provenance.ts; server/wizard/ownership.ts checks it again before deleting), then the
// setup's own record. Pure: the page, the server and the tests read the same rules.

import type { StepView } from './wizard.js';
import { readProvenance } from './setup-provenance.js';
import type { OperationNotice } from './setup-operations.js';

/** Why Retry would fail right now, said before it runs, with what to do about it. */
export interface SetupBlocker {
  kind: 'paused' | 'budget' | 'pause-run' | 'resume-run' | 'restart' | 'studio' | 'operation';
  text: string;
  /** The floor a Resume button wakes (an admin's, shown with a paused project). */
  resume?: string;
}

/** A setup that hasn't finished, as its card shows it. */
export interface UnfinishedSetup {
  id: string;
  /** owner/name. */
  repo: string;
  name: string;
  status: 'running' | 'failed' | 'idle' | 'cancelling';
  /** The step it stopped at (or is on), and why it stopped. */
  step?: string;
  error?: string;
  done: number;
  total: number;
  /** The floor it made, when it's still in the office. */
  floor?: string;
  by: string;
  updatedAt: number;
  blocker?: SetupBlocker;
  /** An operation whose outcome isn't settled, or waits to be adopted: the card offers Check again (and Use this existing …), never Retry. */
  operation?: OperationNotice;
  /** A Cancel & undo of it that stopped part way (Retry carries it on), or is running. */
  cancel?: CancelJobView;
}

export type CancelStepId = 'project' | 'folder' | 'repo' | 'record';

/** Cancel & undo's steps, in the order they run: the reverse of what the setup did. */
export const CANCEL_STEPS: readonly { id: CancelStepId; label: string }[] = [
  { id: 'project', label: 'Taking the project off the office (agents, worktrees, office data)' },
  { id: 'folder', label: 'Deleting the local folder' },
  { id: 'repo', label: 'Deleting the GitHub repository' },
  { id: 'record', label: 'Removing the setup' },
];

export type CancelStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface CancelJobView {
  id: string;
  repo: string;
  deleteFolder: boolean;
  deleteRepo: boolean;
  status: 'running' | 'failed' | 'done';
  steps: { id: CancelStepId; label: string; status: CancelStepStatus; detail?: string }[];
  error?: string;
  by: string;
  startedAt: number;
  finishedAt?: number;
}

/** What Cancel & undo would do, worked out before anything happens (GET /api/wizard/cancel-plan). */
export interface CancelPlan {
  id: string;
  repo: string;
  /** What has to be typed: the repository, owner/name, exactly. */
  confirm: string;
  /** The floor it made, while it's in the office. */
  floor?: string;
  dir: string;
  /** What the setup did, a line per step that ran. */
  did: string[];
  agents: number;
  worktrees: number;
  /** `proof`: how the office knows who made it (server/wizard/ownership.ts); only 'recorded' ever lets it be deleted. */
  folder: { exists: boolean; createdBySetup: boolean; deletable: boolean; why?: string; proof?: string };
  repoDelete: {
    /** This setup recorded creating it on GitHub (its provenance record, never its log line). */
    createdBySetup: boolean;
    proof?: string;
    /** Someone created it on GitHub by hand, or it was there already. */
    byHand: boolean;
    /** A test office's local bare repository: nothing on GitHub. */
    offline: boolean;
    possible: boolean;
    why?: string;
    settingsUrl?: string;
  };
  /** A local-only project's own bare repository (<projects home>/.local-git/<owner>/<name>.git), when this setup made it: it goes with the folder. */
  localBare?: { path: string; exists: boolean };
  /** The Mendix app: its .mpr goes with the folder and the repository; a Portal / Team Server app never does. */
  mendix: { mpr: boolean; portalUrl?: string };
  /** Something that stops it now, in words. */
  blocked?: string;
  unfinished?: CancelJobView;
}

/** POST /api/wizard/cancel. */
export interface CancelRequest {
  /** Typed by hand: exactly the plan's `confirm`. */
  confirm: string;
  deleteFolder: boolean;
  deleteRepo: boolean;
}

const stepOf = (steps: readonly Pick<StepView, 'id' | 'status' | 'detail'>[], id: StepView['id']) => steps.find((s) => s.id === id);

/**
 * What this setup made itself: the GitHub repository and the folder only when its provenance record says
 * it created them (the repo and clone steps write it as they make something). The steps' log lines
 * ("created owner/name on GitHub", "cloned into …") are only a hint (`legacyRepo`, `legacyFolder`, for a
 * setup saved before the record): they never make anything the setup's to delete. A test office's local
 * bare repository (`offline`) is nothing on GitHub.
 */
export function madeBySetup(
  steps: readonly Pick<StepView, 'id' | 'status' | 'detail'>[],
  provenance?: unknown,
): { repo: boolean; repoByHand: boolean; offline: boolean; folder: boolean; legacyRepo: boolean; legacyFolder: boolean } {
  const prov = readProvenance(provenance);
  const repo = stepOf(steps, 'repo');
  const clone = stepOf(steps, 'clone');
  // A local-only project's bare repository (wizard/local-only.ts) is nothing on GitHub either.
  const offline = /^(offline|local only, nothing on GitHub):/i.test(repo?.detail ?? '');
  const saysCreated = repo?.status === 'done' && /^created\s/i.test(repo.detail ?? '');
  const saysCloned = clone?.status === 'done' && /^(cloned into|offline floor at)\s/i.test(clone.detail ?? '');
  const made = !!prov?.repo?.createdBySetup;
  return {
    repo: made,
    repoByHand: !made && !offline && !saysCreated,
    offline,
    folder: !!prov?.folder?.createdBySetup,
    legacyRepo: saysCreated && !prov?.repo,
    legacyFolder: saysCloned && !prov?.folder,
  };
}

/**
 * The local bare repository a local-only project's repo step made (its detail "local only, nothing on GitHub: a local bare
 * repository at <path>"), only when that step created it (done, not "already there") and the path is a .git folder under a
 * .local-git folder: never anything else on the disk.
 */
export function localBareMade(steps: readonly Pick<StepView, 'id' | 'status' | 'detail'>[]): string | undefined {
  const repo = stepOf(steps, 'repo');
  if (repo?.status !== 'done') return undefined;
  const m = /^local only, nothing on GitHub: a local bare repository at (.+)$/i.exec(repo.detail ?? '');
  const at = m?.[1].trim();
  if (!at || !/\.git$/i.test(at)) return undefined;
  const segs = at.replace(/\\/g, '/').split('/');
  return segs.includes('.local-git') && segs.indexOf('.local-git') < segs.length - 2 ? at : undefined;
}

/** A request read from JSON: anything missing or odd is the safe choice (keep the folder, keep the repository). */
export function cleanCancelRequest(v: unknown): CancelRequest | string {
  if (!v || typeof v !== 'object') return 'Send JSON';
  const r = v as Record<string, unknown>;
  return { confirm: typeof r.confirm === 'string' ? r.confirm.slice(0, 300) : '', deleteFolder: r.deleteFolder === true, deleteRepo: r.deleteRepo === true };
}

/** The dialog's summary: exactly what will happen, a line each. */
export function cancelConsequences(p: CancelPlan, r: Pick<CancelRequest, 'deleteFolder' | 'deleteRepo'>): string[] {
  const lines: string[] = [];
  if (p.floor) {
    const first = `${p.agents ? `${p.agents} agent${p.agents === 1 ? '' : 's'} stopped and sent home; ` : ''}${p.worktrees ? `${p.worktrees} worktree${p.worktrees === 1 ? '' : 's'} removed; ` : ''}the project’s office data archived, then the project taken off the office (as Delete project does). The audit log is kept.`;
    lines.push(first.charAt(0).toUpperCase() + first.slice(1));
  }
  lines.push(r.deleteFolder ? `The local folder ${p.dir} deleted, for good${p.mendix.mpr ? ', with the Mendix app (.mpr) in it' : ''}.` : `The local folder ${p.dir} kept.`);
  if (p.localBare?.exists) lines.push(r.deleteFolder ? `The project’s local repository ${p.localBare.path} (its origin on this machine) deleted, for good.` : `The project’s local repository ${p.localBare.path} kept (it goes only with the folder).`);
  if (!p.repoDelete.offline) lines.push(r.deleteRepo ? `The GitHub repository ${p.repo} deleted, for good.` : `The GitHub repository ${p.repo} kept.`);
  lines.push('The setup itself removed: New project no longer lists it.');
  lines.push('A Mendix Portal / Team Server app is never deleted by the office: delete it in the Portal yourself if there is one.');
  return lines;
}

/** Exactly what was asked for: no trimming, no case folding (GitHub's rule). */
export const cancelConfirmed = (typed: unknown, target: string): boolean => typeof typed === 'string' && target.length > 0 && typed === target;
