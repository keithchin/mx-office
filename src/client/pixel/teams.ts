// Who's who on the 2D view's floor (pixel.ts): the floor's project team (GET /api/roster, fetched
// again when the office says it changed), so each Lead is dressed for its role in its team's colour,
// its name tag says its role, its hover card its team, and each zone's signpost names its Lead.
// Anyone not on the team is dressed in their own colour and tagged with what they're working on.
// teamLookup does the same for any floor's team (the home page's overview draws every floor).

import type { MemberView, RosterView } from '../../shared/roster/types';
import type { RoleId, TeamId } from '../../shared/roster/roles';
import type { WorkerInfo } from '../../shared/protocol';
import { ZONE_BY_TEAM, ZONE_OF_DESK, type TeamZone } from '../../shared/zones';
import { fetchRoster } from '../ui/roster/api';
import { clip } from '../ui/dom';
import type { Outfit } from './chars';
import type { BreakLead } from './breaks';

const OUTFIT: Record<RoleId, Outfit> = { pm: 'pm', 'lead-designer': 'designer', 'lead-developer': 'dev', 'lead-tester': 'qa', 'chief-analyst': 'analyst', 'solo-lead': 'dev' };
/** Each role's title cut short, for name tags when the office is zoomed out and the desks are close. */
const SHORT: Record<RoleId, string> = { pm: 'Coordinator', 'lead-designer': 'Design lead', 'lead-developer': 'Dev lead', 'lead-tester': 'QA lead', 'chief-analyst': 'Chief analyst', 'solo-lead': 'Solo lead' };

/** What drawing a team needs of each member. */
export type TeamMember = Pick<MemberView, 'role' | 'team' | 'title' | 'workerId' | 'covers'>;

export interface TeamLookup<M extends TeamMember> {
  memberOf(w: WorkerInfo): M | undefined;
  dressFor(w: WorkerInfo): { outfit: Outfit; color: string };
  tagFor(w: WorkerInfo): { text: string; short?: string; color?: string } | undefined;
  leadOf(team: TeamId): M | undefined;
}

/** A floor's team, `members`, as the drawing asks about it. */
export function teamLookup<M extends TeamMember>(members: readonly M[]): TeamLookup<M> {
  const byWorker = new Map(members.filter((m) => m.workerId).map((m) => [m.workerId!, m]));
  const memberOf = (w: WorkerInfo) => byWorker.get(w.id);
  return {
    memberOf,
    dressFor(w) {
      const m = memberOf(w);
      if (!m) return { outfit: 'plain', color: w.color };
      return { outfit: OUTFIT[m.role], color: ZONE_BY_TEAM.get(m.team)?.color ?? w.color };
    },
    tagFor(w) {
      const m = memberOf(w);
      if (m) return { text: m.title, short: SHORT[m.role], color: ZONE_BY_TEAM.get(m.team)?.color };
      const task = w.task?.name ?? w.title ?? (w.prompt ? w.prompt : undefined);
      return task ? { text: clip(task, 26) } : undefined;
    },
    // Whoever covers the team (shared/roster/coverage.ts): its own Lead, or the member covering it.
    leadOf: (team) => members.find((m) => m.covers?.includes(team)) ?? members.find((m) => m.team === team && !m.covers),
  };
}

/** A zone signpost's second line: who leads (or covers) the zone and how they are. */
export function signLine(m: Pick<MemberView, 'role' | 'team' | 'name' | 'covers'> | undefined, team: TeamId, status: string): string | undefined {
  if (!m) return undefined;
  if (m.team !== team) return `Covered by ${m.name} (${SHORT[m.role]}) · ${status}`;
  return `${m.role === 'pm' ? 'Coordinator' : 'Lead'}: ${m.name} · ${status}`;
}

/** The team's benched Leads on floor `floor`, to be on a break about the office (breaks.ts). */
export function benchedLeads(members: readonly Pick<MemberView, 'role' | 'team' | 'title' | 'name' | 'status'>[], floor: string): BreakLead[] {
  return members.filter((m) => m.status === 'benched').map((m) => ({ id: `lead:${floor}:${m.role}`, name: m.name, title: m.title, outfit: OUTFIT[m.role], color: ZONE_BY_TEAM.get(m.team)?.color ?? '#8fa3bf' }));
}

let roster: RosterView | null = null;
let team = teamLookup<MemberView>([]);
let changed: () => void = () => {};

/** The floor's team as last fetched: none until it's in, or when the office has no roster. */
export function setRoster(view: RosterView | null) {
  roster = view;
  team = teamLookup(view?.members ?? []);
  changed();
}

/** Calls `fn` whenever the team changes (to redraw). */
export function onRoster(fn: () => void) {
  changed = fn;
}

let asked = 0;
/** Fetches the floor's team; a failure (no roster on this office, or signed out) just leaves it empty. */
export async function refreshRoster(floor: string | null) {
  const mine = ++asked;
  if (!floor) return setRoster(null);
  try {
    const view = await fetchRoster(floor);
    if (mine === asked) setRoster(view);
  } catch {
    if (mine === asked) setRoster(null);
  }
}

/** A worker's place on the team: its role and team, or nothing when it isn't on it. */
export const memberOf = (w: WorkerInfo): MemberView | undefined => team.memberOf(w);

/** What someone wears: their role's outfit in their team's colour, or their own colour. */
export const dressFor = (w: WorkerInfo) => team.dressFor(w);

/** The tag under someone's name: their role on the team, else what they're working on. */
export const tagFor = (w: WorkerInfo) => team.tagFor(w);

/** The zone a worker sits in, if any (the back office, the bean bags and the kiosks are open floor). */
export function zoneOf(w: WorkerInfo): TeamZone | undefined {
  return ZONE_OF_DESK.get(w.deskId);
}

/** A zone's Lead, for its signpost: its name and how it is, or undefined when nobody's on the roster. */
export const leadOf = (t: TeamId): MemberView | undefined => team.leadOf(t);

/** The floor's benched Leads, as last fetched. */
export const benched = (floor: string | null): BreakLead[] => (floor ? benchedLeads(roster?.members ?? [], floor) : []);

/** The floor's team as last fetched (the subagents at work on it: subagents.ts). */
export const rosterNow = (): RosterView | null => roster;

/** Whether the floor's team has been fetched (there's a roster to name the Leads from). */
export function hasRoster(): boolean {
  return !!roster;
}
