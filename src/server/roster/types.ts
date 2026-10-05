// What the roster needs of a floor and of the office, and nothing more: a narrow seam so the tests
// can drive hiring, benching and standups with fake workers instead of real Claude sessions (which
// cost money). adapter.ts makes one from a real Floor.

import type { RosterAlert, WorkerInfo } from '../../shared/protocol.js';
import type { TeamId } from '../../shared/roster/roles.js';
import type { IssueMaker } from './issues.js';
import type { JudgeMade } from '../../shared/judge.js';
import type { AskOpts, Questions, Verdict } from '../judge/index.js';

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
  openPulls(): { number: number; title: string; url: string; headRefName: string; labels?: { name: string }[] }[];
  toast(text: string, level?: 'info' | 'warn'): void;
  /** Tells the floor's browsers to fetch the Team tab again; with `alert`, an urgent escalation to notify about. */
  changed(alert?: RosterAlert): void;
  /** A line in the project summary's recent activity (the review nudge, escalations). */
  activity?(text: string): void;
  /**
   * Adds a team's `team:<team>` label to an open pull request, on GitHub, as the office's gh account.
   * Only the real office has it: the tests' fake floors never touch GitHub.
   */
  labelPr?(number: number, team: TeamId): Promise<string | undefined>;
  /** The same for an issue (Jeff's triage, roster/jeff.ts). */
  labelIssue?(number: number, team: TeamId): Promise<string | undefined>;
  /** What an agent said last, once its turn ended: the Stop hook's message, else its transcript's end. */
  lastWords?(w: WorkerInfo): string | undefined;
  /** Tells the floor's browsers Jeff just judged something (his room in the 2D view reacts). */
  judged?(made: JudgeMade): void;
}

export interface RosterDeps {
  /** The office's data dir: the roster keeps roster/<floor>.json there. */
  dataDir: string;
  floors(): TeamFloor[];
  makeIssue: IssueMaker;
  /** A few lines of the analyzer's numbers for a floor, for the Chief Analyst's standup. */
  analysis(floorId: string): string;
  now(): number;
  /** Jeff's answers (server/judge/): undefined when he has none, and with no judge at all he's never asked. */
  judge?: (text: string, questions: Questions, opts?: AskOpts) => Promise<Verdict | undefined>;
}
