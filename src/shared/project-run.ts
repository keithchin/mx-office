// ▶ Resume project and ⏸ Pause project (server/project-run/): what the browser and the office say to
// each other about them. A resume is previewed first (who on the floor has work waiting, and why,
// and what's safe), then run as a workflow that wakes them a few at a time; a pause lets every agent
// finish its turn, write a handoff note and go to sleep, and holds the office's own prompts to the
// floor until it's resumed. Pure types and a few helpers, no Node.

import type { RoleId } from './roster/roles.js';

/** Why an agent has work waiting (the preview's reasons, in the order they're shown). */
export type WorkKind = 'owed' | 'held' | 'outbox' | 'cut-off' | 'failing-pr' | 'issue' | 'standup';

export interface WorkReason {
  kind: WorkKind;
  text: string;
}

/** What a safety check found about one agent. `block` ones stop it being woken as it is. */
export type CheckKind = 'missing-worktree' | 'merged' | 'behind' | 'dirty' | 'no-session';

export interface SafetyNote {
  kind: CheckKind;
  text: string;
}

/** What Resume project does with an agent: wake it, hire it again fresh from its handoff, send it home, or leave it be. */
export type ResumeAction = 'wake' | 'rehire' | 'send-home' | 'skip';

export interface AgentPreview {
  /** Its worker, when it has one (a benched member has none). */
  workerId?: string;
  role?: RoleId;
  name: string;
  /** "Project Coordinator", "Lead Developer", or "Worker". */
  title: string;
  /** How it is now. */
  state: 'asleep' | 'benched';
  reasons: WorkReason[];
  checks: SafetyNote[];
  /** What it'd do by default ("Resume those with work"). */
  action: ResumeAction;
  /** What else it may do (the preview's picker). */
  options: ResumeAction[];
  /** Its place in the order (0 first): Coordinator, then the most blocking Leads, then the rest. */
  order: number;
}

export interface ResumePreview {
  floor: string;
  floorName: string;
  /** Asleep or benched agents, in waking order. */
  agents: AgentPreview[];
  /** Agents already awake (working, idle, waiting on someone): left as they are. */
  awake: string[];
  /** Why nothing may be woken now (the floor's spend cap). */
  blocked?: string;
  warnings: string[];
  pause?: PauseInfo;
  pacing: Pacing;
}

/** How a resume wakes agents: at most `concurrent` starting at once, `gapSec` apart. */
export interface Pacing {
  concurrent: number;
  gapSec: number;
}

export const DEFAULT_PACING: Pacing = { concurrent: 2, gapSec: 45 };
export const PACING_BOUNDS = { concurrent: [1, 6], gapSec: [5, 600] } as const;

