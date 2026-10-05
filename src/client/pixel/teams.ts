// Who's who on the 2D view's floor (pixel.ts): the floor's project team (GET /api/roster, fetched
// again when the office says it changed), so each Lead is dressed for its role in its team's colour,
// its name tag says its role, its hover card its team, and each zone's signpost names its Lead.
// Anyone not on the team is dressed in their own colour and tagged with what they're working on.

import type { MemberView, RosterView } from '../../shared/roster/types';
import type { RoleId, TeamId } from '../../shared/roster/roles';
import type { WorkerInfo } from '../../shared/protocol';
import { ZONE_BY_TEAM, ZONE_OF_DESK, type TeamZone } from '../../shared/zones';
import { fetchRoster } from '../ui/roster/api';
import { clip } from '../ui/dom';
import type { Outfit } from './chars';

const OUTFIT: Record<RoleId, Outfit> = { pm: 'pm', 'lead-designer': 'designer', 'lead-developer': 'dev', 'lead-tester': 'qa', 'chief-analyst': 'analyst' };
/** Each role's title cut short, for name tags when the office is zoomed out and the desks are close. */
const SHORT: Record<RoleId, string> = { pm: 'Coordinator', 'lead-designer': 'Design lead', 'lead-developer': 'Dev lead', 'lead-tester': 'QA lead', 'chief-analyst': 'Chief analyst' };

let roster: RosterView | null = null;
let byWorker = new Map<string, MemberView>();
let changed: () => void = () => {};

/** The floor's team as last fetched: none until it's in, or when the office has no roster. */
export function setRoster(view: RosterView | null) {
  roster = view;
  byWorker = new Map((view?.members ?? []).filter((m) => m.workerId).map((m) => [m.workerId!, m]));
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
export function memberOf(w: WorkerInfo): MemberView | undefined {
  return byWorker.get(w.id);
}

/** What someone wears: their role's outfit in their team's colour, or their own colour. */
export function dressFor(w: WorkerInfo): { outfit: Outfit; color: string } {
  const m = memberOf(w);
  if (!m) return { outfit: 'plain', color: w.color };
  return { outfit: OUTFIT[m.role], color: ZONE_BY_TEAM.get(m.team)?.color ?? w.color };
}

/** The tag under someone's name: their role on the team, else what they're working on. */
export function tagFor(w: WorkerInfo): { text: string; short?: string; color?: string } | undefined {
  const m = memberOf(w);
  if (m) return { text: m.title, short: SHORT[m.role], color: ZONE_BY_TEAM.get(m.team)?.color };
  const task = w.task?.name ?? w.title ?? (w.prompt ? w.prompt : undefined);
  return task ? { text: clip(task, 26) } : undefined;
}

/** The zone a worker sits in, if any (the back office, the bean bags and the kiosks are open floor). */
export function zoneOf(w: WorkerInfo): TeamZone | undefined {
  return ZONE_OF_DESK.get(w.deskId);
}

/** A zone's Lead, for its signpost: its name and how it is, or undefined when nobody's on the roster. */
export function leadOf(team: TeamId): MemberView | undefined {
  return roster?.members.find((m) => m.team === team);
}

/** Whether the floor's team has been fetched (there's a roster to name the Leads from). */
export function hasRoster(): boolean {
  return !!roster;
}
