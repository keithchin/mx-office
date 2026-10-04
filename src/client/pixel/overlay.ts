// What the 2D view draws over the office at the screen's own size rather than in art pixels (pixel.ts),
// so it stays sharp at any zoom: names in pills, counts on the boards, the words on the desks' signs,
// and the outline round what the pointer's on.

import type { Label } from './people';
import type { DeskSign } from './props';

/** Where the art is on the screen: device pixels to an art pixel, and its top-left corner in device pixels. */
export interface View {
  scale: number;
  x: number;
  y: number;
  dpr: number;
}

const STATUS_DOT: Record<string, string> = { working: '#5fd9cb', starting: '#5fd9cb', idle: '#c9d4e3', needs_input: '#f2b33d', done: '#2fbf8a', exited: '#8fa3bf', offline: '#8fa3bf' };
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** The names, in a pill: navy for workers (with a dot for how it's doing), white for people. Too small to read beside each other, only the one under the pointer. */
export function drawLabels(g: CanvasRenderingContext2D, v: View, labels: Label[], hover: string | null) {
  const all = v.scale / v.dpr >= 1.5;
  const size = Math.round((v.scale / v.dpr >= 3 ? 13 : 11) * v.dpr);
  g.font = `700 ${size}px ${FONT}`;
  g.textBaseline = 'middle';
  /** The pills drawn so far: one that would overlap another steps a row further from its owner. */
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  for (const l of labels) {
    if (!all && hover !== l.id) continue;
    const text = l.text.length > 14 ? `${l.text.slice(0, 13)}…` : l.text;
    const pad = Math.round(5 * v.dpr), dot = l.status ? Math.round(8 * v.dpr) : 0;
    const w = Math.ceil(g.measureText(text).width) + pad * 2 + dot, hgt = Math.round(size * 1.5);
    let y = Math.round(v.y + l.y * v.scale - (l.above ? hgt : 0));
    const x = Math.round(v.x + l.x * v.scale - w / 2);
    for (let tries = 0; tries < 3 && placed.some((p) => x < p.x + p.w && p.x < x + w && y < p.y + p.h && p.y < y + hgt); tries++) y += (l.above ? -1 : 1) * (hgt + Math.round(2 * v.dpr));
    placed.push({ x, y, w, h: hgt });
    pill(g, x, y, w, hgt, v.dpr, l.human ? '#ffffff' : '#13213a', l.human ? '#9aa6b6' : '#05090f', hover === l.id);
    if (l.status) {
      g.fillStyle = STATUS_DOT[l.status] ?? '#8fa3bf';
      g.fillRect(x + pad, Math.round(y + hgt / 2 - 2.5 * v.dpr), Math.round(5 * v.dpr), Math.round(5 * v.dpr));
    }
    g.fillStyle = l.human ? '#13213a' : '#ffffff';
    g.fillText(text, x + pad + dot, y + hgt / 2 + v.dpr * 0.5);
  }
}

/** A chunky pixel-framed pill: square corners cut a step in, and a hard shadow under it, like a game's name tag. */
function pill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dpr: number, fill: string, edge: string, lit: boolean) {
  const p = Math.max(1, Math.round(dpr * 1.5));
  g.fillStyle = 'rgba(5, 9, 15, 0.45)';
  g.fillRect(x + p, y + h, w - p * 2, p);
  g.fillStyle = lit ? '#17b3a3' : edge;
  g.fillRect(x + p, y - p, w - p * 2, h + p * 2);
  g.fillRect(x - p, y + p, w + p * 2, h - p * 2);
  g.fillRect(x, y, w, h);
  g.fillStyle = fill;
  g.fillRect(x + p, y, w - p * 2, h);
  g.fillRect(x, y + p, w, h - p * 2);
}

/** A count on a board (open issues, PRs, tasks waiting), in the board's top-right corner: nothing at 0. */
export function badge(g: CanvasRenderingContext2D, v: View, at: { x: number; y: number; w: number }, n: number) {
  if (!n) return;
  const size = Math.round(Math.max(10, Math.min(14, 5 * v.scale / v.dpr)) * v.dpr);
  g.font = `900 ${size}px ${FONT}`;
  g.textBaseline = 'middle';
  const text = n > 99 ? '99+' : String(n);
  const w = Math.max(size * 1.4, g.measureText(text).width + size * 0.8), h = Math.round(size * 1.45);
  const x = Math.round(v.x + (at.x + at.w) * v.scale - w * 0.7), y = Math.round(v.y + at.y * v.scale - h * 0.35);
  pill(g, x, y, Math.round(w), h, v.dpr, '#f2b33d', '#05090f', false);
  g.fillStyle = '#13213a';
  g.textAlign = 'center';
  g.fillText(text, x + w / 2, y + h / 2 + v.dpr * 0.5);
  g.textAlign = 'start';
}

/** The words on a desk's sign, over its painted tab. */
export function signText(g: CanvasRenderingContext2D, v: View, s: DeskSign) {
  const size = Math.round(Math.min(11, 2.4 * v.scale / v.dpr) * v.dpr);
  if (size < 7 * v.dpr) return;
  g.font = `800 ${size}px ${FONT}`;
  g.textBaseline = 'middle';
  const text = s.text.length > 14 ? `${s.text.slice(0, 13)}…` : s.text;
  const w = g.measureText(text).width + 6 * v.dpr, h = size * 1.35;
  const x = v.x + s.x * v.scale - w / 2, y = v.y + (s.y - 0.5) * v.scale - h / 2;
  g.fillStyle = s.color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  g.fillStyle = s.ink;
  g.fillText(text, x + 3 * v.dpr, y + h / 2);
}

/** What the pointer's on: a teal frame round it, stepped at the corners; dashed round a free desk. */
export function outline(g: CanvasRenderingContext2D, v: View, s: { x: number; y: number; w: number; h: number }, dashed: boolean) {
  const lw = Math.max(2, Math.round(v.scale / 2));
  const x = Math.round(v.x + (s.x - 1) * v.scale), y = Math.round(v.y + (s.y - 1) * v.scale);
  const w = Math.round((s.w + 2) * v.scale), h = Math.round((s.h + 2) * v.scale);
  g.save();
  g.strokeStyle = '#17b3a3';
  g.lineWidth = lw;
  if (dashed) g.setLineDash([lw * 3, lw * 2]);
  g.strokeRect(x, y, w, h);
  g.restore();
  // Corner brackets, like a game's selection.
  g.fillStyle = '#5fd9cb';
  const c = lw * 4;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
    g.fillRect(sx > 0 ? cx - lw : cx - c + lw, sy > 0 ? cy - lw : cy - lw, c, lw);
    g.fillRect(sx > 0 ? cx - lw : cx, sy > 0 ? cy - lw : cy - c + lw, lw, c);
  }
}
