// The 2D view's people (pixel.ts, people.ts): characters 24 art pixels across and 34 tall standing,
// drawn in code a part at a time (head, hair, face, clothes, arms, legs) rather than from a picture,
// so each role can wear its own outfit and carry its own things: the PM a blazer and a headset, the
// designer a turtleneck, a beret and a stylus, the developer a hoodie, the tester a lab coat with
// goggles and a clipboard, the analyst a sweater and glasses. Each finished picture gets a dark
// outline all round (so it stands out on any floor) and is kept, so it's only ever drawn once.

import { C } from './sprites';
import { darken, lighten } from './paint';

/** Who a character is dressed as: a role on the project team, or anyone else. */
export type Outfit = 'pm' | 'designer' | 'dev' | 'qa' | 'analyst' | 'router' | 'plain';
export type Pose = 'front' | 'back';
export type How = 'still' | 'typing' | 'asleep';

export interface Look {
  hair: string;
  skin: string;
  /** The hair's cut: see HAIR_STYLES. */
  style: number;
  /** Their clothes' main colour: their team's, or their own. */
  shirt: string;
  outfit: Outfit;
}

/** The picture's size, standing: seated, only the top SEATED rows are drawn (the desk hides the rest). */
export const CHAR_W = 24;
export const CHAR_H = 34;
export const SEATED = 27;

const HAIR = ['#2b2118', '#4a3123', '#6d4a2f', '#a8743f', '#d9b56c', '#1c1c24', '#8c8c94', '#7a3b2e', '#3b2a4a'];
const SKIN = ['#f6d7bd', '#ecbf98', '#d39b70', '#a8714b', '#7a4e31'];
const HAIR_STYLES = 7;
const OUTLINE = [20, 34, 58];

/** A number from `id` that stays the same, to pick someone's hair, its cut and their skin. */
function hash(id: string): number {
  let n = 2166136261;
  for (let i = 0; i < id.length; i++) n = Math.imul(n ^ id.charCodeAt(i), 16777619);
  return n >>> 0;
}

/** Jeff, the Router (the office's quick judge, not a worker): a charcoal suit, a tie in `shirt`, glasses and a moustache. */
export const JEFF_LOOK: Look = { hair: '#4a3a2e', skin: '#ecbf98', style: 0, shirt: '#8c2f39', outfit: 'router' };

/** Someone's look: hair, cut and skin from their id, dressed for their role in `shirt`. */
export function lookFor(id: string, shirt: string, outfit: Outfit = 'plain'): Look {
  const n = hash(id);
  return { hair: HAIR[n % HAIR.length], skin: SKIN[(n >>> 8) % SKIN.length], style: (n >>> 12) % HAIR_STYLES, shirt, outfit };
}

const cache = new Map<string, HTMLCanvasElement>();

/** A worker in a chair: facing you or with its back to you, typing on beat `beat` (0 or 1), still, or asleep. */
export function seated(look: Look, pose: Pose, how: How, beat: number): HTMLCanvasElement {
  return picture(look, pose, how, beat, false, false);
}

/** Someone on their feet, mid-step when `walking`. */
export function standing(look: Look, pose: Pose, walking: boolean, beat: number): HTMLCanvasElement {
  return picture(look, pose, 'still', beat, true, walking);
}

