// The smoking balcony out past the south wall's glass doors (shared/layout.ts BALCONY), as the 3D
// office has it: a deck of boards, a railing round its three open sides, the standing ashtray where a
// smoke break happens, and a planter. Part of the still office (office.ts); benched Leads come out
// here for a smoke (breaks.ts).

import { ASHTRAY, BALCONY } from '../../shared/layout';
import { C } from './sprites';
import { blob, oval, rect } from './paint';
import { ax, az, type Frame } from './frame';
import { drawPlant } from './props';

export function drawBalcony(g: CanvasRenderingContext2D, f: Frame) {
  const x0 = ax(f, BALCONY.minX), x1 = ax(f, BALCONY.maxX), y0 = az(f, BALCONY.minZ), y1 = az(f, BALCONY.maxZ);
  // The deck: weathered boards running across, a gap between each.
  rect(g, x0, y0, x1 - x0, y1 - y0, '#8f7b66');
  for (let y = y0; y < y1; y += 5) {
    rect(g, x0, y, x1 - x0, 4, (y / 5) % 2 ? '#a48e76' : '#9c866e');
    rect(g, x0, y, x1 - x0, 1, 'rgba(255,255,255,0.12)');
  }
  // Its shadow under the wall, and the railing round the open sides: posts, a top rail and a lit edge.
  rect(g, x0, y0, x1 - x0, 3, 'rgba(9, 18, 34, 0.25)');
  const rail = '#3b4a63', top = '#8fa3bf';
  rect(g, x0, y1 - 3, x1 - x0, 3, rail);
  rect(g, x0, y1 - 3, x1 - x0, 1, top);
  rect(g, x0, y0, 3, y1 - y0, rail);
  rect(g, x0, y0, 1, y1 - y0, top);
  rect(g, x1 - 3, y0, 3, y1 - y0, rail);
  rect(g, x1 - 1, y0, 1, y1 - y0, top);
  for (let x = x0 + 12; x < x1 - 6; x += 16) rect(g, x, y1 - 6, 2, 6, rail);
  // The standing ashtray: a steel bin with a sand top, a stub or two in it.
  const ax0 = ax(f, ASHTRAY.x), ay0 = az(f, ASHTRAY.z);
  blob(g, ax0, ay0 + 1, 5, 2);
  rect(g, ax0 - 3, ay0 - 12, 7, 12, '#7d8a9c');
  rect(g, ax0 - 3, ay0 - 12, 1, 12, '#aab5c3');
  oval(g, ax0, ay0 - 12, 4, 2, '#d9cfb8');
  rect(g, ax0 - 1, ay0 - 13, 2, 1, '#f4f1ea');
  rect(g, ax0 + 1, ay0 - 12, 1, 1, C.ink);
  // A planter at the east end.
  drawPlant(g, x1 - 14, y1 - 8, 1.1, 'snake');
}
