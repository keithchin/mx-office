// The 2D view's office (pixel.ts): the floor plan the 3D office is built from (shared/layout.ts),
// drawn from above in a three-quarter view, a pixel at a time. This is what stands still (the floor,
// each team's patch of it, the walls and what's on them, the lounge, the meeting room, the plants,
// the light from the windows and the lamps), drawn once per floor plan into a canvas of its own; the
// desks and the people at them go on top every frame (see people.ts).

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
  PLANTS,
  plantsAt,
  wingMinZ,
  type Opening,
} from '../../shared/layout';
import type { Theme } from '../../shared/protocol';
import { C } from './sprites';
import { blob, box, castShadow, noise, oval, rect, solid } from './paint';
import { drawPlant, drawProps, plantSpecies } from './props';
import { drawZoneDecor, drawZoneFloors } from './zones';
import { drawAmbient, drawLamps, drawWindowLight } from './light';
import { FACE, LIFT, PPM, WALL, ax, az, type Frame } from './frame';
import { drawBalcony } from './balcony';

export { FACE, LIFT, PPM, WALL, ax, az, frameFor, type Frame } from './frame';
export { box, oval, rect } from './paint';

/** The whole still office, into a canvas of its own. */
export function drawOffice(f: Frame, theme: Theme | null = null): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = f.width;
  c.height = f.height;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  rect(g, 0, 0, f.width, f.height, C.night);
  floor(g, f);
  drawZoneFloors(g, f);
  lounge(g, f);
  drawWindowLight(g, f);
  drawBalcony(g, f);
  walls(g, f);
  drawAmbient(g, f);
  fixtures(g, f);
  meetingRoom(g, f);
  drawProps(g, f, theme);
  drawZoneDecor(g, f);
  // The plants take turns, as the 3D office's do (see floorPlant there), by where each is in the full list.
  for (const [x, z, scale] of plantsAt(f.level)) drawPlant(g, ax(f, x), az(f, z), scale * 1.35, plantSpecies(PLANTS.findIndex((p) => p[0] === x && p[1] === z)));
  drawLamps(g, f);
  return c;
}

/** The open floor, in big pale tiles with a few flecks in each: the room, and the back office once it's built. */
function floor(g: CanvasRenderingContext2D, f: Frame) {
  const areas: { x0: number; x1: number; z0: number; z1: number }[] = [{ x0: FLOOR.minX, x1: FLOOR.maxX, z0: FLOOR.minZ, z1: FLOOR.maxZ }];
  if (f.level > 0) areas.push({ x0: WING.minX, x1: WING.maxX, z0: wingMinZ(f.level), z1: FLOOR.minZ });
  for (const a of areas) {
    for (let x = Math.floor(a.x0); x < a.x1; x++) {
      for (let z = Math.floor(a.z0); z < a.z1; z++) {
        const x0 = Math.max(x, a.x0), x1 = Math.min(x + 1, a.x1);
        const z0 = Math.max(z, a.z0), z1 = Math.min(z + 1, a.z1);
        const px = ax(f, x0), pz = az(f, z0), pw = ax(f, x1) - px, ph = az(f, z1) - pz;
        rect(g, px, pz, pw, ph, (x + z) & 1 ? C.floorB : C.floorA);
        rect(g, px, pz, pw, 1, C.grout);
        rect(g, px, pz, 1, ph, C.grout);
        // A lit corner on each tile, and a few flecks, so the floor isn't flat colour.
        rect(g, px + 1, pz + 1, 3, 1, 'rgba(255,255,255,0.55)');
        for (let i = 0; i < 3; i++) {
          const n = noise(x * 7 + i, z * 13 - i);
          rect(g, px + 2 + Math.floor(n * (pw - 4)), pz + 2 + Math.floor(noise(z + i, x - i) * (ph - 4)), 1, 1, n > 0.5 ? '#d3dae3' : '#f4f6f9');
        }
      }
    }
  }
}

/** The lounge's rug round the couch and the TV. */
function lounge(g: CanvasRenderingContext2D, f: Frame) {
  const couch = SEATING_BY_ID.get('couch');
  if (!couch) return;
  const x0 = ax(f, couch.x - 1), y0 = az(f, -3.4), x1 = ax(f, FLOOR.maxX - 0.6), y1 = az(f, 3.4);
  rect(g, x0, y0, x1 - x0, y1 - y0, '#9fb3cf');
  rect(g, x0 + 2, y0 + 2, x1 - x0 - 4, y1 - y0 - 4, '#bccbe0');
  rect(g, x0 + 5, y0 + 5, x1 - x0 - 10, y1 - y0 - 10, '#c9d6e8');
  for (let y = y0 + 8; y < y1 - 8; y += 6) rect(g, x0 + 8, y, x1 - x0 - 16, 1, 'rgba(255,255,255,0.25)');
}

