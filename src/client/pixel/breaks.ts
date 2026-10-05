// A benched Lead on the 2D view (and the home page's overview) isn't gone: they're on a break about the
// office. Each takes turns at watching TV on the lounge couch, a smoke out on the balcony by the ashtray,
// and a coffee from the kitchen's machine, half a minute to a minute and a half at each, walking
// between them along the open floor. Which break and when comes from their name and the clock, so
// every browser shows them at the same thing. With less motion asked for, they just stay at it.

import { ASHTRAY } from '../../shared/layout';
import { C } from './sprites';
import { blob, oval, rect } from './paint';
import { ax, az, type Frame } from './frame';
import { lookFor, seated, standing, type Outfit, type Pose } from './chars';
import { KITCHEN } from './props';

export type BreakAct = 'tv' | 'smoke' | 'coffee';
const ACTS: BreakAct[] = ['tv', 'smoke', 'coffee'];

/** A benched Lead, as the drawing needs them. */
export interface BreakLead {
  id: string;
  name: string;
  title: string;
  outfit: Outfit;
  color: string;
}

/** Where a benched Lead is and what they're doing, at a moment. */
export interface BreakState {
  act: BreakAct;
  /** On their way there, rather than at it. */
  walking: boolean;
  /** Where their feet are, in meters on the floor plan. */
  x: number;
  z: number;
  pose: Pose;
  /** How long they've been at it (ms): 0 while walking. */
  at: number;
}

/** The words for it, as a hover card says it. */
export const BREAK_WORDS: Record<BreakAct, string> = { tv: 'watching TV', smoke: 'on a smoke break', coffee: 'on a coffee break' };

/** The open aisle south of the teams' patches, every walk goes along. */
const AISLE_Z = 8.4;
/** Each break takes at least this long, and the two in a cycle add up to it. */
const CYCLE_MS = 120_000;
const MIN_MS = 30_000;
/** Walking pace (meters a second), and at most this share of a break spent getting there. */
const PACE = 1.8;
const MOST_WALK = 0.4;

type Pt = [number, number];
/** Where the `i`th one on a break of `act` stands (or sits), and the way there from the aisle. */
function placeOf(act: BreakAct, i: number): { at: Pt; path: Pt[]; pose: Pose } {
  const n = i % 3;
  if (act === 'tv') {
    // On the couch, facing the TV across the coffee table: up past Jeff's room and the meeting room's corner.
    const z = [0, -1.2, 1.2][n];
    return { at: [10.6, z], path: [[8.6, AISLE_Z], [8.6, 2], [11.4, 2], [11.4, z]], pose: 'front' };
  }
  if (act === 'coffee') {
    const x = KITCHEN.coffee + [0, 1.1, -1.1][n];
    // Far enough back that the counter doesn't hide their feet.
    return { at: [x, 11.3], path: [[x, AISLE_Z]], pose: 'front' };
  }
  // Out the balcony doors to the ashtray.
  const x = ASHTRAY.x + [0.7, -0.6, 1.9][n];
  return { at: [x, ASHTRAY.z - 0.5], path: [[-4, AISLE_Z], [-4, 14.3], [x, 14.3]], pose: 'front' };
}

/** A number from `s` that stays the same. */
function hash(s: string): number {
  let n = 2166136261;
  for (let i = 0; i < s.length; i++) n = Math.imul(n ^ s.charCodeAt(i), 16777619);
  return n >>> 0;
}
/** A fraction 0..1 from the seed, the cycle and which pick it is. */
const rand = (seed: number, k: number, j: number) => hash(`${seed}:${k}:${j}`) / 4294967296;

/**
 * The two breaks in cycle `k`, and how long the first lasts. Each Lead goes round the three in an
 * order of their own, so it's never the same break twice running and each gets its turn.
 */
function cycle(seed: number, k: number): { acts: [BreakAct, BreakAct]; first: number } {
  const order = seed % 2 ? [0, 1, 2] : [0, 2, 1];
  const at = (n: number) => ACTS[(order[((n % 3) + 3) % 3] + seed) % 3];
  return { acts: [at(2 * k), at(2 * k + 1)], first: MIN_MS + Math.floor(rand(seed, k, 0) * (CYCLE_MS - 2 * MIN_MS)) };
}

/** The walk from one break to another: back out to the aisle, along it, and in. */
export function route(from: BreakAct, to: BreakAct, i: number): Pt[] {
  const a = placeOf(from, i), b = placeOf(to, i);
  return [a.at, ...[...a.path].reverse(), [b.path[0][0], AISLE_Z], ...b.path, b.at];
}

/** The point `d` meters along `pts`, and which way it's heading there. */
function along(pts: Pt[], d: number): { x: number; z: number; dz: number } {
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (d <= len || i === pts.length - 1) {
      const t = len ? Math.min(1, d / len) : 1;
      return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, dz: z1 - z0 };
    }
    d -= len;
  }
  return { x: pts[0][0], z: pts[0][1], dz: 0 };
}
const lengthOf = (pts: Pt[]) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/**
 * Where Lead `name` (the `i`th benched one on the floor) is at wall-clock time `clock` (ms): on their
 * way to a break or at it. `still` (less motion) puts them at it, with no walking.
 */
