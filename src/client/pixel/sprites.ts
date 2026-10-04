// The 2D view's pixel art (pixel.ts): its palette, and the people drawn a pixel at a time from
// little text pictures. Everything here is drawn in code, so there's no image to load and no art
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

// ---- People --------------------------------------------------------------------------------------
// Ten pixels across. H is hair, S skin, E an eye, C the shirt (the worker's color), P trousers and
// K shoes. Seated, the desk hides everything below the chest, so the seated ones stop there.

/** Facing you, sitting down. */
const FRONT = [
  '...HHHH...',
  '..HHHHHH..',
  '.HHHHHHHH.',
  '.HSSSSSSH.',
  '.SSESSESS.',
  '.SSSSSSSS.',
  '..SSSSSS..',
  '...ssss...',
  '.CCCCCCCC.',
  'CCCCCCCCCC',
  'CCcCCCCcCC',
  'CCcCCCCcCC',
  'SScCCCCcSS',
  '.ccccccc..',
];
/** Eyes shut: asleep at the desk. */
const FRONT_ASLEEP = FRONT.map((r, i) => (i === 4 ? '.SeeSSeeS.' : r));
/** Typing: the arms out to the keys, the other way each beat. */
const FRONT_TYPE = [FRONT.map((r, i) => (i === 12 ? 'CScCCCCcCC' : r)), FRONT.map((r, i) => (i === 12 ? 'CCcCCCCcSC' : r))];

/** From behind, sitting down. */
const BACK = [
  '...HHHH...',
  '..HHHHHH..',
  '.HHHHHHHH.',
  '.HHHHHHHH.',
  '.HHHHHHHH.',
  '.sHHHHHHs.',
  '..HHHHHH..',
  '...ssss...',
  '.CCCCCCCC.',
  'CCCCCCCCCC',
  'CCcCCCCcCC',
  'CCcCCCCcCC',
  'CCcCCCCcCC',
  '.ccccccc..',
];
/** Typing from behind: an elbow out, then the other. */
const BACK_TYPE = [BACK.map((r, i) => (i === 9 ? 'SCCCCCCCCC' : i === 10 ? 'sCcCCCCcCC' : r)), BACK.map((r, i) => (i === 9 ? 'CCCCCCCCCS' : i === 10 ? 'CCcCCCCcCs' : r))];

/** Standing up and facing you: a person walking about the floor. */
const STAND = [
  ...FRONT.slice(0, 12),
  'SScCCCCcSS',
  '.cccccccc.',
  '..PPPPPP..',
  '..PP..PP..',
  '..PP..PP..',
  '..KK..KK..',
];
/** A step: one leg forward, then the other. */
const WALK = [
  STAND.map((r, i) => (i === 16 ? '..PP...P..' : i === 17 ? '..KK...K..' : r)),
  STAND.map((r, i) => (i === 16 ? '...P..PP..' : i === 17 ? '...K..KK..' : r)),
];
const STAND_BACK = [...BACK.slice(0, 12), 'SScCCCCcSS', '.cccccccc.', '..PPPPPP..', '..PP..PP..', '..PP..PP..', '..KK..KK..'];

const HAIR = ['#2b2118', '#4a3123', '#6d4a2f', '#a8743f', '#d9b56c', '#1c1c24', '#8c8c94', '#7a3b2e'];
const SKIN = ['#f3d2b5', '#e5b48f', '#c98d63', '#9a6440', '#6e4529'];

/** A number from `id` that stays the same, to pick someone's hair and skin. */
function hash(id: string): number {
  let n = 2166136261;
  for (let i = 0; i < id.length; i++) n = Math.imul(n ^ id.charCodeAt(i), 16777619);
  return n >>> 0;
}

export type Pose = 'front' | 'back';

export interface Look {
  hair: string;
  skin: string;
  shirt: string;
}

/** Someone's look: their hair and skin from their id, their shirt in their color. */
export function lookFor(id: string, color: string): Look {
  const n = hash(id);
  return { hair: HAIR[n % HAIR.length], skin: SKIN[(n >>> 8) % SKIN.length], shirt: color };
}

function paintFor(look: Look): Paint {
  return {
    H: look.hair,
    S: look.skin,
    s: shade(look.skin, 0.18),
    E: C.ink,
    e: shade(look.skin, 0.45),
    C: look.shirt,
    c: shade(look.shirt, 0.25),
    P: '#2c3a52',
    K: '#151d2b',
  };
}

/** A worker at a desk: facing you or with its back to you, typing on beat `beat` (0 or 1), or asleep. */
export function seated(look: Look, pose: Pose, how: 'still' | 'typing' | 'asleep', beat: number): HTMLCanvasElement {
  const rows = pose === 'front' ? (how === 'typing' ? FRONT_TYPE[beat] : how === 'asleep' ? FRONT_ASLEEP : FRONT) : how === 'typing' ? BACK_TYPE[beat] : BACK;
  return sprite(rows, paintFor(look));
}

/** A person on their feet, mid-step when `walking`. */
export function standing(look: Look, pose: Pose, walking: boolean, beat: number): HTMLCanvasElement {
  if (pose === 'back') return sprite(STAND_BACK, paintFor(look));
  return sprite(walking ? WALK[beat] : STAND, paintFor(look));
}

// ---- What floats over someone ----------------------------------------------------------------------
const BUBBLE = ['.OOOOOOO.', 'OWWWWWWWO', 'OWWWWWWWO', 'OWWWWWWWO', 'OWWWWWWWO', 'OWWWWWWWO', 'OWWWWWWWO', 'OWWWWWWWO', '.OOOOOOO.', '...OO....', '...O.....'];
const QUESTION = ['..XXX..', '.X...X.', '.....X.', '...XX..', '...X...', '.......', '...X...'];
const BANG = ['...X...', '...X...', '...X...', '...X...', '...X...', '.......', '...X...'];
const CHECK = ['.GGGGG.', 'GGGGGGG', 'GGGGGWG', 'GWGGWGG', 'GGWWGGG', 'GGGWGGG', '.GGGGG.'];
const ZED = ['XXX', '..X', '.X.', 'X..', 'XXX'];

/** A speech bubble with a ? (a question for you) or ! (wants permission) in it. */
export function bubble(mark: '?' | '!'): HTMLCanvasElement {
  const key = `bubble${mark}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 9;
  c.height = BUBBLE.length;
  const g = c.getContext('2d')!;
  g.drawImage(sprite(BUBBLE, { O: C.ink, W: '#ffffff' }), 0, 0);
  g.drawImage(sprite(mark === '?' ? QUESTION : BANG, { X: mark === '?' ? C.amber : C.red }), 1, 1);
  cache.set(key, c);
  return c;
}

/** A green tick in a circle: done. */
export const check = () => sprite(CHECK, { G: C.green, W: '#ffffff' });
/** One z of someone asleep. */
export const zed = () => sprite(ZED, { X: '#6f84a8' });
