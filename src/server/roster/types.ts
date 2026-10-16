// What the roster needs of a floor and of the office, and nothing more: a narrow seam so the tests
// can drive hiring, benching and standups with fake workers instead of real Claude sessions (which
// cost money). adapter.ts makes one from a real Floor.

import type { RosterAlert, WorkerInfo } from '../../shared/protocol.js';
import type { RoleId, TeamId } from '../../shared/roster/roles.js';
import type { IssueMaker } from './issues.js';
import type { JudgeMade } from '../../shared/judge.js';
import type { PipelineStage } from '../../shared/roster/types.js';
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
  /** Types a prompt into a worker's session (`by`: who it's from, else the office). Go through roster/deliver.ts, which never types into a dialog. */
  prompt(id: string, text: string, by?: string): string | undefined;
  /** Wakes an asleep worker carrying on its session, with `prompt` as its next message. */
  wake(id: string, prompt?: string, by?: string): string | undefined;
  rename(id: string, name: string): void;
  /** The folder a worker works in (its worktree, or the checkout). */
  cwdOf(w: WorkerInfo): string;
  openPulls(): { number: number; title: string; url: string; headRefName: string; labels?: { name: string }[] }[];
  /** The floor's whole PR list as GitHub gave it (open, merged and closed unmerged), so a task can tell a merge from a closed PR. */
  pulls?(): { number: number; state: string; headRefName?: string; closes?: readonly number[]; mergedAt?: string; closedAt?: string; body?: string; headRefOid?: string; mergeCommit?: string }[];
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
  /** A worker's Claude Code transcript (its session's .jsonl), for the subagent runs no hook told of (subagent-live.ts). */
  transcript?(w: WorkerInfo): string | undefined;
  /** The text on a worker's terminal screen now (the office's mirror of it), for what sits in its input box. */
  screen?(id: string): string | undefined;
  /** Presses Enter once in a worker's terminal, as the office: why not, when it couldn't. */
  enter?(id: string): string | undefined;
  /** Tells the floor's browsers Jeff just judged something (his room in the 2D view reacts). */
  judged?(made: JudgeMade): void;
}

export interface RosterDeps {
  /** The office's data dir: the roster keeps roster/<floor>.json there. */
  dataDir: string;
  floors(): TeamFloor[];
  makeIssue: IssueMaker;
  /**
   * Searches the repository checked out at `dir` for the issue whose body has `marker` (a proposal's
   * office-proposal line): the issue, null when none was found (not conclusive: GitHub's index lags),
   * undefined when it couldn't search. Only the real office has it.
   */
  findIssue?: (dir: string, marker: string) => Promise<{ number: number; url?: string } | null | undefined>;
  /** A few lines of the analyzer's numbers for a floor, for the Chief Analyst's standup. */
  analysis(floorId: string): string;
  now(): number;
  /**
   * Where a toolkit project's pipeline stands (wizard/setup.ts): before its build plan's gate (Stage 4)
   * passed, or after; undefined when it has no pipeline. For autonomy by stage (stage-autonomy.ts).
   */
  pipelineStage?: (dir: string) => PipelineStage | undefined;
  /** Jeff's answers (server/judge/): undefined when he has none, and with no judge at all he's never asked. */
  judge?: (text: string, questions: Questions, opts?: AskOpts) => Promise<Verdict | undefined>;
  /** Whether Studio Pro has the floor's project open (Studio mode holds the agents' writes): no back-to-work nudge then. */
  studioOpen?: (floorId: string) => boolean;
  /**
   * A project in a portfolio with a company brain (server/portfolios/): the one line its hire's first message
   * gets, and how to record what the hire was offered (its context manifest) once it's hired. Undefined for
   * every other project, whose first message stays exactly as it was.
   */
  hireContext?: (floorId: string) => Promise<{ line: string; record(role: string, workerId: string, sessionId?: string): Promise<void> } | undefined>;
  /** Agent profiles (server/profiles/): office-wide identities for the seats. Without it the team works as before. */
  profiles?: ProfileHooks;
}

/** What the roster tells agent profiles, and asks of them (server/profiles/service.ts). */
export interface ProfileHooks {
  /** Before a hire: why it's refused (a move holds the seat), else the one line its first message may get. May rename a seat about to mint a profile. */
  beforeHire(floorId: string, role: RoleId): Promise<{ refuse?: string; line?: string }>;
  hired(floorId: string, role: RoleId, workerId: string): void;
  /** Why a rename is refused (another agent in the office has the name), else undefined. */
  renaming(floorId: string, role: RoleId, name: string): string | undefined;
  renamed(floorId: string, role: RoleId, name: string, by?: string): void;
  profileOf(floorId: string, role: RoleId): string | undefined;
  /** The roster saved the floor (cheap: returns at once with no move open). */
  touched(floorId: string): void;
}
