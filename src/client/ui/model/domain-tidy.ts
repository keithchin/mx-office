// "Tidy layout" for a domain model, for the view only (the model is never written): the entities
// rearranged in layers along the associations, referenced entities above the ones that reference them,
// so a model whose entities were dropped on a grid (as agents and mxcli place them) reads top to
// bottom. Its own small layered layout (no dependency): cycles broken by a walk, longest-path layers,
// a few barycentre sweeps for the order, each entity under its neighbours. Deterministic.

import type { DomainDoc, Pt } from '../../../shared/model';
import { ENTITY_W, entityHeight } from './domain-layout';

const COL_GAP = 170;
const MAX_ROW = 6;
/** The space under a row: room for the lines passing below it (and their names) to run side by side. */
const rowGap = (lines: number) => Math.min(320, 90 + 16 * lines);

/**
 * The same domain model with its entities rearranged for reading (the view only): each group of
 * connected entities in layers, the referenced ones above those that reference them, ordered to cross
 * as little as possible; entities without associations in a grid below; annotations under those. All
 * associations get chosen ends (their stored points belonged to the old places). The same model always
 * comes out the same.
 */
export function tidyDomain(doc: DomainDoc): DomainDoc {
  const ents = [...doc.entities].sort((a, b) => a.y - b.y || a.x - b.x || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const idx = new Map(ents.map((e, i) => [e.id, i]));
  const n = ents.length;
  const out: number[][] = Array.from({ length: n }, () => []);
  const adj: number[][] = Array.from({ length: n }, () => []);
  const seen = new Set<string>();
  for (const a of doc.associations) {
    if (a.cross) continue;
    const p = idx.get(a.parent);
    const c = idx.get(a.child);
    if (p === undefined || c === undefined || p === c || seen.has(`${p}>${c}`)) continue;
    seen.add(`${p}>${c}`);
    out[p].push(c);
    if (!seen.has(`${c}>${p}`)) {
      adj[p].push(c);
      adj[c].push(p);
    }
  }
  // Connected groups (the biggest first), and the loners.
  const comp = new Array<number>(n).fill(-1);
  const groups: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0 || !adj[i].length) continue;
    const g: number[] = [];
    const stack = [i];
    comp[i] = groups.length;
    while (stack.length) {
      const v = stack.pop()!;
      g.push(v);
      for (const w of adj[v]) if (comp[w] < 0) (comp[w] = groups.length), stack.push(w);
    }
    groups.push(g.sort((a, b) => a - b));
  }
  groups.sort((a, b) => b.length - a.length || a[0] - b[0]);
  const loners = ents.map((_, i) => i).filter((i) => !adj[i].length);

  // Layers: a referenced entity above the ones referencing it (cycles broken where the walk meets them).
  const layer = new Array<number>(n).fill(-1);
  const state = new Array<number>(n).fill(0);
  const depth = (v: number): number => {
    if (state[v] === 2) return layer[v];
    state[v] = 1;
    let l = 0;
    for (const c of out[v]) if (state[c] !== 1) l = Math.max(l, depth(c) + 1);
    state[v] = 2;
    layer[v] = l;
    return l;
  };
  for (let i = 0; i < n; i++) if (adj[i].length && !state[i]) depth(i);

  const pos = new Map<number, Pt>();
  let gx = 100;
  let bottom = 100;
  const top = 100;
  for (const g of groups) {
    const maxL = Math.max(...g.map((v) => layer[v]));
    let rows: number[][] = Array.from({ length: maxL + 1 }, () => []);
    for (const v of g) rows[layer[v]].push(v);
    rows = rows.filter((r) => r.length);
    // Order within rows: by the mean place of their neighbours, a few sweeps down and up.
    const place = new Map<number, number>();
    const setPlaces = (r: number[]) => r.forEach((v, i) => place.set(v, i - (r.length - 1) / 2));
    rows.forEach(setPlaces);
    for (let sweep = 0; sweep < 6; sweep++) {
      const order = sweep % 2 ? [...rows.keys()].reverse() : [...rows.keys()];
      for (const ri of order) {
        const r = rows[ri];
        const bary = new Map<number, number>();
        for (const v of r) {
          const ns = adj[v].filter((w) => layer[w] !== layer[v]);
          bary.set(v, ns.length ? ns.reduce((s, w) => s + place.get(w)!, 0) / ns.length : place.get(v)!);
        }
        r.sort((a, b) => bary.get(a)! - bary.get(b)! || place.get(a)! - place.get(b)!);
        setPlaces(r);
      }
    }
    // Long rows wrap.
    const lines: number[][] = [];
    for (const r of rows) for (let i = 0; i < r.length; i += MAX_ROW) lines.push(r.slice(i, i + MAX_ROW));
    const lineOf = new Map<number, number>();
    lines.forEach((l, i) => l.forEach((v) => lineOf.set(v, i)));
    // How many associations pass under each row.
    const under = new Array<number>(lines.length).fill(0);
    for (const v of g)
      for (const c of out[v]) {
        const a = lineOf.get(v)!;
        const b = lineOf.get(c)!;
        for (let i = Math.min(a, b); i < Math.max(a, b); i++) under[i]++;
      }
    const widest = Math.max(...lines.map((l) => l.length));
    const step = ENTITY_W + COL_GAP;
    // Across: each entity under the mean of its neighbours in the rows above (in order, never closer than a column).
    const xOf = new Map<number, number>();
    for (const l of lines) {
      const want = l.map((v, i) => {
        const ns = adj[v].filter((u) => xOf.has(u));
        return ns.length ? ns.reduce((s, u) => s + xOf.get(u)!, 0) / ns.length : ((widest - l.length) / 2 + i) * step;
      });
      const xs = [...want];
      for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + step);
      const shift = want.reduce((s, v, i) => s + v - xs[i], 0) / xs.length;
      l.forEach((v, i) => xOf.set(v, xs[i] + shift));
    }
    const minX = Math.min(...xOf.values());
    const width = Math.max(...xOf.values()) - minX + ENTITY_W;
    let y = top;
    for (const [li, l] of lines.entries()) {
      let h = 0;
      for (const v of l) {
        const e = ents[v];
        const lift = e.generalization || e.service ? 24 : 0;
        pos.set(v, { x: Math.round(gx + xOf.get(v)! - minX), y: y + lift });
        h = Math.max(h, entityHeight(e) + lift);
      }
      y += h + (li < lines.length - 1 ? rowGap(under[li]) : 0);
    }
    bottom = Math.max(bottom, y);
    gx += Math.round(width + COL_GAP + 60);
  }
  // The loners in a grid beside the groups when those are taller than wide (a screen is wide), else under them.
  const beside = groups.length > 0 && bottom - top > gx - 100;
  const lx = beside ? gx + 40 : 100;
  let y = groups.length && !beside ? bottom + 160 : top;
  const cols = beside ? Math.max(2, Math.min(4, Math.ceil(Math.sqrt(loners.length / 1.5)))) : Math.max(3, Math.min(MAX_ROW, Math.ceil(Math.sqrt(loners.length * 1.6))));
  for (let i = 0; i < loners.length; i += cols) {
    const row = loners.slice(i, i + cols);
    let h = 0;
    row.forEach((v, j) => {
      const e = ents[v];
      const lift = e.generalization || e.service ? 24 : 0;
      pos.set(v, { x: lx + j * (ENTITY_W + 60), y: y + lift });
      h = Math.max(h, entityHeight(e) + lift);
    });
    y += h + 60;
  }
  y = Math.max(y, bottom + 60);
  let ax = 100;
  const annotations = [...doc.annotations]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((a) => {
      const r = { ...a, x: ax, y: y + 10 };
      ax += a.w + 40;
      return r;
    });
  return {
    ...doc,
    entities: doc.entities.map((e) => ({ ...e, ...pos.get(idx.get(e.id)!) })),
    associations: doc.associations.map((a) => ({ ...a, parentConn: undefined, childConn: undefined })),
    annotations,
  };
}
