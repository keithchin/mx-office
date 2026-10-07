// The Leads' subagents' first names in a floor's roster (shared/roster/subagent-names.ts): every subagent
// the floor has (each Lead's defined ones, by the team's coverage, those with a record, and those only
// seen at work) named once and kept in the roster file's `subagentNames`. A roster saved before names
// gets them on load; a subagent seen for the first time gets its own when it's first asked for.

import { LEADS, ROLES, type RoleId } from '../../shared/roster/roles.js';
import { subagentDefsOf } from '../../shared/roster/coverage.js';
import { assignSubagentNames, subRef } from '../../shared/roster/subagent-names.js';
import type { RosterData } from './store.js';
import { subKey } from './subagent-store.js';

type Named = Pick<RosterData, 'subagentNames' | 'subagents' | 'subagentRuns' | 'coverage' | 'members'>;

/** Every subagent key the floor has. */
export function subagentKeys(d: Named): string[] {
  const keys = new Set<string>(Object.keys(d.subagents));
  for (const lead of LEADS) for (const s of subagentDefsOf(d.coverage, lead.id)) keys.add(subKey(lead.id, s.id));
  for (const r of d.subagentRuns) if (r.lead !== 'pm') keys.add(subKey(r.lead, r.name));
  return [...keys];
}

/** The Leads' (and the Coordinator's) names, which no subagent may share. */
export const memberNames = (d: Pick<RosterData, 'members'>) => ROLES.map((r) => d.members[r.id].name);

/** Names every subagent that has none (or whose name clashes): true when any changed, for the caller to save. */
export function ensureSubagentNames(d: Named, extra: string[] = []): boolean {
  return assignSubagentNames(d.subagentNames, [...subagentKeys(d), ...extra], memberNames(d));
}

/** The first name of `lead`'s subagent `type`, naming it now when it's new (`named` says so, for a save). */
export function subagentFirstName(d: Named, lead: RoleId, type: string, named?: () => void): string {
  const key = subKey(lead, type);
  if (!d.subagentNames[key] && ensureSubagentNames(d, [key])) named?.();
  return d.subagentNames[key];
}

/** "Nia (tester)" for `lead`'s subagent `type` ("Nia (tester, Sonnet)" with `more`). */
export const subagentRef = (d: Named, lead: RoleId, type: string, named?: () => void, more?: string) => subRef(subagentFirstName(d, lead, type, named), type, more);

/** One Lead's subagents' first names by type, for its Playbook (playbooks.ts). */
export function namesOf(d: Pick<RosterData, 'subagentNames'>, lead: RoleId): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.subagentNames)) if (k.startsWith(`${lead}/`)) out[k.slice(lead.length + 1)] = v;
  return out;
}
