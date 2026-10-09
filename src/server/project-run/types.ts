// What ▶ Resume / ⏸ Pause project need of a floor and of the office: a narrow seam like the roster's
// (roster/types.ts), so the tests drive them with fake workers, a fake clock and an engine in a temp
// folder instead of Claude sessions. adapter.ts makes it from the real office.

import type { GhIssue, GhPull, WorkerInfo } from '../../shared/protocol.js';
import type { FlowEngine } from '../flow/engine.js';
import type { Roster } from '../roster/index.js';
import type { TeamFloor } from '../roster/types.js';
import type { Probe } from './safety.js';

export interface RunFloor {
  team: TeamFloor;
  /** The project's default branch (origin/<it> is what agents are compared with). */
  base?: string;
  /** The floor's pull requests as GitHub last listed them (open and merged). */
  pulls(): GhPull[];
  /** Its issues, open ones among them. */
  issues(): GhIssue[];
  /** Cut off mid-turn and not carried on (WorkerManager.cutOff). */
  cutOff(id: string): boolean;
  /** Puts an agent between turns to sleep, its session kept (WorkerManager.sleep). Why not, if not. */
  sleep(id: string): string | undefined;
  /** Studio Pro has the floor's project open (Studio mode): mxcli writes are paused. */
  studioOpen(): boolean;
  /** A few lines of the floor's chatter since `since` that involve `name`. */
  chatter(name: string, since: number): string[];
  /** The safety checks' look at an agent's folder (safety.ts probeAgent). */
  probe(w: WorkerInfo, mergedPr: boolean): Promise<Probe>;
  /** Commit subjects landed on the default branch since `since` (safety.ts mergesSince). */
  merges(w: WorkerInfo, since: number): Promise<string[]>;
}

export interface RunDeps {
  roster: Roster;
  engine: FlowEngine;
  floor(id: string): RunFloor | undefined;
  /** Why an agent between turns is still busy: its background helper (restart/helpers.ts), for the pause's progress. */
  helperNote?(floorId: string, workerId: string): string | undefined;
  now(): number;
  /** Waits (a test's fake clock moves on); rejects when `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** How often a waiting step looks again. */
  pollMs?: number;
  /** How long a wake may take to reach a live session. */
  bootMs?: number;
  /** A line in the floor's Team chatter, from the office. */
  chatter?(floorId: string, text: string): void;
  /** How many turns a worker has started, counted as its status changes (turns.ts): one that came and went between two looks still counts. */
  turnsStarted?(workerId: string): number;
}
