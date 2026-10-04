// The 2D view's desks and chairs (people.ts draws them in with the people, nearest last): a white
// desk with its shadow, and on it what its team works with — the dev bay's two monitors and a rubber
// duck, the design studio's drawing tablet and swatches, the QA lab's test phone, the analysts'
// chart screen and reports, the PM's papers and mug; a laptop on the open floor. The screen toward
// you shows what its worker is doing: code scrolling while it works, a prompt waiting on you, a tick.

import { DESK_SIZE } from '../../shared/layout';
import type { TeamId } from '../../shared/roster/roles';
import type { WorkerInfo } from '../../shared/protocol';
import { isAsleep } from '../../shared/status';
import { C } from './sprites';
import { blob, box, castShadow, oval, rect } from './paint';
import { LIFT } from './frame';
import type { Pose } from './chars';

export const DESK_H = Math.round(DESK_SIZE.height * LIFT);

/** How a desk is drawn: where, which way its worker faces, whose patch it's in, and who's at it. */
export interface DeskDraw {
  x0: number;
  y0: number;
  dw: number;
  dd: number;
  pose: Pose;
  team: TeamId | null;
  /** The duck sits on one desk in the dev bay. */
  duck: boolean;
  w: WorkerInfo | undefined;
  beat: number;
  slow: number;
}

export function drawDesk(g: CanvasRenderingContext2D, d: DeskDraw) {
  const { x0, y0, dw, dd, pose, w } = d;
  castShadow(g, x0, y0, dw, dd, DESK_H);
  box(g, x0, y0, dw, dd, DESK_H, C.desk, C.deskFront, C.deskEdge);
  rect(g, x0, y0 - DESK_H, dw, 1, '#ffffff');
  // The desk's legs under its front edge, in shade.
  rect(g, x0 + 2, y0 + dd - 2, 2, 2, '#8a96a8');
  rect(g, x0 + dw - 4, y0 + dd - 2, 2, 2, '#8a96a8');
  const top = y0 - DESK_H;
  // What's on it sits on the half nearest its chair.
  const near = pose === 'front' ? top + 3 : top + dd - 10;
  accessories(g, d, top);
  const lit = !!w && !isAsleep(w.status);
  if (d.team === 'development') {
    monitor(g, x0 + (dw >> 1) - 13, near, 12, pose, d, lit);
    monitor(g, x0 + (dw >> 1) + 1, near, 12, pose, d, lit);
  } else if (d.team) monitor(g, x0 + (dw >> 1) - 8, near, 16, pose, d, lit);
  else laptop(g, x0 + (dw >> 1) - 8, near, pose, d);
}

/** A monitor on its foot: from behind (facing its worker, with its light) or its screen toward you. */
function monitor(g: CanvasRenderingContext2D, x: number, near: number, mw: number, pose: Pose, d: DeskDraw, lit: boolean) {
  if (pose === 'front') {
    // Its back toward you, a status light on it.
    rect(g, x + (mw >> 1) - 2, near + 6, 4, 3, '#56637a');
    rect(g, x, near - 4, mw, 10, '#3a4659');
    rect(g, x, near - 4, mw, 1, '#56637a');
    rect(g, x + mw - 1, near - 4, 1, 10, '#273142');
    if (d.w) rect(g, x + (mw >> 1) - 1, near, 2, 2, lit ? statusColor(d.w.status) : '#56637a');
    return;
  }
  rect(g, x + (mw >> 1) - 2, near + 5, 4, 3, '#7d8a9c');
  rect(g, x + (mw >> 1) - 4, near + 7, 8, 2, '#9aa5b4');
  rect(g, x - 1, near - 9, mw + 2, 14, C.laptopEdge);
  screen(g, x, near - 8, mw, 12, d);
  rect(g, x - 1, near - 9, mw + 2, 1, '#56637a');
}

