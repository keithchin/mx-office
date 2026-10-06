// The Leads' subagents at work, as the office sees them happen: each run from the moment its Lead's
// Agent (Task) call goes out until it comes back, or until its background run reports it's finished.
// Claude Code's hooks say so (PreToolUse / PostToolUse on the Agent tool, SubagentStart / SubagentStop),
// and the Lead's transcript says so too when the hooks didn't (roster/subagent-live.ts on the server).
// A floor keeps its last LIVE_KEPT runs in its roster file. Pure: the browser imports it too.

import type { RoleId } from './roles.js';
import type { RunOutcome } from './subagents.js';

/** Working now, finished, failed (its call errored or it reported failure), or lost (no word of it for LIVE_STALE_MS). */
export type LiveStatus = 'working' | 'done' | 'failed' | 'lost';

export interface LiveRun {
  /** Its Agent call's tool_use_id when known, else Claude Code's agent id, else one the office made. */
  id: string;
  lead: RoleId;
  /** The Lead's worker that sent it. */
  workerId: string;
  /** The subagent's type (its .claude/agents/<name>.md), general-purpose when the call named none. */
  name: string;
  task?: string;
  /** The model the call asked for, or the one Claude Code says it resolved. */
  model?: string;
  toolUseId?: string;
  /** Claude Code's agent id (SubagentStart/Stop, a background launch's result). */
  agentId?: string;
  /** Sent to run in the background: its call came back at once and the run carries on. */
  background?: boolean;
  status: LiveStatus;
  startedAt: number;
  /** When it was taken up again (a SendMessage to a finished background agent), for how long it's been at it. */
  resumedAt?: number;
  endedAt?: number;
  durationMs?: number;
  /** The last word of it, from either source. */
  seenAt: number;
  /** Where the office first heard of it. */
  source: 'hooks' | 'transcript';
}

/** A run as the Team tab and the Workers tab get it: with the Lead's review verdict, when its record has one. */
export interface LiveRunView extends LiveRun {
  outcome?: RunOutcome;
  note?: string;
  reviewedAt?: number;
}

/** Runs a floor keeps (the newest; working ones before finished ones). */
export const LIVE_KEPT = 50;
/** A run with no word of it for this long is lost (its Lead's session died mid-run, say). */
export const LIVE_STALE_MS = 6 * 3_600_000;

/** "tester (Hedy's)": a subagent's name tag in the 2D view. */
export const helperTag = (name: string, leadName: string) => `${name} (${leadName}'s)`;
