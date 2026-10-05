// What the Firm needs of the office, and nothing more: a narrow seam, so the tests drive whole
// engagements with fake floors, a fake runner and a fake checkout instead of real Claude sessions
// (Fable costs money). adapter.ts makes the real one from the office's Ctx.

import type { AppStats, WorkerGrade } from '../../shared/firm/report.js';
import type { PriceOf } from '../../shared/firm/engagement.js';
import type { RoleId } from '../../shared/roster/roles.js';
import type { ReviewerRunner } from './runner.js';
import type { PrepareOpts, ReviewerFolder } from './isolation.js';

/** Where a project team's role stands, for routing a question to it. */
export interface LeadState {
  role: RoleId;
  name: string;
  /** Hired and awake, hired and asleep, mid-question in its terminal, being benched, or not on the floor. */
  state: 'active' | 'asleep' | 'asking' | 'benching' | 'benched';
  workerId?: string;
}

export interface FirmFloor {
  id: string;
  name: string;
  dir: string;
  repo?: string;
  branch?: string;
  lead(role: RoleId): LeadState;
  /** Types a prompt into a worker's session (waking it with it when asleep); why not, when it can't. */
  deliver(workerId: string, text: string, asleep: boolean): string | undefined;
  /** Hires a benched role back with `task` as its first message (only when the engagement allows it). */
  rehire(role: RoleId, task: string): Promise<string | undefined>;
  /** What the office itself knows of the app: PRs, issues, CI, cost. */
  stats(): AppStats;
  /** The office's ranking of the floor's workers, as report rows for the Partner to start from. */
  grades(): WorkerGrade[];
  /** The evidence pack written into each reviewer's folder, by name (github, ranking, roster…). */
  evidence(): Promise<Record<string, unknown>>;
}

export interface FirmDeps {
  dataDir: string;
  now(): number;
  floor(id: string): FirmFloor | undefined;
  runner: ReviewerRunner;
  /** Makes a reviewer's isolated folder (isolation.ts; the tests fake the clone). */
  prepare(o: PrepareOpts): Promise<ReviewerFolder>;
  /** The project's commit the engagement pins. */
  pin(floor: FirmFloor): Promise<string>;
  /** The environment a reviewer starts from, before isolation strips it. */
  baseEnv(): Record<string, string>;
  /** The hook server's address, for office-workers firm, and where the office-workers command is. */
  hookUrl(): string;
  binDir?: string;
  priceOf: PriceOf;
  /** A toast on a floor (and the 1D views' banners refetch). */
  notify(floorId: string, text: string, level: 'info' | 'warn'): void;
  /** The Firm's state changed: browsers on /firm and the floor's banner fetch again. */
  changed(floorId: string): void;
  /** Spend for the office's ledger, so the Firm shows in the office's totals. */
  spend?(usd: number): void;
  /** The office audit log (server/audit, when it's there). */
  record?(entry: { floor?: string; kind: string; text: string; data?: unknown }): void;
}
