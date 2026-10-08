// One project's setup as a workflow on the office's engine (server/flow/): its steps in order, run
// to the end or stopped at the first failure, checkpointed after every step so it carries on where it
// stopped: after a Retry, or after the office restarted halfway. Each step checks what's already done
// before doing anything, so running one again is always safe; the network steps try again by
// themselves when GitHub or the connection hiccups. This file keeps the wizard's record of the job
// (the state the engine runs on) and the steps' log; the engine decides what runs next.

import { readFileSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { interviewModeOf, SETUP_STEPS, type JobView, type ProjectPlan, type ProjectRole, type StepId, type StepStatus } from '../../shared/wizard.js';
import { FileStore, FlowEngine, transientError, type RetryPolicy, type RunRecord, type RunStatus, type StepCtx } from '../flow/index.js';
import { runningCommands } from './run.js';

export interface JobState {
  id: string;
  plan: ProjectPlan;
  steps: Record<StepId, { status: StepStatus; detail?: string }>;
  log: string[];
  status: JobView['status'];
  /** The floor's checkout, once it's cloned. */
  dir?: string;
  floor?: string;
  issue?: number;
  /** The Discovery issue went to the Chief Analyst as its first task when the team step hired it (so the queue step doesn't queue it again). */
  discoveryHired?: boolean;
  /** The Budget step's level and budget were applied to the floor (once: a Retry doesn't apply it again). */
  budgetApplied?: boolean;
  /**
   * Set once the answers are edited after the team step ran: the roles ticked since then that the team
   * step still has to hire (and only those). Empty once it has; undefined for a setup never edited.
   */
  addRoles?: ProjectRole[];
  by: string;
  /** The account that started it, for queueing its Discovery task. */
  account?: string;
  startedAt: number;
  updatedAt: number;
}

export interface StepResult {
  status: 'done' | 'skipped';
  detail?: string;
}

/** What a step can do besides its own work: say things in the log. */
export interface StepIO {
  log(line: string): void;
}

export type StepImpl = (job: JobState, io: StepIO) => Promise<StepResult>;

/** The setup's workflow on the engine. */
export const SETUP_FLOW = 'new-project';
const SETUP_FLOW_VERSION = 1;

const LOG_KEPT = 1500;
/**
 * A step that has said nothing for this long says where it is: the commands it has running and for how
 * long, or that none is (it waits on something in the office). A setup must never just sit there.
 */
export const STEP_QUIET_MS = 30_000;

/** What a quiet step is waiting on, from the commands running now (run.ts). */
export function waitingOn(now: number, commands: Iterable<{ line: string; since: number; started: boolean }> = runningCommands.values()): string {
  const list = [...commands].map((c) => `${c.line} (${c.started ? 'running' : 'starting'} ${Math.round((now - c.since) / 1000)} s)`);
  return list.length ? `waiting on ${list.join('; ')}` : 'no command running: waiting on the office';
}

/** The steps that talk to GitHub or download something: a dropped connection or a rate limit is tried again, twice. */
const NETWORK: RetryPolicy = { maxAttempts: 3, baseMs: 3000, maxMs: 30_000, retryOn: transientError };
const RETRIES: Partial<Record<StepId, RetryPolicy>> = { repo: NETWORK, clone: NETWORK, app: NETWORK, commit: NETWORK, issue: NETWORK };

const RESTARTED = 'The office restarted in the middle of this step: Retry carries on from here';

/** A job's id: its repository, so the same project can't be set up twice at once. */
export const jobId = (owner: string, name: string) => `${owner}__${name}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');

export function newJob(plan: ProjectPlan, by: string, account?: string): JobState {
  const now = Date.now();
  const steps = Object.fromEntries(SETUP_STEPS.map((s) => [s.id, { status: 'pending' as StepStatus }])) as JobState['steps'];
  return { id: jobId(plan.owner, plan.name), plan, steps, log: [], status: 'idle', by, account, startedAt: now, updatedAt: now };
}

export function viewOf(job: JobState): JobView {
  return {
    id: job.id,
    plan: job.plan,
    steps: SETUP_STEPS.map((s) => ({ id: s.id, label: s.label, ...job.steps[s.id] })),
    log: job.log.slice(-400),
    status: job.status,
    floor: job.floor,
    issue: job.issue,
    by: job.by,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
  };
}

const finished = (s: StepStatus) => s === 'done' || s === 'skipped';

/** A job saved before the engine (a bare JobState in <wizard dir>/<id>.json) as a run checkpoint. */
export function runOfLegacyJob(job: JobState): RunRecord<JobState> {
  const status: RunStatus = job.status === 'running' ? 'interrupted' : job.status === 'idle' ? 'pending' : job.status;
  const step = SETUP_STEPS.find((s) => !finished(job.steps[s.id]?.status ?? 'pending'))?.id;
  return {
    format: 1,
    runId: job.id,
    workflow: SETUP_FLOW,
    version: SETUP_FLOW_VERSION,
    status: status === 'done' && step ? 'pending' : status,
    step: status === 'done' && !step ? undefined : (step ?? SETUP_STEPS[0].id),
    state: job,
    attempts: {},
    loops: {},
    usage: { cost: 0, ms: 0 },
    floor: job.floor,
    by: job.by,
    seq: 0,
    history: [],
    createdAt: job.startedAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * The jobs: runs of the setup workflow on `engine` (the office's, or one of its own under `dir` when
 * none is given). Jobs saved before the engine, as <dir>/<id>.json, are taken in on load and their
 * file renamed <id>.json.migrated. `redact` runs over every log line before it's kept, so a secret
 * a command echoes never reaches the file or a browser.
 */
export class JobBook {
  readonly engine: FlowEngine;
  /** The step implementations of each running job (given to run()). */
  private impls = new Map<string, Record<StepId, StepImpl>>();
  /** How long a step may say nothing before it says what it waits on (STEP_QUIET_MS; the tests shorten it). */
  quietMs = STEP_QUIET_MS;

  constructor(
    private dir: string,
    private redact: (line: string) => string = (l) => l,
    engine?: FlowEngine,
  ) {
    this.engine = engine ?? new FlowEngine({ store: new FileStore(dir) });
    this.engine.register<JobState>({
      id: SETUP_FLOW,
      version: SETUP_FLOW_VERSION,
      steps: SETUP_STEPS.map(({ id, label }) => ({
        id,
        label,
        done: (job: JobState) => finished(job.steps[id].status),
        retry: RETRIES[id],
        run: (ctx: StepCtx<JobState>) => this.step(ctx, id, label),
      })),
      log: (job, line) => this.log(job, line),
      floorOf: (job) => job.floor,
    });
    this.migrate();
    for (const job of this.all()) this.tidy(job);
  }

  get(id: string): JobState | undefined {
    const run = this.engine.get<JobState>(id);
    return run?.workflow === SETUP_FLOW ? run.state : undefined;
  }

  all(): JobState[] {
    return this.engine
      .list({ workflow: SETUP_FLOW })
      .map((r) => r.state as JobState)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  byFloor(floor: string): JobState | undefined {
    return this.all().find((j) => j.floor === floor);
  }

  add(job: JobState) {
    const run = this.engine.get<JobState>(job.id);
    if (!run) {
      this.engine.create(SETUP_FLOW, job, { runId: job.id, floor: job.floor, by: job.by });
      return;
    }
    run.state = job;
    this.save(job);
  }

  isRunning(id: string): boolean {
    return this.engine.isActive(id);
  }

  log(job: JobState, line: string) {
    const clean = this.redact(line).slice(0, 2000);
    job.log.push(clean);
    if (job.log.length > LOG_KEPT) job.log.splice(0, job.log.length - LOG_KEPT);
  }

  /**
   * New answers for a job: its plan replaced, and the steps they touch set back to pending. Roles
   * ticked since the team step ran are kept in addRoles for it to hire, and only then is it run again
   * (a team step that never finished still hires everything ticked, as it would have).
   */
  edit(job: JobState, plan: ProjectPlan, ids: StepId[]) {
    const teamRan = job.addRoles !== undefined || job.steps.team.status === 'done' || job.steps.team.status === 'skipped';
    const added = plan.roles.filter((r) => !job.plan.roles.includes(r));
    job.plan = plan;
    if (teamRan) job.addRoles = [...new Set([...(job.addRoles ?? []), ...added])].filter((r) => plan.roles.includes(r));
    this.reset(job, [...ids, ...(teamRan && job.addRoles?.length ? (['team'] as StepId[]) : [])]);
  }

  /** Sets these steps (and the job) back to pending, for an edit that has to write them again. */
  reset(job: JobState, ids: StepId[]) {
    for (const id of ids) job.steps[id] = { status: 'pending' };
    if (job.status !== 'running') job.status = 'idle';
    this.save(job);
  }

  /**
   * Runs the job's steps in order from the first one not done yet, until they're all done or one
   * fails. Resolves when it stops; a job already running isn't started twice.
   */
  async run(job: JobState, impls: Record<StepId, StepImpl>): Promise<void> {
    if (this.engine.isActive(job.id)) return;
    if (this.get(job.id) !== job) this.add(job);
    this.impls.set(job.id, impls);
    job.status = 'running';
    try {
      // From the top every time: the done steps are skipped, and an edit may have reset any of them.
      const run = await this.engine.start(job.id, { from: SETUP_STEPS[0].id });
      job.status = run.status === 'done' ? 'done' : 'failed';
    } catch (err) {
      job.status = 'failed';
      this.log(job, `✗ ${this.redact((err as Error).message)}`);
    } finally {
      this.impls.delete(job.id);
    }
    this.save(job);
  }

  save(job: JobState) {
    job.updatedAt = Date.now();
    this.engine.save(job.id);
  }

  /** One step of the setup, as the engine runs it: marked running, its implementation, then done, skipped or failed. */
  private async step(ctx: StepCtx<JobState>, id: StepId, label: string): Promise<void> {
    const job = ctx.state;
    const impl = this.impls.get(job.id)?.[id];
    if (!impl) throw new Error(RESTARTED);
    job.steps[id] = { status: 'running' };
    this.log(job, `▶ ${label}${ctx.attempt > 1 ? ` (try ${ctx.attempt} of ${ctx.maxAttempts})` : ''}`);
    this.save(job);
    let throttle = 0;
    let heard = Date.now();
    let noted = 0;
    // Quiet for STEP_QUIET_MS: it says what it waits on, in its log and its line, and again every STEP_QUIET_MS.
    const watch = setInterval(() => {
      const now = Date.now();
      if (now - heard < this.quietMs || now - noted < this.quietMs) return;
      noted = now;
      const what = waitingOn(now);
      job.steps[id] = { status: 'running', detail: `no progress for ${Math.round((now - heard) / 1000)} s: ${what}` };
      this.log(job, `⏳ ${label}: no progress for ${Math.round((now - heard) / 1000)} s, ${what}`);
      console.warn(`agent-office: setup ${job.id}: ${label} has made no progress for ${Math.round((now - heard) / 1000)} s, ${what}`);
      job.updatedAt = now;
    }, Math.min(this.quietMs, 5_000));
    watch.unref?.();
    // Long steps note the time now and then, so a browser polling sees their output.
    const io: StepIO = {
      log: (line) => {
        heard = Date.now();
        this.log(job, line);
        if (Date.now() - throttle > 1000) {
          throttle = Date.now();
          job.updatedAt = Date.now();
        }
      },
    };
    let r: StepResult;
    try {
      r = await impl(job, io);
    } catch (err) {
      clearInterval(watch);
      const why = this.redact((err as Error).message || String(err));
      job.steps[id] = { status: 'failed', detail: why };
      this.log(job, `✗ ${label}: ${why}`);
      throw new Error(why);
    }
    clearInterval(watch);
    const detail = r.detail ? this.redact(r.detail) : undefined;
    job.steps[id] = { status: r.status, detail };
    this.log(job, `${r.status === 'done' ? '✓' : '↷'} ${label}${detail ? ` — ${detail}` : ''}`);
  }

  /** What every loaded job gets: old answers in today's words, steps added since, and a step the office stopped in marked for a Retry. */
  private tidy(job: JobState) {
    // Saved before the toolkit's own words: attended/unattended read as steering/auto.
    job.plan.interview = interviewModeOf(job.plan.interview);
    for (const s of SETUP_STEPS) job.steps[s.id] ??= { status: 'pending' };
    if (job.status === 'running' && !this.engine.isActive(job.id)) {
      for (const s of SETUP_STEPS) if (job.steps[s.id].status === 'running') job.steps[s.id] = { status: 'failed', detail: RESTARTED };
      job.status = 'failed';
      this.engine.save(job.id);
    }
  }

  /** Takes in the jobs saved before the engine, as runs. */
  private migrate() {
    let files: string[] = [];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }
    for (const f of files) {
      const file = path.join(this.dir, f);
      try {
        const job = JSON.parse(readFileSync(file, 'utf8')) as JobState & { format?: unknown };
        if (!job?.id || !job.plan || !job.steps || 'format' in job) continue;
        if (!this.engine.get(job.id)) this.engine.adopt(runOfLegacyJob(job) as RunRecord);
        renameSync(file, `${file}.migrated`);
      } catch {
        // not one of ours
      }
    }
  }
}
