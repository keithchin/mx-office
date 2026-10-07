// The office's Budget (see service.ts and control.ts): made the first time something asks for it
// (budgetOf), with the real floors, the project team's roles, the queue's issues, the toolkit stage and
// the office's Ledger behind it. It hears the office's background calls from the meter (meter.ts), checks
// the alerts after spend, puts a budget pause back after a restart, and applies a budget level to the team.

import type { Ctx } from '../office/context.js';
import type { BudgetAlert, LevelId } from '../../shared/budget/types.js';
import { LEADS, ROLE_BY_ID, ROLES } from '../../shared/roster/roles.js';
import { subagentModelAt, type BudgetChoice, type LevelSettings } from '../../shared/budget/levels.js';
import { analysisOf } from '../analysis/index.js';
import { audit, byWhom } from '../audit/index.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { checkFloor, type ControlDeps } from './control.js';
import { onBackgroundSpend } from './meter.js';
import { BudgetService } from './service.js';
import { currentStage } from './stage.js';
import { rankingReport } from '../ranking/index.js';
import { covers, subagentDefsOf } from '../../shared/roster/coverage.js';

const offices = new WeakMap<object, BudgetService>();

/** A level's parallelism as the Leads' Playbooks say it: at most this many subagents at once. */
export const SUBAGENTS_AT_ONCE = { fewer: 1, normal: 2, more: 4 } as const;
const controls = new WeakMap<BudgetService, ControlDeps>();

/** How often at most a floor's alerts are checked after spend. */
const CHECK_MS = 5_000;

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
    team: (floorId) => {
      try {
        const s = rosterOf(ctx).data(floorId).settings;
        return { idleMinutes: s.idleMinutes, jeffWaiting: s.jeff.waiting, earlyDrafts: s.earlyDrafts };
      } catch {
        return undefined;
      }
    },
    efficiency: (floorId) => efficiencyOf(ctx, floorId),
    runs: () => {
      try {
        return analysisOf(ctx).store.all();
      } catch {
        return [];
      }
    },
  });
  const budget = b;
  const deps: ControlDeps = {
    alert: (floorId, a: BudgetAlert, paused) => {
      const floor = ctx.floors.get(floorId);
      const text = paused ? `${a.text}: project paused (no new hires, no office prompts). Raise the budget or resume it on the 💰 Budget tab` : a.text;
      audit.record({ floor: floorId, actor: { kind: 'office', name: 'The budget' }, action: 'budget.alert', target: { kind: 'budget', id: floorId, label: 'Budget' }, summary: text, details: { level: a.level, budget: a.budget, paused }, severity: a.level === 'threshold' ? 'notice' : 'warning' });
      if (floor) {
        ctx.toastFloor(floor, `💸 ${text}`, 'warn');
        // The Needs-you strips and the Team phone look again; reaching 100 % is a desktop notification too.
        ctx.toFloor(floor, { t: 'roster.changed', floor: floorId, ...(a.level === 'full' ? { alert: { id: `budget-${floorId}-${a.at}`, urgency: 'urgent' as const, title: paused ? 'Budget reached: project paused' : 'Budget reached', body: text } } : {}) });
      }
    },
    record: (floorId, by, action, summary, details) => audit.record({ floor: floorId, actor: byWhom(by), action, target: { kind: 'budget', id: floorId, label: 'Budget' }, summary, ...(details ? { details } : {}), severity: 'notice' }),
  };
  controls.set(b, deps);
  const last = new Map<string, number>();
  const timers = new Map<string, NodeJS.Timeout>();
  b.onSpend = (floor) => {
    const run = () => {
      last.set(floor.id, Date.now());
      timers.delete(floor.id);
      try {
        checkFloor(budget, floor, deps);
      } catch (err) {
        console.error(`agent-office: budget check on ${floor.id}: ${(err as Error).message}`);
      }
    };
    const wait = CHECK_MS - (Date.now() - (last.get(floor.id) ?? 0));
    if (wait <= 0) run();
    else if (!timers.has(floor.id)) timers.set(floor.id, setTimeout(run, wait).unref());
  };
  offices.set(ctx.cfg, b);
  onBackgroundSpend((s) => budget.onBackground(s));
  process.once('exit', () => budget.flush());
  return b;
}

