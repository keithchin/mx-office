// The reviewers' portraits: small pixel-art busts in a brass frame, drawn on a canvas from each
// reviewer's palette (shared/firm/roles.ts), sharp at any size (image-rendering: pixelated).

import type { ReviewerRole } from '../../shared/firm/roles';

/** The bust's grid, in pixels. */
const W = 24;
const H = 28;

type Look = ReviewerRole['look'];

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

/** Draws a bust onto `ctx` at (x, y), one grid pixel per `s` canvas pixels. */
export function drawBust(ctx: CanvasRenderingContext2D, look: Look, x: number, y: number, s: number, long = false) {
  const px = (cx: number, cy: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + cx * s, y + cy * s, w * s, h * s);
  };
  // Shoulders and lapels.
  px(3, 20, 18, 8, look.suit);
  px(2, 22, 20, 6, look.suit);
  px(8, 20, 8, 8, shade(look.suit, 1.25));
  px(10, 19, 4, 9, '#f4f1ea');
  px(11, 20, 2, 7, look.tie);
  px(11, 20, 2, 1, shade(look.tie, 0.7));
  px(7, 21, 2, 6, shade(look.suit, 0.75));
  px(15, 21, 2, 6, shade(look.suit, 0.75));
  // Neck and head.
  px(10, 16, 4, 4, shade(look.skin, 0.88));
  px(7, 6, 10, 11, look.skin);
  px(6, 9, 1, 4, look.skin);
  px(17, 9, 1, 4, look.skin);
  px(8, 16, 8, 1, shade(look.skin, 0.9));
  // Hair: a cap over the top, longer at the sides for some.
  px(7, 4, 10, 3, look.hair);
  px(6, 5, 2, 4, look.hair);
  px(16, 5, 2, 4, look.hair);
  if (long) {
    px(5, 7, 2, 10, look.hair);
    px(17, 7, 2, 10, look.hair);
  }
  // Eyes, brows, mouth.
  px(9, 10, 2, 1, shade(look.hair, 0.6));
  px(13, 10, 2, 1, shade(look.hair, 0.6));
  px(9, 11, 2, 2, '#ffffff');
  px(13, 11, 2, 2, '#ffffff');
  px(10, 11, 1, 2, '#1b1b2a');
  px(14, 11, 1, 2, '#1b1b2a');
  px(11, 14, 3, 1, shade(look.skin, 0.62));
  if (look.glasses) {
    ctx.strokeStyle = '#c9a14a';
    ctx.lineWidth = Math.max(1, s * 0.6);
    ctx.strokeRect(x + 8.5 * s, y + 10.5 * s, 3 * s, 3 * s);
    ctx.strokeRect(x + 12.5 * s, y + 10.5 * s, 3 * s, 3 * s);
    px(11.5, 11.5, 1, 0.5, '#c9a14a');
  }
}

/** Which reviewers wear their hair long (purely the portrait's look). */
const LONG = new Set(['partner', 'qa', 'security']);

/** A framed portrait canvas, `size` CSS pixels wide. */
export function portrait(r: Pick<ReviewerRole, 'id' | 'look' | 'name'>, size = 96): HTMLCanvasElement {
  const s = 4;
  const c = document.createElement('canvas');
  c.width = (W + 4) * s;
  c.height = (H + 4) * s;
  c.className = 'firm-portrait';
  c.style.width = `${size}px`;
  c.style.height = `${Math.round((size * (H + 4)) / (W + 4))}px`;
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', `Portrait of ${r.name}`);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  // The brass frame and a dark wood backdrop.
  ctx.fillStyle = '#8a6a2a';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#c9a14a';
  ctx.fillRect(s, s, c.width - 2 * s, c.height - 2 * s);
  ctx.fillStyle = '#2a1d16';
  ctx.fillRect(2 * s, 2 * s, c.width - 4 * s, c.height - 4 * s);
  ctx.fillStyle = '#3a2a1f';
  ctx.fillRect(2 * s, 2 * s, c.width - 4 * s, 8 * s);
  drawBust(ctx, r.look, 2 * s, 2 * s, s, LONG.has(r.id));
  return c;
}
