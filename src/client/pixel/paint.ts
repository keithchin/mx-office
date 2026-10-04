// The 2D view's brushes (pixel.ts): filled boxes, ovals and shadows a whole art pixel at a time, so
// every edge stays crisp when the office is blown up. The light in the office comes from the upper
// left (the west windows), so everything's shadow falls down and to the right, and every box is lit
// on its top and its left edge and darker on its right.

/** The shadows' colour: the night navy, see through. */
export const SHADOW = 'rgba(9, 18, 34, 0.22)';
export const SHADOW_SOFT = 'rgba(9, 18, 34, 0.12)';

export function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A filled oval, a row of whole pixels at a time, so its edge stays crisp (a canvas arc would blur it). */
export function oval(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string) {
  g.fillStyle = color;
  cx = Math.round(cx);
  cy = Math.round(cy);
  const r = Math.max(1, Math.round(ry));
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - ((dy + (dy < 0 ? 0.5 : -0.5)) / (ry + 0.5)) ** 2)));
    if (half > 0) g.fillRect(cx - half, cy + dy, half * 2, 1);
  }
}

/**
 * A soft shadow on the floor: an oval in two steps (a darker core in a lighter rim), the pixel-art
 * way of a blur. (cx, cy) is where the thing meets the floor; the shadow leans right, away from the light.
 */
export function blob(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  oval(g, cx + 1, cy, rx + 1, ry + 1, SHADOW_SOFT);
  oval(g, cx + 1, cy, rx, ry, SHADOW);
}

/**
 * The shadow a box `h` high casts on the floor from its footprint (x, y, w, d): the footprint pushed
 * right and down by part of its height, with a lighter fringe, and dark where it meets the floor.
 */
export function castShadow(g: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number) {
  const off = Math.max(2, Math.round(h * 0.45));
  rect(g, x + off + 1, y + Math.round(off / 2) + 1, w, d, SHADOW_SOFT);
  rect(g, x + off, y + Math.round(off / 2), w, d, SHADOW);
  rect(g, x, y + d, w + off, 1, SHADOW);
}

/**
 * Something boxy standing on the floor: its footprint `w` by `d` art pixels from (x, y), `h` high.
 * The top is drawn raised by its height, with the face toward you under it, a lit edge along the
 * top's front and left, and the face darker on its right, so it reads as solid.
 */
export function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number, top: string, front: string, edge?: string) {
  rect(g, x, y - h, w, d, top);
  rect(g, x, y + d - h, w, h, front);
  if (edge) rect(g, x, y + d - h, w, 1, edge);
  // The light from the upper left: a bright line on the top's left, the face's right column in shade.
  rect(g, x, y - h, 1, d, 'rgba(255,255,255,0.28)');
  if (h > 1) rect(g, x + w - 1, y + d - h, 1, h, 'rgba(9,18,34,0.18)');
}

/** A box with its shadow under it: the usual way to stand furniture on the floor. */
export function solid(g: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number, top: string, front: string, edge?: string) {
  castShadow(g, x, y, w, d, h);
  box(g, x, y, w, d, h, top, front, edge);
}

/** Every other pixel of a rectangle: the pixel-art way of a half-tone, for a soft edge of light or shade. */
export function dither(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, phase = 0) {
  g.fillStyle = color;
  x = Math.round(x);
  y = Math.round(y);
  for (let j = 0; j < h; j++) for (let i = (j + phase) & 1; i < w; i += 2) g.fillRect(x + i, y + j, 1, 1);
}

/** A number from 0 up to (not including) 1 that's always the same for the same (a, b): speckles that stay put. */
export function noise(a: number, b: number): number {
  let n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** A colour `amount` (0..1) of the way to black, as a hex #rrggbb. */
export function darken(hex: string, amount: number): string {
  return mix(hex, '#000000', amount);
}

/** A colour `amount` (0..1) of the way to white. */
export function lighten(hex: string, amount: number): string {
  return mix(hex, '#ffffff', amount);
}

/** Two #rrggbb colours mixed, `t` of the way from `a` to `b`. */
export function mix(a: string, b: string, t: number): string {
  const p = parseInt(a.slice(1, 7), 16), q = parseInt(b.slice(1, 7), 16);
  const ch = (s: number) => Math.round(((p >> s) & 255) * (1 - t) + ((q >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}
