// A Lead's subagent's life about the 2D view's office when it isn't working: the same breaks a benched
// Lead takes (breaks.ts: the lounge TV, a smoke on the balcony, a coffee in the kitchen, walking between
// them along the aisle), each at a spot of its own, a word with whoever else is on a break close by, and
// a walk back to its stool behind its Lead's chair when a run starts (and away again when it ends). Pure
// (meters on the floor plan, a clock): helpers.ts draws it, and the tests check it.

import { breakAt, type BreakAct } from './breaks';
import type { Pose } from './chars';

/** Where one is and what it's doing at a moment. */
export interface LifeSpot {
  x: number;
  z: number;
  /** On a break (or its way to one), on its stool, or walking between the two. */
  act: BreakAct | 'stool';
  walking: boolean;
  pose: Pose;
  /** How long it's been at its break (ms), for the smoke and the steam. */
  at: number;
}

/** The open aisle south of the teams' patches, and the gap between the west and east patches. */
const AISLE_Z = 8.4, GAP_X = -6;
/** Walking pace (meters a second); a walk is sped up to take no longer than this. */
const PACE = 1.8, MOST_WALK_MS = 8000, LEAST_WALK_MS = 600;
/** Two on a break this close are talking. */
export const CHAT_M = 1.4;

/**
 * Where idle subagent `name` (the `i`th one on a break about the floor, counting the benched Leads
 * first) is at wall-clock `clock`: a benched Lead's break cycle of its own, shifted a little off the
 * spot when several share one so they stand side by side.
 */
export function idleSpot(name: string, i: number, clock: number, still = false): LifeSpot {
  const s = breakAt(name, i, clock, still);
  const shift = s.walking ? 0 : ((Math.floor(i / 3) % 3) - 1) * 0.5;
  return { x: s.x + shift, z: s.z, act: s.act, walking: s.walking, pose: s.pose, at: s.at };
}

type Pt = { x: number; z: number };

/** The way from one place to another without cutting through the patches: down to the aisle, along it to the gap, up the gap, across. */
export function wayBetween(from: Pt, to: Pt): Pt[] {
  const pts: Pt[] = [from, { x: from.x, z: AISLE_Z }, { x: GAP_X, z: AISLE_Z }, { x: GAP_X, z: to.z }, to];
  return pts.filter((p, n) => !n || Math.hypot(p.x - pts[n - 1].x, p.z - pts[n - 1].z) > 0.01);
}

const lengthOf = (pts: Pt[]) => pts.reduce((n, p, k) => (k ? n + Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z) : 0), 0);

/** How long walking `pts` takes. */
export const walkMs = (pts: Pt[]) => Math.max(LEAST_WALK_MS, Math.min(MOST_WALK_MS, (lengthOf(pts) / PACE) * 1000));

/** The point a share `t` (0..1) of the way along `pts`, and whether it's heading away from you. */
export function alongWay(pts: Pt[], t: number): Pt & { back: boolean } {
  let d = Math.max(0, Math.min(1, t)) * lengthOf(pts);
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= len || k === pts.length - 1) {
      const u = len ? Math.min(1, d / len) : 1;
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, back: b.z < a.z };
    }
    d -= len;
  }
  return { ...pts[0], back: false };
}

/**
 * Remembers where each subagent was drawn and walks it from there when where it belongs changes kind
 * (its stool, or the breaks), so one that starts a run walks back to its Lead's stool rather than
 * jumping there. One per drawing (the 2D view, each floor of the overview).
 */
export class Walks {
  private readonly seen = new Map<string, { onStool: boolean; at: Pt; walk?: { pts: Pt[]; from: number; ms: number } }>();

  /** Where `key` is now, given where it belongs (`target`), at `now` (ms). `still`: no walking (less motion). */
  place(key: string, target: LifeSpot, now: number, still = false): LifeSpot {
    const onStool = target.act === 'stool';
    const had = this.seen.get(key);
    if (!had || still) {
      this.seen.set(key, { onStool, at: target });
      return target;
    }
    if (had.onStool !== onStool) {
      const pts = wayBetween(had.at, target);
      had.walk = { pts, from: now, ms: walkMs(pts) };
      had.onStool = onStool;
    }
    if (had.walk) {
      const t = (now - had.walk.from) / had.walk.ms;
      if (t < 1) {
        // Towards where it belongs now, wherever that's got to (a break's spot moves as it walks too).
        had.walk.pts[had.walk.pts.length - 1] = { x: target.x, z: target.z };
        const p = alongWay(had.walk.pts, t);
        had.at = p;
        return { x: p.x, z: p.z, act: target.act, walking: true, pose: p.back ? 'back' : 'front', at: 0 };
      }
      had.walk = undefined;
    }
    had.at = target;
    return target;
  }

  /** Forgets the ones not drawn any more. */
  keep(keys: Set<string>) {
    for (const k of this.seen.keys()) if (!keys.has(k)) this.seen.delete(k);
  }
}

/** Which of `who` (standing still, not on a stool) are talking: anyone with another within CHAT_M. */
export function chatting(who: readonly { id: string; x: number; z: number; busy: boolean }[]): Set<string> {
  const out = new Set<string>();
  for (let a = 0; a < who.length; a++) {
    if (who[a].busy) continue;
    for (let b = a + 1; b < who.length; b++) {
      if (who[b].busy || Math.hypot(who[a].x - who[b].x, who[a].z - who[b].z) > CHAT_M) continue;
      out.add(who[a].id);
      out.add(who[b].id);
    }
  }
  return out;
}