/** A laptop on the open floor's desks: shut with nobody there, open toward its worker otherwise. */
function laptop(g: CanvasRenderingContext2D, x: number, near: number, pose: Pose, d: DeskDraw) {
  const lw = 16;
  if (!d.w) {
    rect(g, x, near + 1, lw, 6, C.laptop);
    rect(g, x, near + 1, lw, 1, '#56637a');
    return;
  }
  if (pose === 'back') {
    rect(g, x, near + 4, lw, 5, '#9aa5b4');
    rect(g, x - 1, near - 7, lw + 2, 11, C.laptopEdge);
    screen(g, x, near - 6, lw, 9, d);
  } else {
    rect(g, x, near, lw, 5, '#9aa5b4');
    rect(g, x - 1, near + 1, lw + 2, 9, C.laptop);
    rect(g, x - 1, near + 1, lw + 2, 1, '#56637a');
    rect(g, x + (lw >> 1) - 1, near + 4, 2, 2, isAsleep(d.w.status) ? '#56637a' : statusColor(d.w.status));
  }
}

/** A screen, as its worker's doing: code scrolling while it works (charts for the analysts, shapes for the designers), a prompt waiting, a tick when done, dark asleep. */
function screen(g: CanvasRenderingContext2D, x: number, y: number, sw: number, sh: number, d: DeskDraw) {
  const w = d.w;
  if (!w || isAsleep(w.status)) {
    rect(g, x, y, sw, sh, C.screenOff);
    rect(g, x + 1, y + 1, 2, sh - 2, 'rgba(255,255,255,0.06)');
    return;
  }
  const shell = w.kind === 'shell';
  const tint = w.status === 'needs_input' ? '#3a2c12' : w.status === 'done' ? '#123426' : shell ? '#0b1210' : C.screen;
  const ink = w.status === 'needs_input' ? C.amber : w.status === 'done' ? C.green : shell ? '#7ee08a' : C.tealLight;
  rect(g, x, y, sw, sh, tint);
  if (w.status === 'starting') return void (d.beat && rect(g, x + 2, y + 2, 3, 1, ink));
  if (w.status === 'working' && d.team === 'analysis') {
    for (let i = 0; i < Math.floor((sw - 2) / 3); i++) {
      const h = 2 + ((d.slow + i * 5) % (sh - 3));
      rect(g, x + 1 + i * 3, y + sh - 1 - h, 2, h, i % 2 ? '#6d7ff2' : ink);
    }
    return;
  }
  if (w.status === 'working' && d.team === 'design') {
    rect(g, x + 2, y + 2, 5, 4, '#e07a5f');
    oval(g, x + sw - 5, y + 4, 2, 2, C.amber);
    rect(g, x + 2, y + sh - 3, sw - 4 - (d.slow % 4), 1, ink);
    return;
  }
  const lines = w.status === 'working' ? Math.floor(sh / 2) - 1 : 2;
  for (let i = 0; i < lines; i++) {
    const n = w.status === 'working' ? (d.slow + i * 3) % 5 : i;
    rect(g, x + 1 + (n % 3), y + 2 + i * 2, Math.min(sw - 3, 3 + ((n * 5) % 9)), 1, i === 0 && w.status === 'working' ? '#ffffff' : ink);
  }
  if (w.status === 'needs_input' && d.beat) rect(g, x + sw - 4, y + sh - 2, 3, 1, ink);
}

