// Where a domain model's association lines go, so a model nobody arranged in Studio Pro still reads.
//
// Agents and mxcli create associations with Studio Pro's default connection points (the parent's
// left-middle to the child's right-middle) and place entities on a plain grid, so drawn faithfully the
// lines run from one box's left edge to another's right edge straight across the boxes between. For
// such an association (both points still the defaults) the line instead leaves from the sides the two
// boxes face each other with, several lines on one side are spread along it, and the line runs in
// straight horizontal and vertical segments around the other boxes, its name and 1/* discs put where
// they cover no box or other label when there's room. An association whose points someone moved in
// Studio Pro keeps them exactly (a straight line, as Studio Pro draws it).
//
// "Tidy layout" (domain-tidy.ts) goes further, for the view only. Nothing here writes the model.
// Everything is plain arithmetic on tens of boxes: well under the 30 ms a 50-entity, 80-association
// model may take (tests/model-layout.test.ts measures it).

import type { DmAssociation, DmEntity, DomainDoc, Pt } from '../../../shared/model';
import { measure } from './text';

export type Box = { x: number; y: number; w: number; h: number };
export type Side = 'L' | 'R' | 'T' | 'B';

export const ENTITY_W = 170;
const MIN_H = 89;
const ROW = 16.5;
export const entityHeight = (e: DmEntity): number => Math.max(MIN_H, 40.5 + e.attrs.length * ROW);

/** How a line is drawn: orthogonal segments, a straight line (stored points), Studio Pro's loop, or a stub to another module. */
export type RouteKind = 'ortho' | 'straight' | 'loop' | 'cross';

export interface Route {
  kind: RouteKind;
  /** The line, from the parent's end to the child's (a stub's far end for 'cross'; the two ends for 'loop'). */
  pts: Pt[];
  /** The middle of the name box. */
  name: Pt;
  /** The middle of the multiplicity discs at the parent's and the child's end. */
  pDisc: Pt;
  cDisc: Pt;
  /** 'cross': where the other module's entity is named. */
  crossText?: { x: number; y: number; anchor: 'start' | 'middle' | 'end' };
  /** Whether the ends were chosen here (the stored points were Studio Pro's defaults). */
  auto: boolean;
}

const DEF_P: Pt = { x: 0, y: 50 };
const DEF_C: Pt = { x: 100, y: 50 };
const isAt = (p: Pt | undefined, d: Pt) => !p || (Math.abs(p.x - d.x) < 0.01 && Math.abs(p.y - d.y) < 0.01);

/** Whether an association still has the connection points it was created with (nobody moved them in Studio Pro). */
export const unarranged = (a: DmAssociation): boolean => isAt(a.parentConn, DEF_P) && isAt(a.childConn, DEF_C);

const DIR: Record<Side, Pt> = { L: { x: -1, y: 0 }, R: { x: 1, y: 0 }, T: { x: 0, y: -1 }, B: { x: 0, y: 1 } };
const horiz = (s: Side) => s === 'L' || s === 'R';
const centre = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** The sides two boxes face each other with: left/right when they're further apart across than down, else top/bottom. */
export function facing(a: Box, b: Box): [Side, Side] {
  const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const ca = centre(a);
  const cb = centre(b);
  if (gx >= gy) return cb.x >= ca.x ? ['R', 'L'] : ['L', 'R'];
  return cb.y >= ca.y ? ['B', 'T'] : ['T', 'B'];
}

/** Where `k` ends sit along a side `len` long, as fractions of it: evenly, at most 28 apart, around the middle. */
export function spreadAlong(len: number, k: number): number[] {
  const gap = Math.min(len / (k + 1), 28);
  return Array.from({ length: k }, (_, i) => 0.5 + ((i - (k - 1) / 2) * gap) / len);
}

const onSide = (b: Box, s: Side, t: number): Pt =>
  s === 'L' ? { x: b.x, y: b.y + b.h * t } : s === 'R' ? { x: b.x + b.w, y: b.y + b.h * t } : s === 'T' ? { x: b.x + b.w * t, y: b.y } : { x: b.x + b.w * t, y: b.y + b.h };

