// Unfinished new-project setups, wired to the real office (shared/setup-cancel.ts): the cards Home and
// the wizard's first page show, what would stop each one's Retry right now (blockers.ts, from the pause,
// the safe restart and Studio mode), and Cancel & undo (cancel.ts) on top of Delete project's service.
// One per office, made on first use.

import path from 'node:path';
import { SETUP_STEPS } from '../../shared/wizard.js';
import type { SetupBlocker, UnfinishedSetup } from '../../shared/setup-cancel.js';
import { audit, human } from '../audit/index.js';
import { gh } from '../github.js';
import type { Ctx } from '../office/context.js';
import { projectRunsOf } from '../project-run/adapter.js';
import { projectPause } from '../project-run/store.js';
import { projectDeletesOf } from '../project-delete/office.js';
import { safeRestartOf } from '../restart/office.js';
import { busyAgents, studioStateOf } from '../studio/index.js';
import { testModeOf } from '../testmode.js';
import { ghIsFake } from '../project-delete/fakegh.js';
import { setupBlocker } from './blockers.js';
import { SetupCancels } from './cancel.js';
import type { JobState } from './job.js';
import type { Wizard } from './index.js';

const finished = (s: string | undefined) => s === 'done' || s === 'skipped';

/** What would stop the setup's Retry now, or undefined. */
export function blockerOf(ctx: Ctx, job: JobState): SetupBlocker | undefined {
  const floor = job.floor;
  const run = floor ? projectRunsOf(ctx).going(floor) : undefined;
  const pause = floor ? projectPause(floor) : undefined;
  return setupBlocker(job, {
    restart: safeRestartOf(ctx).active,
    ...(pause ? { pause: { why: pause.why, by: pause.by } } : {}),
    ...(run ? { run: run.workflow === 'project-pause' ? 'pause' : 'resume' } : {}),
    studioOpen: !!floor && !!studioStateOf(floor)?.open,
  });
}

const cancels = new WeakMap<object, SetupCancels>();

/** The office's Cancel & undo service. */
export function setupCancelsOf(ctx: Ctx, wizard: Wizard): SetupCancels {
  let s = cancels.get(ctx.cfg);
  if (s) return s;
  const deletes = projectDeletesOf(ctx);
  s = new SetupCancels({
    dataDir: ctx.cfg.dataDir,
    projectsHome: () => ctx.building.projectsDir,
    setup: (id) => wizard.book.get(id),
    running: (id) => wizard.book.isRunning(id),
    removeSetup: (id) => wizard.book.remove(id),
    defaultDir: (owner, name) => path.join(ctx.building.projectsDir, owner, name),
    hasFloor: (id) => ctx.building.list().some((d) => d.id === id),
    busyAgents: (id) => {
      const f = ctx.floors.get(id);
      return f ? busyAgents(f) : [];
    },
    blocked: (floor) => {
      if (safeRestartOf(ctx).active) return 'A safe restart is under way: cancel the setup once the office is back';
      const run = floor ? projectRunsOf(ctx).going(floor) : undefined;
      if (run) return `A ${run.workflow === 'project-pause' ? 'pause' : 'resume'} of this project is under way: let it finish (or cancel it) first`;
      return undefined;
    },
    studioOpen: (id) => !!studioStateOf(id)?.open,
    deletes,
    gh: (args) => gh(args, ctx.cfg.dataDir, 60_000),
    testMode: () => testModeOf().on,
    // What execFile('gh') really starts, never a .cmd shim a PATHEXT lookup finds (fakegh.ts).
    ghIsFake: () => ghIsFake(),
    audit: (setup, by, job) =>
      audit.record({
        ...(setup.floor ? { floor: setup.floor } : {}),
        actor: human(by.name, by.id),
        action: 'project.setup-cancel',
        target: { kind: 'project', id: setup.repo, label: setup.name },
        summary: `Cancelled the setup of ${setup.repo} and undid it${job.deleteFolder ? ', deleting its local folder' : ''}${job.deleteRepo ? ', deleting its GitHub repository' : ''}`,
        details: { repo: setup.repo, dir: setup.dir, floor: setup.floor, deleteFolder: job.deleteFolder, deleteRepo: job.deleteRepo, steps: job.steps.map((x) => `${x.id}: ${x.status}${x.detail ? ` (${x.detail})` : ''}`) },
        severity: 'warning',
      }),
    now: () => Date.now(),
  });
  cancels.set(ctx.cfg, s);
  return s;
}

/** The cards: every setup that isn't done (or a Cancel & undo of one that stopped part way), newest first. */
export async function unfinishedSetups(ctx: Ctx, wizard: Wizard): Promise<UnfinishedSetup[]> {
  const svc = setupCancelsOf(ctx, wizard);
  const stopped = new Map((await svc.unfinished()).map((c) => [c.id, c]));
  const out: UnfinishedSetup[] = [];
  for (const job of wizard.book.all()) {
    if (job.status === 'done') continue;
    const running = wizard.book.isRunning(job.id);
    const at = SETUP_STEPS.find((s) => job.steps[s.id]?.status === 'failed') ?? SETUP_STEPS.find((s) => !finished(job.steps[s.id]?.status));
    const cancel = stopped.get(job.id);
    stopped.delete(job.id);
    const floor = job.floor && ctx.building.list().some((d) => d.id === job.floor) ? job.floor : undefined;
    const blocker = running ? undefined : blockerOf(ctx, job);
    out.push({
      id: job.id,
      repo: `${job.plan.owner}/${job.plan.name}`,
      name: job.plan.name,
      status: cancel ? 'cancelling' : running ? 'running' : job.status === 'failed' ? 'failed' : 'idle',
      ...(at ? { step: at.label } : {}),
      ...(at && job.steps[at.id]?.status === 'failed' && job.steps[at.id].detail ? { error: job.steps[at.id].detail } : {}),
      done: SETUP_STEPS.filter((s) => finished(job.steps[s.id]?.status)).length,
      total: SETUP_STEPS.length,
      ...(floor ? { floor } : {}),
      by: job.by,
      updatedAt: job.updatedAt,
      ...(blocker ? { blocker } : {}),
      ...(cancel ? { cancel } : {}),
    });
  }
  // A cancel that stopped after the setup's own record went (with the project's office data).
  for (const c of stopped.values()) {
    out.push({ id: c.id, repo: c.repo, name: c.repo.split('/')[1] ?? c.repo, status: 'cancelling', step: c.steps.find((s) => s.status === 'failed')?.label, error: c.error, done: 0, total: SETUP_STEPS.length, by: c.by, updatedAt: c.finishedAt ?? c.startedAt, cancel: c });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
