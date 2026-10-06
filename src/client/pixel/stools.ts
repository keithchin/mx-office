// Where a Lead's subagents sit while they work, in the 2D view: on an assistant's stool just behind
// their Lead's chair, to its open side (the desks stand in pairs, so away from the neighbour; the walls
// and the zone's things are further out). A second one at work at once sits further out, a third
// further back.
// Pure (meters on the floor plan): helpers.ts draws them, and the tests check the places.

import { DESK_SIZE, type DeskDef } from '../../shared/layout';

/** The most stools beside one desk: any more at work at once are told in the last one's tag. */
export const STOOLS = 3;

/** How far across from the desk's middle, and back from it past the chair, the first stool stands; then the next's step out. */
const ACROSS = 0.9, BACK = 1.3, STEP = 0.6;

/**
 * The `i`th stool (0-based, below STOOLS) of desk `desk`, among `desks` (the floor's desks, to see
 * which side has a neighbour). For a bean bag or a kiosk, it's beside it all the same.
 */
export function stoolSpot(desk: Pick<DeskDef, 'x' | 'z' | 'rotY'>, i: number, desks: readonly Pick<DeskDef, 'x' | 'z' | 'rotY'>[] = []): { x: number; z: number } {
  // The desk's own across (its width) and towards its chair (where its worker sits).
  const ax = Math.cos(desk.rotY), az = -Math.sin(desk.rotY);
  const fx = Math.sin(desk.rotY), fz = Math.cos(desk.rotY);
  const at = (side: number) => ({ x: desk.x + ax * side * DESK_SIZE.width, z: desk.z + az * side * DESK_SIZE.width });
  const taken = (p: { x: number; z: number }) => desks.some((d) => Math.abs(d.x - p.x) < 0.2 && Math.abs(d.z - p.z) < 0.2);
  // Away from the neighbour; with none, or both, on the +across side.
  const side = taken(at(1)) && !taken(at(-1)) ? -1 : 1;
  const across = i >= 2 ? ACROSS * 0.35 : ACROSS + i * STEP;
  const back = i >= 2 ? BACK + STEP : BACK;
  return round({ x: desk.x + ax * side * across + fx * back, z: desk.z + az * side * across + fz * back });
}

const round = (p: { x: number; z: number }) => ({ x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 });
