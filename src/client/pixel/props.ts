// The 2D view's props (pixel.ts): the rest of what the 3D office has standing about, drawn a pixel at
// a time like office.ts's walls and floor. The kitchen and its coffee machine, the lounge's coffee
// table, the basketball hoop, three kinds of potted plant, the holiday decorations when the
// building's dressed up, the signs on the desks, and the dog. Some of it moves a little every frame
// (steam off the coffee, the jukebox's lights, the lamps' glow, the teams' blinking things): drawMoving.

import { DESKS, FLOOR, JUKEBOX, CABINET, TV, WING_DESKS, DESK_SIZE, deskBuilt, plantsAt } from '../../shared/layout';
import { HOOP } from '../../shared/hoop';
import { DOG_COATS, type DogState } from '../../shared/dog';
import { SIGN_COLORS, type FloorPlan } from '../../shared/floorplan';
import type { Theme } from '../../shared/protocol';
import { C, sprite } from './sprites';
import { blob, box, oval, rect, solid } from './paint';
import { LIFT, PPM, ax, az, type Frame } from './frame';
import { lamps, pool } from './light';
import { drawZoneMoving } from './decor';

/** Where the kitchen counter runs along the south wall, and its coffee machine (where the 3D office's cup is poured). */
export const KITCHEN = { minX: -17.2, maxX: -12, depth: 0.75, coffee: -15.7 } as const;
/** The lounge's coffee table. */
const COFFEE_TABLE = { x: 13, z: 0, width: 1.6, depth: 1.6 } as const;

/** What stands still: drawn into office.ts's picture once per floor plan and decorations. */
export function drawProps(g: CanvasRenderingContext2D, f: Frame, theme: Theme | null) {
  kitchen(g, f);
  // The lounge: the coffee table between the couch and the TV, a mug and a magazine on it.
  const tx = ax(f, COFFEE_TABLE.x - COFFEE_TABLE.width / 2), ty = az(f, COFFEE_TABLE.z - COFFEE_TABLE.depth / 2);
  const tw = Math.round(COFFEE_TABLE.width * PPM), td = Math.round(COFFEE_TABLE.depth * PPM);
  solid(g, tx, ty, tw, td, 6, C.wood, C.woodDark, '#e2d2bd');
  rect(g, tx + 5, ty - 3, 9, 6, C.board);
  rect(g, tx + 6, ty - 2, 6, 1, C.teal);
  rect(g, tx + tw - 11, ty + 6, 5, 5, '#e8eef5');
  rect(g, tx + tw - 10, ty + 7, 3, 2, '#7a4e31');
  hoop(g, f);
  if (theme === 'halloween') halloween(g, f);
}

/** The kitchen against the south wall: cupboards, a sink, the fridge and the coffee machine. */
function kitchen(g: CanvasRenderingContext2D, f: Frame) {
  const x0 = ax(f, KITCHEN.minX), x1 = ax(f, KITCHEN.maxX), d = Math.round(KITCHEN.depth * PPM);
  const y0 = az(f, FLOOR.maxZ) - d;
  box(g, x0, y0, x1 - x0, d, 12, '#e7ebf0', '#3c5683', C.ink);
  rect(g, x0, y0 - 12, x1 - x0, 1, '#ffffff');
  // Cupboard doors along its front, each with a handle.
  for (let x = x0 + 3; x < x1 - 8; x += 16) {
    rect(g, x, y0 + d - 10, 14, 8, '#4a679a');
    rect(g, x, y0 + d - 10, 14, 1, '#6382b8');
    rect(g, x + 6, y0 + d - 8, 3, 1, '#c5cedb');
  }
  // The sink, and the tap over it.
  const sx = x0 + Math.round((x1 - x0) * 0.62);
  rect(g, sx, y0 - 10, 17, 9, '#b8c4d2');
  rect(g, sx + 1, y0 - 9, 15, 6, '#93a3b6');
  rect(g, sx + 7, y0 - 13, 3, 4, '#7d8a9c');
  // The fridge at the west end, tall.
  solid(g, x0 - 1, y0 - 3, 20, d + 3, 28, '#f4f6f9', '#d6dde6', '#aab5c3');
  rect(g, x0 + 15, y0 + d - 24, 1, 9, '#9aa5b4');
  rect(g, x0 - 1, y0 + d - 14, 20, 1, '#aab5c3');
  // The coffee machine on the counter.
  const cx = ax(f, KITCHEN.coffee);
  box(g, cx - 6, y0 + 1, 13, 8, 13, '#2a3342', '#1b222d');
  rect(g, cx - 3, y0 - 10, 7, 2, C.tealLight);
  rect(g, cx - 1, y0 - 4, 4, 4, '#ffffff');
  // Mugs beside it.
  rect(g, cx + 10, y0 - 5, 4, 4, C.amber);
  rect(g, cx + 16, y0 - 5, 4, 4, C.teal);
}

