// The team side of the agents' commit identity (workers/git-identity.ts): which seat a worker holds, so
// its commits read "Sophie (Mx Office Lead Developer)" with its profile's address. A worker is launched
// inside its hire, before the roster has written down whose it is, so the hire holds its desk's seat
// for that moment (holdSeat); after that the member record says.

import type { WorkerInfo } from '../../shared/protocol.js';
import { ROLES, ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';
import type { AgentSeat } from '../workers/git-identity.js';
import type { Roster } from './index.js';

/** Seats held for a hire under way, by "<floor>\0<desk>": a desk holds one worker at a time. */
const held = new Map<string, AgentSeat>();
const key = (floorId: string, deskId: string) => `${floorId}\0${deskId}`;

/** Holds the seat for the worker about to start at `deskId`; returns what lets it go once the hire is through. */
export function holdSeat(floorId: string, deskId: string, seat: AgentSeat | undefined): () => void {
  if (!seat) return () => undefined;
  const k = key(floorId, deskId);
  held.set(k, seat);
  return () => {
    if (held.get(k) === seat) held.delete(k);
  };
}

/** A role's seat on a floor: its member's name, its title, and its profile id (else the role id) as the stable key. */
export function seatOf(roster: Roster, floorId: string, role: RoleId, name?: string): AgentSeat | undefined {
  const def = ROLE_BY_ID.get(role);
  if (!def) return undefined;
  let profile: string | undefined;
  try {
    profile = roster.deps.profiles?.profileOf(floorId, role);
  } catch {
    // no profiles yet
  }
  return { name: name || roster.data(floorId).members[role].name, role: def.title, key: profile ?? role };
}

/** The seat a worker holds on the floor: the member it is, else the seat its hire is holding at its desk. */
export function rosterSeat(roster: Roster, floorId: string, info: Pick<WorkerInfo, 'id' | 'deskId'>): AgentSeat | undefined {
  try {
    const d = roster.data(floorId);
    const role = ROLES.find((r) => d.members[r.id].workerId === info.id)?.id;
    if (role) return seatOf(roster, floorId, role);
  } catch {
    // no team on this floor
  }
  return held.get(key(floorId, info.deskId));
}
