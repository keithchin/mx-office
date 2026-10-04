// The 2D view's office (pixel.ts): the floor plan the 3D office is built from (shared/layout.ts),
// drawn from above in a three-quarter view, a pixel at a time. This is what stands still (the floor,
// the walls and what's on them, the lounge, the meeting room, the plants), drawn once per floor
// plan; the desks and the people at them go on top every frame (see people.ts).

import {
  BOARDS,
  BOOKSHELF,
  CABINET,
  EXIT_DOOR,
  BALCONY_DOOR,
  ELEVATOR,
  FLOOR,
  GONG,
  JUKEBOX,
  MACHINE_MONITOR,
  MEETING_ROOM,
  SEATING_BY_ID,
  STAIRS,
  TV,
  WHITEBOARD,
  WINDOWS,
  WING,
  plantsAt,
  wingMinZ,
  type Opening,
} from '../../shared/layout';
import { C } from './sprites';

/** Art pixels to a meter across the floor. */
export const PPM = 14;
/** Art pixels to a meter of height: what stands up is drawn this much higher (the three-quarter view). */
export const LIFT = 9;
/** How tall the north wall's face is drawn, in art pixels: the boards hang on it. */
const FACE = 26;
/** The outside walls' thickness from above, in art pixels. */
const WALL = 5;

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
  const maxZ = FLOOR.maxZ + 0.6;
  const top = FACE + 4;
  return { minX, minZ, top, width: Math.round((maxX - minX) * PPM), height: top + Math.round((maxZ - minZ) * PPM), level };
}

/** A point on the floor, in art pixels. */
export const ax = (f: Frame, x: number) => Math.round((x - f.minX) * PPM);
export const az = (f: Frame, z: number) => Math.round((z - f.minZ) * PPM) + f.top;

export function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A filled oval, a row of whole pixels at a time, so its edge stays crisp (a canvas arc would blur it). */
export function oval(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string) {
  g.fillStyle = color;
  cx = Math.round(cx);
  cy = Math.round(cy);
  const r = Math.max(1, Math.round(ry));
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - ((dy + (dy < 0 ? 0.5 : -0.5)) / (ry + 0.5)) ** 2)));
    if (half > 0) g.fillRect(cx - half, cy + dy, half * 2, 1);
  }
}

/**
 * Something boxy standing on the floor: its footprint `w` by `d` art pixels from (x, y), `h` high. The
 * top is drawn raised by its height, with the face toward you under it.
 */
export function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number, top: string, front: string, edge?: string) {
  rect(g, x, y - h, w, d, top);
  rect(g, x, y + d - h, w, h, front);
  if (edge) rect(g, x, y + d - h, w, 1, edge);
}

/** The whole still office, into a canvas of its own. */
export function drawOffice(f: Frame): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = f.width;
  c.height = f.height;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  rect(g, 0, 0, f.width, f.height, C.night);
  floor(g, f);
  rugs(g, f);
  walls(g, f);
  fixtures(g, f);
  meetingRoom(g, f);
  for (const [x, z, scale] of plantsAt(f.level)) plant(g, ax(f, x), az(f, z), scale);
  return c;
}

/** The floor, in big pale tiles: the room, and the back office once it's built. */
function floor(g: CanvasRenderingContext2D, f: Frame) {
  const areas: { x0: number; x1: number; z0: number; z1: number }[] = [{ x0: FLOOR.minX, x1: FLOOR.maxX, z0: FLOOR.minZ, z1: FLOOR.maxZ }];
  if (f.level > 0) areas.push({ x0: WING.minX, x1: WING.maxX, z0: wingMinZ(f.level), z1: FLOOR.minZ });
  for (const a of areas) {
    for (let x = Math.floor(a.x0); x < a.x1; x++) {
      for (let z = Math.floor(a.z0); z < a.z1; z++) {
        const x0 = Math.max(x, a.x0), x1 = Math.min(x + 1, a.x1);
        const z0 = Math.max(z, a.z0), z1 = Math.min(z + 1, a.z1);
        const px = ax(f, x0), pz = az(f, z0);
        rect(g, px, pz, ax(f, x1) - px, az(f, z1) - pz, (x + z) & 1 ? C.floorB : C.floorA);
        rect(g, px, pz, ax(f, x1) - px, 1, C.grout);
      }
    }
  }
}