/** The key's paint on the floor: a quiet line, not a court. */
const KEY = '#d9a48c';

/** The basketball hoop on the west wall by the lounge's end, the key painted on the floor in front of it. */
function hoop(g: CanvasRenderingContext2D, f: Frame) {
  const wall = ax(f, FLOOR.minX), z = az(f, HOOP.z);
  const kx1 = ax(f, FLOOR.minX + 2.6), kw = Math.round(1.1 * PPM);
  rect(g, wall, z - kw, kx1 - wall, 1, KEY);
  rect(g, wall, z + kw, kx1 - wall, 1, KEY);
  rect(g, kx1, z - kw, 1, kw * 2 + 1, KEY);
  rect(g, wall, z - 20 - 17, 6, 34, C.board);
  rect(g, wall, z - 20 - 17, 6, 1, '#7d8a9c');
  rect(g, wall + 1, z - 20 - 6, 3, 11, C.red);
  oval(g, wall + 13, z - 20, 6, 3, '#e86a2b');
  oval(g, wall + 13, z - 20, 4, 1, C.floorA);
}

/** Jack-o'-lanterns by the plants and on the kitchen counter. */
function halloween(g: CanvasRenderingContext2D, f: Frame) {
  const pumpkin = sprite(['...GG...', '..OOOO..', '.OOOOOO.', 'OYOOOOYO', 'OYYOOYYO', 'OOOOOOOO', 'OYYYYYYO', '.OOYYOO.', '..OOOO..'], { G: C.leafDark, O: '#e8761f', Y: '#ffd76a' });
  for (const [x, z] of plantsAt(f.level)) {
    blob(g, ax(f, x) + (x < 0 ? 14 : -14), az(f, z) + 1, 4, 1);
    g.drawImage(pumpkin, ax(f, x) + (x < 0 ? 10 : -18), az(f, z) - 8);
  }
  g.drawImage(pumpkin, ax(f, KITCHEN.minX + 3.6), az(f, FLOOR.maxZ) - Math.round(KITCHEN.depth * PPM) - 20);
}

// ---- Plants ---------------------------------------------------------------------------------------
/** The 3D office's three kinds of floor plant, taking turns round the room: monstera, snake plant and ficus. */
export function plantSpecies(i: number): 'monstera' | 'snake' | 'ficus' {
  return (['monstera', 'snake', 'ficus'] as const)[i % 3];
}

/** A potted plant standing at (x, y), `scale` times the usual size, lit from the upper left. */
export function drawPlant(g: CanvasRenderingContext2D, x: number, y: number, scale: number, kind: 'monstera' | 'snake' | 'ficus') {
  const s = Math.max(0.8, scale);
  const pw = Math.round(7 * s), ph = Math.round(6 * s);
  blob(g, x + 2, y + 1, pw * 0.8, 2);
  const pot = kind === 'snake' ? '#8ecae6' : C.pot;
  rect(g, x - (pw >> 1), y - ph, pw, ph, pot);
  rect(g, x - (pw >> 1), y - ph, pw, 2, kind === 'snake' ? '#5c9cbc' : C.potDark);
  rect(g, x - (pw >> 1), y - ph + 2, 1, ph - 2, 'rgba(255,255,255,0.5)');
  rect(g, x + (pw >> 1) - 1, y - ph + 2, 1, ph - 2, 'rgba(9,18,34,0.2)');
  const top = y - ph;
  if (kind === 'snake') {
    const blades: [number, number][] = [[-3, 13], [-1, 17], [1, 15], [3, 11], [0, 9]];
    for (const [dx, h] of blades) {
      const bh = Math.round(h * s);
      rect(g, x + Math.round(dx * s) - 1, top - bh, 2, bh, C.leaf);
      rect(g, x + Math.round(dx * s) - 1, top - bh, 1, bh, C.leafLight);
      rect(g, x + Math.round(dx * s), top - bh + 3, 1, 2, '#c9e27a');
    }
    return;
  }
  if (kind === 'ficus') {
    rect(g, x, top - Math.round(8 * s), 1, Math.round(8 * s), '#8a5a3b');
    oval(g, x + 1, top - 12 * s, 6 * s, 5 * s, C.leafDark);
    oval(g, x - 1, top - 13 * s, 5 * s, 4 * s, C.leaf);
    oval(g, x - 2, top - 14 * s, 2.5 * s, 2 * s, C.leafLight);
    return;
  }
  // Monstera: big leaves fanned out, a notch in each.
  const leaves: [number, number, number, string][] = [
    [1, -7, 6, C.leafDark],
    [-4, -4, 4.5, C.leaf],
    [4, -5, 4.5, C.leafDark],
    [0, -10, 4, C.leaf],
    [-2, -6, 2.5, C.leafLight],
    [-1, -11, 2, C.leafLight],
  ];
  for (const [dx, dy, r, color] of leaves) oval(g, x + dx * s, top + dy * s, r * s, r * s, color);
  rect(g, x + Math.round(-4 * s), top + Math.round(-4 * s), 1, 2, C.leafDark);
  rect(g, x + Math.round(4 * s), top + Math.round(-6 * s), 1, 2, '#1a5240');
}