/** A stored connection point (percentages of the box) on the box. */
const stored = (b: Box, conn: Pt): Pt => ({ x: b.x + (b.w * conn.x) / 100, y: b.y + (b.h * conn.y) / 100 });

/** Where a line without stored points meets a box: the middle of the side facing `toward` (the old behaviour, for stubs and loops). */
function endOn(b: Box, conn: Pt | undefined, toward: Pt): Pt {
  if (conn) return stored(b, conn);
  const c = centre(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) * b.h >= Math.abs(dy) * b.w) return { x: dx >= 0 ? b.x + b.w : b.x, y: c.y };
  return { x: c.x, y: dy >= 0 ? b.y + b.h : b.y };
}

// ---- Geometry helpers -------------------------------------------------------------------------------

const len = (pts: Pt[]) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  return s;
};

/** The point `d` along a polyline from its start (its end when it's shorter). */
export function pointAlong(pts: Pt[], d: number): Pt {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= d && l > 0) return { x: a.x + ((b.x - a.x) / l) * d, y: a.y + ((b.y - a.y) / l) * d };
    d -= l;
  }
  return { ...pts[pts.length - 1] };
}

/** Drops repeated points and points in the middle of a straight run. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      if ((Math.abs(a.x - last.x) < 0.01 && Math.abs(last.x - p.x) < 0.01) || (Math.abs(a.y - last.y) < 0.01 && Math.abs(last.y - p.y) < 0.01)) {
        // Collinear: keep the run going the same way, but a turn back stays (reversed() rejects it).
        const back = (p.x - last.x) * (last.x - a.x) + (p.y - last.y) * (last.y - a.y) < 0;
        if (!back) {
          out[out.length - 1] = p;
          continue;
        }
      }
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

const dirOf = (v: number) => (v > 0.01 ? 1 : v < -0.01 ? -1 : 0);

/** An orthogonal polyline's length and bends, or -1 when it doubles back on itself somewhere. */
function shape(pts: Pt[]): { len: number; bends: number } | null {
  let len = 0;
  let bends = 0;
  let dx0 = 0;
  let dy0 = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = dirOf(pts[i].x - pts[i - 1].x);
    const dy = dirOf(pts[i].y - pts[i - 1].y);
    if (!dx && !dy) continue;
    len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
    if (dx0 || dy0) {
      if (dx === -dx0 && dy === -dy0) return null;
      if (dx !== dx0 || dy !== dy0) bends++;
    }
    dx0 = dx;
    dy0 = dy;
  }
  return { len, bends };
}

/** Whether the axis-aligned segment a-b passes through box `b` grown by `pad`. */
export function segHitsBox(a: Pt, c: Pt, b: Box, pad = 0): boolean {
  const x0 = Math.min(a.x, c.x);
  const x1 = Math.max(a.x, c.x);
  const y0 = Math.min(a.y, c.y);
  const y1 = Math.max(a.y, c.y);
  return x1 > b.x - pad && x0 < b.x + b.w + pad && y1 > b.y - pad && y0 < b.y + b.h + pad;
}

const rectsOverlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// ---- Routing ----------------------------------------------------------------------------------------

interface Seg {
  h: boolean;
  /** y for a horizontal segment, x for a vertical one. */
  at: number;
  lo: number;
  hi: number;
}

