// What each team keeps about its patch of the 2D view's floor (zones.ts): the dev bay's server racks,
// cable tray and drinks fridge; the design studio's mood board, easel and paint; the QA lab's device
// rack and bug board, and a magnifier on the floor; the analysts' chart screen, graphs and reports;
// the PM's roadmap, a round table and a plant. Positions are from each patch's corners, clear of its
// desks and chairs. A few lights on them blink and tick every frame: drawZoneMoving.

import type { TeamId } from '../../shared/roster/roles';
import { C } from './sprites';
import { blob, oval, rect, solid } from './paint';
import type { Frame } from './frame';
import { zoneBoxes, type ZoneBox } from './zones';
import { drawPlant } from './props';

type Decor = (g: CanvasRenderingContext2D, f: Frame, b: ZoneBox) => void;

export function decorFor(team: TeamId): Decor {
  return DECOR[team];
}

/**
 * A board on two legs, its face to the room: `w` across, its panel `h` tall standing `up` off the
 * floor at (x, y). `face` draws what's on the panel, from its top-left corner.
 */
export function standBoard(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, up: number, frame: string, face: (px: number, py: number) => void) {
  blob(g, x + (w >> 1), y, (w >> 1) + 1, 2);
  rect(g, x + 3, y - up, 2, up, '#5c6b80');
  rect(g, x + w - 5, y - up, 2, up, '#5c6b80');
  rect(g, x + 1, y - 1, 6, 2, C.ink);
  rect(g, x + w - 7, y - 1, 6, 2, C.ink);
  rect(g, x - 1, y - up - h - 1, w + 2, h + 2, frame);
  rect(g, x - 1, y - up - h - 1, w + 2, 1, 'rgba(255,255,255,0.35)');
  face(x, y - up - h);
}