/** A rug under the lounge, and under each pod of desks (see pods in people.ts for the desks themselves). */
function rugs(g: CanvasRenderingContext2D, f: Frame) {
  const rug = (x0: number, z0: number, x1: number, z1: number) => {
    rect(g, ax(f, x0), az(f, z0), ax(f, x1) - ax(f, x0), az(f, z1) - az(f, z0), C.rugEdge);
    rect(g, ax(f, x0) + 2, az(f, z0) + 2, ax(f, x1) - ax(f, x0) - 4, az(f, z1) - az(f, z0) - 4, C.rug);
  };
  // The desks' two clusters of two pods each, and the lounge round the couch and the TV.
  for (const cx of [-10.5, -1.5]) for (const z of [-4, 4]) rug(cx - 3, z - 2.6, cx + 3, z + 2.6);
  const couch = SEATING_BY_ID.get('couch');
  if (couch) rug(couch.x - 1, -3.4, FLOOR.maxX - 0.6, 3.4);
}

/** Along a wall from `a` to `b` (meters along it), the windows and doors in it, in order. */
function openings(wall: Opening['wall']): Opening[] {
  return [...WINDOWS.filter((w) => w.wall === wall && w.y0 < 3), ...[EXIT_DOOR, BALCONY_DOOR].filter((d) => d.wall === wall)];
}

function walls(g: CanvasRenderingContext2D, f: Frame) {
  const north = az(f, FLOOR.minZ);
  const south = az(f, FLOOR.maxZ);
  const west = ax(f, FLOOR.minX);
  const east = ax(f, FLOOR.maxX);
  const wingX = ax(f, WING.minX);
  const wingTop = az(f, wingMinZ(f.level));
  // The north wall's face, the boards on it; the back office's back wall, further north, once it's built.
  const face = (x0: number, x1: number, y: number) => {
    rect(g, x0, y - FACE, x1 - x0, FACE, C.wall);
    rect(g, x0, y - FACE, x1 - x0, 3, C.wallTop);
    rect(g, x0, y - 2, x1 - x0, 2, C.wallLine);
  };
  face(west - WALL, f.level > 0 ? wingX : east + WALL, north);
  if (f.level > 0) {
    face(wingX, east + WALL, wingTop);
    rect(g, wingX - WALL, wingTop - FACE, WALL, north - wingTop, C.wallTop);
  }
  // The side and south walls, seen from above, with their windows and doors.
  const top = f.level > 0 ? wingTop : north;
  rect(g, west - WALL, north - FACE, WALL, south - north + FACE + WALL, C.wallTop);
  rect(g, east, top - FACE, WALL, south - top + FACE + WALL, C.wallTop);
  rect(g, west - WALL, south, east - west + 2 * WALL, WALL, C.wallTop);
  for (const o of openings('west')) gap(g, west - WALL, az(f, o.u - o.width / 2), WALL, Math.round(o.width * PPM), o.y0 > 0);
  for (const o of openings('south')) gap(g, ax(f, o.u - o.width / 2), south, Math.round(o.width * PPM), WALL, o.y0 > 0);

  // On the north face: the Issues board, the task queue and the PR board, the elevator and the gong.
  const board = (x: number, width: number, head: string) => {
    const w = Math.round(width * PPM) - 8, x0 = ax(f, x) - (w >> 1), y0 = north - FACE + 6;
    rect(g, x0 - 1, y0 - 1, w + 2, FACE - 11, C.wallLine);
    rect(g, x0, y0, w, FACE - 13, C.board);
    rect(g, x0, y0, w, 3, head);
    // A few cards pinned up.
    for (let i = 0; i < Math.floor(w / 14); i++) rect(g, x0 + 4 + i * 14, y0 + 6 + (i % 2) * 4, 9, 5, i % 3 ? '#dfe6ee' : '#cfe9e5');
  };
  board(BOARDS.issues.x, BOARDS.issues.width, C.amber);
  board(BOARDS.queue.x, BOARDS.queue.width, C.teal);
  board(BOARDS.pulls.x, BOARDS.pulls.width, '#6d7ff2');
  const ew = Math.round(ELEVATOR.doorWidth * PPM), ex = ax(f, ELEVATOR.x) - (ew >> 1);
  rect(g, ex - 3, north - FACE + 4, ew + 6, FACE - 4, C.wallLine);
  rect(g, ex, north - FACE + 8, ew, FACE - 8, '#a9b6c6');
  rect(g, ex + (ew >> 1), north - FACE + 8, 1, FACE - 8, '#7d8a9c');
  rect(g, ex + (ew >> 1) - 3, north - FACE + 5, 6, 2, C.tealLight);
  const gx = ax(f, GONG.x);
  rect(g, gx - 8, north - FACE + 6, 16, 2, C.woodDark);
  oval(g, gx, north - FACE + 17, 7, 7, '#c99a3a');
  rect(g, gx - 2, north - FACE + 15, 4, 4, '#e6bd62');
}

