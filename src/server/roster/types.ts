// What the roster needs of a floor and of the office, and nothing more: a narrow seam so the tests
// can drive hiring, benching and standups with fake workers instead of real Claude sessions (which
// cost money). adapter.ts makes one from a real Floor.

import type { WorkerInfo } from '../../shared/protocol.js';
import type { TeamId } from '../../shared/roster/roles.js';
import type { IssueMaker } from './issues.js';

export interface HireAsk {
  name: string;
  model: string;
  prompt: string;
  /** The account the worker runs as, when the person hiring has one. */
  owner?: string;
  by: string;
  /** The role's team: it sits at a free desk in that team's patch of the floor first (shared/zones.ts). */
  team?: TeamId;
}

export interface TeamFloor {
  id: string;
  name: string;
  /** The project's checkout. */
  dir: string;
  workers(): WorkerInfo[];
  worker(id: string): WorkerInfo | undefined;
  /** Hires a Claude Code worker with this name, model and first message; the worker, or why not. */
  hire(ask: HireAsk): Promise<WorkerInfo | string>;
  /** Sends a worker home: its worktree stays when it holds work that isn't on GitHub. */
  stop(id: string): Promise<void>;
  prompt(id: string, text: string): string | undefined;
  /** Wakes an asleep worker carrying on its session, with `prompt` as its next message. */
  wake(id: string, prompt?: string): string | undefined;
  rename(id: string, name: string): void;
  /** The folder a worker works in (its worktree, or the checkout). */
  cwdOf(w: WorkerInfo): string;
  openPulls(): { number: number; title: string; url: string; headRefName: string }[];
  toast(text: string, level?: 'info' | 'warn'): void;
  /** Tells the floor's browsers to fetch the Team tab again. */
  changed(): void;
}

export interface RosterDeps {
  /** The office's data dir: the roster keeps roster/<floor>.json there. */
  dataDir: string;
  floors(): TeamFloor[];
  makeIssue: IssueMaker;
  /** A few lines of the analyzer's numbers for a floor, for the Chief Analyst's standup. */
  analysis(floorId: string): string;
  now(): number;
}
