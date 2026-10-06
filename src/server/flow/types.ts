// The workflow engine's vocabulary (see engine.ts): a workflow is named steps joined by edges, run
// against one state object per run, checkpointed to a file after every step. Pure types and two tiny
// helpers, so a workflow's own module can name them without pulling the engine in.

/** Where an edge goes when the run is over. */
export const END = '__end__';

/**
 * A run's status. `running` is only ever in memory and in a file the office was writing when it
 * stopped: loading such a file reads it as `interrupted`. `waiting` is a step that asked for a value
 * (interrupt); `needs-attention` is a loop guard or budget that tripped; both carry on with resume.
 */
export type RunStatus = 'pending' | 'running' | 'waiting' | 'paused' | 'needs-attention' | 'interrupted' | 'failed' | 'done' | 'cancelled';

/** The statuses a run can carry on from (resume). */
export const RESUMABLE: readonly RunStatus[] = ['pending', 'waiting', 'paused', 'needs-attention', 'interrupted', 'failed'];

/** What a step can be asked to give up: its usage, which budgets are counted in. */
export interface Usage {
  /** Whatever unit the workflow's budget is in (dollars, tokens…): the engine only adds them up. */
  cost: number;
  /** Wall time spent in steps, which the engine counts itself. */
  ms: number;
}

const INTERRUPT = Symbol.for('agent-office.flow.interrupt');

/** A step's answer that stops the run until resume(runId, value) delivers a value to the same step. */
export interface Interrupt<P = unknown> {
  readonly [INTERRUPT]: true;
  readonly payload: P;
}

/** Stops the run at this step with `payload` (what it's waiting for), status `waiting`. */
export const interrupt = <P>(payload: P): Interrupt<P> => ({ [INTERRUPT]: true, payload });

export const isInterrupt = (v: unknown): v is Interrupt => !!v && typeof v === 'object' && (v as Record<symbol, unknown>)[INTERRUPT] === true;

/** Who and what a run is, as a step sees it. */
export interface RunMeta {
  runId: string;
  workflow: string;
  version: number;
  floor?: string;
  by?: string;
  createdAt: number;
}

export interface StepCtx<S> {
  /** The run's state. Return a partial update rather than changing it, except where a workflow says otherwise. */
  readonly state: S;
  readonly run: RunMeta;
  readonly step: string;
  /** 1 for the first try, counting up with each retry. */
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Aborted when the run is cancelled: long steps should stop when it is. */
  readonly signal: AbortSignal;
  /** The value resume(runId, value) delivered, when this step stopped the run with interrupt() last time. */
  readonly resume?: unknown;
  log(line: string): void;
  /** Adds to the run's usage, which `limits.budget` is checked against after the step. */
  report(usage: Partial<Usage>): void;
  /** Saves a checkpoint now, mid-step (a long step's progress); the state as it is. */
  save(): void;
}

export type StepUpdate<S> = Partial<S> | void | Interrupt;

export interface RetryPolicy {
  /** Tries in all, the first included (1: no retry, the default). */
  maxAttempts: number;
  /** The wait before the first retry; it doubles (`factor`) each time, up to `maxMs`. */
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  /** ± this fraction of each wait, at random, so retries don't march in step. */
  jitter?: number;
  /** Whether this error is worth another try (default: every error). */
  retryOn?: (err: Error, attempt: number) => boolean;
}

export interface CachePolicy<S> {
  /** The inputs that decide the result, as a string; undefined: don't cache this time. */
  key(state: S): string | undefined;
  ttlMs: number;
}

export interface StepDef<S> {
  id: string;
  label?: string;
  run(ctx: StepCtx<S>): Promise<StepUpdate<S>>;
  /** Already done (on a resume, a retry or a run again): the step is skipped, and the run moves on. */
  done?(state: S): boolean;
  retry?: RetryPolicy;
  /** Reuse an earlier result (the update it returned) for the same key within the TTL. */
  cache?: CachePolicy<S>;
}

