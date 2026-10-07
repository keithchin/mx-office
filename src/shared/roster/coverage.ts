// Team shapes and team coverage (docs/teams-and-agents.md, "Team shapes"). A project's team has one of
// three shapes: Solo (one generalist Lead covering every team, with subagents), Startup (a Chief Analyst
// and a Lead Developer, design and test done by their subagents) or Enterprise (a Project Coordinator
// and four Leads, the office's original team). Coverage says, per team, which member covers it: its own
// Lead, or another member. Everything that used to go to a fixed role (relays to the Coordinator, the
// standup page, a team's issues and subagents, the Firm's questions, the deliverables) goes to whoever
// covers that team instead. Enterprise with each team covering itself behaves exactly as before.
// Pure: the browser imports it too.

import { ROLE_BY_ID, ROLES, type RoleDef, type RoleId, type SubagentDef, type TeamId } from './roles.js';

export const TEAM_SHAPES = ['solo', 'startup', 'enterprise'] as const;
export type TeamShape = (typeof TEAM_SHAPES)[number];
export const isTeamShape = (v: unknown): v is TeamShape => typeof v === 'string' && (TEAM_SHAPES as readonly string[]).includes(v);

/** Which member covers each team. */
export type Coverage = Record<TeamId, RoleId>;

/** The teams in the order the coverage table lists them. */
export const COVERAGE_TEAMS: readonly TeamId[] = ['management', 'analysis', 'design', 'development', 'testing'];

/** Each team's own Lead (or the Coordinator for management): the identity coverage. */
export const TEAM_OWNER: Readonly<Coverage> = { management: 'pm', design: 'lead-designer', development: 'lead-developer', testing: 'lead-tester', analysis: 'chief-analyst' };

export interface ShapeInfo {
  id: TeamShape;
  label: string;
  icon: string;
  /** In a few words. */
  tagline: string;
  /** Who is on it, in a sentence. */
  who: string;
  /** The roles hired for it, in hiring order. */
  roles: readonly RoleId[];
  coverage: Readonly<Coverage>;
}

export const SHAPES: Readonly<Record<TeamShape, ShapeInfo>> = {
  solo: {
    id: 'solo',
    label: 'Solo',
    icon: '🧑‍🚀',
    tagline: 'One generalist Lead',
    who: 'One Solo Lead (Sonnet) covers every team, with every subagent type to draft and check.',
    roles: ['solo-lead'],
    coverage: { management: 'solo-lead', design: 'solo-lead', development: 'solo-lead', testing: 'solo-lead', analysis: 'solo-lead' },
  },
  startup: {
    id: 'startup',
    label: 'Startup',
    icon: '🚲',
    tagline: 'Analyst + developer',
    // The pipeline split in two: the Chief Analyst takes Stages P–4 (requirements, wireframes, the
    // status), the Lead Developer Stages 5–7 (the build and its tests), so the builder idles until there's a plan.
    who: 'A Chief Analyst (analysis, design, management) and a Lead Developer (development, testing); design and test are their subagents.',
    roles: ['chief-analyst', 'lead-developer'],
    coverage: { management: 'chief-analyst', analysis: 'chief-analyst', design: 'chief-analyst', development: 'lead-developer', testing: 'lead-developer' },
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise',
    icon: '🏢',
    tagline: 'Coordinator + four Leads',
    who: 'A Project Coordinator and four Leads (Analysis, Design, Development, Testing), each with its own subagents.',
    roles: ['pm', 'lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst'],
    coverage: TEAM_OWNER,
  },
};

/** A shape from a saved roster or a request: Enterprise unless it says otherwise (every project before shapes). */
export const cleanShape = (v: unknown): TeamShape => (isTeamShape(v) ? v : 'enterprise');

export const defaultCoverage = (shape: TeamShape): Coverage => ({ ...SHAPES[shape].coverage });

/** Coverage from a saved roster: each team a real role, else the shape's default for it. */
export function cleanCoverage(raw: unknown, shape: TeamShape): Coverage {
  const out = defaultCoverage(shape);
  if (!raw || typeof raw !== 'object') return out;
  for (const team of COVERAGE_TEAMS) {
    const v = (raw as Record<string, unknown>)[team];
    if (typeof v === 'string' && ROLE_BY_ID.has(v as RoleId)) out[team] = v as RoleId;
  }
  return out;
}