/** A window (light through it) or a doorway (the floor carries on) in a wall. */
function gap(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, window: boolean) {
  rect(g, x, y, w, h, window ? C.window : C.floorB);
  if (window) rect(g, x + (w > h ? 0 : 1), y + (w > h ? 1 : 0), w > h ? w : 1, w > h ? 1 : h, C.windowLight);
}

/** What stands about the room: the lounge, the TV, the jukebox, the arcade, the bookshelf, the whiteboard and the stairs. */
function fixtures(g: CanvasRenderingContext2D, f: Frame) {
  const east = ax(f, FLOOR.maxX);
  // On the east wall: the TV, and the services board north of it; the machine's monitor on the west wall.
  const slab = (x: number, z: number, width: number, color: string, glow: string) => {
    const h = Math.round(width * PPM);
    rect(g, x, az(f, z) - (h >> 1), 4, h, color);
    rect(g, x, az(f, z) - (h >> 1), 1, h, glow);
  };
  slab(east - 4, TV.z, TV.width, '#1a2436', C.tealLight);
  slab(east - 4, BOARDS.services.z, BOARDS.services.width - 1, C.board, C.teal);
  slab(ax(f, FLOOR.minX), MACHINE_MONITOR.z, MACHINE_MONITOR.width, '#1a2436', C.green);
  // The lounge couch, its back to the room, facing the TV.
  const couch = SEATING_BY_ID.get('couch');
  if (couch) {
    const x = ax(f, couch.x - 0.45), y = az(f, couch.z - 1.9), w = Math.round(0.9 * PPM), d = Math.round(3.8 * PPM);
    box(g, x, y, w, d, 5, '#3e5a8a', C.chair, C.ink);
    rect(g, x, y - 9, 4, d, C.chair);
    for (let i = 0; i < 3; i++) rect(g, x + 5, y - 4 + 2 + i * Math.round(d / 3), w - 7, Math.round(d / 3) - 3, '#4d6ca0');
  }
  for (const id of ['lounge-beanbag-1', 'lounge-beanbag-2']) {
    const s = SEATING_BY_ID.get(id);
    if (s) beanbag(g, ax(f, s.x), az(f, s.z), '#5b7bb0');
  }
  // Against the east wall: the jukebox and the arcade cabinet.
  box(g, east - Math.round(JUKEBOX.depth * PPM), az(f, JUKEBOX.z - JUKEBOX.width / 2), Math.round(JUKEBOX.depth * PPM), Math.round(JUKEBOX.width * PPM), 12, '#7a3e5a', '#5b2c43');
  rect(g, east - 9, az(f, JUKEBOX.z) - 14, 4, 8, C.amber);
  box(g, east - Math.round(CABINET.depth * PPM), az(f, CABINET.z - CABINET.width / 2), Math.round(CABINET.depth * PPM), Math.round(CABINET.width * PPM), 14, '#26324a', '#1a2336');
  rect(g, east - 11, az(f, CABINET.z) - 18, 7, 6, C.tealLight);
  // The bookshelf against the south wall.
  const bx = ax(f, BOOKSHELF.x - BOOKSHELF.width / 2), bw = Math.round(BOOKSHELF.width * PPM);
  box(g, bx, az(f, BOOKSHELF.z - BOOKSHELF.depth / 2), bw, Math.round(BOOKSHELF.depth * PPM), 4, C.wood, C.woodDark);
  ['#5b7bb0', C.teal, C.amber, '#c96d6d', '#6d7ff2', C.green].forEach((col, i) => rect(g, bx + 2 + i * 4, az(f, BOOKSHELF.z) - 6, 3, 4, col));
  // The whiteboard on wheels, its face to the room.
  const ww = Math.round(WHITEBOARD.width * PPM), wx = ax(f, WHITEBOARD.x) - (ww >> 1), wy = az(f, WHITEBOARD.z);
  const wh = Math.round(WHITEBOARD.height * LIFT), wb = Math.round(WHITEBOARD.bottom * LIFT);
  rect(g, wx + 4, wy - wb, 2, wb, '#7d8a9c');
  rect(g, wx + ww - 6, wy - wb, 2, wb, '#7d8a9c');
  rect(g, wx + 1, wy - 1, ww - 2, 1, 'rgba(20,34,58,0.18)');
  rect(g, wx - 1, wy - wb - wh - 1, ww + 2, wh + 2, '#7d8a9c');
  rect(g, wx, wy - wb - wh, ww, wh, C.board);
  rect(g, wx + 6, wy - wb - wh + 5, 22, 1, C.teal);
  rect(g, wx + 6, wy - wb - wh + 9, 30, 1, '#9aa6b6');
  rect(g, wx + 6, wy - wb - wh + 13, 16, 1, '#9aa6b6');
  rect(g, wx + 42, wy - wb - wh + 5, 12, 10, '#e7f6f4');
  // The stairs up to the loft, along the south wall.
  const sx0 = ax(f, STAIRS.fromX), sx1 = ax(f, STAIRS.toX), sy = az(f, STAIRS.minZ), sd = az(f, STAIRS.maxZ) - sy;
  for (let i = 0; i < STAIRS.steps; i++) {
    const x = sx0 + Math.round(((sx1 - sx0) * i) / STAIRS.steps);
    rect(g, x, sy - Math.round(i * 0.9), Math.ceil((sx1 - sx0) / STAIRS.steps), sd + Math.round(i * 0.9), i % 2 ? C.wood : C.woodDark);
  }
}

