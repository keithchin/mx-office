// The 2D view's pixel art (pixel.ts): its palette, and the little things drawn a pixel at a time
// from text pictures (the people are chars.ts's). Everything here is drawn in code, so there's no image to load and no art
// pack to license; each picture is turned into a small canvas once and reused.

/** The office's colors: deep navy and white, with a teal accent. */
export const C = {
  night: '#0d1828',
  wall: '#1d2d47',
  wallTop: '#2b4066',
  wallLine: '#13213a',
  floorA: '#e9edf2',
  floorB: '#e2e7ed',
  grout: '#d6dce4',
  rug: '#cdd7e4',
  rugEdge: '#b9c6d7',
  desk: '#f8f9fb',
  deskEdge: '#c5cedb',
  deskFront: '#a7b3c4',
  laptop: '#3a4659',
  laptopEdge: '#273142',
  screenOff: '#1f2836',
  screen: '#0f2a36',
  teal: '#17b3a3',
  tealLight: '#5fd9cb',
  tealDark: '#0e7c71',
  chair: '#2a3c5c',
  chairTop: '#3b5280',
  glass: 'rgba(160, 222, 214, 0.28)',
  glassEdge: '#7fa8bd',
  wood: '#c9b49a',
  woodDark: '#a8927a',
  leaf: '#2f8f6f',
  leafLight: '#45ad87',
  leafDark: '#21664f',
  pot: '#dfe4ea',
  potDark: '#9aa5b4',
  board: '#fbfcfd',
  ink: '#14223a',
  amber: '#f2b33d',
  red: '#e05263',
  green: '#2fbf8a',
  window: '#9fc7e3',
  windowLight: '#c8e1f2',
} as const;

/** What each letter in a picture is painted. Lowercase is the shade of its uppercase. */
export interface Paint {
  [ch: string]: string;
}

const cache = new Map<string, HTMLCanvasElement>();

/** A picture (rows of letters, '.' for nothing) as a canvas, painted with `paint`. */
export function sprite(rows: readonly string[], paint: Paint): HTMLCanvasElement {
  const key = rows.join('/') + JSON.stringify(paint);
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = Math.max(...rows.map((r) => r.length));
  c.height = rows.length;
  const g = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = paint[row[x]];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  });
  cache.set(key, c);
  return c;
}

/** A color `amount` (0..1) of the way to black. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v: number) => Math.round(v * (1 - amount));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

// ---- What floats over someone ----------------------------------------------------------------------
const BUBBLE = ['..OOOOOOOOO..', '.OWWWWWWWWWO.', 'OWWWWWWWWWWWO', 'OWWWWWWWWWWWO', 'OWWWWWWWWWWWO', 'OWWWWWWWWWWWO', 'OWWWWWWWWWWWO', 'OWWWWWWWWWWWO', 'OWWWWWWWWWWWO', 'OWWWWWWWWWWWO', '.OWWWWWWWWWO.', '..OOOWWOOOO..', '....OWO......', '....OO.......'];
const QUESTION = ['.XXXX.', 'XX..XX', '....XX', '...XX.', '..XX..', '......', '..XX..'];
const BANG = ['..XX..', '..XX..', '..XX..', '..XX..', '..XX..', '......', '..XX..'];
const CHECK = ['..OOOOO..', '.OGGGGGO.', 'OGGGGGGWO', 'OGGGGGWWO', 'OGWGGWWGO', 'OGWWWWGGO', 'OGGWWGGGO', '.OGGGGGO.', '..OOOOO..'];
const ZED = ['XXXX', '..XX', '.XX.', 'XX..', 'XXXX'];

/** A speech bubble with a ? (a question for you) or ! (wants permission) in it. */
export function bubble(mark: '?' | '!'): HTMLCanvasElement {
  const key = `bubble${mark}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = BUBBLE[0].length;
  c.height = BUBBLE.length;
  const g = c.getContext('2d')!;
  g.drawImage(sprite(BUBBLE, { O: C.ink, W: '#ffffff' }), 0, 0);
  g.drawImage(sprite(mark === '?' ? QUESTION : BANG, { X: mark === '?' ? '#d98e04' : C.red }), 4, 2);
  cache.set(key, c);
  return c;
}

/** A green tick in a circle: done. */
export const check = () => sprite(CHECK, { G: C.green, W: '#ffffff', O: C.ink });
/** One z of someone asleep. */
export const zed = () => sprite(ZED, { X: '#6f84a8' });
