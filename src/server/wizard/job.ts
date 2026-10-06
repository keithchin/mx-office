// One project's setup as a list of steps that runs to the end or stops at the first failure, saved
// to a file after every step so it can carry on where it stopped: after a Retry, or after the office
// restarted halfway. Each step checks what's already done before doing anything, so running one
// again is always safe; this file only decides which step runs next and keeps the record.

import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { interviewModeOf, SETUP_STEPS, type JobView, type ProjectPlan, type ProjectRole, type StepId, type StepStatus } from '../../shared/wizard.js';

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

const LOG_KEPT = 1500;

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

/**
 * The jobs, kept in <dir>/<id>.json. `redact` runs over every log line before it's kept, so a
 * secret a command echoes never reaches the file or a browser.
 */
export class JobBook {
  private jobs = new Map<string, JobState>();
  private running = new Set<string>();

  constructor(
    private dir: string,
    private redact: (line: string) => string = (l) => l,
  ) {
    this.load();
  }

  get(id: string): JobState | undefined {
    return this.jobs.get(id);
  }

  all(): JobState[] {
    return [...this.jobs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  byFloor(floor: string): JobState | undefined {
    return this.all().find((j) => j.floor === floor);
  }

  add(job: JobState) {
    this.jobs.set(job.id, job);
    this.save(job);
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
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
    if (this.running.has(job.id)) return;
    this.running.add(job.id);
    job.status = 'running';
    this.save(job);
    const io: StepIO = { log: (line) => this.log(job, line) };
    try {
      for (const { id, label } of SETUP_STEPS) {
        const st = job.steps[id];
        if (st.status === 'done' || st.status === 'skipped') continue;
        job.steps[id] = { status: 'running' };
        this.log(job, `▶ ${label}`);
        this.save(job);
        let throttle = 0;
        // Long steps save now and then, so a browser polling sees their output.
        const ioStep: StepIO = {
          log: (line) => {
            io.log(line);
            if (Date.now() - throttle > 1000) {
              throttle = Date.now();
              job.updatedAt = Date.now();
            }
          },
        };
        try {
          const r = await impls[id](job, ioStep);
          job.steps[id] = { status: r.status, detail: r.detail ? this.redact(r.detail) : undefined };
          this.log(job, `${r.status === 'done' ? '✓' : '↷'} ${label}${r.detail ? ` — ${this.redact(r.detail)}` : ''}`);
          this.save(job);
        } catch (err) {
          const why = this.redact((err as Error).message || String(err));
          job.steps[id] = { status: 'failed', detail: why };
          job.status = 'failed';
          this.log(job, `✗ ${label}: ${why}`);
          this.save(job);
          return;
        }
      }
      job.status = 'done';
      this.save(job);
    } finally {
      this.running.delete(job.id);
    }
  }

  save(job: JobState) {
    job.updatedAt = Date.now();
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const file = path.join(this.dir, `${job.id}.json`);
      writeFileSync(`${file}.tmp`, JSON.stringify(job, null, 2), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error(`agent-office: couldn't save the setup of ${job.id}: ${(err as Error).message}`);
    }
  }

  /** The jobs saved before; one that was mid-step when the office stopped is marked failed, for a Retry to carry on. */
  private load() {
    let files: string[] = [];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }
    for (const f of files) {
      try {
        const job = JSON.parse(readFileSync(path.join(this.dir, f), 'utf8')) as JobState;
        if (!job?.id || !job.plan || !job.steps) continue;
        // Saved before the toolkit's own words: attended/unattended read as steering/auto.
        job.plan.interview = interviewModeOf(job.plan.interview);
        for (const s of SETUP_STEPS) job.steps[s.id] ??= { status: 'pending' };
        if (job.status === 'running') {
          for (const s of SETUP_STEPS) if (job.steps[s.id].status === 'running') job.steps[s.id] = { status: 'failed', detail: 'The office restarted in the middle of this step: Retry carries on from here' };
          job.status = 'failed';
        }
        this.jobs.set(job.id, job);
      } catch {
        // not one of ours
      }
    }
  }
}
