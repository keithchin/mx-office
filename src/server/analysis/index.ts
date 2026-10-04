// The worker performance analyzer, as the office runs it: it watches workers finish (and stop on a
// question), records a run for each (collect.ts) in the building's store (store.ts), and answers the
// Analysis tab with rankings across every floor or one (shared/analysis.ts). One per office, made
// the first time something asks for it (analysisOf), so it needs no stage of its own in startServer.

import path from 'node:path';
import type { QueueTask, WorkerInfo } from '../../shared/protocol.js';
import { buildReport, type AnalysisReport, type GroupBy, type RunRecord } from '../../shared/analysis.js';
import { childEnv } from '../workers/env.js';
import { resolveCommand } from '../workers/process.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { Classifier } from './classify.js';
import { collectRun, exclusionOf, GhCache, outcomeOf, type FloorRef, type WorkerSnapshot } from './collect.js';
import { readBuilding } from './disk.js';
import { Haiku } from './llm.js';
import { scorecardOf } from './scorecard.js';
import { RunStore } from './store.js';

/** After a worker's update, how long to wait for more before recording: a turn ending sends a burst. */
const SETTLE_MS = 5_000;
/** An open PR's record is looked at again (merged yet? scorecard posted?) at most this often. */
const OPEN_PR_REFRESH_MS = 15 * 60_000;

const RUNNING = new Set<WorkerInfo['status']>(['starting', 'working', 'needs_input']);

export class Analysis {
  readonly store: RunStore;
  readonly haiku: Haiku;
  private classifier: Classifier;
  private gh = new GhCache();
  private timers = new Map<string, NodeJS.Timeout>();
  /** Waits on a person seen live, by worker: how many, how long, and since when the current one. */
  private waits = new Map<string, { count: number; ms: number; since?: number }>();
  private busyCount = 0;
  /** Whether the runs already on the floors were recorded once since the office started. */
  private booted = false;

  constructor(dataDir: string, claude: string | null = resolveCommand('claude')) {
    this.store = new RunStore(dataDir);
    this.haiku = new Haiku(claude, childEnv());
    this.classifier = new Classifier(path.join(this.store.dir, 'classes.json'), this.haiku);
  }

  get busy(): boolean {
    return this.busyCount > 0;
  }

  /** Every worker update: count its waits on a person, and record its run once a turn has ended. */
  onWorker(floor: Floor, w: WorkerInfo) {
    if (w.kind !== 'agent') return;
    const wait = this.waits.get(w.id) ?? { count: 0, ms: 0 };
    if (w.status === 'needs_input' && wait.since === undefined) {
      wait.count++;
      wait.since = Date.now();
    } else if (w.status !== 'needs_input' && wait.since !== undefined) {
      wait.ms += Date.now() - wait.since;
      wait.since = undefined;
    }
    this.waits.set(w.id, wait);
    if (w.status !== 'done' && w.status !== 'exited' && w.status !== 'needs_input') return;
    clearTimeout(this.timers.get(w.id));
    this.timers.set(
      w.id,
      setTimeout(() => {
        this.timers.delete(w.id);
        const now = floor.workers.get(w.id);
        if (now) void this.record(liveFloor(floor), this.snapshot(now), taskOf(floor, w.id), !RUNNING.has(now.status));
      }, SETTLE_MS),
    );
  }

  /** Records every worker on these floors again (an admin's re-analysis, or the first look). */
  async backfill(floors: Floor[]): Promise<number> {
    let n = 0;
    await this.run(async () => {
      for (const f of floors) {
        for (const w of f.workers.list()) {
          if (w.kind !== 'agent') continue;
          await this.record(liveFloor(f), this.snapshot(w), taskOf(f, w.id), true, true);
          n++;
        }
      }
    });
    return n;
  }

  /** The same from an office's data folder on disk (the CLI's backfill, and checking against a live office without touching it). */
  async backfillDisk(dataDir: string, useModel: boolean): Promise<RunRecord[]> {
    const out: RunRecord[] = [];
    await this.run(async () => {
      for (const { floor, workers, tasks } of readBuilding(dataDir)) {
        for (const w of workers) out.push(await this.record(floor, w, tasks.find((t) => t.workerId === w.id), useModel, true));
      }
    });
    return out;
  }

