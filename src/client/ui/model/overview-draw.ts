// The System Overview drawn on the Model tab's canvas (canvas.ts: pan, zoom, fit, click): a box per module
// with its counts, an arrow from each module to the ones it uses, labelled with how many references. The
// modules are laid out in layers (`layers`): the ones nothing uses at the top, each module below
// everything that uses it, so dependencies point down and System sits at the bottom. Marketplace and
// platform modules are drawn quieter. Pointing at an arrow lights it and its two modules.

import type { OverviewDoc } from '../../../shared/model';
import type { Drawn } from './flow-draw';
import { ellipsis, esc, n } from './text';

export const BOX_W = 240;
export const BOX_H = 72;
const GAP_X = 36;
const GAP_Y = 110;
/** At most this many modules side by side; a longer layer wraps. */
const ROW_MAX = 4;

export const moduleId = (name: string) => `mod:${name}`;
export const edgeId = (from: string, to: string) => `dep:${from}>${to}`;

/** Each module's layer (0 at the top): one below the lowest module that uses it. Cycles are cut. */
export function layers(doc: OverviewDoc): Map<string, number> {
  const layer = new Map(doc.modules.map((m) => [m.name, 0]));
  // Longest path from the modules nothing uses, at most one pass per module (a cycle stops growing there).
  for (let pass = 0; pass < doc.modules.length; pass++) {
    let moved = false;
    for (const e of doc.edges) {
      const a = layer.get(e.from);
      const b = layer.get(e.to);
      if (a === undefined || b === undefined) continue;
      if (b < a + 1 && a + 1 < doc.modules.length) {
        layer.set(e.to, a + 1);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return layer;
}

/** Each module's box: layers top to bottom, each layer centred, its modules ordered by where their users sit. */
export function placeModules(doc: OverviewDoc): Map<string, { x: number; y: number }> {
  const layer = layers(doc);
  const linked = new Set(doc.edges.flatMap((e) => [e.from, e.to]));
  const layered: string[][] = [];
  for (const m of doc.modules) if (linked.has(m.name)) (layered[layer.get(m.name) ?? 0] ??= []).push(m.name);
  // Modules with no dependency either way go in a row of their own at the bottom; a long layer wraps.
  const alone = doc.modules.filter((m) => !linked.has(m.name)).map((m) => m.name);
  const rows: string[][] = [];
  for (const r of [...layered.filter(Boolean), alone]) for (let i = 0; i < r.length; i += ROW_MAX) rows.push(r.slice(i, i + ROW_MAX));
  const pos = new Map<string, { x: number; y: number }>();
  const widest = Math.max(1, ...rows.map((r) => r?.length ?? 0));
  rows.forEach((row, li) => {
    if (!row) return;
    // Under the modules that use them (the mean x of their users), app modules before Marketplace ones.
    const users = (name: string) => doc.edges.filter((e) => e.to === name && pos.has(e.from)).map((e) => (pos.get(e.from) as { x: number }).x);
    const sys = new Set(doc.modules.filter((m) => m.system).map((m) => m.name));
    row.sort((a, b) => {
      const ua = users(a);
      const ub = users(b);
      const ma = ua.length ? ua.reduce((s, x) => s + x, 0) / ua.length : 0;
      const mb = ub.length ? ub.reduce((s, x) => s + x, 0) / ub.length : 0;
      return li === 0 ? Number(sys.has(a)) - Number(sys.has(b)) || a.localeCompare(b) : ma - mb || a.localeCompare(b);
    });
    const offset = ((widest - row.length) * (BOX_W + GAP_X)) / 2;
    row.forEach((name, i) => pos.set(name, { x: offset + i * (BOX_W + GAP_X), y: li * (BOX_H + GAP_Y) }));
  });
  return pos;
}

export function drawOverview(doc: OverviewDoc): Drawn {
  const pos = placeModules(doc);
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  const parts: string[] = [];
  const marker = '<defs><marker id="mx-dep-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="mx-head"/></marker></defs>';
  // Where each arrow leaves its module's bottom and meets the other's top: spread along the edge, in the order of the other ends.
  const port = new Map<string, number>();
  const spread = (ends: [string, number][], key: (other: string) => string) => {
    ends.sort((p, q) => p[1] - q[1]);
    ends.forEach(([other], i) => port.set(key(other), (BOX_W * (i + 1)) / (ends.length + 1)));
  };
  for (const m of doc.modules) {
    const out: [string, number][] = doc.edges.filter((e) => e.from === m.name && pos.has(e.to)).map((e) => [e.to, (pos.get(e.to) as { x: number }).x]);
    const inc: [string, number][] = doc.edges.filter((e) => e.to === m.name && pos.has(e.from)).map((e) => [e.from, (pos.get(e.from) as { x: number }).x]);
    spread(out, (o) => `out:${m.name}>${o}`);
    spread(inc, (o) => `in:${o}>${m.name}`);
  }
  for (const e of doc.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const pa = port.get(`out:${e.from}>${e.to}`) ?? BOX_W / 2;
    const pb = port.get(`in:${e.from}>${e.to}`) ?? BOX_W / 2;
    let d: string;
    let lx: number;
    let ly: number;
    if (b.y > a.y) {
      const [x1, y1, x2, y2] = [a.x + pa, a.y + BOX_H, b.x + pb, b.y];
      const k = (y2 - y1) / 2;
      d = `M${n(x1)} ${n(y1)}C${n(x1)} ${n(y1 + k)} ${n(x2)} ${n(y2 - k)} ${n(x2)} ${n(y2)}`;
      [lx, ly] = [(x1 + x2) / 2, (y1 + y2) / 2];
    } else {
      // Up or sideways (a cycle, or modules in one layer): out of the right side, round, into the right side.
      const [x1, y1, x2, y2] = [a.x + BOX_W, a.y + BOX_H / 2, b.x + BOX_W, b.y + BOX_H / 2];
      const out = 60 + Math.abs(y2 - y1) * 0.15;
      d = `M${n(x1)} ${n(y1)}C${n(Math.max(x1, x2) + out)} ${n(y1)} ${n(Math.max(x1, x2) + out)} ${n(y2)} ${n(x2)} ${n(y2)}`;
      [lx, ly] = [Math.max(x1, x2) + out * 0.75, (y1 + y2) / 2];
    }
    const label = String(e.count);
    const tw = 10 + label.length * 7;
    const id = edgeId(e.from, e.to);
    const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + BOX_W + 80, h: Math.abs(a.y - b.y) + BOX_H };
    boxes.set(id, box);
    parts.push(
      `<g class="mx-edge mx-dep" data-id="${esc(id)}" data-ends="${esc(`${moduleId(e.from)} ${moduleId(e.to)}`)}" data-box="${n(box.x)},${n(box.y)},${n(box.w)},${n(box.h)}"><path class="mx-hit" d="${d}"/><path class="mx-flow" d="${d}" marker-end="url(#mx-dep-head)"/><g class="mx-lbl"><rect x="${n(lx - tw / 2)}" y="${n(ly - 9)}" width="${n(tw)}" height="18" rx="9"/><text x="${n(lx)}" y="${n(ly + 4)}" text-anchor="middle">${esc(label)}</text></g></g>`,
    );
  }
  for (const m of doc.modules) {
    const p = pos.get(m.name);
    if (!p) continue;
    const id = moduleId(m.name);
    boxes.set(id, { x: p.x, y: p.y, w: BOX_W, h: BOX_H });
    const counts = `${m.entities} entities · ${m.microflows} microflows · ${m.pages} pages`;
    parts.push(
      `<g class="mx-el mx-mod${m.system ? ' mx-mod-sys' : ''}" data-id="${esc(id)}" data-box="${n(p.x)},${n(p.y)},${BOX_W},${BOX_H}"><rect class="mx-mod-box" x="${n(p.x)}" y="${n(p.y)}" width="${BOX_W}" height="${BOX_H}" rx="6"/><path class="mx-mod-ico" d="M${n(p.x + 12)} ${n(p.y + 12)}h14v14h-14zM${n(p.x + 15)} ${n(p.y + 17)}h8M${n(p.x + 15)} ${n(p.y + 21)}h8"/><text class="mx-mod-name" x="${n(p.x + 34)}" y="${n(p.y + 25)}">${esc(ellipsis(m.name, BOX_W - 44, 15))}</text><text class="mx-mod-sub" x="${n(p.x + 12)}" y="${n(p.y + 47)}">${esc(ellipsis(counts, BOX_W - 20, 12))}</text>${m.system ? `<text class="mx-mod-sub" x="${n(p.x + 12)}" y="${n(p.y + 63)}">Marketplace / platform</text>` : ''}</g>`,
    );
  }
  const xs = [...pos.values()];
  const right = Math.max(BOX_W, ...xs.map((p) => p.x + BOX_W)) + 120;
  const bottom = Math.max(BOX_H, ...xs.map((p) => p.y + BOX_H));
  return { svg: marker + parts.join(''), bounds: { x: -20, y: -20, w: right + 40, h: bottom + 40 }, boxes };
}