const segsOf = (pts: Pt[]): Seg[] => {
  const out: Seg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (Math.abs(a.y - b.y) < 0.01) out.push({ h: true, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    else if (Math.abs(a.x - b.x) < 0.01) out.push({ h: false, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
  }
  return out;
};

const STUB = 30;
const GAP = 20;
const PAD = 4;
const BEND = 22;
const HIT = 2000;

/** How much a candidate line runs along or across the lines already placed. */
function clash(segs: Seg[], placed: Seg[]): number {
  let c = 0;
  for (const s of segs) {
    for (const p of placed) {
      if (s.h === p.h) {
        if (Math.abs(s.at - p.at) < 5) {
          const ol = Math.min(s.hi, p.hi) - Math.max(s.lo, p.lo);
          if (ol > 1) c += 40 + ol;
        }
      } else if (p.at > s.lo + 0.5 && p.at < s.hi - 0.5 && s.at > p.lo + 0.5 && s.at < p.hi - 0.5) c += 12;
    }
  }
  return c;
}

/**
 * An orthogonal line from p1 (leaving in direction of side s1) to p2 (arriving from side s2), around
 * `boxes`: the cheapest of a few dozen shapes (one bend coordinate, or a detour through one channel),
 * by length, bends, boxes crossed and lines already placed along the same track.
 */
export function routeOrtho(p1: Pt, s1: Side, p2: Pt, s2: Side, boxes: Box[], placed: Seg[] = []): Pt[] {
  const d1 = DIR[s1];
  const d2 = DIR[s2];
  // Facing sides close together: the stubs share the gap.
  let stub = STUB;
  const gapX = (p2.x - p1.x) * d1.x;
  const gapY = (p2.y - p1.y) * d1.y;
  if (d1.x === -d2.x && d1.y === -d2.y) {
    const g = d1.x ? gapX : gapY;
    if (g > 0 && g < 2 * STUB) stub = g / 2;
  }
  const q1 = { x: p1.x + d1.x * stub, y: p1.y + d1.y * stub };
  const q2 = { x: p2.x + d2.x * stub, y: p2.y + d2.y * stub };
  const mx = (q1.x + q2.x) / 2;
  const my = (q1.y + q2.y) / 2;
  const loX = Math.min(q1.x, q2.x) - 260;
  const hiX = Math.max(q1.x, q2.x) + 260;
  const loY = Math.min(q1.y, q2.y) - 260;
  const hiY = Math.max(q1.y, q2.y) + 260;
  const near: Box[] = [];
  const xs = [q1.x, q2.x, mx];
  const ys = [q1.y, q2.y, my];
  for (const b of boxes) {
    if (b.x > hiX || b.x + b.w < loX || b.y > hiY || b.y + b.h < loY) continue;
    near.push(b);
    xs.push(b.x - GAP, b.x + b.w + GAP);
    ys.push(b.y - GAP, b.y + b.h + GAP);
  }
  const pick = (vs: number[], m: number, k: number) => [...new Set(vs.map((v) => Math.round(v * 2) / 2))].sort((a, b) => Math.abs(a - m) - Math.abs(b - m) || a - b).slice(0, k);
  const X = pick(xs, mx, 12);
  const Y = pick(ys, my, 12);
  const cands: Pt[][] = [];
  for (const x of X) cands.push([q1, { x, y: q1.y }, { x, y: q2.y }, q2]);
  for (const y of Y) cands.push([q1, { x: q1.x, y }, { x: q2.x, y }, q2]);
  for (const x of X.slice(0, 5))
    for (const y of Y.slice(0, 5)) {
      cands.push([q1, { x, y: q1.y }, { x, y }, { x: q2.x, y }, q2]);
      cands.push([q1, { x: q1.x, y }, { x, y }, { x, y: q2.y }, q2]);
    }
  // Shortest first; boxes crossed are counted only until eight shapes cross none (no later one can beat those).
  const shaped: { pts: Pt[]; inner: Pt[]; cost: number }[] = [];
  for (const c of cands) {
    const full = [p1, ...c, p2];
    const sh = shape(full);
    if (sh) shaped.push({ pts: full, inner: c, cost: sh.len + BEND * sh.bends });
  }
  if (!shaped.length) return simplify([p1, q1, { x: q2.x, y: q1.y }, q2, p2]);
  shaped.sort((a, b) => a.cost - b.cost);
  const scored: { pts: Pt[]; cost: number }[] = [];
  let clear = 0;
  for (const s of shaped) {
    let hits = 0;
    const c = s.inner;
    for (let i = 1; i < c.length; i++) for (const b of near) if (segHitsBox(c[i - 1], c[i], b, PAD)) hits++;
    scored.push({ pts: s.pts, cost: s.cost + HIT * hits });
    if (!hits && ++clear >= 8) break;
  }
  scored.sort((a, b) => a.cost - b.cost);
  // Only lines already placed in this neighbourhood can share a track with this one.
  const local = placed.filter((g) => (g.h ? g.at >= loY && g.at <= hiY && g.hi >= loX && g.lo <= hiX : g.at >= loX && g.at <= hiX && g.hi >= loY && g.lo <= hiY));
  let best = scored[0].pts;
  let bestCost = Infinity;
  for (const s of scored.slice(0, 8)) {
    const pts = simplify(s.pts);
    const c = s.cost + clash(segsOf(pts), local);
    if (c < bestCost) {
      bestCost = c;
      best = pts;
    }
  }
  return best;
}

/**
 * Lines that share a track (the same channel, overlapping) are moved apart, 7 apart around it, so each
 * stays visible. Only the inner segments move; the ends stay on their boxes.
 */
function nudge(routes: Pt[][]) {
  type Item = { r: number; i: number; s: Seg };
  const items: Item[] = [];
  routes.forEach((pts, r) => {
    for (let i = 2; i < pts.length - 1; i++) {
      const [s] = segsOf([pts[i - 1], pts[i]]);
      if (s) items.push({ r, i, s });
    }
  });
  items.sort((a, b) => Number(a.s.h) - Number(b.s.h) || a.s.at - b.s.at || a.s.lo - b.s.lo);
  const done = new Set<Item>();
  for (let k = 0; k < items.length; k++) {
    const first = items[k];
    if (done.has(first)) continue;
    const group = [first];
    let hi = first.s.hi;
    for (let j = k + 1; j < items.length; j++) {
      const o = items[j];
      if (o.s.h !== first.s.h || Math.abs(o.s.at - first.s.at) > 2.5) break;
      if (o.s.lo < hi - 1 && o.r !== group[group.length - 1].r) {
        group.push(o);
        hi = Math.max(hi, o.s.hi);
      }
    }
    if (group.length < 2) continue;
    group.sort((a, b) => a.r - b.r);
    group.forEach((g, n) => {
      done.add(g);
      const off = Math.max(-12, Math.min(12, (n - (group.length - 1) / 2) * 7));
      const pts = routes[g.r];
      const a = pts[g.i - 1];
      const b = pts[g.i];
      if (g.s.h) {
        a.y += off;
        b.y += off;
      } else {
        a.x += off;
        b.x += off;
      }
    });
  }
}

// ---- Placing everything ------------------------------------------------------------------------------

const NAME_H = 20;
const DISC = 15;
const nameW = (name: string) => measure(name, 11.5) + 8;
const discBox = (p: Pt): Box => ({ x: p.x - DISC / 2, y: p.y - DISC / 2, w: DISC, h: DISC });

/**
 * Every association's line, ends and labels. `boxes` holds the entities' (and annotations') boxes by id.
 * Associations whose entities aren't in `boxes` are left out.
 */
export function routeAssociations(assocs: DmAssociation[], boxes: Map<string, Box>, obstacles: Box[] = [...boxes.values()]): Map<string, Route> {
  const out = new Map<string, Route>();
  type End = { box: Box; side: Side; key: number; order: number; set: (p: Pt) => void };
  const ends = new Map<string, End[]>();
  const addEnd = (id: string, e: End) => {
    const k = `${id}|${e.side}`;
    const l = ends.get(k);
    if (l) l.push(e);
    else ends.set(k, [e]);
  };
  type Auto = { a: DmAssociation; pb: Box; cb: Box; ps: Side; cs: Side; p?: Pt; c?: Pt; self: boolean; order: number };
  const autos: Auto[] = [];
  type Stub = { a: DmAssociation; pb: Box; side: Side; start?: Pt };
  const stubs: Stub[] = [];

  assocs.forEach((a, order) => {
    const pb = boxes.get(a.parent);
    if (!pb) return;
    if (a.cross) {
      if (!unarranged(a)) {
        const start = endOn(pb, a.parentConn, { x: pb.x - 100, y: pb.y + pb.h / 2 });
        out.set(a.id, crossRoute(start, start.x <= pb.x + pb.w / 2 ? 'L' : 'R', false));
        return;
      }
      // A stub out of the side where it crosses nothing (left first, as before).
      let side: Side = 'L';
      let fewest = Infinity;
      for (const s of ['L', 'R', 'T', 'B'] as Side[]) {
        const st = onSide(pb, s, 0.5);
        const l = horiz(s) ? 150 : 110;
        const d = DIR[s];
        const a0 = { x: st.x + d.x * PAD * 2, y: st.y + d.y * PAD * 2 };
        const a1 = { x: st.x + d.x * l, y: st.y + d.y * l };
        let hits = 0;
        for (const b of obstacles) if (b !== pb && segHitsBox(a0, a1, b, 12)) hits++;
        if (hits < fewest) {
          fewest = hits;
          side = s;
        }
        if (!hits) break;
      }
      const stub: Stub = { a, pb, side };
      stubs.push(stub);
      addEnd(a.parent, { box: pb, side, key: horiz(side) ? pb.y + pb.h / 2 : pb.x + pb.w / 2, order, set: (p) => (stub.start = p) });
      return;
    }
    const cb = boxes.get(a.child);
    if (!cb) return;
    const self = a.parent === a.child;
    if (!unarranged(a)) {
      out.set(a.id, storedRoute(a, pb, cb));
      return;
    }
    if (self) {
      const u: Auto = { a, pb, cb, ps: 'R', cs: 'R', self, order };
      autos.push(u);
      addEnd(a.parent, { box: pb, side: 'R', key: -1e9 + order * 2, order, set: (p) => (u.p = p) });
      addEnd(a.child, { box: cb, side: 'R', key: -1e9 + order * 2 + 1, order, set: (p) => (u.c = p) });
      return;
    }
    const [ps, cs] = facing(pb, cb);
    const u: Auto = { a, pb, cb, ps, cs, self, order };
    autos.push(u);
    const pc = centre(pb);
    const cc = centre(cb);
    addEnd(a.parent, { box: pb, side: ps, key: horiz(ps) ? cc.y : cc.x, order, set: (p) => (u.p = p) });
    addEnd(a.child, { box: cb, side: cs, key: horiz(cs) ? pc.y : pc.x, order, set: (p) => (u.c = p) });
  });

  // Several ends on one side: spread along it, in the order of where their lines go (fewer crossings).
  for (const list of ends.values()) {
    list.sort((x, y) => x.key - y.key || x.order - y.order);
    const { box, side } = list[0];
    const ts = spreadAlong(horiz(side) ? box.h : box.w, list.length);
    list.forEach((e, i) => e.set(onSide(box, side, ts[i])));
  }

  // Short lines first: they have the fewest ways round.
  autos.sort((x, y) => {
    const dx = Math.abs(centre(x.pb).x - centre(x.cb).x) + Math.abs(centre(x.pb).y - centre(x.cb).y);
    const dy = Math.abs(centre(y.pb).x - centre(y.cb).x) + Math.abs(centre(y.pb).y - centre(y.cb).y);
    return dx - dy || x.order - y.order;
  });
  const placed: Seg[] = [];
  const lines: Pt[][] = [];
  for (const u of autos) {
    const p = u.p!;
    const c = u.c!;
    const pts = u.self ? selfLoop(p, c, u.pb) : routeOrtho(p, u.ps, c, u.cs, obstacles, placed);
    lines.push(pts);
    placed.push(...segsOf(pts));
  }
  nudge(lines);
  autos.forEach((u, i) => out.set(u.a.id, { kind: 'ortho', pts: simplify(lines[i]), name: { x: 0, y: 0 }, pDisc: { x: 0, y: 0 }, cDisc: { x: 0, y: 0 }, auto: true }));
  for (const s of stubs) out.set(s.a.id, crossRoute(s.start!, s.side, true));

  // Labels: the discs where they belong (beside the ends), then each name where it covers least.
  const labels: Box[] = [];
  const segs: Seg[] = [];
  const segsByRoute = new Map<Route, Seg[]>();
  for (const r of out.values()) {
    if (r.kind === 'ortho') {
      r.pDisc = pointAlong(r.pts, 22.5);
      r.cDisc = pointAlong([...r.pts].reverse(), 22.5);
      const mine = segsOf(r.pts);
      segsByRoute.set(r, mine);
      segs.push(...mine);
    }
    labels.push(discBox(r.pDisc), discBox(r.cDisc));
  }
  const ordered = assocs.filter((a) => out.get(a.id)?.kind === 'ortho');
  for (const a of assocs) {
    const r = out.get(a.id);
    if (r && r.kind !== 'ortho') labels.push(nameRect(r.name, a.name));
  }
  for (const a of ordered) {
    const r = out.get(a.id)!;
    const total = len(r.pts);
    const w = nameW(a.name);
    let best: Pt = pointAlong(r.pts, total / 2);
    let bestCost = Infinity;
    const own = new Set(segsByRoute.get(r));
    // On the line, half way or nearer an end; failing that beside it (as Studio Pro does on a short line).
    const spots: { at: Pt; cost: number }[] = [];
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78]) spots.push({ at: pointAlong(r.pts, total * f), cost: Math.abs(f - 0.5) * 40 });
    for (const f of [0.5, 0.3, 0.7]) {
      const a0 = pointAlong(r.pts, total * f - 1);
      const a1 = pointAlong(r.pts, total * f + 1);
      const at = pointAlong(r.pts, total * f);
      const across = Math.abs(a1.x - a0.x) > Math.abs(a1.y - a0.y);
      for (const sign of [-1, 1]) spots.push({ at: across ? { x: at.x, y: at.y + sign * 17 } : { x: at.x + sign * (w / 2 + 6), y: at.y }, cost: 30 + Math.abs(f - 0.5) * 40 });
    }
    // Only what's near the line can be under its name.
    let rx0 = Infinity;
    let ry0 = Infinity;
    let rx1 = -Infinity;
    let ry1 = -Infinity;
    for (const s of spots) {
      rx0 = Math.min(rx0, s.at.x - w / 2);
      rx1 = Math.max(rx1, s.at.x + w / 2);
      ry0 = Math.min(ry0, s.at.y - NAME_H / 2);
      ry1 = Math.max(ry1, s.at.y + NAME_H / 2);
    }
    const area = { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 };
    const touches = (b: Box) => b.x < area.x + area.w && b.x + b.w > area.x && b.y < area.y + area.h && b.y + b.h > area.y;
    const nearBoxes = obstacles.filter(touches);
    const nearLabels = labels.filter(touches);
    const nearSegs = segs.filter((s) => (s.h ? s.at >= area.y && s.at <= area.y + area.h && s.hi >= area.x && s.lo <= area.x + area.w : s.at >= area.x && s.at <= area.x + area.w && s.hi >= area.y && s.lo <= area.y + area.h));
    for (const { at, cost: base } of spots) {
      const rect = { x: at.x - w / 2, y: at.y - NAME_H / 2, w, h: NAME_H };
      let cost = base;
      for (const b of nearBoxes) cost += rectsOverlap(rect, b) * 4;
      for (const l of nearLabels) cost += rectsOverlap(rect, l) * 3;
      for (const s of nearSegs) {
        if (own.has(s)) continue;
        const crosses = s.h ? s.at > rect.y && s.at < rect.y + rect.h && s.hi > rect.x && s.lo < rect.x + rect.w : s.at > rect.x && s.at < rect.x + rect.w && s.hi > rect.y && s.lo < rect.y + rect.h;
        if (crosses) cost += 30;
      }
      if (cost < bestCost - 0.01) {
        bestCost = cost;
        best = at;
      }
      if (cost < 1) break;
    }
    r.name = best;
    labels.push(nameRect(best, a.name));
  }
  return out;
}

const nameRect = (p: Pt, name: string): Box => {
  const w = nameW(name);
  return { x: p.x - w / 2, y: p.y - NAME_H / 2, w, h: NAME_H };
};

/** An association from an entity to itself, both ends on its right side: out, down (or up), back in. */
function selfLoop(p: Pt, c: Pt, b: Box): Pt[] {
  const x = b.x + b.w + STUB;
  if (Math.abs(p.y - c.y) < 1) c = { x: c.x, y: c.y + 20 };
  return [p, { x, y: p.y }, { x, y: c.y }, c];
}

function crossRoute(start: Pt, side: Side, auto: boolean): Route {
  const d = DIR[side];
  const l = horiz(side) ? 150 : 110;
  const end = { x: start.x + d.x * l, y: start.y + d.y * l };
  const crossText: Route['crossText'] =
    side === 'L' ? { x: end.x - 4, y: end.y + 22, anchor: 'end' } : side === 'R' ? { x: end.x + 4, y: end.y + 22, anchor: 'start' } : side === 'T' ? { x: end.x, y: end.y - 8, anchor: 'middle' } : { x: end.x, y: end.y + 18, anchor: 'middle' };
  return { kind: 'cross', pts: [start, end], name: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, pDisc: pointAlong([start, end], 22), cDisc: pointAlong([end, start], 10), crossText, auto };
}

/** A line between the points someone chose in Studio Pro: drawn exactly as Studio Pro does. */
function storedRoute(a: DmAssociation, pb: Box, cb: Box): Route {
  const p = endOn(pb, a.parentConn, centre(cb));
  const c = endOn(cb, a.childConn, centre(pb));
  if (a.parent === a.child || Math.hypot(p.x - c.x, p.y - c.y) < 4) {
    const top = pb.y - 46;
    return { kind: 'loop', pts: [p, c], name: { x: pb.x + pb.w / 2, y: top }, pDisc: { x: p.x - 18, y: p.y - 10 }, cDisc: { x: c.x + 18, y: c.y - 10 }, auto: false };
  }
  let mid = { x: (p.x + c.x) / 2, y: (p.y + c.y) / 2 };
  // A line too short for its name between the two discs: the name sits beside the line instead.
  const l = Math.hypot(c.x - p.x, c.y - p.y);
  if (l < nameW(a.name) + 2 * 32) {
    const nx = -(c.y - p.y) / (l || 1);
    const ny = (c.x - p.x) / (l || 1);
    const side = ny > 0 ? -1 : 1;
    mid = { x: mid.x + nx * 17 * side, y: mid.y + ny * 17 * side };
  }
  return { kind: 'straight', pts: [p, c], name: mid, pDisc: pointAlong([p, c], 22.5), cDisc: pointAlong([c, p], 22.5), auto: false };
}

// ---- Whether the layout looks unarranged ---------------------------------------------------------------

const evenlySpaced = (vs: number[]) => {
  const u = [...new Set(vs.map((v) => Math.round(v)))].sort((a, b) => a - b);
  if (u.length < 2) return true;
  const step = u[1] - u[0];
  return u.every((v, i) => i === 0 || Math.abs(v - u[i - 1] - step) <= 1);
};

/**
 * Whether nobody arranged this domain model in Studio Pro: the entities on an even grid (as agents and
 * mxcli place them) and (nearly) every association with the default connection points. The page then
 * suggests the tidy layout.
 */
export function looksUnarranged(doc: DomainDoc): boolean {
  const inner = doc.associations.filter((a) => !a.cross && a.parent !== a.child);
  if (doc.entities.length < 3 || inner.length < 2) return false;
  if (inner.filter(unarranged).length < inner.length * 0.8) return false;
  return evenlySpaced(doc.entities.map((e) => e.x)) && evenlySpaced(doc.entities.map((e) => e.y));
}