  report(floors: Floor[], opts: { floor?: string; by?: GroupBy }): AnalysisReport {
    // The first look since the office started: the workers already at their desks get their records.
    if (!this.booted) {
      this.booted = true;
      void this.backfill(floors);
    }
    this.settle(floors);
    const names = new Map<string, string>();
    for (const r of this.store.all()) names.set(r.floor, r.floor);
    for (const f of floors) names.set(f.id, f.def.name);
    return buildReport(this.store.all(), { floor: opts.floor, by: opts.by, floors: [...names].map(([id, name]) => ({ id, name })), busy: this.busy });
  }

  private async record(floor: FloorRef, w: WorkerSnapshot, task: QueueTask | undefined, useModel: boolean, freshPr = false): Promise<RunRecord> {
    const id = `${floor.id}:${w.id}`;
    const r = await collectRun(floor, w, task, { gh: this.gh, classifier: this.classifier, useModel, previous: this.store.get(id), freshPr });
    this.store.put(r);
    return r;
  }

  /**
   * Runs whose worker has gone home while still marked as running are settled from what's known,
   * and open PRs are looked at again now and then, in the background: the tab never waits on GitHub.
   */
  private settle(floors: Floor[]) {
    const byId = new Map(floors.map((f) => [f.id, f]));
    for (const r of this.store.all()) {
      const floor = byId.get(r.floor);
      if (!floor) continue;
      const w = floor.workers.get(r.workerId);
      if (r.outcome === 'running' && (!w || !RUNNING.has(w.status))) {
        if (w) {
          void this.record(liveFloor(floor), this.snapshot(w), taskOf(floor, w.id), true);
          continue;
        }
        const outcome = outcomeOf(false, r.pr?.state, !!r.pr);
        this.store.put({ ...r, outcome, excluded: exclusionOf(outcome, !!r.pr, r.apiCalls), updatedAt: Date.now() });
      } else if (r.outcome === 'open' && Date.now() - r.updatedAt > OPEN_PR_REFRESH_MS && !this.timers.has(r.workerId)) {
        this.store.put({ ...r, updatedAt: Date.now() });
        if (w) void this.record(liveFloor(floor), this.snapshot(w), taskOf(floor, w.id), true, true);
        else void this.refreshGone(liveFloor(floor), r);
      }
    }
  }

  /** An open PR's run whose worker has gone home: just its PR's fate and scorecard again. */
  private async refreshGone(floor: FloorRef, r: RunRecord) {
    if (!r.pr) return;
    const pr = await this.gh.pr(floor.dir, r.pr.number, true);
    if (!pr) return;
    const outcome = outcomeOf(false, pr.state, true);
    this.store.put({ ...r, outcome, pr: { ...r.pr, state: pr.state, additions: pr.additions, deletions: pr.deletions, checks: pr.checks }, scorecard: scorecardOf(pr.body, pr.comments) ?? r.scorecard, updatedAt: Date.now() });
  }

  private snapshot(w: WorkerInfo): WorkerSnapshot {
    const wait = this.waits.get(w.id);
    const live = wait?.since !== undefined ? Date.now() - wait.since : 0;
    return {
      id: w.id,
      name: w.name,
      provider: w.provider,
      model: w.model,
      effort: w.effort,
      prompt: w.prompt,
      title: w.title,
      sessionId: w.sessionId,
      createdAt: w.createdAt,
      pr: w.pr,
      worktreePath: w.worktree?.path,
      usage: w.usage,
      workedMs: w.workedMs,
      running: RUNNING.has(w.status),
      needsInput: wait?.count,
      needsInputMs: wait ? wait.ms + live : undefined,
    };
  }

  private async run(fn: () => Promise<void>) {
    this.busyCount++;
    try {
      await fn();
    } finally {
      this.busyCount--;
    }
  }
}

const liveFloor = (f: Floor): FloorRef => ({ id: f.id, name: f.def.name, repo: f.def.repo, dir: f.dir });
const taskOf = (f: Floor, workerId: string): QueueTask | undefined => f.queue.state().tasks.find((t) => t.workerId === workerId);

const offices = new WeakMap<object, Analysis>();

/** The office's analyzer: made on first use, then the same one for its routes and its workers. */
export function analysisOf(ctx: Pick<Ctx, 'cfg'>): Analysis {
  let a = offices.get(ctx.cfg);
  if (!a) {
    a = new Analysis(ctx.cfg.dataDir);
    offices.set(ctx.cfg, a);
  }
  return a;
}
