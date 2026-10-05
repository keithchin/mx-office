// How the 2D view maps the floor plan (shared/layout.ts, in meters) onto its picture (in art pixels):
// the scale across the floor and up, and where the picture's corner is. Its own module so everything
// that draws (office.ts, zones.ts, light.ts, people.ts…) can share it without importing each other.

import { BALCONY, FLOOR, wingMinZ } from '../../shared/layout';

/** Art pixels to a meter across the floor: big enough for characters 24 pixels across at a desk 44 wide. */
export const PPM = 20;
/** Art pixels to a meter of height: what stands up is drawn this much higher (the three-quarter view). */
export const LIFT = 13;
/** How tall the north wall's face is drawn, in art pixels: the boards hang on it. */
export const FACE = 38;
/** The outside walls' thickness from above, in art pixels. */
export const WALL = 7;

/** Where the floor plan sits in the picture: world meters to art pixels. */
export interface Frame {
  minX: number;
  minZ: number;
  /** Art pixels above minZ, for the north wall's face. */
  top: number;
  width: number;
  height: number;
  /** How far the back office is built out (see WING). */
  level: number;
}

export function frameFor(level: number): Frame {
  const minX = FLOOR.minX - 0.6;
  const minZ = wingMinZ(level) - 0.4;
  const maxX = FLOOR.maxX + 0.6;
  // Down past the south wall to take in the smoking balcony (balcony.ts).
  const maxZ = Math.max(FLOOR.maxZ + 0.6, BALCONY.maxZ + 0.3);
  const top = FACE + 6;
  return { minX, minZ, top, width: Math.round((maxX - minX) * PPM), height: top + Math.round((maxZ - minZ) * PPM), level };
}

/** A point on the floor, in art pixels. */
export const ax = (f: Frame, x: number) => Math.round((x - f.minX) * PPM);
export const az = (f: Frame, z: number) => Math.round((z - f.minZ) * PPM) + f.top;
