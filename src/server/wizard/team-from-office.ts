// Start from a team's office side (shared/team-from.ts, ./team-from.ts): the projects whose team can be copied
// (GET /api/team-sources: every project that has had a team member, with its client, shape, roles, models,
// budget level and agents), the same list as cleanPlan's check, the audit line when a setup starts from one,
// and the team step's hooks over agent profiles (server/profiles/) and the roster. Built from a ProfileService
// and a Roster (teamFromDepsOf, sourcesOf), so the tests drive the real path over fake floors.

import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { levelOf } from '../budget/index.js';
import { portfoliosOf } from '../portfolios/index.js';
import { profilesOf } from '../profiles/index.js';
import type { ProfileService } from '../profiles/service.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import type { Roster } from '../roster/index.js';
import { everHired } from '../roster/store.js';
import type { TeamFloor } from '../roster/types.js';
import type { LevelId } from '../../shared/budget/types.js';
import { freshName, isOpenMove, seatKey } from '../../shared/profiles.js';
import { PROJECT_ROLES, type ProjectPlan, type ProjectRole } from '../../shared/wizard.js';
import type { KnownSource, SourceAgent, TeamSource } from '../../shared/team-from.js';
import type { TeamFromDeps } from './team-from.js';

export interface SourceFacts {
  svc: ProfileService;
  roster: () => Roster;
  floors: () => TeamFloor[];
  level?(floor: string): LevelId | undefined;
  /** Each project's client (portfolio), by floor id. */
  clients?(): Promise<Map<string, { id: string; label: string }>>;
}

/** Every project in the office with a team (a member hired at some point), newest roster facts. */
export async function sourcesOf(o: SourceFacts): Promise<TeamSource[]> {
  const view = await o.svc.view(false);
  const byId = new Map(view.profiles.map((p) => [p.id, p]));
  const clients = (await o.clients?.().catch(() => undefined)) ?? new Map<string, { id: string; label: string }>();
  const d = o.svc.store.data;
  const out: TeamSource[] = [];
  for (const f of o.floors()) {
    const r = o.roster().data(f.id);
    const roles = PROJECT_ROLES.map((x) => x.id).filter((role) => r.members[role] && everHired(r.members[role]));
    if (!roles.length) continue;
    const models: Partial<Record<ProjectRole, string>> = {};
    const agents: SourceAgent[] = [];
    for (const role of roles) {
      models[role] = r.members[role].model;
      // The seat's profile; else (the seat released) the profile that last held it.
      const linked = d.seats[seatKey(f.id, role)];
      const last = linked ? undefined : d.profiles.filter((p) => p.assignments.some((a) => a.floor === f.id && a.role === role)).sort((a, b) => lastStart(b, f.id, role) - lastStart(a, f.id, role))[0]?.id;
      const p = byId.get(linked ?? last ?? '');
      if (!p) continue;
      const w = p.where;
      agents.push({ role, profile: p.id, name: p.label, where: w.kind, ...(w.kind !== 'free' ? { at: { floor: w.floor, project: w.project, role: w.role } } : {}) });
    }
    const c = clients.get(f.id);
    const level = o.level?.(f.id);
    out.push({ floor: f.id, project: f.name, ...(c ? { client: c.label } : {}), shape: r.shape, roles, models, ...(level ? { level } : {}), agents });
  }
  return out.sort((a, b) => a.project.localeCompare(b.project));
}

const lastStart = (p: { assignments: { floor: string; role: string; start: number }[] }, floor: string, role: string) => Math.max(0, ...p.assignments.filter((a) => a.floor === floor && a.role === role).map((a) => a.start));

/** cleanPlan's check list: each source project's name, client and agents, as the office has them now. */
export function knownOf(sources: TeamSource[], portfolios: Map<string, { id: string; label: string }> = new Map()): Map<string, KnownSource> {
  return new Map(sources.map((s) => [s.floor, { project: s.project, ...(s.client ? { client: s.client } : {}), ...(portfolios.get(s.floor) ? { portfolio: portfolios.get(s.floor)!.id } : {}), agents: new Map(s.agents.map((a) => [a.role, { profile: a.profile, name: a.name, where: a.where }])) }]));
}

