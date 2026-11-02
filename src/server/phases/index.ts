// Phased delivery in the office (shared/phases/, docs/site/using-the-office/phased-delivery.md): the one
// PhasesService (phasesOf), wired to the office's audit log, the pages ("roster.changed" makes them look
// again), a toast and the team lead's durable tell; and the Roadmap's view (viewOf), put together from the plan
// and what the office read (./inputs.ts), which also lets the office move a phase on when its exit criteria
// are met (service.tick). A project without a plan file is untouched: viewOf says "one-go" and nothing more.

import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { audit, agent, human, office } from '../audit/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { budgetOf } from '../budget/index.js';
import { currentStage } from '../budget/stage.js';
import { localDay } from '../budget/service.js';
import { securityOf } from '../security-gate/index.js';
import { dataImpactOf } from '../data-impact/index.js';
import { binds } from '../../shared/data-impact.js';
import { ROLES } from '../../shared/roster/roles.js';
import { buildView, type PhasesView } from '../../shared/phases/view.js';
import { exitOf, type ExitInputs } from '../../shared/phases/derive.js';
import { isPhased } from '../../shared/phases/plan.js';
import type { PhaseExit, Who } from '../../shared/phases/types.js';
import { PhaseStore } from './store.js';
import { PhasesService } from './service.js';
import { readRepo, resultsOnMain } from './inputs.js';

const offices = new WeakMap<object, PhasesService>();

const actorOf = (w: Who) => (w.kind === 'agent' ? agent(w.name) : w.kind === 'pm' ? human(w.name) : office(w.name));

export function phasesOf(ctx: Ctx): PhasesService {
  let s = offices.get(ctx.cfg);
  if (s) return s;
  s = new PhasesService({
    store: new PhaseStore(ctx.cfg.dataDir),
    now: Date.now,
    record: (floorId, by, action, summary, details) => audit.record({ floor: floorId, actor: actorOf(by), action, target: { kind: 'phases', id: floorId, label: 'Phases' }, summary, ...(details ? { details } : {}), severity: 'notice' }),
    changed: (floorId) => {
      const floor = ctx.floors.get(floorId);
      if (floor) ctx.toFloor(floor, { t: 'roster.changed', floor: floorId });
    },
    toast: (floorId, text) => ctx.toastFloor(ctx.floors.get(floorId), text),
    tellLead: async (floorId, text, by) => {
      const floor = ctx.floors.get(floorId);
      if (!floor) return 'The project is gone';
      try {
        return await rosterOf(ctx).interrupts.tell(teamFloor(ctx, floor), text, by.kind === 'pm' ? by.name : 'The office', 'after', {}, undefined, `tell:phases-${Date.now().toString(36)}`);
      } catch (err) {
        return (err as Error).message;
      }
    },
  });
  offices.set(ctx.cfg, s);
  return s;
}

const ROLE_TEAM = new Map<string, string>(ROLES.map((r) => [r.title, r.team]));

/** The exit inputs at main: results on main, the newest mx check on main, open data-impact holds. */
async function exitInputs(ctx: Ctx, floor: Floor, history: readonly string[], main: string | undefined, journeyIds: string[]): Promise<ExitInputs> {
  const journeyResults = await resultsOnMain(ctx.cfg.dataDir, floor.id, history, journeyIds);
  let modelCheck: ExitInputs['modelCheck'];
  try {
    const checks = (await securityOf(ctx).d.store.get(floor.id)).checks;
    const rank = (c: string) => history.findIndex((h) => h === c || h.startsWith(c));
    const onMain = checks.filter((c) => rank(c.commit) >= 0).sort((a, b) => rank(a.commit) - rank(b.commit));
    const c = onMain[0];
    if (c) modelCheck = { status: c.status, ...(c.errors !== undefined ? { errors: c.errors } : {}), commit: c.commit };
  } catch {
    // no security record: "not run"
  }
  let openDataImpacts = 0;
  try {
    const rec = dataImpactOf(ctx).guard.store.get(floor.id);
    openDataImpacts = Object.values(rec.holds).filter((h) => !rec.approvals.some((a) => !a.void && binds(a, h))).length;
  } catch {
    // no guard record: none open
  }
  return { ...(main ? { commit: main } : {}), journeyResults, ...(modelCheck ? { modelCheck } : {}), openDataImpacts };
}

/** The Roadmap's view of a project; the office moves phases whose exit criteria are met on the way. */
export async function viewOf(ctx: Ctx, floor: Floor, accountId: string | undefined): Promise<PhasesView> {
  const s = phasesOf(ctx);
  const admin = ctx.meOf(accountId).admin;
  let plan = s.plan(floor.id);
  const pulls = floor.github?.pulls.items ?? [];
  const repo = await readRepo(floor.dir, pulls);
  const ids = plan.phases.flatMap((p) => p.journeys);
  const exit = await exitInputs(ctx, floor, repo.history, repo.main?.sha, ids);
  if (isPhased(plan) && plan.state === 'approved') {
    const now = Date.now();
    const exits = new Map<string, PhaseExit>(plan.phases.map((p) => [p.id, exitOf(p, exit, now)]));
    if (s.tick(floor.id, exits).length) plan = s.plan(floor.id);
  }
  const b = budgetOf(ctx);
  const ref = b.floorRef(floor.id);
  const file = ref ? b.file(ref) : undefined;
  const ledger = file?.ledger;
  const firstNote = ledger?.stages[0]?.at;
  return buildView({
    floor: floor.id,
    admin,
    now: Date.now(),
    plan,
    planRows: repo.planRows,
    planPhases: repo.planPhases,
    done: new Set(repo.done),
    journeys: repo.journeys,
    exit,
    spend: { rows: ledger?.rows ?? [], days: ledger?.days ?? {}, agents: ledger?.agents ?? {}, teamOf: (role) => ROLE_TEAM.get(role), dayOf: localDay },
    merges: repo.merges,
    ...(file?.settings.total ? { budget: { total: file.settings.total, autoPause: file.settings.autoPause } } : {}),
    stage: currentStage(floor.dir),
    ...(firstNote ? { discoveryFrom: firstNote } : {}),
  });
}
