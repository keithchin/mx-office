// Show here's own logic, apart from the page (ui/liveapp/embed.ts): where in the placeholder the desktop
// app's native view goes for a device width, which part of the page shows it (the window and every
// scrolling box around it), and the points that say whether anything of the office (a dialog, a menu)
// is over it, since a native view always sits above the page. Pure.

import { DEVICE_WIDTH, type Device, type Zoom } from './viewer-logic';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The overlap of boxes (empty: zero size). */
export function overlap(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

/**
 * The view's box inside the placeholder for a device width, and the app's own zoom: Desktop fills it; a
 * Tablet or Phone width narrower than the box is centred at that width; a wider one fills the box, at
 * "fit" laid out at the device's width and shrunk into it, at 100% simply as wide as the box.
 */
export function deviceBox(box: Box, device: Device, zoom: Zoom): { rect: Box; zoom: number } {
  const w = DEVICE_WIDTH[device];
  if (!w || box.width <= 0) return { rect: box, zoom: 1 };
  if (w <= box.width) return { rect: { x: box.x + Math.floor((box.width - w) / 2), y: box.y, width: w, height: box.height }, zoom: 1 };
  return { rect: box, zoom: zoom === 'fit' ? Math.max(0.25, box.width / w) : 1 };
}

/** The part of the page that shows: the window's, cut by every box around the placeholder that clips (scrolls). */
export function clipOf(viewport: Box, clippers: Box[]): Box {
  return clippers.reduce(overlap, viewport);
}

/** Where to look for anything over the view: a 3 × 3 grid inside the part of it that shows, a little in from its edges. */
export function probePoints(r: Box): { x: number; y: number }[] {
  if (r.width < 4 || r.height < 4) return [];
  const xs = [r.x + 2, r.x + r.width / 2, r.x + r.width - 3];
  const ys = [r.y + 2, r.y + r.height / 2, r.y + r.height - 3];
  return ys.flatMap((y) => xs.map((x) => ({ x: Math.floor(x), y: Math.floor(y) })));
}

/** One line per placement, so the same one isn't sent twice. */
export const placeKey = (rect: Box, clip: Box, zoom: number, dpr: number) => [rect.x, rect.y, rect.width, rect.height, clip.x, clip.y, clip.width, clip.height, zoom, dpr].map((n) => Math.round(n * 100) / 100).join(',');

/** The address field's text for where the app is: its path on the app's own origin, else the whole address. */
export function shownPath(url: string, base: string): string {
  try {
    const u = new URL(url);
    return u.origin === new URL(base).origin ? `${u.pathname}${u.search}${u.hash}` || '/' : url;
  } catch {
    return url;
  }
}
