// Each project team's patch of the 2D view's floor (shared/zones.ts says which desks and where): its
// own floor (the dev bay's dark tiles, the design studio's warm planks, the QA lab's white-and-teal
// tiles, the analysts' soft carpet, the PM's navy carpet with a gold inlay), trimmed in the team's
// colour, with planters at its corners and glass round the PM's office; then what the team has
// about it (decor.ts). The signposts' words are drawn sharp over the art (overlay.ts zoneBanner).

import { ZONES, type TeamZone } from '../../shared/zones';
import type { TeamId } from '../../shared/roster/roles';
import { C } from './sprites';
import { blob, darken, dither, lighten, noise, oval, rect, solid } from './paint';
import { LIFT, ax, az, type Frame } from './frame';
import { decorFor } from './decor';

/** A zone's patch in art pixels. */
export interface ZoneBox {
  zone: TeamZone;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function zoneBoxes(f: Frame): ZoneBox[] {
  return ZONES.map((zone) => ({ zone, x0: ax(f, zone.area.minX), y0: az(f, zone.area.minZ), x1: ax(f, zone.area.maxX), y1: az(f, zone.area.maxZ) }));
}

/** Where a zone's signpost stands, in art pixels: the middle of its north edge, its board this high up. */
export function signAnchor(b: ZoneBox): { x: number; y: number; post: number } {
  return { x: (b.x0 + b.x1) >> 1, y: b.y0 + 6, post: 28 };
}

export function drawZoneFloors(g: CanvasRenderingContext2D, f: Frame) {
  for (const b of zoneBoxes(f)) {
    FLOORS[b.zone.team](g, b);
    trim(g, b);
  }
}

/** Every zone's dividers, signpost and things, after the walls (so their shadows fall on the floor). */
export function drawZoneDecor(g: CanvasRenderingContext2D, f: Frame) {
  for (const b of zoneBoxes(f)) {
    if (b.zone.team === 'management') glassOffice(g, b);
    else planters(g, b);
    decorFor(b.zone.team)(g, f, b);
    signpost(g, b);
  }
}

// ---- The floors -------------------------------------------------------------------------------------
type Paint = (g: CanvasRenderingContext2D, b: ZoneBox) => void;

/** Square tiles `size` across in two colours, with grout, a lit corner and a fleck or two. */
function tiles(g: CanvasRenderingContext2D, b: ZoneBox, size: number, a: string, c: string, grout: string, fleck: string) {
  for (let y = b.y0, j = 0; y < b.y1; y += size, j++) {
    for (let x = b.x0, i = 0; x < b.x1; x += size, i++) {
      const w = Math.min(size, b.x1 - x), h = Math.min(size, b.y1 - y);
      rect(g, x, y, w, h, (i + j) & 1 ? c : a);
      rect(g, x, y, w, 1, grout);
      rect(g, x, y, 1, h, grout);
      if (noise(i * 3 + 1, j * 5 + 2) > 0.6) rect(g, x + 2 + Math.floor(noise(i, j) * (w - 4)), y + 2 + Math.floor(noise(j, i) * (h - 4)), 1, 1, fleck);
    }
  }
}

const FLOORS: Record<TeamId, Paint> = {
  // Dark slate tiles: a focus zone, the screens' glow the brightest thing in it.
  development: (g, b) => {
    tiles(g, b, 10, '#273650', '#2b3b57', '#1d2a40', '#3a4c6c');
    dither(g, b.x0, b.y0, b.x1 - b.x0, 3, 'rgba(0,0,0,0.25)');
  },
  // Warm wooden planks, each its own shade, their ends staggered.
  design: (g, b) => {
    const woods = ['#d6b086', '#cfa577', '#dcb98f', '#c99d6d'];
    for (let y = b.y0, row = 0; y < b.y1; y += 5, row++) {
      const h = Math.min(5, b.y1 - y);
      let x = b.x0 - Math.floor(noise(row, 7) * 30);
      for (let k = 0; x < b.x1; k++) {
        const len = 26 + Math.floor(noise(row, k) * 22);
        const x0 = Math.max(b.x0, x), x1 = Math.min(b.x1, x + len);
        if (x1 > x0) {
          rect(g, x0, y, x1 - x0, h, woods[Math.floor(noise(k, row * 3) * woods.length)]);
          rect(g, x0, y, x1 - x0, 1, 'rgba(255,255,255,0.18)');
          if (x > b.x0) rect(g, x0, y, 1, h, '#a8805a');
          // A knot in the grain now and then.
          if (noise(k * 5, row) > 0.85 && x1 - x0 > 8) rect(g, x0 + 5, y + 2, 2, 1, '#b48a5f');
        }
        x += len;
      }
      rect(g, b.x0, y + h - 1, b.x1 - b.x0, 1, 'rgba(120,80,40,0.25)');
    }
  },
  // A clean lab: white and pale teal tiles, teal grout.
  testing: (g, b) => tiles(g, b, 10, '#f2faf9', '#e3f4f1', '#c3e6e0', '#ffffff'),
  // A soft lavender carpet, its pile dithered.
  analysis: (g, b) => {
    rect(g, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, '#d3d7f0');
    dither(g, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, '#cacff0');
    for (let y = b.y0 + 6; y < b.y1; y += 12) for (let x = b.x0 + 6 + ((y >> 2) & 4); x < b.x1; x += 12) rect(g, x, y, 1, 1, '#b4bbe6');
  },
  // A navy carpet with a little diamond in it, inlaid with gold round the edge.
  management: (g, b) => {
    rect(g, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, '#33416a');
    dither(g, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, '#36466f', 1);
    for (let y = b.y0 + 8; y < b.y1 - 4; y += 10) {
      for (let x = b.x0 + 8 + (((y - b.y0) / 10) & 1) * 5; x < b.x1 - 4; x += 10) {
        rect(g, x, y - 1, 1, 3, '#45578a');
        rect(g, x - 1, y, 3, 1, '#45578a');
      }
    }
    rect(g, b.x0 + 4, b.y0 + 4, b.x1 - b.x0 - 8, 1, '#c99a3a');
    rect(g, b.x0 + 4, b.y1 - 5, b.x1 - b.x0 - 8, 1, '#c99a3a');
    rect(g, b.x0 + 4, b.y0 + 4, 1, b.y1 - b.y0 - 8, '#c99a3a');
    rect(g, b.x1 - 5, b.y0 + 4, 1, b.y1 - b.y0 - 8, '#c99a3a');
  },
};

/** A border in the team's colour round its patch, lit on the top and left, and its shadow on the right. */
function trim(g: CanvasRenderingContext2D, b: ZoneBox) {
  const c = b.zone.color, w = b.x1 - b.x0, h = b.y1 - b.y0;
  rect(g, b.x0, b.y0, w, 2, lighten(c, 0.15));
  rect(g, b.x0, b.y0, 2, h, lighten(c, 0.15));
  rect(g, b.x0, b.y1 - 2, w, 2, darken(c, 0.2));
  rect(g, b.x1 - 2, b.y0, 2, h, darken(c, 0.2));
  rect(g, b.x0 + 2, b.y0 + 2, w - 4, 1, 'rgba(9,18,34,0.18)');
  rect(g, b.x0 + 2, b.y0 + 2, 1, h - 4, 'rgba(9,18,34,0.18)');
}

// ---- Dividers -----------------------------------------------------------------------------------------
/** A long low planter of little shrubs: `w` across from (x, y), where it stands on the floor. */
export function planter(g: CanvasRenderingContext2D, x: number, y: number, w: number, color: string) {
  solid(g, x, y - 6, w, 6, 6, '#e8edf3', darken(color, 0.25), lighten(color, 0.1));
  rect(g, x, y - 12, w, 1, '#c5cedb');
  for (let i = 0; i < w - 3; i += 5) {
    const tall = 3 + Math.floor(noise(x + i, y) * 4);
    oval(g, x + 3 + i, y - 13 - tall / 2, 3, tall / 2 + 1, C.leafDark);
    oval(g, x + 2 + i, y - 14 - tall / 2, 2, tall / 2, C.leaf);
    rect(g, x + 1 + i, y - 15 - tall / 2, 1, 1, C.leafLight);
  }
}

/** Planters at a zone's corners, marking where it starts without walling it in. */
function planters(g: CanvasRenderingContext2D, b: ZoneBox) {
  const c = b.zone.color, run = 26;
  planter(g, b.x0 + 3, b.y1 - 2, run, c);
  // The analysts' shelf of reports has the other corner.
  if (b.zone.team !== 'analysis') planter(g, b.x1 - 3 - run, b.y1 - 2, run, c);
}

/** Glass round the PM's office (a door gap in the north side), so it reads as a corner office. */
function glassOffice(g: CanvasRenderingContext2D, b: ZoneBox) {
  const hgt = Math.round(1.1 * LIFT);
  const pane = (x: number, y: number, w: number) => {
    rect(g, x, y - hgt, w, hgt, 'rgba(170, 220, 230, 0.28)');
    rect(g, x, y - hgt, w, 1, '#9cc4d4');
    rect(g, x, y, w, 1, '#6f93b3');
    rect(g, x, y + 1, w, 2, 'rgba(9,18,34,0.15)');
    for (let gx = x + 5; gx < x + w - 6; gx += 22) {
      rect(g, gx, y - hgt + 3, 1, hgt - 5, 'rgba(255,255,255,0.55)');
      rect(g, gx + 2, y - hgt + 5, 1, hgt - 9, 'rgba(255,255,255,0.35)');
    }
  };
  const side = (x: number) => {
    rect(g, x - 1, b.y0 - hgt, 3, b.y1 - b.y0 + hgt, 'rgba(170, 220, 230, 0.32)');
    rect(g, x - 1, b.y0 - hgt, 1, b.y1 - b.y0 + hgt, '#9cc4d4');
    rect(g, x + 2, b.y0, 2, b.y1 - b.y0, 'rgba(9,18,34,0.12)');
  };
  side(b.x0);
  side(b.x1);
  // The north wall of glass, with its door; the south one in front of the desks.
  const door0 = b.x0 + Math.round((b.x1 - b.x0) * 0.62), door1 = door0 + 22;
  pane(b.x0, b.y0, door0 - b.x0);
  pane(door1, b.y0, b.x1 - door1);
  rect(g, door0, b.y0 - hgt, 2, hgt, '#6f93b3');
  rect(g, door1 - 2, b.y0 - hgt, 2, hgt, '#6f93b3');
  pane(b.x0, b.y1, b.x1 - b.x0);
}

/** The post under a zone's signpost; the board and its words are drawn sharp on top (overlay.ts). */
function signpost(g: CanvasRenderingContext2D, b: ZoneBox) {
  const a = signAnchor(b);
  blob(g, a.x, a.y, 6, 2);
  rect(g, a.x - 1, a.y - a.post, 3, a.post, '#5c6b80');
  rect(g, a.x - 1, a.y - a.post, 1, a.post, '#8fa3bf');
  rect(g, a.x - 5, a.y - 2, 11, 3, '#3a4659');
  rect(g, a.x - 5, a.y - 2, 11, 1, '#56637a');
}