/** Pacing from what was saved or sent, held to its bounds; anything malformed is the default. */
export function cleanPacing(v: unknown, base: Pacing = DEFAULT_PACING): Pacing {
  const p = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof Pacing, unknown>>;
  const one = (x: unknown, [lo, hi]: readonly [number, number], d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
  return { concurrent: one(p.concurrent, PACING_BOUNDS.concurrent, base.concurrent), gapSec: one(p.gapSec, PACING_BOUNDS.gapSec, base.gapSec) };
}

/** Why a paused floor hires nobody: the queue, meetings, the roster and the Firm all say this. */
export const PAUSED_HIRES = 'Project paused: no new agents until it’s resumed';

/** Who paused a floor: a person, a safe restart, or its budget at 100 % (server/budget/). */
export type PauseWhy = 'person' | 'restart' | 'budget';

/** A floor paused with ⏸ Pause project: who and when, and whether a person, a safe restart or the budget did it. */
export interface PauseInfo {
  by: string;
  at: number;
  why: PauseWhy;
  /** Agents left with a question open in their terminal: they wait on a person. */
  waiting: string[];
}

/** One agent's line in a run's progress. */
export interface RunAgent {
  workerId?: string;
  role?: RoleId;
  name: string;
  action: ResumeAction | 'pause';
  status: 'pending' | 'starting' | 'woken' | 'finishing' | 'handoff' | 'asleep' | 'waiting-on-you' | 'skipped' | 'failed' | 'sent-home';
  note?: string;
}

export interface RunProgress {
  runId: string;
  kind: 'resume' | 'pause';
  floor: string;
  status: string;
  by?: string;
  agents: RunAgent[];
  startedAt: number;
  finishedAt?: number;
}

/** GET /api/project-run?floor=<id>: the floor's pause, its latest run, and its pacing. */
export interface ProjectRunView {
  floor: string;
  pause?: PauseInfo;
  run?: RunProgress;
  pacing: Pacing;
  admin: boolean;
}

/** What the person picked in the preview. */
export interface ResumeChoice {
  /** 'work': those with work (the default); 'all': everyone asleep; 'pick': `picks` only. */
  mode: 'work' | 'all' | 'pick';
  /** Per worker id (or `role:<id>` for a benched member): what to do with it. */
  picks?: Record<string, ResumeAction>;
}

/** The key a preview's agent is picked by. */
export const agentKey = (a: Pick<AgentPreview, 'workerId' | 'role'>) => a.workerId ?? `role:${a.role}`;

/** "Wakes 3 agents ≈ 3 turns": what a resume costs, roughly. */
export function estimateLine(n: number): string {
  if (!n) return 'Wakes nobody: nothing to do';
  return `Wakes ${n} agent${n === 1 ? '' : 's'} ≈ ${n} turn${n === 1 ? '' : 's'}`;
}

/** The agents a choice wakes (or re-hires, or sends home), with what each does. */
export function chosen(p: Pick<ResumePreview, 'agents'>, c: ResumeChoice): { agent: AgentPreview; action: ResumeAction }[] {
  return p.agents
    .map((agent) => {
      const picked = c.picks?.[agentKey(agent)];
      const action: ResumeAction =
        c.mode === 'pick' ? (picked && agent.options.includes(picked) ? picked : 'skip') : c.mode === 'all' ? (agent.action === 'skip' ? (agent.options.find((o) => o === 'wake' || o === 'rehire') ?? 'skip') : agent.action) : agent.action;
      return { agent, action };
    })
    .filter((x) => x.action !== 'skip');
}

/** "⏸ Paused by Keith at 14:05 · 2 waiting on you". */
export function pauseLine(p: PauseInfo, time: (at: number) => string): string {
  if (p.why === 'budget') return `⏸ Paused: budget reached at ${time(p.at)}${p.waiting.length ? ` · ${p.waiting.length} waiting on you` : ''}`;
  const who = p.why === 'restart' ? `for a safe restart (${p.by})` : `by ${p.by}`;
  return `⏸ Paused ${who} at ${time(p.at)}${p.waiting.length ? ` · ${p.waiting.length} waiting on you` : ''}`;
}

// ---- 🔁 Restart safely --------------------------------------------------------------------------

/** The exit code that tells a looping launcher to start the office again. */
export const RESTART_EXIT_CODE = 75;
/** The env a looping launcher sets, so the office knows exiting with RESTART_EXIT_CODE brings it back. */
export const LAUNCHER_ENV = 'AGENT_OFFICE_LAUNCHER_LOOP';
export const DEFAULT_RESTART_TIMEOUT_MIN = 10;

export type RestartPhase = 'idle' | 'pausing' | 'waiting' | 'timed-out' | 'building' | 'exiting' | 'failed' | 'cancelled';

export interface RestartView {
  phase: RestartPhase;
  /** Started by a looping launcher: exiting brings it back. Otherwise it only pauses, waits and exits. */
  loop: boolean;
  /** The office's own checkout has commits it isn't running yet: "Restart on the latest build" is offered. */
  newCommits: boolean;
  by?: string;
  startedAt?: number;
  /** Who it's still waiting on ("Anita mid-turn"). */
  waitingOn: string[];
  timeoutMin: number;
  build?: boolean;
  /** A build that failed: the end of its log. */
  log?: string;
  error?: string;
  admin: boolean;
}

/** The PowerShell launcher loop: run the office again while it exits asking to be restarted. */
export const LAUNCHER_SNIPPET = `$env:${LAUNCHER_ENV} = '1'
do {
  node bin/agent-office.js @args
  $code = $LASTEXITCODE
} while ($code -eq ${RESTART_EXIT_CODE})`;