/** Who covers a team. */
export const coverOf = (c: Coverage, team: TeamId): RoleId => c[team];

/** Who covers Management: the one the Coordinator's relays, the standup page and the project console go to. */
export const managerOf = (c: Coverage): RoleId => c.management;

/** The teams a member covers, in COVERAGE_TEAMS order. */
export const coveredBy = (c: Coverage, role: RoleId): TeamId[] => COVERAGE_TEAMS.filter((t) => c[t] === role);

/** Whether a member covers any team: one that covers none isn't on this shape's team. */
export const covers = (c: Coverage, role: RoleId): boolean => COVERAGE_TEAMS.some((t) => c[t] === role);

/** Every team covering itself: how the office ran before shapes. */
export const isIdentity = (c: Coverage): boolean => COVERAGE_TEAMS.every((t) => c[t] === TEAM_OWNER[t]);

/**
 * The roles whose lanes a member takes on besides its own: the owners of the other teams it covers
 * (the Solo Lead covers every owner's, the Startup's Chief Analyst the Designer's and the Coordinator's).
 */
export const alsoCovers = (c: Coverage, role: RoleId): RoleId[] => coveredBy(c, role).map((t) => TEAM_OWNER[t]).filter((r) => r !== role);

/** The subagents a member may dispatch: its own and those of every team it covers, each once. */
export function subagentDefsOf(c: Coverage | undefined, role: RoleId): SubagentDef[] {
  const roles = [role, ...(c ? alsoCovers(c, role) : [])];
  const seen = new Set<string>();
  const out: SubagentDef[] = [];
  for (const r of roles) for (const s of ROLE_BY_ID.get(r)?.subagents ?? []) if (!seen.has(s.id) && seen.add(s.id)) out.push(s);
  return out;
}

/** The member a subagent belongs to on this team: the first member (in role order) that may dispatch it. */
export function ownerOfSubagent(c: Coverage, name: string): RoleId | undefined {
  return ROLES.find((r) => covers(c, r.id) && subagentDefsOf(c, r.id).some((s) => s.id === name))?.id;
}

/** The one writer of the .mpr: whoever covers Development. */
export const writerOf = (c: Coverage): RoleId => c.development;

/**
 * The members asked for a standup: every Lead that covers a team (the Coordinator compiles rather than
 * reports), in role order, which for Enterprise is the four Leads as before.
 */
export const standupRoles = (c: Coverage): RoleId[] => ROLES.filter((r) => r.id !== 'pm' && covers(c, r.id)).map((r) => r.id);

/** The roles a shape's team shows: the shape's own, plus any other the floor has had (so nothing hired is hidden). */
export function shownRoles(shape: TeamShape, had: (role: RoleId) => boolean): RoleDef[] {
  return ROLES.filter((r) => SHAPES[shape].roles.includes(r.id) || had(r.id));
}

/** "Design · covered by Sam (Solo Lead)" for a team covered by another member; undefined when it covers itself. */
export function coveredNote(c: Coverage, team: TeamId, nameOf: (role: RoleId) => string): string | undefined {
  const by = c[team];
  if (by === TEAM_OWNER[team]) return undefined;
  return `covered by ${nameOf(by)} (${ROLE_BY_ID.get(by)?.title ?? by})`;
}

/**
 * The shape a set of hired roles adds up to (a wizard plan from before shapes, or one customised by hand):
 * the Solo Lead makes it Solo; the Chief Analyst and/or Lead Developer without anyone else Startup; anything
 * else Enterprise, whose every team covers itself.
 */
export function shapeForRoles(roles: readonly RoleId[]): TeamShape {
  if (roles.includes('solo-lead')) return 'solo';
  if (roles.length && roles.every((r) => r === 'chief-analyst' || r === 'lead-developer')) return 'startup';
  return 'enterprise';
}

/** One row of the Team tab's coverage table. */
export interface CoverageRow {
  team: TeamId;
  role: RoleId;
  name: string;
  title: string;
  /** Covered by its own Lead. */
  own: boolean;
}

export function coverageRows(c: Coverage, nameOf: (role: RoleId) => string): CoverageRow[] {
  return COVERAGE_TEAMS.map((team) => ({ team, role: c[team], name: nameOf(c[team]), title: ROLE_BY_ID.get(c[team])?.title ?? c[team], own: c[team] === TEAM_OWNER[team] }));
}