/** Along a wall, the windows and doors in it. */
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
  // The north wall's face (the boards hang on it): a lit cap, the wall, a darker skirting board.
  const face = (x0: number, x1: number, y: number) => {
    rect(g, x0, y - FACE, x1 - x0, FACE, C.wall);
    for (let x = x0 + 9; x < x1; x += 18) rect(g, x, y - FACE + 5, 1, FACE - 9, 'rgba(255,255,255,0.03)');
    rect(g, x0, y - FACE, x1 - x0, 4, C.wallTop);
    rect(g, x0, y - FACE, x1 - x0, 1, '#3d5785');
    rect(g, x0, y - 4, x1 - x0, 4, C.wallLine);
    rect(g, x0, y - 4, x1 - x0, 1, '#2b4066');
  };
  face(west - WALL, f.level > 0 ? wingX : east + WALL, north);
  if (f.level > 0) {
    face(wingX, east + WALL, wingTop);
    rect(g, wingX - WALL, wingTop - FACE, WALL, north - wingTop, C.wallTop);
  }
  // The side and south walls, seen from above, with their windows and doors; a lit inner edge.
  const top = f.level > 0 ? wingTop : north;
  rect(g, west - WALL, north - FACE, WALL, south - north + FACE + WALL, C.wallTop);
  rect(g, east, top - FACE, WALL, south - top + FACE + WALL, C.wallTop);
  rect(g, west - WALL, south, east - west + 2 * WALL, WALL, C.wallTop);
  rect(g, west - 1, north, 1, south - north, '#3d5785');
  rect(g, west - WALL, south, east - west + 2 * WALL, 1, '#3d5785');
  for (const o of openings('west')) gap(g, west - WALL, az(f, o.u - o.width / 2), WALL, Math.round(o.width * PPM), o.y0 > 0);
  for (const o of openings('south')) gap(g, ax(f, o.u - o.width / 2), south, Math.round(o.width * PPM), WALL, o.y0 > 0);

  // On the north face: the Issues board, the task queue and the PR board, the elevator and the gong.
  const board = (x: number, width: number, head: string) => {
    const w = Math.round(width * PPM) - 12, x0 = ax(f, x) - (w >> 1), y0 = north - FACE + 8, h = FACE - 16;
    rect(g, x0 + 2, y0 + 2, w, h, 'rgba(5,9,15,0.35)');
    rect(g, x0 - 1, y0 - 1, w + 2, h + 2, '#0f1a2c');
    rect(g, x0, y0, w, h, C.board);
    rect(g, x0, y0, w, 4, head);
    rect(g, x0, y0 + 4, w, 1, 'rgba(9,18,34,0.15)');
    // A few cards pinned up, in columns, each with a line of writing and a pin.
    for (let i = 0; i < Math.floor((w - 6) / 18); i++) {
      for (let j = 0; j < 2; j++) {
        if ((i + j) % 3 === 2) continue;
        const cx = x0 + 5 + i * 18, cy = y0 + 8 + j * 9;
        rect(g, cx + 1, cy + 1, 13, 7, 'rgba(9,18,34,0.12)');
        rect(g, cx, cy, 13, 7, (i + j) % 2 ? '#e3eaf2' : '#d4efeb');
        rect(g, cx + 2, cy + 3, 8, 1, '#9aa6b6');
        rect(g, cx + 6, cy, 1, 1, head);
      }
    }
  };
  board(BOARDS.issues.x, BOARDS.issues.width, C.amber);
  board(BOARDS.queue.x, BOARDS.queue.width, C.teal);
  board(BOARDS.pulls.x, BOARDS.pulls.width, '#6d7ff2');
  const ew = Math.round(ELEVATOR.doorWidth * PPM), ex = ax(f, ELEVATOR.x) - (ew >> 1), ey = north - FACE + 10;
  rect(g, ex - 4, north - FACE + 5, ew + 8, FACE - 5, '#0f1a2c');
  rect(g, ex - 3, north - FACE + 6, ew + 6, FACE - 6, '#5c6b80');
  rect(g, ex, ey, ew, north - ey, '#b4c0cf');
  rect(g, ex, ey, ew >> 1, north - ey, '#c3cedb');
  rect(g, ex + (ew >> 1), ey, 1, north - ey, '#7d8a9c');
  rect(g, ex + 3, ey + 2, 1, north - ey - 4, 'rgba(255,255,255,0.5)');
  rect(g, ex + (ew >> 1) - 4, north - FACE + 7, 8, 2, C.tealLight);
  const gx = ax(f, GONG.x), gy = north - FACE + 22;
  rect(g, gx - 11, north - FACE + 7, 22, 3, C.woodDark);
  rect(g, gx - 11, north - FACE + 7, 2, 24, C.woodDark);
  rect(g, gx + 9, north - FACE + 7, 2, 24, C.woodDark);
  oval(g, gx + 1, gy + 1, 9, 9, 'rgba(5,9,15,0.35)');
  oval(g, gx, gy, 9, 9, '#b8862c');
  oval(g, gx, gy, 7, 7, '#d9a441');
  oval(g, gx - 2, gy - 2, 3, 3, '#f2cf7a');
}

