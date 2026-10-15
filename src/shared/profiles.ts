// Agent profiles (Portfolios Phase 2, docs/site/using-the-office/agents.md): an office-wide identity for a
// team member, an immutable id (prf_<ulid>) with an editable display name and a factual history of the
// projects and roles it held. A profile carries no knowledge, skill or session between projects: every hire
// is a fresh session with the destination's Playbook. Its track record isn't measured yet (Phase 5).
// Pure: the server, the pages and the tests import it.

import { ulid } from './evidence/ids.js';
import { NAME_POOL, type RoleId } from './roster/roles.js';

/** Said on the Agents page and the hire dialog: what reusing a profile means, and what it doesn't. */
export const PROFILE_HONESTY = 'A profile is a name and a factual history. Each project starts a fresh session with that project’s Playbook: nothing from earlier projects (sessions, handoffs, journals or your notes) comes with it, and a familiar name doesn’t mean better work.';
export const NOT_MEASURED = 'not measured yet';
/** The track-record rows a profile page shows; each is "not measured yet" until Phase 5 attributes work to profiles. */
export const TRACK_ROWS = ['Tasks completed', 'Pull requests merged first time', 'Verification passed at the delivered revision', 'Spend per task'] as const;

export type AssignmentReason = 'migrated' | 'hired' | 'reused' | 'moved-in';
export type AssignmentEnd = 'moved' | 'replaced' | 'project-removed';

export interface Assignment {
  floor: string;
  /** The project's name when it started (owner-facing only; never given to an agent). */
  project: string;
  role: RoleId;
  start: number;
  end?: number;
  reason: AssignmentReason;
  ended?: AssignmentEnd;
  /** The workers hired under it, newest last (Phase 5: executionId → agentInstanceId → profileId). */
  workers: string[];
}

export interface Profile {
  id: string;
  displayName: string;
  createdAt: number;
  createdBy: 'migration' | 'hire';
  assignments: Assignment[];
}

export type MoveState = 'source-benching' | 'dest-hiring' | 'done' | 'failed' | 'cancelled';
export interface SeatRef {
  floor: string;
  role: RoleId;
}

/** A durable operation record for one Hire from your agents (with a Move when the profile was elsewhere). */
export interface MoveOp {
  id: string;
  profileId: string;
  from?: SeatRef;
  to: SeatRef;
  state: MoveState;
  /** Where a failed one stopped. */
  stage?: 'source' | 'dest';
  error?: string;
  at: number;
  updatedAt: number;
  by: string;
  owner?: string;
  task?: string;
  /** The destination seat's name and profile before it was reserved, put back if the hire fails. */
  prevDest?: { name: string; profileId: string | null };
}

export const OPEN_MOVE: readonly MoveState[] = ['source-benching', 'dest-hiring', 'failed'];
export const isOpenMove = (m: Pick<MoveOp, 'state'>) => OPEN_MOVE.includes(m.state);

const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
const PROFILE_RE = new RegExp(`^prf_${ULID}$`);
const MOVE_RE = new RegExp(`^mov_${ULID}$`);
export const isProfileId = (v: unknown): v is string => typeof v === 'string' && PROFILE_RE.test(v);
export const isMoveId = (v: unknown): v is string => typeof v === 'string' && MOVE_RE.test(v);
export const mintProfileId = (now = Date.now(), random?: (n: number) => Uint8Array) => `prf_${ulid(now, random)}`;
export const mintMoveId = (now = Date.now()) => `mov_${ulid(now)}`;

/** The key of a roster seat in profiles.json's `seats`. */
export const seatKey = (floor: string, role: string) => `${floor}|${role}`;

/** The first pool name nobody has (case-insensitive), then "Ada 2", "Ada 3"…: names stay unique office-wide. */
export function freshName(taken: Iterable<string>): string {
  const t = new Set([...taken].map((n) => n.toLowerCase()));
  const free = NAME_POOL.find((n) => !t.has(n.toLowerCase()));
  if (free) return free;
  for (let i = 2; ; i++) for (const n of NAME_POOL) if (!t.has(`${n} ${i}`.toLowerCase())) return `${n} ${i}`;
}

/** "Ada", or "Ada · #7QX2" when another profile has the same name (migrated duplicates are never merged). */
export function labelOf(p: Pick<Profile, 'id' | 'displayName'>, dupes: ReadonlySet<string>): string {
  return dupes.has(p.displayName.toLowerCase()) ? `${p.displayName} · #${p.id.slice(-4)}` : p.displayName;
}

/** The names more than one profile has, lower case: one pass over the list. */
export function duplicateNames(list: readonly Pick<Profile, 'displayName'>[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const p of list) {
    const k = p.displayName.toLowerCase();
    if (seen.has(k)) dupes.add(k);
    seen.add(k);
  }
  return dupes;
}

/** The one line a hire's first message may get about its profile: a count only, never a project, client or note (S02). */
export function profileLine(otherProjects: number): string | undefined {
  if (otherProjects < 1) return undefined;
  return `Your profile in this office has worked on ${otherProjects} other project${otherProjects === 1 ? '' : 's'} before. Nothing from ${otherProjects === 1 ? 'it' : 'them'} comes with you (no session, handoff, journal or notes): work from this project's Playbook, journal and handoff.`;
}

/** Where a profile is now, for the pages. */
export type ProfileWhere = { kind: 'free' } | { kind: 'working' | 'benched' | 'moving'; floor: string; project: string; role: RoleId };

export interface ProfileView extends Profile {
  label: string;
  roles: RoleId[];
  where: ProfileWhere;
  /** Projects it has had an assignment on (each once). */
  projects: number;
  /** Admins only. */
  notes?: { text: string; at: number; by: string };
  /** Its open Hire from your agents, if any. */
  move?: MoveOp;
}

export interface ProfilesView {
  profiles: ProfileView[];
  admin: boolean;
}

/** The answer to a hire of a profile that is active elsewhere: what a Move does there, for the confirmation. */
export interface NeedsMove {
  profile: string;
  name: string;
  from: SeatRef & { project: string; status: 'active' | 'benched' };
  to: SeatRef & { project: string };
}