/** The team step's hooks over agent profiles and the roster. */
export function teamFromDepsOf(o: { svc: ProfileService; roster: () => Roster; floor(id: string): TeamFloor | undefined }): TeamFromDeps {
  const openTo = (floor: string, role: string) => o.svc.store.data.moves.find((m) => isOpenMove(m) && m.to.floor === floor && m.to.role === role);
  return {
    setRoleModel: (floorId, role, model, by) => {
      const f = o.floor(floorId);
      if (!f) return 'No such project';
      if (o.roster().data(floorId).members[role].model === model) return undefined;
      return o.roster().members.setModel(f, role, model, by);
    },
    seatReserved: (floorId, role) => {
      if (!o.svc.store.ready) return undefined;
      const m = openTo(floorId, role);
      if (!m) return undefined;
      const name = o.svc.store.get(m.profileId)?.displayName ?? 'An agent';
      return m.state === 'failed' ? `${name}'s move here stopped (${m.error ?? 'see Home › Agents'}): Retry or Cancel it on Home › Agents` : `${name} joins after the handoff note on ${o.svc.projectName(m.from?.floor ?? floorId)}`;
    },
    movedIn: (floorId, role, profile) => o.svc.store.data.moves.some((m) => m.state === 'done' && m.profileId === profile && m.to.floor === floorId && m.to.role === role),
    hireProfile: async (ask) => {
      await o.svc.store.load();
      const f = o.floor(ask.floor);
      if (!f) return { error: 'No such project' };
      const p = o.svc.store.get(ask.profile);
      if (!p) return { error: 'That agent isn’t in the office any more' };
      // The new project's other seats got pool names when it opened: one that has this agent's name gets a free one first.
      const d = o.roster().data(ask.floor);
      for (const r of PROJECT_ROLES) {
        const m = d.members[r.id];
        if (r.id === ask.role || !m || m.name.toLowerCase() !== p.displayName.toLowerCase() || everHired(m)) continue;
        o.roster().members.setName(f, r.id, freshName([...o.svc.store.data.profiles.map((x) => x.displayName), ...Object.values(d.members).map((x) => x.name), ...Object.values(d.subagentNames)]));
      }
      const r = await o.svc.moves.hire({ profileId: ask.profile, floor: ask.floor, role: ask.role, by: ask.by, ...(ask.account ? { owner: ask.account } : {}), ...(ask.task ? { task: ask.task } : {}), ...(ask.model ? { model: ask.model } : {}), move: ask.move });
      if (r.needsMove) return { error: `${r.error ?? 'It is on another project'}: the Move wasn’t confirmed` };
      if (r.error) return { error: r.error };
      return r.op?.state === 'source-benching' ? { pending: `joins after the handoff note on ${o.svc.projectName(r.op.from!.floor)}` } : {};
    },
  };
}

// ---- The office ------------------------------------------------------------------------------------

async function clientsOf(ctx: Ctx): Promise<Map<string, { id: string; label: string }>> {
  const list = await portfoliosOf(ctx).store.load();
  const out = new Map<string, { id: string; label: string }>();
  for (const p of list) for (const id of p.projectIds) out.set(id, { id: p.id, label: p.label });
  return out;
}

const facts = (ctx: Ctx): SourceFacts => ({
  svc: profilesOf(ctx),
  roster: () => rosterOf(ctx),
  floors: () => [...ctx.floors.values()].map((f) => teamFloor(ctx, f)),
  level: (id) => levelOf(ctx, id),
  clients: () => clientsOf(ctx),
});

export const teamSources = (ctx: Ctx) => sourcesOf(facts(ctx));

/** The check list for a plan from the page that starts from a team (undefined when it doesn't: nothing is read). */
export async function teamsFor(ctx: Ctx, raw: unknown): Promise<Map<string, KnownSource> | undefined> {
  if (!raw || typeof raw !== 'object' || !(raw as { teamFrom?: unknown }).teamFrom) return undefined;
  const [sources, clients] = await Promise.all([teamSources(ctx), clientsOf(ctx).catch(() => new Map())]);
  return knownOf(sources, clients);
}

export const officeTeamFromDeps = (ctx: Ctx): TeamFromDeps =>
  teamFromDepsOf({
    svc: profilesOf(ctx),
    roster: () => rosterOf(ctx),
    floor: (id) => {
      const f = ctx.floors.get(id);
      return f && teamFloor(ctx, f);
    },
  });

/** The audit line when a setup starts from another project's team (office-level: the new project isn't there yet). */
export function auditTeamFrom(plan: ProjectPlan, by: string, account?: string): void {
  const t = plan.teamFrom;
  if (!t) return;
  const agents = t.agents ?? [];
  audit.record({
    actor: { kind: 'human', name: by, ...(account ? { id: account } : {}) },
    action: 'wizard.team-from',
    target: { kind: 'project', id: `${plan.owner}/${plan.name}`, label: plan.name },
    summary: `Set up ${plan.name}'s team from ${t.project}: shape, roles, models and budget level copied (not the budget amount, permissions, connections or any of its work)${agents.length ? `; bringing ${agents.map((a) => a.name).join(', ')}${t.moveConfirmed ? ' (Move confirmed)' : ''}` : ''}`,
    details: { source: t.floor, project: t.project, shape: plan.shape, roles: plan.roles, models: t.models, level: t.level ?? null, agents: agents.map((a) => ({ role: a.role, profileId: a.profile })), moveConfirmed: !!t.moveConfirmed },
  });
}