/** Where to go after a step: a step id (or END), or a function of the state that picks one (a gate). */
export type Edge<S> = string | ((state: S) => string);

export interface Limits<S> {
  /** Steps run (and skipped) between one start or resume and the next stop: LangGraph's recursion_limit. Default 100. */
  maxSteps?: number;
  /** Times each edge, named `from->to`, may be taken in a run (a review loop's rounds). */
  loops?: Record<string, number>;
  /** Stops the run (needs-attention) once its usage passes these. */
  budget?: Partial<Usage>;
  /** A budget of your own: a reason to stop, or undefined. Checked after every step. */
  check?(usage: Usage, state: S): string | undefined;
}

export interface WorkflowDef<S> {
  id: string;
  /** Bump when the steps change meaning; saved with each run. */
  version: number;
  steps: StepDef<S>[];
  /** The first step (default: the first in `steps`). */
  start?: string;
  /** From each step, where to go; a step without one goes to the next in `steps`, the last to END. */
  edges?: Record<string, Edge<S>>;
  limits?: Limits<S>;
  /** How an update goes into the state (default: shallow assign, in place). L3's reducers go here. */
  merge?(state: S, update: Partial<S>): S;
  /** Where the run's log lines go (default: the office's console). */
  log?(state: S, line: string, runId: string): void;
  /** The floor a run is for, read at each checkpoint (for listing by floor). */
  floorOf?(state: S): string | undefined;
}

export type HistoryStatus = 'done' | 'skipped' | 'cached' | 'failed' | 'retrying' | 'interrupted' | 'cancelled';

/** One step taken, in a run's history. */
export interface HistoryEntry {
  /** The checkpoint's number in the run: L6 forks a run from one of these. */
  seq: number;
  step: string;
  status: HistoryStatus;
  attempt: number;
  startedAt: number;
  endedAt: number;
  next?: string;
  error?: string;
}

export interface PauseReason {
  kind: 'manual' | 'max-steps' | 'loop' | 'budget' | 'interrupt';
  message: string;
  /** The edge (`from->to`) a loop limit tripped on. */
  edge?: string;
}

/** A run as checkpointed: one JSON file, rewritten after every step. */
export interface RunRecord<S = unknown> {
  /** Format of this file. */
  format: 1;
  runId: string;
  workflow: string;
  version: number;
  status: RunStatus;
  /** The step to run (or that's running, or that failed or is waiting); undefined once the run is over. */
  step?: string;
  state: S;
  /** Tries of the current step so far. */
  attempts: Record<string, number>;
  /** Times each edge has been taken. */
  loops: Record<string, number>;
  usage: Usage;
  /** Why it stopped short: a limit, a pause, an interrupt. */
  reason?: PauseReason;
  error?: string;
  /** What the step that stopped with interrupt() is waiting for. */
  waiting?: { step: string; payload: unknown; at: number };
  /** A value for that step, set by resume until the step has had it. */
  resumeValue?: unknown;
  floor?: string;
  by?: string;
  seq: number;
  history: HistoryEntry[];
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

/** A run as listed (GET /api/flows): no state. */
export interface RunSummary {
  runId: string;
  workflow: string;
  version: number;
  status: RunStatus;
  step?: string;
  reason?: PauseReason;
  error?: string;
  floor?: string;
  by?: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

export interface FlowEvents {
  'run-started': { run: RunRecord; resumed: boolean };
  'step-started': { run: RunRecord; step: string; attempt: number };
  'step-finished': { run: RunRecord; step: string; status: 'done' | 'skipped' | 'cached'; next: string };
  'step-failed': { run: RunRecord; step: string; error: string; attempt: number; willRetry: boolean; delayMs?: number };
  /** Stopped short and will carry on with resume: paused, a limit, or waiting on an interrupt. This is L2's seam. */
  'run-paused': { run: RunRecord; reason: PauseReason };
  'run-finished': { run: RunRecord; status: 'done' | 'failed' | 'cancelled' };
}

export type FlowEventName = keyof FlowEvents;
