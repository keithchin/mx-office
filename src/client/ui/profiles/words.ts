// What the pages say about a profile: where it is, an assignment's dates and how it ended, its roles.

import { ROLE_BY_ID, type RoleId } from '../../../shared/roster/roles';
import type { Assignment, AssignmentEnd, NeedsMove, ProfileView } from '../../../shared/profiles';

export const roleTitle = (r: RoleId) => ROLE_BY_ID.get(r)?.title ?? r;
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const ENDED: Record<AssignmentEnd, string> = { moved: 'moved to another project', replaced: 'seat given to another agent', 'project-removed': 'project removed' };

/** "4 Oct 2026 – 9 Oct 2026 · moved to another project", or "since 4 Oct 2026". */
export function periodText(a: Assignment): string {
  return a.end !== undefined ? `${day(a.start)} – ${day(a.end)}${a.ended ? ` · ${ENDED[a.ended]}` : ''}` : `since ${day(a.start)}`;
}

/** "Working on Travel approval (Lead Developer)", "Benched on …", "Moving to …", "Not on a project". */
export function whereText(p: ProfileView): string {
  const w = p.where;
  if (w.kind === 'free') return 'Not on a project';
  const verb = w.kind === 'working' ? 'Working on' : w.kind === 'benched' ? 'Benched on' : 'Moving to';
  return `${verb} ${w.project} (${roleTitle(w.role)})`;
}

export const rolesText = (p: ProfileView) => p.roles.map(roleTitle).join(', ') || 'No role yet';

/** Its projects, newest first, each with its dates: "Welcome desk (since …), Travel approval (… – …)". */
export function projectsText(p: ProfileView, names: (floor: string, fallback: string) => string = (_f, n) => n): string {
  return [...p.assignments].reverse().map((a) => `${names(a.floor, a.project)} (${periodText(a)})`).join('; ');
}

/** The rows in the order shown: this role's agents first, then the rest; never the seat's own agent. */
export function hireOrder(list: readonly ProfileView[], floor: string, role: RoleId): ProfileView[] {
  const others = list.filter((p) => !(p.where.kind !== 'free' && p.where.floor === floor && p.where.role === role));
  const held = (p: ProfileView) => (p.roles.includes(role) ? 0 : 1);
  return [...others].sort((a, b) => held(a) - held(b) || a.label.localeCompare(b.label));
}

/** The Move confirmation's lines: the effect on the source project, then here. */
export function moveLines(n: NeedsMove): string[] {
  const src = `${n.from.project}`;
  return [
    n.from.status === 'active' ? `On ${src}, ${n.name} is asked to write a handoff note and lessons, then benched. The note stays with ${src}.` : `${n.name} is benched on ${src} (no session there now).`,
    `Then ${n.name} is hired here as ${roleTitle(n.to.role)} in a fresh session with this project’s Playbook. Nothing from ${src} comes along: no session, handoff, journal or your notes.`,
    `${src}’s ${roleTitle(n.from.role)} seat is then open: its next hire there is someone new.`,
    `${n.name} can’t work on both projects at once.`,
    ...(n.from.status === 'active' ? [`If ${n.name} is in the middle of something there, the bench is refused and nothing changes.`] : []),
  ];
}