export function breakAt(name: string, i: number, clock: number, still = false): BreakState {
  const seed = hash(name);
  const t = clock + (seed % CYCLE_MS);
  const k = Math.floor(t / CYCLE_MS), u = t - k * CYCLE_MS;
  const c = cycle(seed, k);
  const second = u >= c.first;
  const act = second ? c.acts[1] : c.acts[0];
  const before = second ? c.acts[0] : cycle(seed, k - 1).acts[1];
  const into = second ? u - c.first : u;
  const span = second ? CYCLE_MS - c.first : c.first;
  const place = placeOf(act, i);
  const way = route(before, act, i);
  const walkMs = Math.min(span * MOST_WALK, (lengthOf(way) / PACE) * 1000);
  if (still || into >= walkMs) return { act, walking: false, x: place.at[0], z: place.at[1], pose: place.pose, at: still ? 0 : into - walkMs };
  const p = along(way, (into / walkMs) * lengthOf(way));
  return { act, walking: true, x: p.x, z: p.z, pose: p.dz < 0 ? 'back' : 'front', at: 0 };
}

/** Standing, the picture's top is this far above the feet; sitting on the couch, this far. */
const STAND = 33, SIT = 29;

/** Where to draw a Lead at break state `s`: their feet, and the top of their picture, in art pixels. */
export function breakSpot(f: Frame, s: BreakState): { x: number; y: number; top: number } {
  const x = ax(f, s.x), y = az(f, s.z);
  return { x, y, top: y - (s.act === 'tv' && !s.walking ? SIT : STAND) };
}

/**
 * Draws Lead `l` at `s` into `g`: walking, or at their break with what goes with it (the TV
 * flickering, a cigarette and its smoke, a cup and its steam). `now` runs the animation; `ring` marks
 * the one the pointer's on.
 */
export function drawBreak(g: CanvasRenderingContext2D, f: Frame, l: BreakLead, s: BreakState, now: number, ring: boolean) {
  const { x, y, top } = breakSpot(f, s);
  const look = lookFor(l.id, l.color, l.outfit);
  const beat = Math.floor(now / 180) % 2;
  if (s.act === 'tv' && !s.walking) {
    g.drawImage(seated(look, 'front', 'still', 0), x - 12, top);
    // The TV across the room flickers through whatever's on, its light on them.
    const flick = ['#9fe8ff', '#ffd27a', '#b8a1ff', '#7dffb2'][Math.floor(now / 650) % 4];
    g.globalAlpha = 0.18 + 0.08 * Math.sin(now / 140);
    oval(g, x + 8, y - 12, 7, 9, flick);
    g.globalAlpha = 1;
  } else {
    blob(g, x, y, 8, 2);
    g.drawImage(standing(look, s.pose, s.walking, beat), x - 12, top);
  }
  if (!s.walking && s.act === 'smoke') smoke(g, x, top, now, s.at);
  if (!s.walking && s.act === 'coffee') coffee(g, x, top, now, s.at);
  if (ring) {
    rect(g, x - 10, y + 3, 21, 1, C.teal);
    rect(g, x - 8, y + 4, 17, 1, 'rgba(23,179,163,0.4)');
  }
}

/** A cigarette in the hand, up to the mouth now and then, and the smoke curling off it. */
function smoke(g: CanvasRenderingContext2D, x: number, top: number, now: number, at: number) {
  const drag = at % 4000 > 3100;
  const hx = x + 6, hy = top + (drag ? 13 : 20);
  rect(g, hx, hy, 3, 1, '#f4f1ea');
  rect(g, hx + 3, hy, 1, 1, drag ? '#ff7a2f' : '#d9542b');
  for (let i = 0; i < 4; i++) {
    const p = (now / 1500 + i / 4) % 1;
    g.globalAlpha = 0.55 * (1 - p);
    rect(g, hx + 3 + Math.round(Math.sin(p * 5 + i) * 2), hy - 2 - Math.round(p * 14), 2, 1 + (i & 1), '#d7dde6');
  }
  g.globalAlpha = 1;
}

/** Making a coffee at the machine, then a cup in the hand, sipped now and then, steam off it. */
function coffee(g: CanvasRenderingContext2D, x: number, top: number, now: number, at: number) {
  // The first few seconds it's brewing in the machine; then it's theirs.
  if (at < 8000) return;
  const sip = at % 5000 > 4200;
  const cx = x + 6, cy = top + (sip ? 12 : 19);
  rect(g, cx, cy, 3, 3, '#ffffff');
  rect(g, cx + 3, cy + 1, 1, 1, '#ffffff');
  rect(g, cx, cy, 3, 1, '#6b4a2f');
  for (let i = 0; i < 2; i++) {
    const p = (now / 1100 + i / 2) % 1;
    g.globalAlpha = 0.5 * (1 - p);
    rect(g, cx + 1 + Math.round(Math.sin(p * 6 + i)), cy - 2 - Math.round(p * 7), 1, 1, '#ffffff');
  }
  g.globalAlpha = 1;
}
