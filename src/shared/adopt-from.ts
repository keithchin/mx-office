// Start from another app (server/adopt-from/, docs/site/using-the-office/clients.md#start-from-another-app):
// a new project of a client takes reusable material from one of the client's existing apps through the
// mechanisms the office already has, and nothing else: the source's design system version (the explicit
// binding, applied by the wizard's design step), the client's company brain (the client's own wiring), the
// source's toolkit pin (the same pinned commit) and its role skill selections (the Team tab's per-role
// overrides, copied before the team is hired). Project knowledge (PROJECT.md decisions, lessons) is never
// copied: a lesson is shared by proposing it to the brain's inbox, where it's reviewed first.
// Adoption offers material; it doesn't prove agents use it: the words say "available to agents", never
// "applied". Pure: the page, the server and the tests read the same rules.

import type { RoleId } from './roster/roles.js';
import type { SkillOverrides } from './roster/skills.js';

/** The plan's adoption choices (ProjectPlan.adopt). What each choice means is worked out by the office at start (`resolved`). */
export interface PlanAdopt {
  /** The source app (a floor id in the office). */
  source: string;
  /** Bind the new project to the source's design system version. */
  design?: boolean;
  /** Start on the source's toolkit pin (else the newest toolkit, as every new project). */
  toolkit?: boolean;
  /** Copy the source's role skill selections. */
  roleSkills?: boolean;
  /** What the office found on the source when the setup started (never taken from the page). */
  resolved?: AdoptResolved;
}

export interface AdoptResolved {
  sourceName: string;
  sourceClient?: { id: string; label: string };
  design?: { systemId: string; name: string; n: number; digest: string };
  toolkit?: { sha: string; date?: string };
  roleSkills?: Partial<Record<RoleId, SkillOverrides>>;
  /** The new project's client's company brain (wired by the client's own step), when it has one. */
  brain?: { client: string };
}

/** One source app as the adoption step shows it (GET /api/adopt-from/sources). */
export interface AdoptSource {
  floor: string;
  name: string;
  client?: { id: string; label: string };
  /** In another client than the one asked for (admins only). */
  crossClient: boolean;
  design?: AdoptDesign;
  /** The source's client's company brain. */
  brain?: { client: string; connected: boolean };
  /** The source's toolkit pin, when it has one. */
  toolkit?: { sha: string; date?: string };
  /** Per role, how many of its skills the Project Manager changed from the defaults. */
  roleSkills: { role: RoleId; title: string; changes: number }[];
}

export interface AdoptDesign {
  systemId: string;
  name: string;
  n: number;
  digest: string;
  kind: 'atlas' | 'branded';
  /** The version's status (approved, superseded…), as the design-systems module has it. */
  status?: string;
  /** What the version was made with (the design-systems module's compatibility record) and what tokens can't express. */
  compat?: { studioPro: string; mxcli: string; atlas?: string };
  gaps: string[];
  /** The newest runtime capture of the source app on this version, if there is one (a URL). */
  capture?: string;
  /** A few of the version's colours, for a small preview when there's no capture. */
  swatch: string[];
  /** The design-systems module's check of the package: its files still match its digest. */
  verified: boolean;
}

export interface AdoptSourcesView {
  client?: string;
  admin: boolean;
  /** Other clients' apps are listed too (admins only). */
  all: boolean;
  /** The asked client's own company brain (the one a new project of it is wired to). */
  clientBrain?: { client: string; connected: boolean };
  sources: AdoptSource[];
}

export type AdoptKind = 'design' | 'brain' | 'toolkit' | 'role-skills';

/** One thing adopted, as recorded: available to agents, or not (and why). */
export interface AdoptItem {
  kind: AdoptKind;
  status: 'available' | 'failed';
  text: string;
}

/** What a project was set up with from another app (<data>/adopt-from/<floor>.json). */
export interface AdoptRecord {
  floor: string;
  source: { floor: string; name: string; client?: string };
  at: number;
  by: string;
  items: AdoptItem[];
}

export const ADOPT_HONESTY = 'Adopted material is available to agents; adopting it doesn’t prove they use it.';
export const LESSONS_DOC = '/docs/using-the-office/clients#start-from-another-app';
export const LESSONS_WORDS = 'Project knowledge (PROJECT.md decisions, lessons) is never copied. To share a lesson, propose it to the company brain’s inbox, where it’s reviewed before agents are pointed at it.';

const FLOOR_ID = /^[A-Za-z0-9._-]{1,100}$/;

/** The plan's adoption, made safe: a source floor id and three yes/no choices (never `resolved` from the page). */
export function cleanPlanAdopt(v: unknown): PlanAdopt | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.source !== 'string' || !FLOOR_ID.test(r.source)) return undefined;
  const out: PlanAdopt = { source: r.source };
  if (r.design === true) out.design = true;
  if (r.toolkit === true) out.toolkit = true;
  if (r.roleSkills === true) out.roleSkills = true;
  return out;
}

/** The roles with changed skills and how many changes, from a source's overrides. */
export function skillChanges(map: Partial<Record<RoleId, SkillOverrides>>): number {
  return Object.values(map).reduce((n, o) => n + Object.keys(o ?? {}).length, 0);
}

/**
 * The summary before Create project: "Design system X v1 (from App A) · Acme brain connected · Toolkit pin
 * same as App A · Role skills from App A". `brainOf` is the new project's client's brain, if any.
 */
export function adoptSummary(a: PlanAdopt | undefined, s: AdoptSource | undefined, brainOf?: { client: string; connected: boolean }): string[] {
  const out: string[] = [];
  if (a && s && a.design && s.design) out.push(`Design system ${s.design.name} v${s.design.n} (from ${s.name})`);
  if (brainOf?.connected) out.push(`${brainOf.client} brain connected`);
  if (a && s) out.push(a.toolkit && s.toolkit ? `Toolkit pin same as ${s.name}` : 'Newest toolkit (default)');
  if (a && s && a.roleSkills && s.roleSkills.some((r) => r.changes)) out.push(`Role skills from ${s.name}`);
  return out;
}

/** "Adopted from App A on 20 Oct 2026: …", as Project Settings shows it. */
export function recordHeadline(r: AdoptRecord, locale?: string): string {
  const day = new Date(r.at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return `Adopted from ${r.source.name}${r.source.client ? ` (${r.source.client})` : ''} on ${day}`;
}

export const KIND_LABEL: Record<AdoptKind, string> = { design: 'Design system', brain: 'Company brain', toolkit: 'Toolkit', 'role-skills': 'Role skills' };