/** A window (light through it, a mullion down the middle) or a doorway (the floor carries on) in a wall. */
function gap(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, window: boolean) {
  rect(g, x, y, w, h, window ? C.window : C.floorB);
  if (!window) return;
  const across = w > h;
  rect(g, x + (across ? 0 : 2), y + (across ? 2 : 0), across ? w : 2, across ? 2 : h, C.windowLight);
  rect(g, across ? x + (w >> 1) : x, across ? y : y + (h >> 1), across ? 1 : w, across ? h : 1, '#6f93b3');
}

/** What stands about the room: the lounge, the TV, the jukebox, the arcade, the bookshelf, the whiteboard and the stairs. */
function fixtures(g: CanvasRenderingContext2D, f: Frame) {
  const east = ax(f, FLOOR.maxX);
  // On the east wall: the TV, and the services board north of it; the machine's monitor on the west wall.
  const slab = (x: number, z: number, width: number, color: string, glow: string) => {
    const h = Math.round(width * PPM);
    rect(g, x - 1, az(f, z) - (h >> 1) - 1, 7, h + 2, '#0f1a2c');
    rect(g, x, az(f, z) - (h >> 1), 5, h, color);
    rect(g, x, az(f, z) - (h >> 1), 1, h, glow);
  };
  slab(east - 6, TV.z, TV.width, '#1a2436', C.tealLight);
  slab(east - 6, BOARDS.services.z, BOARDS.services.width - 1, C.board, C.teal);
  slab(ax(f, FLOOR.minX), MACHINE_MONITOR.z, MACHINE_MONITOR.width, '#1a2436', C.green);
  // The lounge couch, its back to the room, facing the TV, with three cushions.
  const couch = SEATING_BY_ID.get('couch');
  if (couch) {
    const x = ax(f, couch.x - 0.45), y = az(f, couch.z - 1.9), w = Math.round(0.9 * PPM), d = Math.round(3.8 * PPM);
    solid(g, x, y, w, d, 7, '#3e5a8a', C.chair, C.ink);
    rect(g, x, y - 13, 6, d, C.chair);
    rect(g, x, y - 13, 6, 1, C.chairTop);
    for (let i = 0; i < 3; i++) {
      const cy = y - 5 + 2 + i * Math.round(d / 3);
      rect(g, x + 7, cy, w - 9, Math.round(d / 3) - 4, '#4d6ca0');
      rect(g, x + 7, cy, w - 9, 1, '#6b8bc0');
    }
  }
  for (const id of ['lounge-beanbag-1', 'lounge-beanbag-2']) {
    const s = SEATING_BY_ID.get(id);
    if (s) beanbag(g, ax(f, s.x), az(f, s.z), '#5b7bb0');
  }
  // Against the east wall: the jukebox and the arcade cabinet.
  const jd = Math.round(JUKEBOX.depth * PPM), jw = Math.round(JUKEBOX.width * PPM);
  solid(g, east - jd, az(f, JUKEBOX.z - JUKEBOX.width / 2), jd, jw, 18, '#8a4766', '#5b2c43');
  rect(g, east - jd + 2, az(f, JUKEBOX.z) - 20, jd - 4, 3, '#c9a24a');
  const cd = Math.round(CABINET.depth * PPM), cw = Math.round(CABINET.width * PPM);
  solid(g, east - cd, az(f, CABINET.z - CABINET.width / 2), cd, cw, 20, '#2c3a56', '#1a2336');
  // The bookshelf against the south wall, its shelves of books.
  const bx = ax(f, BOOKSHELF.x - BOOKSHELF.width / 2), bw = Math.round(BOOKSHELF.width * PPM), bd = Math.round(BOOKSHELF.depth * PPM), by = az(f, BOOKSHELF.z - BOOKSHELF.depth / 2);
  box(g, bx, by, bw, bd, 6, C.wood, C.woodDark);
  const books = ['#5b7bb0', C.teal, C.amber, '#c96d6d', '#6d7ff2', C.green, '#e07a5f', '#8fa3bf'];
  for (let i = 0; i < Math.floor((bw - 4) / 4); i++) rect(g, bx + 2 + i * 4, by - 9 + (i % 3 === 1 ? 1 : 0), 3, 6 - (i % 3 === 1 ? 1 : 0), books[i % books.length]);
  // The whiteboard on wheels, its face to the room, a scribble and a sticky note on it.
  const ww = Math.round(WHITEBOARD.width * PPM), wx = ax(f, WHITEBOARD.x) - (ww >> 1), wy = az(f, WHITEBOARD.z);
  const wh = Math.round(WHITEBOARD.height * LIFT), wb = Math.round(WHITEBOARD.bottom * LIFT);
  blob(g, wx + (ww >> 1), wy, ww >> 1, 2);
  rect(g, wx + 5, wy - wb, 2, wb, '#7d8a9c');
  rect(g, wx + ww - 7, wy - wb, 2, wb, '#7d8a9c');
  rect(g, wx + 2, wy - 1, 5, 2, C.ink);
  rect(g, wx + ww - 7, wy - 1, 5, 2, C.ink);
  rect(g, wx - 1, wy - wb - wh - 1, ww + 2, wh + 2, '#7d8a9c');
  rect(g, wx, wy - wb - wh, ww, wh, C.board);
  rect(g, wx, wy - wb - wh, ww, 1, '#ffffff');
  rect(g, wx + 8, wy - wb - wh + 6, 30, 1, C.teal);
  rect(g, wx + 8, wy - wb - wh + 11, 42, 1, '#9aa6b6');
  rect(g, wx + 8, wy - wb - wh + 16, 22, 1, '#9aa6b6');
  rect(g, wx + 58, wy - wb - wh + 5, 14, 13, '#fff1a8');
  rect(g, wx + 58, wy - wb - wh + 5, 14, 2, '#f2d36b');
  // The stairs up to the loft, along the south wall: each step lit on its nose.
  const sx0 = ax(f, STAIRS.fromX), sx1 = ax(f, STAIRS.toX), sy = az(f, STAIRS.minZ), sd = az(f, STAIRS.maxZ) - sy;
  castShadow(g, sx0, sy, sx1 - sx0, sd, 8);
  for (let i = 0; i < STAIRS.steps; i++) {
    const x = sx0 + Math.round(((sx1 - sx0) * i) / STAIRS.steps), w = Math.ceil((sx1 - sx0) / STAIRS.steps), lift = Math.round(i * 1.3);
    rect(g, x, sy - lift, w, sd + lift, i % 2 ? C.wood : C.woodDark);
    rect(g, x, sy - lift, 1, sd + lift, '#e2d2bd');
  }
}