/** The meeting room under the loft: glass walls with a door in the north one. The table and chairs are people.ts's. */
function meetingRoom(g: CanvasRenderingContext2D, f: Frame) {
  const x0 = ax(f, MEETING_ROOM.minX), x1 = ax(f, MEETING_ROOM.maxX), y0 = az(f, MEETING_ROOM.minZ), y1 = az(f, MEETING_ROOM.maxZ);
  for (let y = y0; y < y1; y += 4) rect(g, x0, y, x1 - x0, 4, (y >> 2) & 1 ? '#e4dccf' : '#ebe4d8');
  g.fillStyle = C.glass;
  g.fillRect(x0, y0 - 6, x1 - x0, 6);
  g.fillRect(x0, y0 - 6, 3, y1 - y0 + 6);
  const d0 = ax(f, MEETING_ROOM.door.x0), d1 = ax(f, MEETING_ROOM.door.x1);
  rect(g, x0, y0 - 6, d0 - x0, 1, C.glassEdge);
  rect(g, d1, y0 - 6, x1 - d1, 1, C.glassEdge);
  rect(g, x0, y0, d0 - x0, 1, C.glassEdge);
  rect(g, d1, y0, x1 - d1, 1, C.glassEdge);
  rect(g, x0, y0 - 6, 1, y1 - y0 + 6, C.glassEdge);
  rect(g, x0 + 3, y0, 1, y1 - y0, C.glassEdge);
  // The doorway: no glass across it.
  rect(g, d0, y0 - 6, d1 - d0, 7, C.floorA);
}

/** A bean bag, round and squashed, centered on (x, y). */
export function beanbag(g: CanvasRenderingContext2D, x: number, y: number, color: string) {
  oval(g, x, y + 2, 8, 3, 'rgba(20,34,58,0.16)');
  oval(g, x, y - 1, 8, 5, color);
  rect(g, x - 4, y - 5, 5, 2, 'rgba(255,255,255,0.25)');
}

/** A potted plant standing at (x, y), `scale` times the usual size. */
function plant(g: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  const s = Math.max(0.8, scale);
  const pw = Math.round(7 * s), ph = Math.round(6 * s);
  oval(g, x, y + 1, pw * 0.7, 2, 'rgba(20,34,58,0.16)');
  rect(g, x - (pw >> 1), y - ph, pw, ph, C.pot);
  rect(g, x - (pw >> 1), y - ph, pw, 2, C.potDark);
  const leaves: [number, number, number, string][] = [
    [0, -ph - 7 * s, 6 * s, C.leafDark],
    [-4 * s, -ph - 4 * s, 4.5 * s, C.leaf],
    [4 * s, -ph - 5 * s, 4.5 * s, C.leaf],
    [0, -ph - 10 * s, 4 * s, C.leafLight],
    [-2 * s, -ph - 6 * s, 2.5 * s, C.leafLight],
  ];
  for (const [dx, dy, r, color] of leaves) oval(g, x + dx, y + dy, r, r, color);
}
