// Start from a team (docs/site/get-started/first-project.md, "Team & budget"): the New project flow copies
// the setup of a project already in the office. It copies the team's shape, which roles it has, each role's
// model and the budget level (never the amount: the new project's own estimate prices it). The same agents
// (their profiles, shared/profiles.ts) are a separate choice, and moving one that is on another project goes
// through the profiles' Move, confirmed by the person before setup starts. Nothing from the source project's
// work, permissions, connections or tokens is copied. Pure: the page, the server and the tests import it.

import type { LevelId } from './budget/types.js';
import { isProfileId } from './profiles.js';
import { SHAPES, shapeForRoles, type TeamShape } from './roster/coverage.js';
import { PROJECT_ROLES, type ProjectRole } from './wizard.js';

/** Where one of the source project's agents is now, for the list and the Move confirmation. */
export type AgentWhere = 'free' | 'working' | 'benched' | 'moving';

export interface SourceAgent {
  role: ProjectRole;
  profile: string;
  /** The profile's display name, disambiguated as the Agents page shows it. */
  name: string;
  where: AgentWhere;
  /** The project it is on (or moving to), when it is on one. */
  at?: { floor: string; project: string; role: string };
}

/** A project in the office whose team can be copied (GET /api/team-sources). */
export interface TeamSource {
  floor: string;
  project: string;
  /** Its client (portfolio) label, when it has one. */
  client?: string;
  shape: TeamShape;
  /** The roles it has had, in the wizard's order. */
  roles: ProjectRole[];
  /** Each of those roles' model as the project has it now. */
  models: Partial<Record<ProjectRole, string>>;
  /** Its budget level, when it has a budget. */
  level?: LevelId;
  agents: SourceAgent[];
}

export interface TeamSourcesView {
  sources: TeamSource[];
}

/** What a plan records about the team it started from (ProjectPlan.teamFrom). */
export interface PlanTeamFrom {
  floor: string;
  /** The source project's name when it was picked (owner-facing; never given to an agent). */
  project: string;
  client?: string;
  /** The roles' models copied (only roles still on the plan); applied after the budget level at the team step. */
  models: Partial<Record<ProjectRole, string>>;
  /** The level copied, if the source had one (Lean, Balanced, Fast). */
  level?: 'lean' | 'balanced' | 'fast';
  /** "Also bring the same agents": the profile for each of the plan's roles that has one. */
  agents?: { role: ProjectRole; profile: string; name: string }[];
  /** The person saw and confirmed the Move list (agents on another project, or benched there). */
  moveConfirmed?: boolean;
  /** Another client's project (set by the office): its name stays out of the new project's committed files. */
  confidential?: boolean;
}

/** What a copy sets on the plan. */
export interface TeamCopy {
  shape: TeamShape;
  roles: ProjectRole[];
  /** The roles don't make one of the three shapes exactly: the plan picks them by hand (Customize). */
  customTeam: boolean;
  level?: 'lean' | 'balanced' | 'fast';
  models: Partial<Record<ProjectRole, string>>;
}

/** Said under the copied summary: what Start from a team never copies. */
export const NOT_COPIED: readonly string[] = [
  'Permission settings: this project starts on its own defaults (review them under Advanced)',
  'Connections and tokens',
  'The budget amount: this project’s own estimate prices the level',
  'Anything from that project’s work: transcripts, handoffs, journals, documents, the brief and lessons',
];

export const COPY_HONESTY = 'This copies a setup only. It doesn’t make the new team work better or faster.';

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,63}$/;
const isLevel = (v: unknown): v is 'lean' | 'balanced' | 'fast' => v === 'lean' || v === 'balanced' || v === 'fast';
const roleOf = (v: unknown): ProjectRole | undefined => (PROJECT_ROLES.some((r) => r.id === v) ? (v as ProjectRole) : undefined);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');

/** What picking `src` copies. */
export function copyTeam(src: Pick<TeamSource, 'shape' | 'roles' | 'models' | 'level'>): TeamCopy {
  const roles = PROJECT_ROLES.map((r) => r.id).filter((r) => src.roles.includes(r));
  const exact = SHAPES[src.shape].roles;
  const customTeam = !(roles.length === exact.length && exact.every((r) => roles.includes(r as ProjectRole)));
  const models: Partial<Record<ProjectRole, string>> = {};
  for (const r of roles) if (src.models[r] && MODEL.test(src.models[r]!)) models[r] = src.models[r];
  return { shape: customTeam ? shapeForRoles(roles) : src.shape, roles, customTeam, ...(isLevel(src.level) ? { level: src.level } : {}), models };
}

