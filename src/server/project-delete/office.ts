// Deleting a project, wired to the real office: its floors and floors.json, the pause and safe-restart
// checks (nothing happens while either is under way), sending every agent home the way 🚪 Send home does
// (worker manager kill, the worktree kept for the job's own step), the live app stopped, the toolkit pin
// book, the project id registry, the audit log, and every open page told to leave the project. One
// service per office, made on first use.

import { ROOF } from '../../shared/rooftop.js';
import { audit, human } from '../audit/index.js';
import { gh } from '../github.js';
import type { Ctx } from '../office/context.js';
import { projectRunsOf } from '../project-run/adapter.js';
import { projectIdsFor } from '../projects/ids.js';
import { safeRestartOf } from '../restart/office.js';
import { isTestPath, testModeOf } from '../testmode.js';
import { toolkitOfOffice } from '../toolkit-pin/office.js';
import { liveAppsOf } from '../liveapp/index.js';
import { resolveCommand } from '../workers/process.js';
import { ProjectDeletes } from './index.js';
import type { DeleteFloor } from './types.js';
import { analysisOf } from '../analysis/index.js';
import { flowsOf } from '../flow/index.js';
import { forgetProject } from './forget.js';

const services = new WeakMap<object, ProjectDeletes>();
/** The pages that were on a project when its floor closed, so they go Home once it's deleted. */
const wereOn = new Map<string, Set<string>>();

export function projectDeletesOf(ctx: Ctx): ProjectDeletes {
  let s = services.get(ctx.cfg);
  if (s) return s;
  const floorOf = (id: string): DeleteFloor | undefined => {
    const d = ctx.building.list().find((x) => x.id === id);
    return (
      d && {
        id: d.id,
        name: d.name,
        ...(d.repo ? { repo: d.repo } : {}),
        dir: d.dir,
        ...(d.projectId ? { projectId: d.projectId } : {}),
        local: ctx.building.isLocal(d.id),
      }
    );
  };
  s = new ProjectDeletes({
    dataDir: ctx.cfg.dataDir,
    projectsHome: () => ctx.building.projectsDir,
    floor: floorOf,
    agents: (id) => ctx.floors.get(id)?.workers.list().length ?? 0,
    blocked: (id) => {
      if (safeRestartOf(ctx).active) return 'A safe restart is under way: delete the project once the office is back';
      const run = projectRunsOf(ctx).going(id);
      if (run) return `A ${run.workflow === 'project-pause' ? 'pause' : 'resume'} of this project is under way: let it finish (or cancel it) first`;
      const floor = ctx.floors.get(id);
      if (floor && toolkitOfOffice(ctx).jobs.busyDir(floor.dir)) return 'A toolkit update is running on this project: let it finish first';
      return undefined;
    },
    stopAgents: async (id, by) => {
      const floor = ctx.floors.get(id);
      if (!floor) return 0;
      const live = liveAppsOf(ctx);
      if (live.stateOf(floor).status !== 'stopped')
        await live
          .of(floor)
          .stop(by)
          .catch(() => undefined);
      const workers = floor.workers.list();
      // Sent home as 🚪 Send home does; their worktrees stay for the job's own worktree step.
      for (const w of workers) await floor.workers.kill(w.id, 'keep').catch(() => undefined);
      // Off the building: everyone on it moves on (their pages go Home when they hear it was deleted).
      const next = [...ctx.floors.values()].find((f) => f !== floor);
      ctx.floors.delete(id);
      const here = new Set<string>();
      for (const c of ctx.clients.values()) {
        if (c.peer.floor !== id && !(c.peer.floor === ROOF && !next)) continue;
        here.add(c.id);
        if (next) ctx.goToFloor(c, next);
        else ctx.toLobby(c);
        ctx.sendTo(c, {
          t: 'toast',
          text: `🗑 ${by} is deleting ${floor.def.name}…`,
          level: 'warn',
        });
      }
      wereOn.set(id, here);
      floor.shutdown();
      ctx.floorsChanged();
      ctx.pumpQueues();
      return workers.length;
    },
    removeFloor: (id, by) => {
      const r = ctx.building.remove(id, by);
      ctx.floorsChanged();
      return typeof r === 'string' ? r : undefined;
    },
    pin: (id, remove) => {
      const book = toolkitOfOffice(ctx).svc.book;
      return remove ? book.remove(id) : book.get(id);
    },
    forget: async (f, archive) => {
      const errors = await forgetProject(f, archive, { runs: analysisOf(ctx).store, flows: flowsOf(ctx) });
      for (const err of errors) console.error(`agent-office: letting go of ${f.id}: ${err}`);
    },
    retire: (f, by) => {
      const ids = projectIdsFor(ctx.cfg.dataDir);
      const pid = f.projectId ?? ids.byFloorId(f.id);
      if (pid) ids.retire(pid, by, f.name);
    },
    audit: (f, by, job) =>
      audit.record({
        floor: f.id,
        actor: human(by.name, by.id),
        action: 'project.delete',
        target: { kind: 'project', id: f.projectId ?? f.id, label: f.name },
        summary: job.mode === 'remove' ? `Removed ${f.name} from the office (folder and repository kept)` : `Deleted ${f.name}${job.deleteFolder ? ', its local folder' : ''}${job.deleteRepo ? ', its GitHub repository' : ''}`,
        details: {
          mode: job.mode,
          repo: f.repo,
          dir: f.dir,
          deleteFolder: job.deleteFolder,
          deleteRepo: job.deleteRepo,
          archive: job.archiveDir,
          steps: job.steps.map((s) => `${s.id}: ${s.status}${s.detail ? ` (${s.detail})` : ''}`),
        },
        severity: 'warning',
      }),
    announce: (f, by) => {
      const here = wereOn.get(f.id);
      wereOn.delete(f.id);
      for (const c of ctx.clients.values())
        ctx.sendTo(c, {
          t: 'project.deleted',
          floor: f.id,
          name: f.name,
          by,
          ...(here?.has(c.id) ? { wasHere: true } : {}),
        });
      ctx.floorsChanged();
    },
    gh: (args) => gh(args, ctx.cfg.dataDir, 60_000),
    testMode: () => testModeOf().on,
    ghIsFake: () => {
      const p = resolveCommand('gh');
      return !!p && (isTestPath(p) || /fake/i.test(p));
    },
    now: () => Date.now(),
  });
  services.set(ctx.cfg, s);
  return s;
}
