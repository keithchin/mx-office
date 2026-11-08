// Expert mode's readiness check for an existing toolkit project ("Open existing toolkit project"): what the
// office looked at in the folder before it is attached, one row per check, each ok / warn / error with one
// plain line, and the fix a person may click for it. Nothing here is required to attach; only demo users block
// a Deploy (at Lock in). The check itself never writes to the folder: only a fix does, and only what it says.
// Shapes both sides share (server/expert-ready/, client/ui/expert/ready.ts). Pure.

export type ReadyState = 'ok' | 'warn' | 'error';

export type ReadyId = 'toolkit' | 'mxcli' | 'mendix' | 'git' | 'teamserver' | 'demo' | 'tests' | 'budget' | 'lint';

/** The fixes, each one clicked by a person. `wish` ones only record what the session should be asked later. */
export type ReadyFixId = 'pin-toolkit' | 'add-teamserver' | 'seed-users' | 'add-tests' | 'set-budget';

export const WISH_FIXES: readonly ReadyFixId[] = ['seed-users', 'add-tests'];

export interface ReadyFix {
  id: ReadyFixId;
  label: string;
  /** What clicking it does, in one line (the button's title). */
  says: string;
  /** Why it can't be used now (no git, no Mendix account in Settings…). */
  off?: string;
}

export interface ReadyCheck {
  id: ReadyId;
  label: string;
  state: ReadyState;
  /** The one plain line. */
  line: string;
  /** A second, smaller line. */
  detail?: string;
  fix?: ReadyFix;
  /** A fix already done or a wish recorded for it, in words. */
  done?: string;
}

/** The app's size from its model, app modules only (Marketplace modules left out). */
export interface ReadyModelStats {
  modules: number;
  entities: number;
  microflows: number;
  pages: number;
}

export interface ReadyReport {
  /** The folder, as checked (resolved). */
  dir: string;
  /** The .mpr's file name, when there is one. */
  mpr?: string;
  stats?: ReadyModelStats;
  checks: ReadyCheck[];
  /** Rows that aren't ok. */
  toLookAt: number;
  /** What blocks a Deploy at Lock in (only demo users). */
  blocksDeploy: string[];
  /** The Expert project already attached to this folder, if any. */
  attached?: string;
  checkedAt: number;
  ms: number;
}

/** What a person asked for that only the session can do (a model change), kept for after attaching. */
export interface ReadyWishes {
  seedUsers?: { at: number; by: string };
  addTests?: { at: number; by: string };
  /** A budget to set when the folder is attached (before that there's no project to hold it). */
  budget?: { total: number; autoPause: true; at: number; by: string };
}

/** The prompt each wish puts in the session's composer later (the user edits and sends it; the office never does). */
export const WISH_PROMPTS: Record<'seed-users' | 'add-tests', string> = {
  'seed-users': 'Switch this app from demo users to seed users: turn demo users off and add a seed microflow that creates one user per role for local work. Keep the roles as they are.',
  'add-tests': 'Add microflow tests (tests/*.test.mdl) for the main business logic, starting with the microflows that change data. Each test must assert something.',
};

/** Order the rows are shown in. */
export const READY_ORDER: readonly ReadyId[] = ['toolkit', 'mxcli', 'mendix', 'git', 'teamserver', 'demo', 'tests', 'budget', 'lint'];

export const READY_LABELS: Record<ReadyId, string> = {
  toolkit: 'Toolkit',
  mxcli: 'mxcli',
  mendix: 'Mendix version',
  git: 'Git repository',
  teamserver: 'Team Server remote',
  demo: 'Demo users',
  tests: 'Tests',
  budget: 'Budget',
  lint: 'Lint baseline',
};

/** A budget amount from a request: dollars, more than 0, under ten million; undefined when it isn't one. */
export function budgetAmount(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : Number(v);
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : undefined;
}