/** The lines of "Copies the setup of X", for the page. */
export function copiedLines(src: Pick<TeamSource, 'project' | 'roles'>, copy: TeamCopy, roleTitle: (r: ProjectRole) => string): string[] {
  const s = SHAPES[copy.shape];
  const models = Object.entries(copy.models).map(([r, m]) => `${roleTitle(r as ProjectRole)} on ${m}`);
  return [
    `Team shape: ${s.icon} ${s.label}${copy.customTeam ? ' (roles picked by hand)' : ''}`,
    `Roles: ${copy.roles.map(roleTitle).join(', ') || 'none'}`,
    `Models: ${models.join(', ') || 'as the budget level sets them'}`,
    copy.level ? `Budget level: ${copy.level[0].toUpperCase()}${copy.level.slice(1)} (the amount is this project’s own estimate)` : 'Budget level: not copied (that project has no level), so this project keeps its suggested one',
  ];
}

/** The plan's team source as sent by the page, its shape checked (cleanPlan checks it against the office). */
export function cleanTeamFrom(raw: unknown, roles: readonly ProjectRole[]): PlanTeamFrom | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const floor = text(r.floor, 200);
  if (!floor) return undefined;
  const models: Partial<Record<ProjectRole, string>> = {};
  for (const [k, v] of Object.entries((r.models && typeof r.models === 'object' ? r.models : {}) as Record<string, unknown>)) {
    const role = roleOf(k);
    if (role && roles.includes(role) && typeof v === 'string' && MODEL.test(v.trim())) models[role] = v.trim();
  }
  const seen = new Set<string>();
  const agents = (Array.isArray(r.agents) ? r.agents : [])
    .slice(0, 12)
    .map((a: Record<string, unknown>) => ({ role: roleOf(a?.role), profile: a?.profile, name: text(a?.name, 40) }))
    .filter((a): a is { role: ProjectRole; profile: string; name: string } => !!a.role && roles.includes(a.role) && isProfileId(a.profile) && !seen.has(a.role) && !seen.has(a.profile) && !!(seen.add(a.role), seen.add(a.profile)));
  return {
    floor,
    project: text(r.project, 100) || floor,
    ...(text(r.client, 100) ? { client: text(r.client, 100) } : {}),
    models,
    ...(isLevel(r.level) ? { level: r.level } : {}),
    ...(agents.length ? { agents } : {}),
    ...(agents.length && r.moveConfirmed === true ? { moveConfirmed: true } : {}),
  };
}

/** What the office knows of a source project, for cleanPlan's check: its name and each role's agent now. */
export interface KnownSource {
  project: string;
  client?: string;
  /** Its portfolio (pfl_…), when it has a client. */
  portfolio?: string;
  agents: Map<ProjectRole, { profile: string; name: string; where: AgentWhere }>;
}

/**
 * The page's team source checked against the office: an unknown project or a profile that isn't that
 * project's agent for the role is refused; agents that need a Move without the person's confirmation too.
 * The names come from the office, never from the page.
 */
export function checkTeamFrom(t: PlanTeamFrom, known: ReadonlyMap<string, KnownSource>, portfolio?: string): PlanTeamFrom | string {
  const src = known.get(t.floor);
  if (!src) return 'The project you started the team from isn’t in the office any more: pick another, or clear Start from a team';
  const agents: NonNullable<PlanTeamFrom['agents']> = [];
  for (const a of t.agents ?? []) {
    const k = src.agents.get(a.role);
    if (!k || k.profile !== a.profile) return `That agent isn’t on ${src.project}’s team as ${a.role} any more: pick the team again`;
    if (k.where === 'moving') return `${k.name} is moving to another project now: untick Also bring the same agents, or wait for that move`;
    agents.push({ role: a.role, profile: a.profile, name: k.name });
  }
  const needsMove = (t.agents ?? []).some((a) => src.agents.get(a.role)!.where !== 'free');
  if (needsMove && !t.moveConfirmed) return 'Some of those agents are on another project: confirm the Move first';
  const confidential = !!src.portfolio && src.portfolio !== portfolio;
  return {
    floor: t.floor,
    project: src.project,
    ...(src.client ? { client: src.client } : {}),
    models: t.models,
    ...(t.level ? { level: t.level } : {}),
    ...(agents.length ? { agents, ...(t.moveConfirmed ? { moveConfirmed: true } : {}) } : {}),
    ...(confidential ? { confidential: true } : {}),
  };
}

