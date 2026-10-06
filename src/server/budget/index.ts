// The office's Budget (see service.ts): made the first time something asks for it (budgetOf), with the
// real floors, the project team's roles, the queue's issues, the toolkit stage and the office's Ledger
// behind it. It hears the office's background calls from the meter (meter.ts) from then on.

import type { Ctx } from '../office/context.js';
import { ROLE_BY_ID, ROLES } from '../../shared/roster/roles.js';
import { analysisOf } from '../analysis/index.js';
import { rosterOf } from '../roster/adapter.js';
import { onBackgroundSpend } from './meter.js';
import { BudgetService } from './service.js';
import { currentStage } from './stage.js';

const offices = new WeakMap<object, BudgetService>();

export function budgetOf(ctx: Ctx): BudgetService {
  let b = offices.get(ctx.cfg);
  if (b) return b;
  const roleOf = (floorId: string, workerId: string, name: string): string | undefined => {
    try {
      const members = rosterOf(ctx).data(floorId).members;
      const role = ROLES.find((r) => members[r.id]?.workerId === workerId) ?? ROLES.find((r) => members[r.id]?.name === name);
      return role ? ROLE_BY_ID.get(role.id)?.title : undefined;
    } catch {
      return undefined;
    }
  };
  b = new BudgetService({
    dataDir: ctx.cfg.dataDir,
    now: () => Date.now(),
    floors: () => [...ctx.floors.values()].map((f) => ({ id: f.id, name: f.def.name, dir: f.dir })),
    workers: (id) => ctx.floors.get(id)?.workers?.list() ?? [],
    floorOfWorker: (id) => ctx.workerFloor(id)?.id,
    roleOf,
    taskIssue: (floorId, workerId) => ctx.floors.get(floorId)?.queue?.state().tasks.find((t) => t.workerId === workerId)?.issue,
    stageOf: currentStage,
    officeLedger: ctx.ledger,
    runs: () => {
      try {
        return analysisOf(ctx).store.all();
      } catch {
        return [];
      }
    },
  });
  offices.set(ctx.cfg, b);
  const budget = b;
  onBackgroundSpend((s) => budget.onBackground(s));
  process.once('exit', () => budget.flush());
  return b;
}
