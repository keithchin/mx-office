// The workflow engine: runs a workflow's steps along its edges against one state per run, and
// checkpoints the run to its file after every step, so it can carry on from there after a failure, a
// pause, a question (interrupt) or an office restart. Steps can retry with backoff, reuse a cached
// result, and be skipped when their own check says they're done; loop guards and budgets stop a run
// that's going round in circles or spending too much, for someone to look at (needs-attention).
//
// LangGraph's ideas, natively: nodes, conditional edges, a checkpointer, recursion_limit, interrupt.

import { EventEmitter } from 'node:events';
import { checkWorkflow, edgeName, firstStep, nextStep, stepOf } from './graph.js';
import { backoffMs, sleep as realSleep } from './retry.js';
import type { CheckpointStore } from './store.js';
import {
  END,
  isInterrupt,
  RESUMABLE,
  type FlowEventName,
  type FlowEvents,
  type HistoryEntry,
  type HistoryStatus,
  type PauseReason,
  type RunRecord,
  type RunSummary,
  type StepCtx,
  type StepDef,
  type WorkflowDef,
} from './types.js';

export interface EngineOptions {
  store: CheckpointStore;
  /** The clock, the wait between retries and the jitter: a test's own, or the real ones. */
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  /** History entries kept per run (the oldest go first). */
  historyKept?: number;
}

export interface CreateOptions {
  runId?: string;
  floor?: string;
  by?: string;
}

export interface ListFilter {
  floor?: string;
  workflow?: string;
}

export type Off = () => void;

/** The default recursion limit: steps between one start or resume and the next stop. */
export const DEFAULT_MAX_STEPS = 100;

interface Active {
  promise: Promise<RunRecord>;
  controller: AbortController;
  pause: boolean;
  cancelled: boolean;
}

// Workflows of every state type sit in one map; each run is only ever driven by its own.
type AnyWorkflow = WorkflowDef<any>;
type Outcome = { kind: 'next'; status: 'done' | 'skipped' | 'cached' } | { kind: 'failed' } | { kind: 'interrupt' } | { kind: 'cancelled' };

