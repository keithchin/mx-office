// ▶ Resume project and ⏸ Pause project, per floor (see docs/site/using-the-office/resume-and-pause.md):
// the preview (preview.ts), the runs (flows.ts, on the office's workflow engine) and the floor's pause
// (store.ts, which the roster's one delivery path holds office prompts on). One per office, made on
// first use (projectRunsOf in adapter.ts); runs a restart cut off carry on when it's made.

import { agentKey, chosen, type ProjectRunView, type ResumeChoice, type ResumePreview, type RunProgress } from '../../shared/project-run.js';
import type { RunRecord } from '../flow/types.js';
import { PAUSE_FLOW, pauseFlow, RESUME_FLOW, resumeFlow, type PauseRun, type ResumeAgent, type ResumeRun } from './flows.js';
import { previewFloor } from './preview.js';
import { pacingOf, projectPause } from './store.js';
import type { RunDeps } from './types.js';

const FLOWS = [RESUME_FLOW, PAUSE_FLOW];
const GOING = new Set(['pending', 'running', 'waiting', 'paused', 'interrupted', 'needs-attention']);

export class ProjectRuns {
  constructor(readonly deps: RunDeps) {
    deps.engine.register(resumeFlow(deps));
    deps.engine.register(pauseFlow(deps));
  }

  /** The newest resume or pause run on a floor. */
  latest(floorId: string): RunRecord<ResumeRun | PauseRun> | undefined {
    return this.deps.engine.list({ floor: floorId }).find((r) => FLOWS.includes(r.workflow)) as RunRecord<ResumeRun | PauseRun> | undefined;
  }

  /** The run going on the floor now, if one is. */
  going(floorId: string): RunRecord<ResumeRun | PauseRun> | undefined {
    const r = this.latest(floorId);
    return r && GOING.has(r.status) ? r : undefined;
  }

  async preview(floorId: string): Promise<ResumePreview | string> {
    const f = this.deps.floor(floorId);
    if (!f) return 'No such floor';
    return (await previewFloor(this.deps, f)).preview;
  }

  /** Starts a resume of the floor with what the person picked; the run, or why not. */
  async resume(floorId: string, choice: ResumeChoice, by: string, byId?: string, reason?: string): Promise<RunProgress | string> {
    const f = this.deps.floor(floorId);
    if (!f) return 'No such floor';
    const { preview, candidates } = await previewFloor(this.deps, f);
    if (preview.blocked) return preview.blocked;
    this.stopGoing(floorId);
    const picked = chosen(preview, choice);
    const agents: ResumeAgent[] = picked.map(({ agent, action }) => {
      const c = candidates.find((x) => agentKey(x) === agentKey(agent))!;
      const { options: _o, order: _r, ...candidate } = c;
      return { key: agentKey(agent), workerId: agent.workerId, role: agent.role, name: agent.name, action, status: 'pending', candidate };
    });
    const run = this.deps.engine.create<ResumeRun>(RESUME_FLOW, { floor: floorId, by, byId, agents, i: 0, pacing: pacingOf(floorId), ...(reason ? { reason } : {}) }, { floor: floorId, by });
    void this.deps.engine.start(run.runId).catch((err) => console.error(`agent-office: resume of ${floorId} failed: ${(err as Error).message}`));
    return progressOf(run);
  }

  /** Starts pausing the floor; the run, or why not. */
  pause(floorId: string, by: string, byId?: string, why: 'person' | 'restart' = 'person'): RunProgress | string {
    if (!this.deps.floor(floorId)) return 'No such floor';
    this.stopGoing(floorId);
    const run = this.deps.engine.create<PauseRun>(PAUSE_FLOW, { floor: floorId, by, byId, why, agents: [] }, { floor: floorId, by });
    void this.deps.engine.start(run.runId).catch((err) => console.error(`agent-office: pause of ${floorId} failed: ${(err as Error).message}`));
    return progressOf(run);
  }

  /** Cancels the run going on the floor (what it did so far stays done). */
  cancel(floorId: string): boolean {
    const r = this.going(floorId);
    return !!r && this.deps.engine.cancel(r.runId);
  }

  /** Stops it mid-way, after the step it's on; carried on with resumeRun. */
  hold(floorId: string): boolean {
    const r = this.going(floorId);
    return !!r && this.deps.engine.pause(r.runId);
  }

  resumeRun(floorId: string): boolean {
    const r = this.going(floorId);
    if (!r || this.deps.engine.isActive(r.runId)) return false;
    void this.deps.engine.resume(r.runId).catch(() => undefined);
    return true;
  }

  private stopGoing(floorId: string) {
    const r = this.going(floorId);
    if (r) this.deps.engine.cancel(r.runId);
  }

  /** Carries on every run a restart cut off (the engine loads them as interrupted). */
  carryOn() {
    for (const r of this.deps.engine.list()) {
      if (!FLOWS.includes(r.workflow) || r.status !== 'interrupted' || !r.floor || !this.deps.floor(r.floor)) continue;
      void this.deps.engine.resume(r.runId).catch((err) => console.error(`agent-office: couldn't carry on ${r.runId}: ${(err as Error).message}`));
    }
  }

  view(floorId: string, admin: boolean): ProjectRunView {
    const r = this.latest(floorId);
    return { floor: floorId, pause: projectPause(floorId), run: r && progressOf(r), pacing: pacingOf(floorId), admin };
  }
}

/** A run as the browser shows it. */
export function progressOf(r: RunRecord<ResumeRun | PauseRun>): RunProgress {
  return {
    runId: r.runId,
    kind: r.workflow === PAUSE_FLOW ? 'pause' : 'resume',
    floor: r.state.floor,
    status: r.status,
    by: r.by,
    agents: r.state.agents.map(({ workerId, role, name, action, status, note }) => ({ workerId, role, name, action, status, note })),
    startedAt: r.createdAt,
    finishedAt: r.finishedAt,
  };
}
