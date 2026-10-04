// The 2D view's light (office.ts draws it into the still picture; props.ts breathes the lamps): the
// daylight falling in through the west and south windows in pale patches across the floor, the
// shade where the floor meets the walls (ambient occlusion, a few steps of it dithered, so it
// stays pixel art), and each team's lamps, a warm or cool pool of light in the team's own mood.
// The sun is in the west, so the window light leans east and a little south, and everything's
// shadow falls the same way (paint.ts).

import { FLOOR, WINDOWS, wingMinZ, WING } from '../../shared/layout';
import { ZONES } from '../../shared/zones';
import type { TeamId } from '../../shared/roster/roles';
import { dither, oval, rect } from './paint';
import { PPM, ax, az, type Frame } from './frame';

/** Each team's lamps: where in its patch (0..1 across and down), and the light's colour. */
const LAMPS: Record<TeamId, { at: readonly (readonly [number, number])[]; color: string; strength: number }> = {
  development: { at: [[0.86, 0.75], [0.5, 0.5]], color: '95, 217, 203', strength: 0.1 },
  design: { at: [[0.18, 0.3], [0.82, 0.3], [0.5, 0.78]], color: '255, 196, 120', strength: 0.11 },
  testing: { at: [[0.5, 0.5]], color: '235, 255, 252', strength: 0.12 },
  analysis: { at: [[0.5, 0.45]], color: '170, 160, 255', strength: 0.1 },
  management: { at: [[0.5, 0.5]], color: '255, 214, 120', strength: 0.1 },
};

/** The open floor's own lamps: over the lounge, and the aisle by the whiteboard. */
const OPEN_LAMPS: readonly (readonly [number, number])[] = [
  [14, 0],
  [6.5, -1.5],
];

/** Where each lamp is in art pixels, its colour and how bright: the lamps' glow breathes from this too. */
export function lamps(f: Frame): { x: number; y: number; color: string; strength: number; r: number }[] {
  const out: { x: number; y: number; color: string; strength: number; r: number }[] = [];
  for (const z of ZONES) {
    const l = LAMPS[z.team];
    for (const [u, v] of l.at) {
      const x = z.area.minX + (z.area.maxX - z.area.minX) * u, y = z.area.minZ + (z.area.maxZ - z.area.minZ) * v;
      out.push({ x: ax(f, x), y: az(f, y), color: l.color, strength: l.strength, r: 30 });
    }
  }
  for (const [x, z] of OPEN_LAMPS) out.push({ x: ax(f, x), y: az(f, z), color: '255, 236, 190', strength: 0.08, r: 38 });
  return out;
}

/** A pool of light: three rings, each a step brighter toward the middle, so its edge is pixel-crisp. */
export function pool(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, strength: number) {
  for (const [k, a] of [[1, 0.45], [0.7, 0.7], [0.42, 1]] as const) oval(g, x, y, r * k, r * k * 0.62, `rgba(${color}, ${(strength * a).toFixed(3)})`);
}

/** Every lamp's pool of light, over the floor and what's on it. */
export function drawLamps(g: CanvasRenderingContext2D, f: Frame) {
  for (const l of lamps(f)) pool(g, l.x, l.y, l.r, l.color, l.strength);
}

/** Daylight through the windows: a patch on the floor in from each, leaning away from the sun. */
export function drawWindowLight(g: CanvasRenderingContext2D, f: Frame) {
  const west = ax(f, FLOOR.minX), south = az(f, FLOOR.maxZ);
  for (const w of WINDOWS) {
    if (w.y0 >= 3) continue;
    if (w.wall === 'west') {
      // In through the west wall, east across the floor, sliding south as it goes.
      const y0 = az(f, w.u - w.width / 2), len = Math.round(3.4 * PPM), hgt = Math.round(w.width * PPM);
      for (let i = 0; i < len; i += 2) {
        const a = i < len * 0.45 ? 0.3 : i < len * 0.75 ? 0.19 : 0.1;
        rect(g, west + i, y0 + Math.round(i * 0.35), 2, hgt, `rgba(255, 246, 220, ${a})`);
      }
      dither(g, west + len, y0 + Math.round(len * 0.35), 6, hgt, 'rgba(255, 246, 220, 0.08)');
    } else if (w.wall === 'south') {
      // In through the south wall, a shorter patch north, leaning east.
      const x0 = ax(f, w.u - w.width / 2), len = Math.round(1.8 * PPM), wid = Math.round(w.width * PPM);
      for (let i = 0; i < len; i += 2) {
        const a = i < len * 0.5 ? 0.24 : 0.12;
        rect(g, x0 + Math.round(i * 0.4), south - i - 2, wid, 2, `rgba(255, 246, 220, ${a})`);
      }
    }
  }
}

/** The shade along the foot of every wall, deepest right at the wall. */
export function drawAmbient(g: CanvasRenderingContext2D, f: Frame) {
  const north = az(f, FLOOR.minZ), south = az(f, FLOOR.maxZ), west = ax(f, FLOOR.minX), east = ax(f, FLOOR.maxX);
  const along = (x: number, y: number, w: number, h: number, dir: 'down' | 'up' | 'right' | 'left') => {
    const steps: [number, number][] = [[3, 0.22], [3, 0.12], [4, 0]];
    let k = 0;
    for (const [n, a] of steps) {
      const c = a ? `rgba(9, 18, 34, ${a})` : 'rgba(9, 18, 34, 0.08)';
      if (dir === 'down') a ? rect(g, x, y + k, w, n, c) : dither(g, x, y + k, w, n, c);
      if (dir === 'up') a ? rect(g, x, y - k - n, w, n, c) : dither(g, x, y - k - n, w, n, c);
      if (dir === 'right') a ? rect(g, x + k, y, n, h, c) : dither(g, x + k, y, n, h, c);
      if (dir === 'left') a ? rect(g, x - k - n, y, n, h, c) : dither(g, x - k - n, y, n, h, c);
      k += n;
    }
  };
  // The north wall stands between the floor and the sun's height: its foot gets the deepest shade.
  along(west, north, (f.level > 0 ? ax(f, WING.minX) : east) - west, 0, 'down');
  if (f.level > 0) along(ax(f, WING.minX), az(f, wingMinZ(f.level)), east - ax(f, WING.minX), 0, 'down');
  along(west, north, 0, south - north, 'right');
  along(east, f.level > 0 ? az(f, wingMinZ(f.level)) : north, 0, south - (f.level > 0 ? az(f, wingMinZ(f.level)) : north), 'left');
  along(west, south, east - west, 0, 'up');
}
