// Deleting a project, GitHub-style (server/project-delete/, ui/project-delete/): what the dialog is
// told before anything happens (the plan), what it asks the office to do (the request), and how far the
// job has got (the view). Pure: the page, the server and the tests read the same rules.

/** "Remove from office" keeps the folder and the repository; "Delete project" may take them too. */
export type DeleteMode = 'remove' | 'delete';

export type DeleteStepId = 'agents' | 'worktrees' | 'archive' | 'data' | 'folder' | 'repo' | 'floor';

/** The job's steps, in the order they run. */
export const DELETE_STEPS: readonly { id: DeleteStepId; label: string }[] = [
  { id: 'agents', label: 'Stopping the agents' },
  { id: 'worktrees', label: 'Removing the worktrees' },
  { id: 'archive', label: 'Archiving the office data' },
  { id: 'data', label: 'Removing the live office data' },
  { id: 'folder', label: 'Deleting the local folder' },
  { id: 'repo', label: 'Deleting the GitHub repository' },
  { id: 'floor', label: 'Taking the project off the office' },
];

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

/** One of the office's worktrees in the project, and what removing it would lose. */
export interface PlanWorktree {
  path: string;
  branch?: string;
  /** Uncommitted or untracked files; -1 when git couldn't tell. */
  dirty: number;
  /** Commits on its branch that are on no remote; -1 when git couldn't tell. */
  unpushed: number;
}

/** What deleting would do, worked out before anything happens (GET /api/projects/<floor>/delete-plan). */
export interface DeletePlan {
  floor: string;
  name: string;
  repo?: string;
  dir: string;
  /** What has to be typed to confirm: owner/name, else the floor's id. */
  confirm: string;
  agents: number;
  worktrees: PlanWorktree[];
  /** Where the office data is copied to before it's removed (<data>/deleted/<floor>-<timestamp>/, the timestamp decided when it runs). */
  archiveDir: string;
  /** Whether the local folder can be deleted, and why not when it can't. */
  folder: { deletable: boolean; why?: string };
  /** Whether the office's GitHub token can delete the repository. */
  repoDelete: { possible: boolean; why?: string; settingsUrl?: string };
  /** A Mendix app that the office never deletes: the Portal's address for it, when known. */
  mendix?: { portalUrl: string };
  /** Something that stops it now (a pause or a safe restart under way). */
  blocked?: string;
  /** A job for this project that stopped part way: running again carries it on. */
  unfinished?: DeleteJobView;
}

/** POST /api/projects/<floor>/delete. */
export interface DeleteRequest {
  mode: DeleteMode;
  deleteFolder?: boolean;
  deleteRepo?: boolean;
  /** Worktrees with uncommitted or unpushed work may go. */
  discardWork?: boolean;
  /** Typed by hand: must be exactly the plan's `confirm`. */
  confirm: string;
}

export interface DeleteJobView {
  floor: string;
  name: string;
  mode: DeleteMode;
  deleteFolder: boolean;
  deleteRepo: boolean;
  status: 'running' | 'failed' | 'done';
  steps: {
    id: DeleteStepId;
    label: string;
    status: StepStatus;
    detail?: string;
  }[];
  archiveDir?: string;
  error?: string;
  by: string;
  startedAt: number;
  finishedAt?: number;
}

/** What has to be typed to delete a project: its repository (owner/name), else its floor id. */
export const confirmTarget = (p: { floor: string; repo?: string }): string => p.repo || p.floor;

/** Exactly what was asked for: no trimming, no case folding (GitHub's rule). */
export const confirmMatches = (typed: unknown, target: string): boolean => typeof typed === 'string' && target.length > 0 && typed === target;

/** Worktrees that hold work removing them would lose (or that git couldn't read). */
export const worktreesWithWork = (w: readonly PlanWorktree[]): PlanWorktree[] => w.filter((t) => t.dirty !== 0 || t.unpushed !== 0);

/** A request read from JSON: anything missing or odd is the safe choice (keep the folder, keep the repo). */
export function cleanRequest(v: unknown): DeleteRequest | string {
  if (!v || typeof v !== 'object') return 'Send JSON';
  const r = v as Record<string, unknown>;
  if (r.mode !== 'remove' && r.mode !== 'delete') return 'mode: remove or delete';
  const strong = r.mode === 'delete';
  return {
    mode: r.mode,
    deleteFolder: strong && r.deleteFolder === true,
    deleteRepo: strong && r.deleteRepo === true,
    discardWork: r.discardWork === true,
    confirm: typeof r.confirm === 'string' ? r.confirm.slice(0, 300) : '',
  };
}

/** The dialog's red summary: exactly what will happen, a line each. */
export function consequences(p: DeletePlan, r: Pick<DeleteRequest, 'mode' | 'deleteFolder' | 'deleteRepo'>): string[] {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const withWork = worktreesWithWork(p.worktrees).length;
  const lines = [
    p.agents ? `${n(p.agents, 'agent')} stopped and sent home.` : 'No agents to stop.',
    p.worktrees.length ? `${n(p.worktrees.length, 'worktree')} removed${withWork ? `, ${withWork} of them with uncommitted or unpushed work` : ''}.` : 'No office worktrees to remove.',
    `The office data (team, chatter, budget ledger, acceptance, toolkit pin, incidents, the project’s .agent-office) archived to ${p.archiveDir}, then removed from the office. The audit log is kept.`,
    r.mode === 'delete' && r.deleteFolder ? `The local folder ${p.dir} deleted, for good.` : `The local folder ${p.dir} kept.`,
  ];
  if (p.repo) lines.push(r.mode === 'delete' && r.deleteRepo ? `The GitHub repository ${p.repo} deleted, for good.` : `The GitHub repository ${p.repo} kept.`);
  return lines;
}

/**
 * Whether a page that hears a project was deleted goes Home: it was on it when its floor closed
 * (`wasHere`), or it's still on it, or its address names it; never Home itself.
 */
export function goesHome(msg: { floor: string; wasHere?: boolean }, page: { path: string; floor: string | null; search: string }): boolean {
  if (page.path === '/home') return false;
  return !!msg.wasHere || page.floor === msg.floor || new URLSearchParams(page.search).get('floor') === msg.floor;
}