function picture(look: Look, pose: Pose, how: How, beat: number, stands: boolean, walking: boolean): HTMLCanvasElement {
  const key = `${look.hair}|${look.skin}|${look.style}|${look.shirt}|${look.outfit}|${pose}|${how}|${beat}|${stands}|${walking}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = CHAR_W;
  c.height = stands ? CHAR_H : SEATED;
  const g = c.getContext('2d')!;
  draw(g, look, pose, how, beat, stands, walking);
  outline(g, c.width, c.height);
  cache.set(key, c);
  return c;
}

/** A dark line round everything drawn: each see-through pixel next to a painted one is painted the outline. */
function outline(g: CanvasRenderingContext2D, w: number, h: number) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 128;
  const edge: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push((y * w + x) * 4);
  for (const i of edge) [d[i], d[i + 1], d[i + 2], d[i + 3]] = [...OUTLINE, 235];
  g.putImageData(img, 0, 0);
}

function draw(g: CanvasRenderingContext2D, L: Look, pose: Pose, how: How, beat: number, stands: boolean, walking: boolean) {
  const p = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  const skin = L.skin, skinD = darken(skin, 0.14), hair = L.hair, hairL = lighten(hair, 0.22), hairD = darken(hair, 0.25);
  const back = pose === 'back';
  // Asleep, the head drops forward a pixel.
  const hy = how === 'asleep' ? 1 : 0;
  const cloth = clothes(L);

  // ---- Legs and shoes, standing: one foot forward, then the other, while walking ----
  if (stands) {
    const pants = L.outfit === 'qa' ? '#3a4a66' : L.outfit === 'pm' ? '#1f2c46' : L.outfit === 'router' ? '#2a2e38' : '#2c3a52';
    const stepA = walking && beat === 0 ? 1 : 0, stepB = walking && beat === 1 ? 1 : 0;
    p(7, 26, 5, 6 - stepA, pants);
    p(12, 26, 5, 6 - stepB, pants);
    p(11, 26, 1, 4, darken(pants, 0.3));
    p(6, 32 - stepA, 6, 2, '#151d2b');
    p(12, 32 - stepB, 6, 2, '#151d2b');
    p(6, 32 - stepA, 2, 1, '#3a4659');
    p(12, 32 - stepB, 2, 1, '#3a4659');
  }

  // ---- The body: shoulders, chest, and the colour's light and shade ----
  p(6, 16, 12, 1, cloth.main);
  p(5, 17, 14, 9, cloth.main);
  p(5, 17, 2, 9, cloth.light);
  p(16, 17, 3, 9, cloth.dark);
  if (stands) p(5, 25, 14, 1, cloth.dark);
  details(p, L, cloth, back);

  // ---- Arms: down at the sides, out to the keys while typing, swinging while walking ----
  const typing = how === 'typing' && !stands;
  const swing = walking ? (beat ? 1 : -1) : 0;
  if (back) {
    // From behind, typing pushes an elbow out, then the other.
    const la = typing && beat === 0 ? 1 : 0, ra = typing && beat === 1 ? 1 : 0;
    p(3 - la, 17, 2, 7, cloth.light);
    p(19 + ra, 17, 2, 7, cloth.dark);
    if (stands) {
      p(3, 24 + swing, 2, 2, skin);
      p(19, 24 - swing, 2, 2, skinD);
    }
  } else if (typing) {
    // Forearms in toward the keyboard, the hands lifting on the beat.
    p(3, 17, 2, 6, cloth.light);
    p(19, 17, 2, 6, cloth.dark);
    p(4, 22, 4, 2, cloth.light);
    p(16, 22, 4, 2, cloth.dark);
    p(7, 23 - (beat ? 1 : 0), 3, 2, skin);
    p(14, 23 - (beat ? 0 : 1), 3, 2, skin);
  } else {
    p(3, 17 + (how === 'asleep' ? 1 : 0), 2, 8 + swing, cloth.light);
    p(19, 17 + (how === 'asleep' ? 1 : 0), 2, 8 - swing, cloth.dark);
    p(3, 25 + swing, 2, 2, skin);
    p(19, 25 - swing, 2, 2, skinD);
  }
  carried(p, L, back, typing, stands, beat);

  // ---- The neck and head ----
  p(10, 15, 4, 2, skinD);
  p(7, 3 + hy, 10, 1, skin);
  p(6, 4 + hy, 12, 10, skin);
  p(7, 14 + hy, 10, 1, skin);
  p(15, 5 + hy, 2, 9, skinD);
  // The ears, unless the hair hides them.
  p(5, 9 + hy, 1, 2, skinD);
  p(18, 9 + hy, 1, 2, skinD);
  hairDo(p, L.style, hair, hairL, hairD, back, hy);
  if (!back) face(p, L, how, hy, skin, hair);
  headwear(p, L, back, hy);
}

interface Cloth {
  main: string;
  light: string;
  dark: string;
}

function clothes(L: Look): Cloth {
  const main = L.outfit === 'pm' ? '#26395e' : L.outfit === 'router' ? '#3a3f4b' : L.outfit === 'qa' ? '#f3f6fa' : L.outfit === 'dev' ? darken(L.shirt, 0.15) : L.shirt;
  return { main, light: lighten(main, 0.18), dark: darken(main, L.outfit === 'qa' ? 0.12 : 0.22) };
}

type Px = (x: number, y: number, w: number, h: number, color: string) => void;

/** What each outfit has on the front of it (or the back): a collar, a tie, drawstrings, buttons. */
function details(p: Px, L: Look, cl: Cloth, back: boolean) {
  const accent = L.shirt;
  switch (L.outfit) {
    case 'pm':
      // A navy blazer over a white shirt, a tie in the team's gold.
      if (back) return p(7, 17, 10, 1, cl.dark);
      p(9, 16, 6, 5, '#f4f6fa');
      p(8, 16, 1, 6, cl.light);
      p(15, 16, 1, 6, cl.dark);
      p(11, 17, 2, 6, accent);
      p(11, 17, 2, 1, darken(accent, 0.25));
      p(13, 23, 1, 1, '#c5cedb');
      return;
    case 'router':
      // A charcoal suit: lapels over a white shirt, a tie in `shirt`, a white pocket square.
      if (back) return p(7, 17, 10, 1, cl.dark);
      p(9, 16, 6, 6, '#f4f6fa');
      p(8, 16, 2, 7, cl.light);
      p(14, 16, 2, 7, cl.dark);
      p(11, 16, 2, 1, darken(accent, 0.25));
      p(11, 17, 2, 6, accent);
      p(11, 22, 2, 1, darken(accent, 0.25));
      p(15, 18, 2, 1, '#f4f6fa');
      return;
    case 'qa':
      // A white lab coat, open at the front over a shirt in the team's teal; a pen in the pocket.
      if (back) return p(11, 18, 2, 8, cl.dark);
      p(10, 16, 4, 6, accent);
      p(9, 16, 1, 10, cl.dark);
      p(14, 16, 1, 10, cl.dark);
      p(15, 19, 2, 2, cl.dark);
      p(16, 18, 1, 2, C.red);
      return;
    case 'dev':
      // A hoodie: the hood round the neck (up the back from behind), drawstrings, a front pocket.
      if (back) {
        p(8, 14, 8, 4, cl.dark);
        p(9, 15, 6, 2, darken(cl.main, 0.32));
        return;
      }
      p(8, 15, 8, 2, cl.dark);
      p(10, 17, 1, 3, '#e8eef5');
      p(13, 17, 1, 3, '#e8eef5');
      p(8, 22, 8, 3, cl.dark);
      p(8, 22, 8, 1, cl.light);
      return;
    case 'designer':
      // A turtleneck, rolled at the neck.
      p(8, 15, 8, 2, cl.light);
      p(8, 16, 8, 1, cl.dark);
      return;
    case 'analyst':
      // A sweater over a white collar.
      if (back) return p(8, 16, 8, 1, '#f4f6fa');
      p(9, 16, 2, 2, '#f4f6fa');
      p(13, 16, 2, 2, '#f4f6fa');
      p(5, 24, 14, 1, cl.dark);
      return;
    default:
      // A t-shirt: a little neckline.
      if (!back) p(10, 16, 4, 1, darken(L.skin, 0.14));
  }
}

/** What each role has in its hands: the designer's stylus, the tester's clipboard, the analyst's chart, the developer's laptop. */
function carried(p: Px, L: Look, back: boolean, typing: boolean, stands: boolean, beat: number) {
  if (back) return;
  if (L.outfit === 'designer' && !typing) {
    p(20, 21, 1, 5, '#f2b33d');
    p(20, 26, 1, 1, C.ink);
  }
  if (!stands) return;
  if (L.outfit === 'qa') {
    p(0, 19, 5, 7, '#9a6b3f');
    p(1, 20, 3, 5, '#ffffff');
    p(1, 21, 3, 1, C.teal);
    p(1, 23, 2, 1, '#9aa6b6');
    p(2, 18, 1, 2, '#c5cedb');
  } else if (L.outfit === 'analyst') {
    p(19, 18, 5, 7, '#ffffff');
    p(20, 22, 1, 2, C.teal);
    p(21, 20, 1, 4, '#6d7ff2');
    p(22, 21, 1, 3, C.amber);
  } else if (L.outfit === 'dev') {
    p(19, 20 - beat, 5, 6, '#3a4659');
    p(19, 20 - beat, 5, 1, '#56637a');
  }
}

/** The hair, by its cut: short, a bob, long, a bun, spiky, curly, or close-cropped. */
function hairDo(p: Px, style: number, hair: string, hl: string, hd: string, back: boolean, hy: number) {
  const y = hy;
  // The crown every cut starts from, with a lit streak on the left where the light falls.
  const crown = (top: number) => {
    p(7, top + y, 10, 1, hair);
    p(6, top + 1 + y, 12, 3, hair);
    p(8, top + 1 + y, 3, 1, hl);
  };
  if (style === 6) {
    // Close-cropped: a thin cap.
    p(7, 3 + y, 10, 2, hair);
    p(6, 4 + y, 1, 4, hair);
    p(17, 4 + y, 1, 4, hair);
    p(8, 3 + y, 3, 1, hl);
    if (back) p(6, 4 + y, 12, 6, hair);
    return;
  }
  if (style === 5) {
    // Curly: a big round puff.
    p(6, 1 + y, 12, 1, hair);
    p(5, 2 + y, 14, 5, hair);
    p(4, 4 + y, 1, 6, hair);
    p(19, 4 + y, 1, 6, hair);
    p(5, 7 + y, 2, 4, hair);
    p(17, 7 + y, 2, 4, hair);
    for (const x of [6, 9, 12, 15]) p(x, 2 + y, 1, 1, hl);
    for (const x of [7, 11, 16]) p(x, 6 + y, 1, 1, hd);
    if (back) p(5, 7 + y, 14, 6, hair);
    return;
  }
  crown(2);
  if (style === 4) for (const x of [7, 10, 13, 16]) p(x, 1 + y, 1, 1, hair);
  if (style === 3) {
    p(10, 0 + y, 4, 2, hair);
    p(11, 0 + y, 1, 1, hl);
  }
  // A fringe over the forehead.
  p(6, 5 + y, 3, 1, hair);
  p(15, 5 + y, 3, 2, hair);
  p(6, 6 + y, 1, style === 0 || style === 4 ? 3 : 2, hair);
  p(17, 6 + y, 1, 3, hair);
  if (style === 1 || style === 2) {
    // A bob, or long: down the sides past the ears, longer still for long.
    const len = style === 2 ? 14 : 8;
    p(5, 5 + y, 2, len, hair);
    p(17, 5 + y, 2, len, hair);
    p(18, 6 + y, 1, len - 1, hd);
  }
  if (back) {
    p(6, 5 + y, 12, 9, hair);
    p(7, 13 + y, 10, 1, hd);
    if (style === 1 || style === 2) p(5, 5 + y, 14, style === 2 ? 14 : 9, hair);
    p(8, 4 + y, 3, 1, hl);
  }
}

/** Eyes (shut asleep), cheeks and a mouth. */
function face(p: Px, L: Look, how: How, hy: number, skin: string, hair: string) {
  const y = hy;
  if (how === 'asleep') {
    p(8, 10 + y, 3, 1, darken(skin, 0.45));
    p(13, 10 + y, 3, 1, darken(skin, 0.45));
  } else {
    p(9, 9 + y, 2, 2, C.ink);
    p(13, 9 + y, 2, 2, C.ink);
    p(9, 9 + y, 1, 1, '#ffffff');
    p(13, 9 + y, 1, 1, '#ffffff');
    p(9, 8 + y, 2, 1, darken(hair, 0.1));
    p(13, 8 + y, 2, 1, darken(hair, 0.1));
  }
  p(7, 11 + y, 2, 1, 'rgba(232, 112, 112, 0.45)');
  p(15, 11 + y, 2, 1, 'rgba(232, 112, 112, 0.45)');
  p(11, 12 + y, 2, 1, darken(skin, 0.3));
  if (L.outfit === 'router') {
    // A neat moustache over the mouth, its ends turned down a little.
    p(9, 12 + y, 6, 1, darken(hair, 0.05));
    p(9, 13 + y, 1, 1, darken(hair, 0.05));
    p(14, 13 + y, 1, 1, darken(hair, 0.05));
    p(11, 13 + y, 2, 1, darken(skin, 0.3));
  }
  if (L.outfit === 'analyst' || L.outfit === 'router') {
    // Glasses: two frames and the bridge (Jeff's in thin gold, so his eyes show through).
    const rim = L.outfit === 'router' ? '#b08d3c' : C.ink;
    for (const x of [8, 12]) {
      p(x, 8 + y, 4, 1, rim);
      p(x, 11 + y, 4, 1, rim);
      p(x, 8 + y, 1, 4, rim);
      p(x + 3, 8 + y, 1, 4, rim);
    }
    p(11, 9 + y, 1, 1, rim);
  }
}

/** On the head: the PM's headset, the designer's beret, the tester's goggles pushed up. */
function headwear(p: Px, L: Look, back: boolean, hy: number) {
  const y = hy;
  if (L.outfit === 'pm') {
    p(6, 2 + y, 12, 1, '#1b2436');
    p(5, 3 + y, 1, 5, '#1b2436');
    p(18, 3 + y, 1, 5, '#1b2436');
    p(4, 8 + y, 2, 4, '#1b2436');
    p(4, 9 + y, 1, 2, L.shirt);
    p(18, 8 + y, 2, 4, '#1b2436');
    if (!back) {
      p(6, 12 + y, 2, 1, '#1b2436');
      p(8, 13 + y, 2, 1, '#1b2436');
      p(10, 13 + y, 1, 1, '#e05263');
    }
  } else if (L.outfit === 'designer') {
    p(5, 2 + y, 12, 2, L.shirt === '#e07a5f' ? '#7a2e45' : darken(L.shirt, 0.4));
    p(7, 1 + y, 9, 1, '#7a2e45');
    p(11, 0 + y, 1, 1, '#7a2e45');
    p(7, 2 + y, 3, 1, '#a2496a');
  } else if (L.outfit === 'qa') {
    p(6, 4 + y, 12, 1, C.tealDark);
    if (!back) {
      p(7, 3 + y, 4, 3, C.tealLight);
      p(13, 3 + y, 4, 3, C.tealLight);
      p(8, 4 + y, 1, 1, '#ffffff');
      p(14, 4 + y, 1, 1, '#ffffff');
    }
  }
}
