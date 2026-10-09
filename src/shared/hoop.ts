// The basketball hoop on every floor's west wall, where the 2D Office view draws it (pixel/props.ts).

import { FLOOR } from './layout.js';

/**
 * The hoop, on the west wall between the exit door and the kitchen, facing into the room (+x).
 * `face` is the backboard's front, `rim` the middle of the ring (`r` to the middle of its tube).
 */
const HOOP_Z = 10.1;
const HOOP_FACE = FLOOR.minX + 0.62;
export const HOOP = {
  z: HOOP_Z,
  face: HOOP_FACE,
  board: { width: 1.4, bottom: 2.88, top: 3.93, thick: 0.05 },
  rim: { x: HOOP_FACE + 0.4, y: 3.05, z: HOOP_Z, r: 0.25, tube: 0.018 },
  /** How far the net hangs below the ring, and how wide it is at the bottom. */
  net: { depth: 0.42, r: 0.15 },
  /** The free-throw line, this far out from the backboard. */
  line: 4.6,
} as const;