/** What else is on each team's desks: a duck, a tablet, a test phone, reports, a mug. */
function accessories(g: CanvasRenderingContext2D, d: DeskDraw, top: number) {
  const { x0, dw, dd, pose } = d;
  const far = pose === 'front' ? top + dd - 8 : top + 2;
  const side = x0 + dw - 11;
  switch (d.team) {
    case 'development':
      if (d.duck) {
        // The rubber duck that every bug gets explained to.
        rect(g, side + 1, far + 1, 6, 4, '#f7d038');
        rect(g, side + 4, far - 2, 4, 4, '#f7d038');
        rect(g, side + 8, far, 2, 1, '#f08a24');
        rect(g, side + 6, far - 1, 1, 1, C.ink);
        rect(g, side + 1, far + 1, 2, 1, '#fff0a0');
      } else {
        rect(g, side + 3, far - 1, 4, 6, '#e05263');
        rect(g, side + 3, far - 1, 4, 1, '#c5cedb');
      }
      break;
    case 'design':
      // A drawing tablet and its pen, and a fan of colour swatches.
      rect(g, x0 + 3, far, 12, 8, '#26324a');
      rect(g, x0 + 4, far + 1, 10, 6, '#3a4659');
      rect(g, x0 + 6, far + 3, 7, 1, '#e07a5f');
      rect(g, x0 + 15, far + 1, 1, 6, '#f2b33d');
      ['#e07a5f', '#f2cc8f', '#81b29a', '#3d405b'].forEach((c, i) => rect(g, side + i * 2, far + 1 - i, 3, 6, c));
      break;
    case 'testing':
      // The phone under test, lit, and a clipboard of test cases.
      rect(g, side + 2, far, 5, 8, '#26324a');
      rect(g, side + 3, far + 1, 3, 6, d.w && !isAsleep(d.w.status) ? C.tealLight : C.screenOff);
      rect(g, x0 + 3, far, 9, 8, '#9a6b3f');
      rect(g, x0 + 4, far + 1, 7, 6, '#ffffff');
      rect(g, x0 + 5, far + 3, 5, 1, C.teal);
      rect(g, x0 + 5, far + 5, 4, 1, '#9aa6b6');
      break;
    case 'analysis':
      // A stack of reports, and a printed chart.
      for (let i = 0; i < 3; i++) rect(g, x0 + 3 + i, far + 4 - i * 2, 10, 3, ['#ffffff', '#e3eaf2', '#6d7ff2'][i]);
      rect(g, side - 1, far, 9, 7, '#ffffff');
      rect(g, side, far + 4, 1, 2, C.teal);
      rect(g, side + 2, far + 2, 1, 4, '#6d7ff2');
      rect(g, side + 4, far + 3, 1, 3, C.amber);
      break;
    case 'management':
      // The plan, a mug of coffee and a nameplate in gold.
      rect(g, x0 + 3, far, 11, 8, '#ffffff');
      rect(g, x0 + 5, far + 2, 7, 1, '#9aa6b6');
      rect(g, x0 + 5, far + 4, 5, 1, C.amber);
      rect(g, side + 2, far + 1, 5, 5, '#ffffff');
      rect(g, side + 3, far + 2, 3, 2, '#7a4e31');
      rect(g, side + 7, far + 2, 1, 2, '#ffffff');
      rect(g, x0 + (dw >> 1) - 6, top + (pose === 'front' ? dd - 4 : 1), 12, 3, '#c99a3a');
      break;
    default:
      rect(g, side + 2, far + 1, 5, 5, '#ffffff');
      rect(g, side + 3, far + 2, 3, 2, '#7a4e31');
  }
}

/** An office chair from above: the seat, its shadow, and its back when that's behind whoever sits there (or nobody does). */
export function drawChair(g: CanvasRenderingContext2D, x: number, y: number, pose: Pose, withBack: boolean, color = C.chair) {
  blob(g, x, y + 1, 8, 3);
  rect(g, x - 1, y - 4, 2, 4, '#56637a');
  rect(g, x - 7, y - 9, 14, 6, lighten(color));
  rect(g, x - 7, y - 4, 14, 1, color);
  rect(g, x - 7, y - 9, 1, 5, 'rgba(255,255,255,0.25)');
  if (!withBack) return;
  if (pose === 'front') {
    rect(g, x - 11, y - 24, 22, 15, color);
    rect(g, x - 11, y - 24, 22, 1, lighten(color));
    rect(g, x - 11, y - 24, 1, 15, 'rgba(255,255,255,0.18)');
    rect(g, x + 10, y - 24, 1, 15, 'rgba(0,0,0,0.25)');
  } else drawChairBack(g, x, y, color);
}

/** A chair's back seen from behind, over the lower back of whoever sits in it. */
export function drawChairBack(g: CanvasRenderingContext2D, x: number, y: number, color = C.chair) {
  rect(g, x - 8, y - 11, 16, 9, color);
  rect(g, x - 8, y - 11, 16, 1, lighten(color));
  rect(g, x - 8, y - 11, 1, 9, 'rgba(255,255,255,0.18)');
  rect(g, x + 7, y - 11, 1, 9, 'rgba(0,0,0,0.25)');
}

function lighten(color: string): string {
  return color === C.chair ? C.chairTop : color;
}

/** The light a worker's monitor shows for how it's doing. */
export function statusColor(status: string): string {
  return status === 'needs_input' ? C.amber : status === 'done' ? C.green : status === 'working' ? C.tealLight : '#8fa3bf';
}