// ---- What moves -------------------------------------------------------------------------------------
export interface Moving {
  now: number;
  theme: Theme | null;
  /** The jukebox is playing. */
  music: boolean;
  /** Someone's sharing their screen on the TV. */
  sharing: boolean;
}

/** The little things that move: steam off the coffee machine, the jukebox's lights, the TV and arcade screens, the lamps, holiday lights. */
export function drawMoving(g: CanvasRenderingContext2D, f: Frame, m: Moving) {
  const t = m.now;
  // Steam curling up off the coffee machine.
  const cx = ax(f, KITCHEN.coffee), cy = az(f, FLOOR.maxZ) - Math.round(KITCHEN.depth * PPM) - 14;
  for (let i = 0; i < 4; i++) {
    const p = (t / 900 + i / 4) % 1;
    g.globalAlpha = 0.6 * (1 - p);
    rect(g, cx + Math.round(Math.sin(p * 6 + i) * 2), cy - Math.round(p * 12), 1 + (i & 1), 1, '#ffffff');
  }
  g.globalAlpha = 1;
  // The jukebox's lights run round while it plays.
  const east = ax(f, FLOOR.maxX), jd = Math.round(JUKEBOX.depth * PPM);
  const jy = az(f, JUKEBOX.z) - 16;
  const lights = [C.amber, C.tealLight, '#ff6fa8', '#6d7ff2'];
  for (let i = 0; i < 5; i++) rect(g, east - jd + 3, jy + i * 2, jd - 6, 2, m.music ? lights[(i + Math.floor(t / 220)) % 4] : '#6b3550');
  // The arcade's screen flickers through its attract mode.
  const cd = Math.round(CABINET.depth * PPM);
  rect(g, east - cd + 3, az(f, CABINET.z) - 24, cd - 6, 8, ['#5fd9cb', '#6d7ff2', '#2fbf8a', '#5fd9cb'][Math.floor(t / 700) % 4]);
  // The TV glows brighter while someone's sharing.
  const th = Math.round(TV.width * PPM);
  g.globalAlpha = m.sharing ? 0.9 : 0.35 + 0.1 * Math.sin(t / 900);
  rect(g, east - 5, az(f, TV.z) - (th >> 1) + 2, 3, th - 4, C.tealLight);
  g.globalAlpha = 1;
  // The lamps' light breathes a little, as a warm lamp's does.
  const breath = 0.25 + 0.2 * Math.sin(t / 1300);
  for (const l of lamps(f)) pool(g, l.x, l.y, l.r * 0.6, l.color, l.strength * breath);
  drawZoneMoving(g, f, t);
  if (m.theme === 'christmas') christmas(g, f, t);
}

/** A tree in the lounge with its lights twinkling, and a string of lights along the north wall. */
function christmas(g: CanvasRenderingContext2D, f: Frame, t: number) {
  const x = ax(f, 15.6), y = az(f, -5.8);
  blob(g, x + 1, y + 1, 10, 3);
  rect(g, x - 1, y - 4, 4, 5, '#8a5a3b');
  for (let i = 0; i < 5; i++) {
    const w = 4 + i * 3;
    rect(g, x - w, y - 7 - (4 - i) * 6, w * 2 + 1, 6, i % 2 ? '#1f7a55' : '#2a8f63');
    rect(g, x - w, y - 7 - (4 - i) * 6, 2, 6, '#3aa877');
  }
  rect(g, x - 1, y - 39, 3, 3, C.amber);
  const colors = [C.amber, C.red, C.tealLight, '#ffffff'];
  for (let i = 0; i < 12; i++) rect(g, x - 9 + ((i * 7) % 19), y - 10 - ((i * 11) % 26), 1, 1, colors[(i + Math.floor(t / 400)) % 4]);
  const north = az(f, FLOOR.minZ) - 36;
  for (let px = ax(f, FLOOR.minX) + 6, i = 0; px < ax(f, FLOOR.maxX) - 6; px += 8, i++) {
    rect(g, px, north + (i % 2), 2, 2, colors[(i + Math.floor(t / 500)) % 4]);
  }
}