const errorOf = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export class FlowEngine {
  private defs = new Map<string, AnyWorkflow>();
  private runs = new Map<string, RunRecord>();
  private active = new Map<string, Active>();
  private events = new EventEmitter();
  private store: CheckpointStore;
  private now: () => number;
  private wait: (ms: number, signal: AbortSignal) => Promise<void>;
  private random: () => number;
  private historyKept: number;

  constructor(opts: EngineOptions) {
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
    this.wait = opts.sleep ?? realSleep;
    this.random = opts.random ?? Math.random;
    this.historyKept = opts.historyKept ?? 500;
    this.events.setMaxListeners(50);
    // A run that was mid-step when the office stopped can't know how far the step got: it's
    // interrupted, and carries on from that step (whose done() check makes running it again safe).
    for (const run of this.store.loadAll()) {
      if (this.runs.has(run.runId)) continue;
      if (run.status === 'running') {
        run.status = 'interrupted';
        run.error = `The office stopped while ${run.step ?? 'a step'} was running`;
        run.updatedAt = this.now();
        this.store.save(run);
      }
      this.runs.set(run.runId, run);
    }
  }

  /** Adds a workflow (or replaces one with the same id). Throws when its shape is wrong. */
  register<S>(def: WorkflowDef<S>): void {
    const bad = checkWorkflow(def);
    if (bad) throw new Error(bad);
    this.defs.set(def.id, def);
  }

  workflow(id: string): AnyWorkflow | undefined {
    return this.defs.get(id);
  }

  on<K extends FlowEventName>(name: K, fn: (e: FlowEvents[K]) => void): Off {
    this.events.on(name, fn);
    return () => void this.events.off(name, fn);
  }

  private emit<K extends FlowEventName>(name: K, e: FlowEvents[K]) {
    for (const fn of this.events.listeners(name)) {
      try {
        (fn as (e: FlowEvents[K]) => void)(e);
      } catch (err) {
        console.error(`agent-office: a workflow ${name} listener failed: ${(err as Error).message}`);
      }
    }
  }

  get<S = unknown>(runId: string): RunRecord<S> | undefined {
    return this.runs.get(runId) as RunRecord<S> | undefined;
  }

  /** Runs, newest first. */
  list(filter: ListFilter = {}): RunRecord[] {
    return [...this.runs.values()].filter((r) => (!filter.floor || r.floor === filter.floor) && (!filter.workflow || r.workflow === filter.workflow)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  summaries(filter: ListFilter = {}): RunSummary[] {
    return this.list(filter).map((r) => ({
      runId: r.runId,
      workflow: r.workflow,
      version: r.version,
      status: r.status,
      step: r.step,
      reason: r.reason,
      error: r.error,
      floor: r.floor,
      by: r.by,
      attempts: r.step ? (r.attempts[r.step] ?? 0) : 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      finishedAt: r.finishedAt,
    }));
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  /** A new run of `workflow` with this state, saved as pending. Throws when the workflow isn't registered or the id is taken. */
  create<S>(workflow: string, state: S, opts: CreateOptions = {}): RunRecord<S> {
    const def = this.defs.get(workflow);
    if (!def) throw new Error(`No workflow called ${workflow}`);
    const now = this.now();
    const runId = opts.runId ?? `${workflow}-${now.toString(36)}-${Math.floor(this.random() * 36 ** 4).toString(36)}`;
    if (!RUN_ID.test(runId)) throw new Error(`A run's id is letters, digits and ._- (not "${runId}")`);
    if (this.runs.has(runId)) throw new Error(`There's already a run called ${runId}`);
    const run: RunRecord<S> = {
      format: 1,
      runId,
      workflow,
      version: def.version,
      status: 'pending',
      step: firstStep(def),
      state,
      attempts: {},
      loops: {},
      usage: { cost: 0, ms: 0 },
      floor: opts.floor,
      by: opts.by,
      seq: 0,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(runId, run as RunRecord);
    this.checkpoint(run as RunRecord);
    return run;
  }

  /** Takes a run made elsewhere (an older format, migrated) as it is, and saves it. */
  adopt(run: RunRecord): void {
    if (this.runs.has(run.runId)) throw new Error(`There's already a run called ${run.runId}`);
    this.runs.set(run.runId, run);
    this.store.save(run);
  }

  /** Saves a run as it is now (after its state was changed from outside a step). */
  save(runId: string): void {
    const run = this.runs.get(runId);
    if (run) this.checkpoint(run);
  }

  /**
   * Runs from `from` (a fresh pass: loop counts and tries start again), or else from where the run
   * is. Resolves with the run when it stops: done, failed, cancelled, paused or waiting. A run that's
   * already going isn't started twice: its promise is returned.
   */
  start(runId: string, opts: { from?: string } = {}): Promise<RunRecord> {
    const going = this.active.get(runId);
    if (going) return going.promise;
    const { run, def } = this.find(runId);
    if (opts.from !== undefined) {
      if (!stepOf(def, opts.from)) return Promise.reject(new Error(`${def.id} has no step called ${opts.from}`));
      run.step = opts.from;
      run.loops = {};
      run.attempts = {};
      run.waiting = undefined;
      delete run.resumeValue;
    } else if (!RESUMABLE.includes(run.status)) return Promise.resolve(run);
    return this.go(run, def, false);
  }

  /**
   * Carries a stopped run on from its checkpoint: a waiting step gets `value`; a failed step gets its
   * tries back; the loop that tripped its limit gets its rounds back.
   */
  resume(runId: string, value?: unknown): Promise<RunRecord> {
    const going = this.active.get(runId);
    if (going) return going.promise;
    const { run, def } = this.find(runId);
    if (!RESUMABLE.includes(run.status)) return Promise.reject(new Error(`${runId} is ${run.status}: there's nothing to resume`));
    if (run.status === 'waiting') run.resumeValue = value;
    if (run.reason?.kind === 'loop' && run.reason.edge) run.loops[run.reason.edge] = 0;
    if ((run.status === 'failed' || run.status === 'interrupted') && run.step) run.attempts[run.step] = 0;
    return this.go(run, def, true);
  }

  /** Stops a running run after the step it's on (status paused). False when it isn't running. */
  pause(runId: string): boolean {
    const a = this.active.get(runId);
    if (!a) return false;
    a.pause = true;
    return true;
  }

  /**
   * Cancels a run: a running one's step is told (its signal aborts) and whatever it returns is thrown
   * away; a stopped one is just marked. False when it's over already.
   */
  cancel(runId: string): boolean {
    const a = this.active.get(runId);
    if (a) {
      a.cancelled = true;
      a.controller.abort();
      return true;
    }
    const run = this.runs.get(runId);
    if (!run || !RESUMABLE.includes(run.status)) return false;
    this.finish(run, 'cancelled');
    return true;
  }

  private find(runId: string): { run: RunRecord; def: AnyWorkflow } {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`No run called ${runId}`);
    const def = this.defs.get(run.workflow);
    if (!def) throw new Error(`No workflow called ${run.workflow} (for ${runId})`);
    return { run, def };
  }

  private go(run: RunRecord, def: AnyWorkflow, resumed: boolean): Promise<RunRecord> {
    const a: Active = { promise: undefined as unknown as Promise<RunRecord>, controller: new AbortController(), pause: false, cancelled: false };
    this.active.set(run.runId, a);
    run.status = 'running';
    run.version = def.version;
    run.reason = undefined;
    run.error = undefined;
    run.finishedAt = undefined;
    run.step ??= firstStep(def);
    this.checkpoint(run);
    this.emit('run-started', { run, resumed });
    a.promise = this.drive(run, def, a).finally(() => this.active.delete(run.runId));
    return a.promise;
  }

  private async drive(run: RunRecord, def: AnyWorkflow, a: Active): Promise<RunRecord> {
    const maxSteps = def.limits?.maxSteps ?? DEFAULT_MAX_STEPS;
    let taken = 0;
    try {
      while (run.step !== undefined && run.step !== END) {
        if (a.cancelled) return this.finish(run, 'cancelled');
        if (a.pause) return this.stopShort(run, { kind: 'manual', message: `Paused before ${run.step}` });
        if (taken >= maxSteps) return this.stopShort(run, { kind: 'max-steps', message: `Took ${taken} steps without finishing (the limit is ${maxSteps}): stopped before ${run.step}` });
        taken++;
        const step = stepOf(def, run.step);
        if (!step) {
          run.error = `${def.id} has no step called ${run.step}`;
          return this.finish(run, 'failed');
        }
        const out = await this.runStep(run, def, step, a);
        if (out.kind === 'cancelled') return this.finish(run, 'cancelled');
        if (out.kind === 'failed') return this.finish(run, 'failed');
        if (out.kind === 'interrupt') return this.stopShort(run, { kind: 'interrupt', message: `${step.label ?? step.id} is waiting for an answer` });
        let to: string;
        try {
          to = nextStep(def, step.id, run.state);
        } catch (err) {
          run.error = errorOf(err).message;
          return this.finish(run, 'failed');
        }
        const last = run.history[run.history.length - 1];
        if (last?.step === step.id) last.next = to;
        run.step = to;
        const edge = edgeName(step.id, to);
        const limit = def.limits?.loops?.[edge];
        if (limit !== undefined && (run.loops[edge] ?? 0) >= limit) {
          this.emit('step-finished', { run, step: step.id, status: out.status, next: to });
          return this.stopShort(run, { kind: 'loop', edge, message: `Went from ${step.id} to ${to} ${limit} time${limit === 1 ? '' : 's'}, the limit: stopped before going round again` });
        }
        run.loops[edge] = (run.loops[edge] ?? 0) + 1;
        const over = this.overBudget(run, def);
        this.checkpoint(run);
        this.emit('step-finished', { run, step: step.id, status: out.status, next: to });
        if (over && to !== END) return this.stopShort(run, { kind: 'budget', message: over });
      }
      return this.finish(run, 'done');
    } catch (err) {
      // The engine's own bug, or a store that threw: don't leave the run looking busy.
      run.error = errorOf(err).message;
      return this.finish(run, 'failed');
    }
  }

  private overBudget(run: RunRecord, def: AnyWorkflow): string | undefined {
    const b = def.limits?.budget;
    if (b?.cost !== undefined && run.usage.cost > b.cost) return `Spent ${run.usage.cost} of a budget of ${b.cost}`;
    if (b?.ms !== undefined && run.usage.ms > b.ms) return `Ran for ${Math.round(run.usage.ms / 1000)}s of a budget of ${Math.round(b.ms / 1000)}s`;
    return def.limits?.check?.(run.usage, run.state);
  }

  private async runStep(run: RunRecord, def: AnyWorkflow, step: StepDef<unknown>, a: Active): Promise<Outcome> {
    const delivering = run.waiting?.step === step.id && 'resumeValue' in run;
    if (!delivering && step.done?.(run.state)) {
      this.record(run, step.id, 'skipped', 0, this.now());
      return { kind: 'next', status: 'skipped' };
    }
    const key = step.cache ? step.cache.key(run.state) : undefined;
    if (step.cache && key !== undefined) {
      const hit = this.store.cacheGet(def.id, step.id, key);
      if (hit && this.now() - hit.at <= step.cache.ttlMs) {
        if (hit.update && typeof hit.update === 'object') this.merge(run, def, hit.update as object);
        this.record(run, step.id, 'cached', 0, this.now());
        return { kind: 'next', status: 'cached' };
      }
    }
    const log = (line: string) => (def.log ? def.log(run.state, line, run.runId) : console.log(`  [${def.id} ${run.runId}] ${line}`));
    for (;;) {
      const attempt = (run.attempts[step.id] ?? 0) + 1;
      run.attempts[step.id] = attempt;
      const maxAttempts = step.retry?.maxAttempts ?? 1;
      const startedAt = this.now();
      this.emit('step-started', { run, step: step.id, attempt });
      const ctx: StepCtx<unknown> = {
        state: run.state,
        run: { runId: run.runId, workflow: run.workflow, version: run.version, floor: run.floor, by: run.by, createdAt: run.createdAt },
        step: step.id,
        attempt,
        maxAttempts,
        signal: a.controller.signal,
        resume: delivering ? run.resumeValue : undefined,
        log,
        report: (u) => {
          run.usage.cost += Number(u.cost) || 0;
          run.usage.ms += Number(u.ms) || 0;
        },
        save: () => this.checkpoint(run),
      };
      let result: unknown;
      try {
        result = await step.run(ctx);
      } catch (e) {
        run.usage.ms += Math.max(0, this.now() - startedAt);
        if (a.cancelled) {
          this.record(run, step.id, 'cancelled', attempt, startedAt);
          return { kind: 'cancelled' };
        }
        const err = errorOf(e);
        const willRetry = attempt < maxAttempts && (step.retry?.retryOn?.(err, attempt) ?? true);
        if (!willRetry) {
          run.error = err.message;
          this.record(run, step.id, 'failed', attempt, startedAt, err.message);
          this.emit('step-failed', { run, step: step.id, error: err.message, attempt, willRetry: false });
          return { kind: 'failed' };
        }
        const delayMs = backoffMs(step.retry!, attempt, this.random);
        this.record(run, step.id, 'retrying', attempt, startedAt, err.message);
        log(`↻ ${step.label ?? step.id} failed (try ${attempt} of ${maxAttempts}): trying again in ${Math.max(1, Math.round(delayMs / 1000))}s`);
        this.checkpoint(run);
        this.emit('step-failed', { run, step: step.id, error: err.message, attempt, willRetry: true, delayMs });
        try {
          await this.wait(delayMs, a.controller.signal);
        } catch {
          return { kind: 'cancelled' };
        }
        if (a.cancelled) return { kind: 'cancelled' };
        continue;
      }
      run.usage.ms += Math.max(0, this.now() - startedAt);
      if (a.cancelled) {
        this.record(run, step.id, 'cancelled', attempt, startedAt);
        return { kind: 'cancelled' };
      }
      if (isInterrupt(result)) {
        run.waiting = { step: step.id, payload: result.payload, at: this.now() };
        delete run.resumeValue;
        delete run.attempts[step.id];
        this.record(run, step.id, 'interrupted', attempt, startedAt);
        return { kind: 'interrupt' };
      }
      if (delivering) {
        delete run.resumeValue;
        run.waiting = undefined;
      }
      if (result && typeof result === 'object') this.merge(run, def, result);
      if (step.cache && key !== undefined) this.store.cachePut(def.id, step.id, { key, at: this.now(), update: result ?? null });
      delete run.attempts[step.id];
      this.record(run, step.id, 'done', attempt, startedAt);
      return { kind: 'next', status: 'done' };
    }
  }

  private merge(run: RunRecord, def: AnyWorkflow, update: object) {
    run.state = def.merge ? def.merge(run.state, update) : Object.assign(run.state as object, update);
  }

  private record(run: RunRecord, step: string, status: HistoryStatus, attempt: number, startedAt: number, error?: string) {
    const entry: HistoryEntry = { seq: run.seq + 1, step, status, attempt, startedAt, endedAt: this.now(), ...(error ? { error } : {}) };
    run.history.push(entry);
    if (run.history.length > this.historyKept) run.history.splice(0, run.history.length - this.historyKept);
  }

  private checkpoint(run: RunRecord) {
    run.seq++;
    run.updatedAt = this.now();
    const def = this.defs.get(run.workflow);
    const floor = def?.floorOf?.(run.state);
    if (floor) run.floor = floor;
    this.store.save(run);
  }

  private stopShort(run: RunRecord, reason: PauseReason): RunRecord {
    run.status = reason.kind === 'interrupt' ? 'waiting' : reason.kind === 'manual' ? 'paused' : 'needs-attention';
    run.reason = reason;
    this.checkpoint(run);
    this.emit('run-paused', { run, reason });
    return run;
  }

  private finish(run: RunRecord, status: 'done' | 'failed' | 'cancelled'): RunRecord {
    run.status = status;
    if (status === 'done') run.step = undefined;
    if (status !== 'failed') run.error = undefined;
    run.finishedAt = this.now();
    this.checkpoint(run);
    this.emit('run-finished', { run, status });
    return run;
  }
}