const effCache = new Map<string, { at: number; v: Record<string, number> }>();
/** How long a floor's token-efficiency scores are kept before the ranking is asked again. */
const EFF_TTL_MS = 10 * 60_000;

/** The worker ranking's token-efficiency score by worker id, for the insights (cached: the ranking is built from everything). */
function efficiencyOf(ctx: Ctx, floorId: string): Record<string, number> {
  const hit = effCache.get(floorId);
  if (hit && Date.now() - hit.at < EFF_TTL_MS) return hit.v;
  const v: Record<string, number> = {};
  try {
    for (const w of rankingReport(ctx, floorId).workers) {
      const s = w.standard.find((c) => c.key === 'efficiency')?.score;
      if (s !== undefined) for (const id of w.workerIds) v[id] = s;
    }
  } catch {
    // no ranking yet: the insights go without it
  }
  effCache.set(floorId, { at: Date.now(), v });
  return v;
}

/** A floor's budget level when it has a budget (the Team tab's "Solo · Lean" chip); nothing is made for a floor without one. */
export function levelOf(ctx: Ctx, floorId: string): LevelId | undefined {
  const b = budgetOf(ctx);
  return b.store.has(floorId) ? b.store.floor(floorId).settings.level : undefined;
}

/** The control's office hooks (audit log, toasts) for the routes. */
export const controlOf = (ctx: Ctx): ControlDeps => controls.get(budgetOf(ctx))!;

/**
 * Applies a budget level's choices to a floor's team, from the next hire or Playbook rewrite: the Leads'
 * model, their subagents' models, early drafts and autonomy by stage. A running session keeps the model
 * it started on, and a Lead only hears about a subagent change between turns (roster/subagents.ts).
 */
export function applyLevelToTeam(ctx: Ctx, floorId: string, s: LevelSettings, by: string): string[] {
  const floor = ctx.floors.get(floorId);
  if (!floor) return ['the floor is gone'];
  const roster = rosterOf(ctx);
  const tf = teamFloor(ctx, floor);
  const problems: string[] = [];
  const coverage = roster.data(floorId).coverage;
  // The Leads on this shape's team (all four on an Enterprise team), with the subagents of every team each covers.
  for (const lead of LEADS.filter((l) => covers(coverage, l.id))) {
    const err = roster.members.setModel(tf, lead.id, s.leadModel, by);
    if (err) problems.push(`${lead.title}: ${err}`);
    for (const sub of subagentDefsOf(coverage, lead.id)) {
      const model = subagentModelAt(s, sub.id, sub.model);
      const rec = roster.data(floorId).subagents[`${lead.id}/${sub.id}`];
      if ((rec?.model ?? sub.model) === model) continue;
      const e = roster.subagents.run(tf, lead.id, 'swap-model', sub.id, { model }, by, 'office');
      if (e) problems.push(`${sub.title}: ${e}`);
    }
  }
  const err = roster.members.settings(tf, { earlyDrafts: s.earlyDrafts, autonomyByStage: s.autonomyByStage, maxSubagents: SUBAGENTS_AT_ONCE[s.parallel] }, by);
  if (err) problems.push(err);
  return problems;
}

/** Saves a level choice as the floor's budget settings and applies it to the team. */
export function applyChoice(ctx: Ctx, floorId: string, c: BudgetChoice, by: string): string[] {
  const b = budgetOf(ctx);
  const floor = b.floorRef(floorId);
  if (!floor) return ['the floor is gone'];
  const f = b.file(floor);
  const was = { ...f.settings };
  f.settings = { ...f.settings, total: c.total, threshold: c.threshold, autoPause: c.autoPause, level: c.level, updatedBy: by, updatedAt: Date.now() };
  if (c.total > (was.total ?? 0)) f.alerts = f.alerts.filter((a) => a.budget >= c.total);
  b.store.changed(floorId);
  controlOf(ctx).record(floorId, by, 'budget.level', `Set ${floor.name}'s budget level to ${c.level} with a $${c.total} budget (alert at ${c.threshold} %, auto-pause ${c.autoPause ? 'on' : 'off'})`, { before: { total: was.total, level: was.level }, after: { total: c.total, level: c.level, settings: c.settings } });
  return applyLevelToTeam(ctx, floorId, c.settings, by);
}
