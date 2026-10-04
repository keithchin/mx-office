// Where each project team works on a floor (see docs/teams.md): the 2D view paints every team's
// patch of floor in its own style, and hiring a role (server/roster/adapter.ts) sits it at a free
// desk in its team's patch first. It's a fixed map of the room's existing desks rather than new
// desks, so the 3D office, saved floors and every other way of hiring stay exactly as they were.
// Pure, with no Node imports: the browser reads it too.

import { DESK_BY_ID, deskBuilt } from './layout.js';
import type { TeamId } from './roster/roles.js';

export interface TeamZone {
  team: TeamId;
  /** What its signpost says. */
  name: string;
  icon: string;
  /** Its clothes and its signpost's colour, and the accent its floor is trimmed in. */
  color: string;
  /**
   * Its desks, the one a Lead takes first at the front: the back rows of the pods come first, so
   * the Lead sits facing the room.
   */
  desks: readonly string[];
  /** Its patch of floor, in meters (x and z, as shared/layout.ts). */
  area: { minX: number; maxX: number; minZ: number; maxZ: number };
}

// The room's four pods of four desks (shared/layout.ts buildDesks): the west pair round x -10.5,
// the east pair round x -1.5, the north pods round z -4 and the south ones round z 4. Each Lead's
// team gets a pod, except that the PM and the analysts share the south-east one down the middle
// (two desks each): a Project Manager rarely hires anyone, and neither team needs four.
const WEST = { minX: -14.6, maxX: -6.4 };
const EAST = { minX: -5.6, maxX: 3.4 };
const NORTH = { minZ: -7.7, maxZ: -0.7 };
const SOUTH = { minZ: 0.7, maxZ: 7.7 };
/** Where the south-east pod splits between the analysts (west) and the PM (east): between its desks. */
const SPLIT_X = -1.5;

export const ZONES: readonly TeamZone[] = [
  { team: 'development', name: 'Dev bay', icon: '🛠️', color: '#1f8a8a', desks: ['desk-1', 'desk-2', 'desk-3', 'desk-4'], area: { ...WEST, ...NORTH } },
  { team: 'design', name: 'Design studio', icon: '🎨', color: '#e07a5f', desks: ['desk-5', 'desk-6', 'desk-7', 'desk-8'], area: { minX: EAST.minX, maxX: 2.6, ...NORTH } },
  { team: 'testing', name: 'QA lab', icon: '🧪', color: '#17b3a3', desks: ['desk-9', 'desk-10', 'desk-11', 'desk-12'], area: { ...WEST, ...SOUTH } },
  { team: 'analysis', name: 'Analyst corner', icon: '📈', color: '#6d7ff2', desks: ['desk-13', 'desk-15'], area: { minX: EAST.minX, maxX: SPLIT_X, ...SOUTH } },
  { team: 'management', name: 'PM office', icon: '🧭', color: '#f2b33d', desks: ['desk-14', 'desk-16'], area: { minX: SPLIT_X, maxX: EAST.maxX, ...SOUTH } },
];

export const ZONE_BY_TEAM: ReadonlyMap<TeamId, TeamZone> = new Map(ZONES.map((z) => [z.team, z]));
/** The team whose patch a desk is in; the back office, the bean bags and the kiosks are open floor. */
export const ZONE_OF_DESK: ReadonlyMap<string, TeamZone> = new Map(ZONES.flatMap((z) => z.desks.map((d) => [d, z] as const)));

/** A free desk in `team`'s patch (the Lead's own first), or undefined when they're all taken. */
export function zoneSeat(team: TeamId, taken: (id: string) => boolean, wing = 0): string | undefined {
  return ZONE_BY_TEAM.get(team)?.desks.find((id) => {
    const d = DESK_BY_ID.get(id);
    return d && deskBuilt(d, wing) && !taken(id);
  });
}