/** The meeting room under the loft: a plank floor, glass walls with a door in the north one. The table and chairs are people.ts's. */
function meetingRoom(g: CanvasRenderingContext2D, f: Frame) {
  const x0 = ax(f, MEETING_ROOM.minX), x1 = ax(f, MEETING_ROOM.maxX), y0 = az(f, MEETING_ROOM.minZ), y1 = az(f, MEETING_ROOM.maxZ);
  for (let y = y0, row = 0; y < y1; y += 5, row++) {
    rect(g, x0, y, x1 - x0, 5, row & 1 ? '#e4dccf' : '#ebe4d8');
    for (let x = x0 + ((row * 23) % 40); x < x1; x += 40) rect(g, x, y, 1, 5, '#d6cbbb');
  }
  g.fillStyle = C.glass;
  g.fillRect(x0, y0 - 8, x1 - x0, 8);
  g.fillRect(x0, y0 - 8, 4, y1 - y0 + 8);
  const d0 = ax(f, MEETING_ROOM.door.x0), d1 = ax(f, MEETING_ROOM.door.x1);
  for (const [a, b] of [[x0, d0], [d1, x1]]) {
    rect(g, a, y0 - 8, b - a, 1, C.glassEdge);
    rect(g, a, y0, b - a, 1, C.glassEdge);
    rect(g, a, y0 + 1, b - a, 2, 'rgba(9,18,34,0.12)');
    // A glint across the glass.
    for (let x = a + 6; x < b - 4; x += 26) rect(g, x, y0 - 6, 3, 1, 'rgba(255,255,255,0.7)');
  }
  rect(g, x0, y0 - 8, 1, y1 - y0 + 8, C.glassEdge);
  rect(g, x0 + 4, y0, 1, y1 - y0, C.glassEdge);
  // The doorway: no glass across it.
  rect(g, d0, y0 - 8, d1 - d0, 9, C.floorA);
}

/** A bean bag, round and squashed, centered on (x, y), lit from the upper left. */
export function beanbag(g: CanvasRenderingContext2D, x: number, y: number, color: string) {
  blob(g, x, y + 3, 11, 4);
  oval(g, x, y - 1, 11, 7, color);
  oval(g, x - 2, y - 3, 7, 4, 'rgba(255,255,255,0.18)');
  rect(g, x - 5, y - 6, 5, 2, 'rgba(255,255,255,0.3)');
}
