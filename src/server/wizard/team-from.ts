// Start from a team at setup (ProjectPlan.teamFrom, shared/team-from.ts). The shape, the roles and the budget
// level were copied into the plan by the page; here the team step sets them in the same order the plain step
// does (shape, then the level's models and settings), then each copied role's model on top, then brings the
// ticked agents through the profiles' own hire (server/profiles/moves.ts: a free profile hired at once, one on
// another project moved after its handoff there, which the person confirmed before setup started), and only
// then runs the plain team step, which hires every other role as before. The settings step records the
// source in agent-office.project.json (its name only when it can't reveal another client's project).
// Safe across a restart: a seat a move holds or has filled is never hired again (the durable MoveOp records).
// A plan without a team source runs both steps exactly as before.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_ROLES, type ProjectRole, type StepId } from '../../shared/wizard.js';
import { shapeForRoles } from '../../shared/roster/coverage.js';
import type { StepImpl } from './job.js';
import { discoveryTask } from './local-only.js';
import { discoveryRole, handsDiscoveryToAnalyst, PROJECT_FILE, type SetupDeps } from './steps.js';

export interface ProfileHireAsk {
  floor: string;
  role: ProjectRole;
  profile: string;
  by: string;
  account?: string;
  task?: string;
  model?: string;
  /** The person confirmed the Move list before setup started. */
  move: boolean;
}

/** What the team step needs of agent profiles and the roster beyond SetupDeps (the office's: team-from-office.ts). */
export interface TeamFromDeps {
  /** A role's model from its next hire (the roster's own setter); why not, if it couldn't. */
  setRoleModel?(floor: string, role: ProjectRole, model: string, by: string): string | undefined;
  /** Hires a profile on a seat through the profiles' Moves; `pending` when it joins after a handoff elsewhere. */
  hireProfile?(ask: ProfileHireAsk): Promise<{ error?: string; pending?: string }>;
  /** Why the seat isn't to be hired now: an open profile move holds it (on its way, or failed and waiting). */
  seatReserved?(floor: string, role: ProjectRole): string | undefined;
  /** A finished move put this profile on this seat already. */
  movedIn?(floor: string, role: ProjectRole, profile: string): boolean;
}

const label = (r: ProjectRole) => PROJECT_ROLES.find((p) => p.id === r)?.label ?? r;

export function withTeamFrom(deps: SetupDeps & TeamFromDeps, steps: Record<StepId, StepImpl>): Record<StepId, StepImpl> {
  const { team, settings } = steps;
  const hired = deps.hired;
  // A seat an agent's move holds counts as taken, so the plain step never hires over it (or fails on it).
  // The plain step reads deps.hired at each call, so it sees this too (with or without a team source).
  deps.hired = (floor, role) => hired(floor, role) || !!deps.seatReserved?.(floor, role);
  return {
    ...steps,

    async settings(job, io) {
      const r = await settings(job, io);
      const t = job.plan.teamFrom;
      if (!t || !job.dir) return r;
      const f = path.join(job.dir, PROJECT_FILE);
      let saved: Record<string, unknown>;
      try {
        saved = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
      } catch {
        return r;
      }
      // Committed with the project: another client's project name never goes into this one's files.
      const record = { ...(t.confidential ? { client: 'another client' } : { project: t.project }), copied: ['shape', 'roles', 'models', 'budget level'], ...(t.agents?.length ? { agents: t.agents.length } : {}) };
      if (JSON.stringify(saved.teamFrom) === JSON.stringify(record)) return r;
      writeFileSync(f, `${JSON.stringify({ ...saved, teamFrom: record }, null, 2)}\n`);
      return { status: 'done', detail: `${r.detail ? `${r.detail} · ` : ''}team set up from ${t.confidential ? 'another client’s project' : t.project}` };
    },

    async team(job, io) {
      const t = job.plan.teamFrom;
      if (!t || job.addRoles || !job.floor) return team(job, io);
      const floor = job.floor;
      // The order of the plain step: the shape, then the level's models and settings…
      deps.setShape?.(floor, job.plan.shape ?? shapeForRoles(job.plan.roles), job.by);
      if (job.plan.budget && deps.applyBudget && !job.budgetApplied) {
        const problems = deps.applyBudget(floor, job.plan.budget, job.by);
        io.log(`  budget: ${job.plan.budget.level}, $${job.plan.budget.total}${problems.length ? ` (${problems.join('; ')})` : ''}`);
        job.budgetApplied = true;
      }
      // …then each copied role's model on top (the level sets the Leads' alike; the source may have changed some).
      const models = Object.entries(t.models).filter(([r]) => job.plan.roles.includes(r as ProjectRole)) as [ProjectRole, string][];
      for (const [role, model] of models) {
        const err = deps.setRoleModel?.(floor, role, model, job.by);
        if (err) io.log(`  couldn't set the ${label(role)}'s model to ${model}: ${err}`);
      }
      io.log(`  team set up from ${t.project}${models.length ? `: ${models.map(([r, m]) => `${label(r)} on ${m}`).join(', ')}` : ''}`);
      const brought: string[] = [];
      if (t.agents?.length && !deps.cfg.offlineDir && deps.hireProfile) {
        const handOff = handsDiscoveryToAnalyst(job);
        for (const a of t.agents) {
          if (!job.plan.roles.includes(a.role)) continue;
          // Already there, on its way, or there before a restart: never hired twice.
          if (hired(floor, a.role) || deps.movedIn?.(floor, a.role, a.profile)) continue;
          const held = deps.seatReserved?.(floor, a.role);
          if (held) {
            brought.push(`${a.name}: ${held}`);
            continue;
          }
          const task = handOff && a.role === discoveryRole(job) ? discoveryTask(job)?.prompt : undefined;
          io.log(`  bringing ${a.name} as the ${label(a.role)}${task ? ', with Discovery' : ''}…`);
          const r = await deps.hireProfile({ floor, role: a.role, profile: a.profile, by: job.by, account: job.account, task, model: task ? job.plan.discovery.model : undefined, move: !!t.moveConfirmed });
          if (r.error) throw new Error(`Couldn't bring ${a.name} as the ${label(a.role)}: ${r.error}${brought.length ? ` (brought so far: ${brought.join('; ')})` : ''}`);
          if (task) job.discoveryHired = true;
          brought.push(r.pending ? `${a.name} (${r.pending})` : a.name);
        }
      }
      const rest = await team(job, io);
      if (!brought.length) return rest;
      return { status: 'done', detail: `brought ${brought.join(', ')}${rest.detail ? ` · ${rest.detail}` : ''}` };
    },
  };
}