const DECOR: Record<TeamId, Decor> = {
  development: (g, _f, b) => {
    // Two server racks against the west side, their fronts to the room, lights down them.
    for (const [i, y] of [b.y0 + 52, b.y0 + 84].entries()) {
      solid(g, b.x0 + 8, y - 12, 20, 12, 30, '#3a4659', '#1b2232', '#56637a');
      for (let r = 0; r < 6; r++) {
        rect(g, b.x0 + 10, y - 28 + r * 4, 16, 3, '#273142');
        rect(g, b.x0 + 11, y - 27 + r * 4, 8, 1, '#0f1520');
        rect(g, b.x0 + 22 + (r + i) % 2, y - 27 + r * 4, 1, 1, r % 3 ? C.green : C.amber);
      }
    }
    // A cable tray along the north edge, its cables in colours.
    const tx0 = b.x0 + 32, tx1 = b.x1 - 30, ty = b.y0 + 6;
    rect(g, tx0, ty, tx1 - tx0, 4, '#3a4659');
    rect(g, tx0, ty, tx1 - tx0, 1, '#56637a');
    ['#5fd9cb', '#f2b33d', '#e05263'].forEach((c, i) => rect(g, tx0 + 2, ty + 1 + i, tx1 - tx0 - 4, 1, c));
    rect(g, tx0, ty + 4, tx1 - tx0, 1, 'rgba(0,0,0,0.3)');
    // A drinks fridge on the east side, cans behind its glass.
    const fx = b.x1 - 30, fy = b.y0 + 62;
    solid(g, fx, fy - 10, 18, 10, 22, '#dfe6ee', '#2c3a52', '#56637a');
    rect(g, fx + 2, fy - 20, 14, 16, '#14202f');
    for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) rect(g, fx + 3 + k * 3, fy - 19 + r * 5, 2, 4, [C.tealLight, '#e05263', C.amber, '#6d7ff2'][(r + k) % 4]);
    rect(g, fx + 2, fy - 20, 1, 16, 'rgba(255,255,255,0.35)');
    // A floor lamp by the fridge (its glow is light.ts's).
    blob(g, b.x1 - 20, b.y0 + 108, 4, 1);
    rect(g, b.x1 - 21, b.y0 + 84, 1, 24, '#56637a');
    oval(g, b.x1 - 21, b.y0 + 83, 5, 3, '#1f8a8a');
    rect(g, b.x1 - 24, b.y0 + 82, 4, 1, C.tealLight);
  },
  design: (g, _f, b) => {
    // The mood board: photos, swatches and a sketch, on a stand on the west side.
    standBoard(g, b.x0 + 4, b.y0 + 70, 30, 22, 10, '#a8805a', (x, y) => {
      rect(g, x, y, 30, 22, '#f1e6d6');
      ['#e07a5f', '#f2cc8f', '#81b29a', '#3d405b', '#f4f1de'].forEach((c, i) => rect(g, x + 2 + i * 5, y + 2, 4, 4, c));
      rect(g, x + 2, y + 9, 12, 10, '#9fc7e3');
      rect(g, x + 2, y + 15, 12, 4, '#81b29a');
      oval(g, x + 10, y + 12, 2, 2, '#ffd76a');
      rect(g, x + 17, y + 9, 11, 10, '#ffffff');
      rect(g, x + 19, y + 11, 7, 1, C.ink);
      rect(g, x + 19, y + 14, 5, 1, '#e07a5f');
      rect(g, x + 16, y + 1, 2, 2, '#e05263');
    });
    // An easel with a painting on the go, and a stool with the palette on it.
    const ex = b.x1 - 30, ey = b.y0 + 60;
    blob(g, ex + 10, ey, 10, 2);
    rect(g, ex + 2, ey - 26, 2, 26, '#8a6040');
    rect(g, ex + 16, ey - 26, 2, 26, '#8a6040');
    rect(g, ex + 9, ey - 30, 2, 30, '#a8805a');
    rect(g, ex, ey - 12, 20, 2, '#a8805a');
    rect(g, ex + 1, ey - 30, 18, 17, '#fbf6ec');
    rect(g, ex + 2, ey - 29, 16, 15, '#9fd4e6');
    rect(g, ex + 2, ey - 19, 16, 5, '#81b29a');
    oval(g, ex + 13, ey - 25, 3, 3, '#f2b33d');
    rect(g, ex + 4, ey - 22, 5, 3, '#e07a5f');
    const sx = b.x1 - 22, sy = b.y0 + 98;
    blob(g, sx, sy, 6, 2);
    rect(g, sx - 4, sy - 8, 1, 8, '#8a6040');
    rect(g, sx + 3, sy - 8, 1, 8, '#8a6040');
    oval(g, sx, sy - 9, 6, 3, '#a8805a');
    oval(g, sx, sy - 10, 5, 2, '#f1e6d6');
    ['#e07a5f', '#3d405b', '#81b29a', '#f2b33d'].forEach((c, i) => rect(g, sx - 4 + i * 2, sy - 11 + (i & 1), 1, 1, c));
    // Rolled-up sketches in a basket by the mood board.
    oval(g, b.x0 + 14, b.y0 + 108, 7, 4, '#b48a5f');
    for (const [dx, c] of [[-3, '#f1e6d6'], [0, '#9fc7e3'], [3, '#f2cc8f']] as const) rect(g, b.x0 + 13 + dx, b.y0 + 96, 2, 11, c);
    oval(g, b.x0 + 14, b.y0 + 107, 7, 2, '#c99f72');
  },
  testing: (g, _f, b) => {
    // The device rack: phones and tablets on shelves, each lit up mid-test.
    const rx = b.x0 + 6, ry = b.y0 + 48;
    solid(g, rx, ry - 10, 26, 10, 30, '#e8edf3', '#c5cedb', '#ffffff');
    for (let s = 0; s < 3; s++) {
      rect(g, rx + 1, ry - 30 + s * 9, 24, 1, '#9aa5b4');
      for (let k = 0; k < 4; k++) {
        const tall = (k + s) % 3 === 0;
        rect(g, rx + 2 + k * 6, ry - 29 + s * 9 + (tall ? 0 : 2), 5, tall ? 8 : 6, '#26324a');
        rect(g, rx + 3 + k * 6, ry - 28 + s * 9 + (tall ? 0 : 2), 3, tall ? 6 : 4, (k + s) % 4 === 1 ? '#f2b33d' : C.tealLight);
      }
    }
    // The bug board on its stand: cards pinned in columns (to do, red; doing, amber; fixed, green), a magnifier on it.
    standBoard(g, b.x0 + 4, b.y0 + 112, 32, 22, 8, '#9a6b3f', (x, y) => {
      rect(g, x, y, 32, 22, '#d9b98f');
      for (const [col, color] of [[0, '#e05263'], [1, '#f2b33d'], [2, '#2fbf8a']] as const) {
        for (let k = 0; k < 3 - col; k++) {
          rect(g, x + 2 + col * 10, y + 3 + k * 6, 8, 5, '#ffffff');
          rect(g, x + 2 + col * 10, y + 3 + k * 6, 8, 1, color);
          rect(g, x + 5 + col * 10, y + 3 + k * 6, 1, 1, C.ink);
        }
      }
      oval(g, x + 25, y + 15, 3, 3, C.tealDark);
      oval(g, x + 25, y + 15, 2, 2, '#c8f1ec');
      rect(g, x + 27, y + 18, 2, 2, C.tealDark);
    });
    // A big magnifier painted on the floor, the lab's sign.
    const mx = b.x1 - 26, my = b.y0 + 62;
    oval(g, mx, my, 10, 7, C.teal);
    oval(g, mx, my, 7, 5, '#e3f4f1');
    oval(g, mx - 2, my - 2, 2, 1, '#ffffff');
    for (let i = 0; i < 7; i++) rect(g, mx + 7 + i, my + 5 + Math.round(i * 0.7), 3, 2, C.tealDark);
    // A test bench with a phone on a stand and a cup of coffee.
    const tx = b.x1 - 34, ty = b.y0 + 116;
    solid(g, tx, ty - 10, 28, 10, 10, '#f8f9fb', '#a7b3c4', '#c5cedb');
    rect(g, tx + 6, ty - 26, 1, 6, '#5c6b80');
    rect(g, tx + 3, ty - 30, 7, 10, '#26324a');
    rect(g, tx + 4, ty - 29, 5, 8, C.tealLight);
    rect(g, tx + 18, ty - 22, 4, 4, '#ffffff');
    rect(g, tx + 18, ty - 22, 4, 1, '#7a4e31');
  },
  analysis: (g, _f, b) => {
    // A big screen on a stand, its dashboard of charts (the bars tick over in drawZoneMoving).
    standBoard(g, b.x0 + 3, b.y0 + 46, 34, 20, 9, '#1b2232', (x, y) => {
      rect(g, x, y, 34, 20, '#0f1d33');
      rect(g, x + 2, y + 2, 14, 1, '#8fa3bf');
      for (let i = 0; i < 6; i++) rect(g, x + 2 + i * 2, y + 16 - [5, 8, 6, 10, 9, 12][i], 1, [5, 8, 6, 10, 9, 12][i], i % 2 ? '#6d7ff2' : C.tealLight);
      oval(g, x + 25, y + 9, 5, 5, '#6d7ff2');
      rect(g, x + 25, y + 4, 5, 5, C.amber);
      rect(g, x + 25, y + 9, 1, 1, '#0f1d33');
    });
    // A whiteboard of graphs: a line going up, and a pie.
    standBoard(g, b.x0 + 4, b.y0 + 98, 30, 18, 8, '#7d8a9c', (x, y) => {
      rect(g, x, y, 30, 18, C.board);
      rect(g, x + 2, y + 15, 16, 1, C.ink);
      rect(g, x + 2, y + 3, 1, 13, C.ink);
      [[3, 12], [6, 11], [9, 12], [12, 8], [15, 6], [17, 4]].forEach(([dx, dy]) => rect(g, x + dx, y + dy, 2, 1, '#e05263'));
      oval(g, x + 24, y + 8, 4, 4, '#6d7ff2');
      rect(g, x + 24, y + 4, 4, 4, C.teal);
    });
    // A low shelf of reports along the south edge: binders in colours.
    const sx = b.x0 + 40, sy = b.y1 - 6;
    solid(g, sx, sy - 8, 36, 8, 10, '#c9b49a', '#a8927a', '#e2d2bd');
    for (let i = 0; i < 8; i++) rect(g, sx + 2 + i * 4, sy - 17 + (i % 3 === 2 ? 1 : 0), 3, 8 - (i % 3 === 2 ? 1 : 0), ['#6d7ff2', '#3d4f8c', '#8fa3bf', C.teal][i % 4]);
  },
  management: (g, _f, b) => {
    // The roadmap on a stand: quarters across the top, a bar for each stream of work, a milestone flag.
    standBoard(g, b.x1 - 46, b.y0 + 44, 40, 22, 9, '#1b2436', (x, y) => {
      rect(g, x, y, 40, 22, C.board);
      for (let q = 0; q < 4; q++) rect(g, x + 1 + q * 10, y + 1, 9, 3, q % 2 ? '#dbe3ee' : '#c9d4e3');
      [[2, 14, '#e07a5f'], [8, 20, '#1f8a8a'], [14, 18, C.teal], [6, 26, '#6d7ff2']].forEach(([x0, w, c], i) => rect(g, x + (x0 as number), y + 6 + i * 4, w as number, 2, c as string));
      rect(g, x + 30, y + 5, 1, 15, '#e05263');
      rect(g, x + 31, y + 5, 4, 3, '#e05263');
    });
    // A little round table for one-to-ones, and its two stools.
    const tx = b.x1 - 26, ty = b.y0 + 100;
    blob(g, tx, ty + 1, 11, 3);
    rect(g, tx - 1, ty - 8, 2, 8, '#5c6b80');
    oval(g, tx, ty - 9, 11, 5, '#c9b49a');
    oval(g, tx - 1, ty - 10, 9, 3, '#e2d2bd');
    rect(g, tx - 4, ty - 12, 5, 3, '#ffffff');
    rect(g, tx + 3, ty - 11, 3, 3, C.amber);
    for (const dx of [-17, 17]) {
      blob(g, tx + dx, ty + 1, 5, 2);
      oval(g, tx + dx, ty - 4, 5, 3, C.chair);
      oval(g, tx + dx - 1, ty - 5, 3, 1, C.chairTop);
    }
    drawPlant(g, b.x1 - 9, b.y1 - 6, 1.1, 'monstera');
  },
};

/** What blinks and ticks over on the teams' things: the racks' lights, the device screens, the analysts' bars. */
export function drawZoneMoving(g: CanvasRenderingContext2D, f: Frame, now: number) {
  const t = Math.floor(now / 300);
  for (const b of zoneBoxes(f)) {
    if (b.zone.team === 'development') {
      for (const [i, y] of [b.y0 + 52, b.y0 + 84].entries()) {
        for (let r = 0; r < 6; r++) if ((t + r * 3 + i * 5) % 7 < 2) rect(g, b.x0 + 24, y - 27 + r * 4, 1, 1, C.tealLight);
      }
    } else if (b.zone.team === 'testing') {
      const rx = b.x0 + 6, ry = b.y0 + 48, k = t % 4, s = Math.floor(t / 4) % 3;
      rect(g, rx + 3 + k * 6, ry - 26 + s * 9, 3, 2, '#ffffff');
    } else if (b.zone.team === 'analysis') {
      const x = b.x0 + 3, y = b.y0 + 46 - 9 - 20, h = 4 + ((t >> 1) % 8);
      rect(g, x + 14, y + 4, 1, 12, '#0f1d33');
      rect(g, x + 14, y + 16 - h, 1, h, C.amber);
    }
  }
}