// ---- The signs on the desks -------------------------------------------------------------------------
export interface DeskSign {
  text: string;
  color: string;
  ink: string;
  /** Its middle, on the desk's top, in art pixels. */
  x: number;
  y: number;
}

/** The signs put on the floor's desks (see shared/floorplan.ts): a painted tab on the desk, the words drawn sharp over it (pixel.ts). */
export function deskSigns(f: Frame, plan: FloorPlan): DeskSign[] {
  const out: DeskSign[] = [];
  for (const d of [...DESKS, ...WING_DESKS.filter((w) => deskBuilt(w, f.level))]) {
    const l = plan.labels[d.id];
    if (!l) continue;
    const ink = SIGN_COLORS.find((c) => c.color === l.color)?.ink ?? '#ffffff';
    // Standing on the desk's top at its west end, clear of the screens in the middle.
    out.push({ text: l.text, color: l.color, ink, x: ax(f, d.x - DESK_SIZE.width / 2) + 9, y: az(f, d.z) - Math.round(DESK_SIZE.height * LIFT) });
  }
  return out;
}

/** A sign's painted tab, standing on its desk. */
export function drawSign(g: CanvasRenderingContext2D, s: DeskSign) {
  rect(g, s.x - 7, s.y - 5, 14, 6, s.color);
  rect(g, s.x - 7, s.y + 1, 14, 1, 'rgba(20,34,58,0.35)');
  rect(g, s.x - 5, s.y - 3, 10, 1, s.ink);
}

// ---- The dog ---------------------------------------------------------------------------------------------
/** Where the dog is along its leg `ms` after it began, and which way it's heading. */
export function dogAt(dog: DogState, ms: number): { x: number; z: number; dx: number; walking: boolean } {
  let left = Math.max(0, (ms / 1000) * dog.speed);
  const path = dog.path;
  for (let i = 1; i < path.length; i++) {
    const [x0, z0] = path[i - 1], [x1, z1] = path[i];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (left <= len && len > 0) return { x: x0 + ((x1 - x0) * left) / len, z: z0 + ((z1 - z0) * left) / len, dx: x1 - x0, walking: true };
    left -= len;
  }
  const [x, z] = path[path.length - 1];
  const face = dog.face ?? 0;
  return { x, z, dx: Math.sin(face) || 1, walking: false };
}

const DOG_STAND = ['.........BB..', '........BBBB.', '........BBEBN', 'T.......BBBB.', '.TBBBBBBBBB..', '..BBBBBBBB...', '..BWWWWWBB...', '..B.B..B.B...', '..K.K..K.K...'];
const DOG_STEP = ['.........BB..', '........BBBB.', '........BBEBN', 'T.......BBBB.', '.TBBBBBBBBB..', '..BBBBBBBB...', '..BWWWWWBB...', '.B..B..B..B..', '.K..K..K..K..'];
const DOG_LIE = ['.............', '.............', '.............', '.........BB..', '........BBBB.', 'T.......BBEBN', '.TBBBBBBBBBB.', '.BBWWWWWWBB..', '.KK.....KK...'];

/** The floor's dog, at (x, y) on the floor, facing the way it walks: trotting, standing, lying down, wagging. */
export function drawDog(g: CanvasRenderingContext2D, x: number, y: number, dog: DogState, at: { dx: number; walking: boolean }, now: number) {
  const [coat, belly, dark] = DOG_COATS[dog.coat % DOG_COATS.length] ?? DOG_COATS[0];
  const lying = !at.walking && (dog.act === 'lie' || dog.act === 'nap');
  const rows = lying ? DOG_LIE : at.walking && Math.floor(now / 160) % 2 ? DOG_STEP : DOG_STAND;
  // Wagging: the tail flicks up and down.
  const wag = (dog.act === 'wag' || at.walking) && Math.floor(now / 120) % 2 ? rows.map((r) => r.replace('T', '.').replace(/^\.T/, 'TT')) : rows;
  const pic = sprite(wag, { B: coat, W: belly, N: dark, T: dark, E: '#151d2b', K: dark });
  blob(g, x, y, 7, 2);
  g.save();
  if (at.dx < 0) {
    g.translate(x, 0);
    g.scale(-1, 1);
    g.drawImage(pic, -6, y - 9);
  } else g.drawImage(pic, x - 6, y - 9);
  g.restore();
  if (dog.act === 'bark' && Math.floor(now / 300) % 2) rect(g, x + (at.dx < 0 ? -11 : 10), y - 12, 1, 4, C.ink);
  if (dog.act === 'nap') rect(g, x + 3, y - 14 - (Math.floor(now / 700) % 3), 3, 1, '#6f84a8');
}
