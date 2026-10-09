// The office's toolkit service and its Update toolkit jobs, made on first use (or at start, timers.ts),
// wired to the office: gate-check and sync-project.sh run the wizard's way (Git Bash, the floor's
// toolkit.env), the mid-stage warning from the setup panel's view, and after a move the setup panel
// re-checked, the hired team's Playbooks written again (they name the toolkit folder) and the audit log told.

import path from 'node:path';
import { ROLES } from '../../shared/roster/roles.js';
import { short, type ToolkitJobView } from '../../shared/toolkit.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { audit, human } from '../audit/index.js';
import { toolkitDir } from '../connections/store.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { wizardOf } from '../wizard/index.js';
import { useJobsBusy } from './index.js';
import { ToolkitJobs } from './jobs.js';
import { FETCH_EVERY_MS, ToolkitService, type PinFloor } from './service.js';

export interface OfficeToolkit {
  svc: ToolkitService;
  jobs: ToolkitJobs;
}

const offices = new WeakMap<object, OfficeToolkit>();

export const pinFloor = (f: Floor): PinFloor => ({ id: f.id, dir: f.dir, name: f.def.name });

export function toolkitOfOffice(ctx: Ctx): OfficeToolkit {
  let t = offices.get(ctx.cfg);
  if (t) return t;
  const svc = new ToolkitService({ root: () => toolkitDir(), bookFile: path.join(ctx.cfg.dataDir, 'toolkit-pins.json') });
  const jobs = new ToolkitJobs(svc, {
    gateCheck: (tk, dir, floorDir) => wizardOf(ctx).gateCheckWith(tk, dir, floorDir, 6 * 60_000).then((r) => r.stdout),
    sync: (tk, dir, floorDir, log) => wizardOf(ctx).syncWith(tk, dir, floorDir, log),
    current: async (pf) => {
      const floor = ctx.floors.get(pf.id);
      if (!floor) return undefined;
      const v = await wizardOf(ctx).setup(floor);
      const settled = (s: string) => s === 'PASS' || s === 'WAIVED';
      return (v.verdicts?.length ? v.verdicts : v.stages).find((s) => !settled(s.status));
    },
    moved: (pf, job, by) => moved(ctx, pf, job, by),
  });
  useJobsBusy((dir) => jobs.busyDir(dir));
  t = { svc, jobs };
  offices.set(ctx.cfg, t);
  return t;
}

function moved(ctx: Ctx, pf: PinFloor, job: ToolkitJobView, by: { name: string; id?: string }) {
  const floor = ctx.floors.get(pf.id);
  const verb = job.action === 'rollback' ? 'rolled the toolkit back to' : job.action === 'pin' ? 'pinned the toolkit at' : 'updated the toolkit to';
  audit.record({
    floor: pf.id,
    actor: human(by.name, by.id),
    action: `toolkit.${job.action}`,
    target: { kind: 'toolkit', id: job.to, label: `toolkit ${short(job.to)}` },
    summary: `${by.name} ${verb} ${short(job.to)}${job.from ? ` (from ${short(job.from)})` : ''} on ${pf.name}; ${job.commit ? `commit ${short(job.commit)} pushed to ${job.pushed}` : 'nothing committed'}`,
    details: { before: { commit: job.from }, after: { commit: job.to }, projectCommit: job.commit, pushed: job.pushed, changes: job.changes?.map((c) => `${c.id}: ${c.before ?? '-'} → ${c.after ?? '-'}`) },
    severity: 'warning',
  });
  if (!floor) return;
  const w = wizardOf(ctx);
  w.recheck(floor);
  try {
    const roster = rosterOf(ctx);
    const tf = teamFloor(ctx, floor);
    for (const r of ROLES) roster.members.rewrite(tf, r.id);
  } catch (err) {
    console.warn(`agent-office: rewriting the Playbooks after the toolkit moved: ${(err as Error).message}`);
  }
  ctx.toastAll(`🧰 ${pf.name}: toolkit ${job.action === 'rollback' ? 'rolled back to' : job.action === 'pin' ? 'pinned at' : 'updated to'} ${short(job.to)}`);
}

/** At start: the book loaded (so Playbooks name the pins), and the fork fetched when the last fetch is over six hours old, then every six hours. */
export function startToolkitPins(ctx: Ctx): () => void {
  const { svc } = toolkitOfOffice(ctx);
  const first = setTimeout(() => void svc.fetch(), 2 * 60_000);
  const every = setInterval(() => void svc.fetch(), FETCH_EVERY_MS);
  first.unref?.();
  every.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
