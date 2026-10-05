// A worker on the Git tab: a little pixel robot in its color, drawn with the 2D view's sprite helper
// (pixel/sprites.ts) and kept as a picture per color, so the map can stand one at every branch tip.

import { C, shade, sprite } from '../../pixel/sprites';

/** The picture's size in art pixels; the map draws it at twice that. */
export const BOT_W = 12;
export const BOT_H = 14;

const ROBOT = [
  '.....aa.....',
  '......k.....',
  '..KKKKKKKK..',
  '..KHHHHHHK..',
  '..KHeHHeHK..',
  '..KHHHHHHK..',
  '..KHHmmHHK..',
  '..KKKKKKKK..',
  '.KBBBBBBBBK.',
  'KBBBccccBBBK',
  'KBKBccccBKBK',
  '.K.BBBBBB.K.',
  '...KK..KK...',
  '...KK..KK...',
];

const urls = new Map<string, string>();

/** The robot in `color` (a #rrggbb), as an image address for an SVG <image>. */
export function robotUrl(color: string): string {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : C.teal;
  let url = urls.get(hex);
  if (!url) {
    const paint = { K: C.ink, k: C.ink, H: C.floorA, e: C.tealLight, m: C.ink, a: C.amber, B: hex, c: shade(hex, 0.35) };
    url = sprite(ROBOT, paint).toDataURL();
    urls.set(hex, url);
  }
  return url;
}
