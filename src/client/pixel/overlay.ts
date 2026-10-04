// What the 2D view draws over the office at the screen's own size rather than in art pixels (pixel.ts),
// so it stays sharp at any zoom: names in pills (with a Lead's role, or anyone else's task, under
// them), each team's signpost, counts on the boards, the words on the desks' signs, and the outline
// round what the pointer's on.

import type { Label } from './people';
import type { DeskSign } from './props';
import type { ZoneBox } from './zones';
import { signAnchor } from './zones';

/** Where the art is on the screen: device pixels to an art pixel, and its top-left corner in device pixels. */
export interface View {
  scale: number;
  x: number;
  y: number;
  dpr: number;
}

const STATUS_DOT: Record<string, string> = { working: '#5fd9cb', starting: '#5fd9cb', idle: '#c9d4e3', needs_input: '#f2b33d', done: '#2fbf8a', exited: '#8fa3bf', offline: '#8fa3bf' };
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** A box on the screen, in device pixels: a label placed so far, or a signpost labels keep clear of. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The names, in a pill: navy for workers (with a dot for how it's doing), white for people, and
 * under (or over) a worker's, a Lead's role in its team's colour or, zoomed in, anyone's task. Too
 * small to read beside each other, only the one under the pointer. One that would overlap another
 * (or a signpost, `avoid`) slides sideways a little, else steps a row further from its owner.
 */
export function drawLabels(g: CanvasRenderingContext2D, v: View, labels: Label[], hover: string | null, avoid: Box[] = []) {
  const zoom = v.scale / v.dpr;
  const all = zoom >= 1.2;
  const size = Math.round((zoom >= 3 ? 13 : zoom >= 2 ? 12 : 11) * v.dpr);
  const small = Math.round(size * 0.82);
  const pad = Math.round(5 * v.dpr), gap = Math.round(2 * v.dpr);
  g.textBaseline = 'middle';
  const placed: Box[] = [...avoid];
  for (const l of labels) {
    if (!all && hover !== l.id) continue;
    g.font = `700 ${size}px ${FONT}`;
    const text = l.text.length > 14 ? `${l.text.slice(0, 13)}…` : l.text;
    const dot = l.status ? Math.round(8 * v.dpr) : 0;
    const w = Math.ceil(g.measureText(text).width) + pad * 2 + dot, hgt = Math.round(size * 1.5);
    // The second line: a Lead's role in its team's colour, always; anyone's task once there's room to read it.
    const tag = l.tag && (l.tag.color || zoom >= 2.5 || hover === l.id) ? l.tag : undefined;
    let tt = '', tw = 0, th = 0;
    if (tag) {
      g.font = `800 ${small}px ${FONT}`;
      const full = zoom < 2.2 && tag.short ? tag.short : tag.text;
      tt = full.length > 22 ? `${full.slice(0, 21)}…` : full;
      tw = Math.ceil(g.measureText(tt).width) + pad * 2;
      th = Math.round(small * 1.45);
    }
    // The block of both lines, centred on its owner: the role over the name when it's over the head.
    const bw = Math.max(w, tw), bh = hgt + th;
    const cx = Math.round(v.x + l.x * v.scale);
    let box: Box = { x: cx - (bw >> 1), y: Math.round(v.y + l.y * v.scale - (l.above ? bh : 0)), w: bw, h: bh };
    for (let tries = 0; tries < 4; tries++) {
      const other = placed.find((p) => hits(box, p));
      if (!other) break;
      const right = other.x + other.w + gap - box.x, left = box.x + box.w + gap - other.x;
      const slide = Math.min(right, left) <= bw * 0.6 ? (right <= left ? right : -left) : 0;
      const moved = { ...box, x: box.x + slide };
      if (slide && !placed.some((p) => hits(moved, p))) box = moved;
      else box = { ...box, y: box.y + (l.above ? -1 : 1) * (bh + gap) };
    }
    placed.push(box);
    const mid = box.x + (box.w >> 1);
    const ny = l.above ? box.y + th : box.y;
    if (tag) {
      const ty = l.above ? box.y + Math.round(v.dpr) : box.y + hgt - Math.round(v.dpr);
      const tx = mid - (tw >> 1);
      g.font = `800 ${small}px ${FONT}`;
      pill(g, tx, ty, tw, th, v.dpr, tag.color ?? '#2b4066', '#05090f', false);
      g.fillStyle = tag.color ? '#0d1828' : '#dfe8f3';
      g.fillText(tt, tx + pad, ty + th / 2 + v.dpr * 0.5);
    }
    const x = mid - (w >> 1);
    g.font = `700 ${size}px ${FONT}`;
    pill(g, x, ny, w, hgt, v.dpr, l.human ? '#ffffff' : '#13213a', l.human ? '#9aa6b6' : '#05090f', hover === l.id);
    if (l.status) {
      g.fillStyle = STATUS_DOT[l.status] ?? '#8fa3bf';
      g.fillRect(x + pad, Math.round(ny + hgt / 2 - 2.5 * v.dpr), Math.round(5 * v.dpr), Math.round(5 * v.dpr));
    }
    g.fillStyle = l.human ? '#13213a' : '#ffffff';
    g.fillText(text, x + pad + dot, ny + hgt / 2 + v.dpr * 0.5);
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

/**
 * A team's signpost board over its patch, on the post zones.ts drew: the team's icon and name on a
 * plaque in its colour, and its Lead (or that nobody's hired yet) on a strip under it.
 */
export function zoneBanner(g: CanvasRenderingContext2D, v: View, b: ZoneBox, lead: string | undefined, before: Box[] = []): Box {
  const zoom = v.scale / v.dpr;
  const a = signAnchor(b);
  const size = Math.round((zoom >= 3 ? 14 : zoom >= 2 ? 13 : 11) * v.dpr), small = Math.round(size * 0.8);
  const title = `${b.zone.icon} ${b.zone.name}`;
  g.textBaseline = 'middle';
  g.font = `900 ${size}px ${FONT}`;
  const pad = Math.round(7 * v.dpr);
  let w = g.measureText(title).width + pad * 2;
  g.font = `800 ${small}px ${FONT}`;
  const sub = lead ?? '';
  if (sub) w = Math.max(w, g.measureText(sub).width + pad * 2);
  w = Math.ceil(w);
  const h1 = Math.round(size * 1.55), h2 = sub ? Math.round(small * 1.5) : 0;
  let x = Math.round(v.x + a.x * v.scale - w / 2);
  const top = Math.round(v.y + (a.y - a.post) * v.scale - h1 - h2 + Math.round(2 * v.dpr));
  // Side by side with a neighbour's (the analysts' and the PM's share a pod), it steps aside east.
  for (const o of before) if (hits({ x, y: top, w, h: h1 + h2 }, o)) x = o.x + o.w + Math.round(4 * v.dpr);
  const y = top;
  pill(g, x, y, w, h1 + h2, v.dpr, b.zone.color, '#05090f', false);
  // A darker strip under the title for the Lead, and a lit line along the top.
  if (sub) {
    g.fillStyle = 'rgba(13, 24, 40, 0.72)';
    g.fillRect(x, y + h1, w, h2);
  }
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(x + Math.round(2 * v.dpr), y + Math.round(v.dpr), w - Math.round(4 * v.dpr), Math.max(1, Math.round(v.dpr)));
  g.font = `900 ${size}px ${FONT}`;
  g.fillStyle = '#0d1828';
  g.fillText(title, x + pad, y + h1 / 2 + v.dpr);
  if (sub) {
    g.font = `800 ${small}px ${FONT}`;
    g.fillStyle = '#ffffff';
    g.fillText(sub, x + pad, y + h1 + h2 / 2 + v.dpr * 0.5);
  }
  return { x, y, w, h: h1 + h2 };
}
