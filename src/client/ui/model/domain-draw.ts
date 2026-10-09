// A module's domain model drawn the way Studio Pro draws it, as SVG: entity boxes coloured by type
// (persistable blue, non-persistable yellow, view green, external purple) with a header (icon and
// name) over the attributes, "Name (Type)" each with its validation and calculated markers; the
// generalization in a blue label on top; associations as grey lines between the connection points the
// developer chose, with "1" and "*" discs near each end, a dot on the owner's end, an arrow at the
// other unless both own it, and the name in a box half way. Annotations sit where they were put.

import type { DmAssociation, DmEntity, DocDiff, DomainDoc, Pt } from '../../../shared/model';
import type { Drawn } from './flow-draw';
import { ellipsis, esc, measure, n, wrap } from './text';

export const ENTITY_W = 170;
const HEAD = 30;
const ROW = 16.5;
const MIN_H = 89;

export const entityHeight = (e: DmEntity): number => Math.max(MIN_H, 40.5 + e.attrs.length * ROW);

type Box = { x: number; y: number; w: number; h: number };

function entitySvg(e: DmEntity, w: number, h: number): string {
  const { x, y } = e;
  let s = `<rect class="mx-ent mx-ent-${e.kind}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="6"/>`;
  s += `<path class="mx-ent-line mx-ent-${e.kind}" d="M${n(x + 1)} ${n(y + HEAD)}H${n(x + w - 1)}"/>`;
  // The header's icon: the entity's image when it has one, else Studio Pro's plain entity glyph.
  const ix = x + 7;
  const iy = y + 7;
  s += e.image
    ? `<g class="mx-ent-ico"><rect x="${n(ix)}" y="${n(iy)}" width="16" height="16" rx="2.5" class="mx-ico-bg"/><circle cx="${n(ix + 8)}" cy="${n(iy + 6)}" r="3"/><path d="M${n(ix + 2.5)} ${n(iy + 14.5)}c.8-3.4 2.9-4.6 5.5-4.6s4.7 1.2 5.5 4.6"/></g>`
    : `<g class="mx-ent-ico"><rect x="${n(ix + 1)}" y="${n(iy + 1)}" width="14" height="14" rx="2" class="mx-ico-bg"/><path d="M${n(ix + 4)} ${n(iy + 4.5)}v7M${n(ix + 7)} ${n(iy + 5.5)}h5M${n(ix + 7)} ${n(iy + 8)}h5M${n(ix + 7)} ${n(iy + 10.5)}h5"/></g>`;
  const right = e.events ? 22 : 8;
  s += `<text class="mx-ent-name" x="${n(x + 29)}" y="${n(y + 19.5)}">${esc(ellipsis(e.name, w - 29 - right, 12))}</text>`;
  if (e.events) s += `<path class="mx-evt" d="M${n(x + w - 12)} ${n(y + 7)}l-5 8.5h4.5l-2.5 7.5 6.5-9.5h-4.6l2.6-6.5z"/>`;
  e.attrs.forEach((a, i) => {
    const cy = y + 43.5 + i * ROW;
    const markers = (a.validation ? 1 : 0) + (a.calculated ? 1 : 0);
    s += `<text class="mx-ent-attr" x="${n(x + 6)}" y="${n(cy + 4)}">${esc(ellipsis(`${a.name} (${a.type})`, w - 12 - markers * 14, 12))}</text>`;
    let mx = x + w - 12;
    if (a.calculated) {
      s += `<g class="mx-calc"><circle cx="${n(mx)}" cy="${n(cy)}" r="5"/><path d="M${n(mx - 1.6)} ${n(cy - 2.6)}l4.2 2.6-4.2 2.6z"/></g>`;
      mx -= 14;
    }
    if (a.validation) s += `<path class="mx-valid" d="M${n(mx - 4.5)} ${n(cy)}l3 3 6-6.5"/>`;
  });
  if (e.generalization) {
    const label = e.generalization;
    const tw = measure(label, 12) + 8;
    s += `<g class="mx-gen"><rect x="${n(x + w - tw)}" y="${n(y - 21)}" width="${n(tw)}" height="18"/><text x="${n(x + w - tw / 2)}" y="${n(y - 7.5)}" text-anchor="middle">${esc(label)}</text></g>`;
  }
  if (e.kind === 'external' && e.service) {
    s += `<g class="mx-svc"><rect x="${n(x)}" y="${n(y - 22)}" width="18" height="18" rx="1.5"/><path d="M${n(x + 5)} ${n(y - 17)}l8 8M${n(x + 13)} ${n(y - 17)}l-8 8"/></g><text class="mx-svc-name" x="${n(x + 23)}" y="${n(y - 8.5)}">${esc(e.service)}</text>`;
  }
  return s;
}

const along = (a: Pt, b: Pt, d: number): Pt => {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: a.x + ((b.x - a.x) / len) * d, y: a.y + ((b.y - a.y) / len) * d };
};

/** Where an association meets a box: its connection point when stored, else the middle of the side facing `toward`. */
function endOn(b: Box, conn: Pt | undefined, toward: Pt): Pt {
  if (conn) return { x: b.x + (b.w * conn.x) / 100, y: b.y + (b.h * conn.y) / 100 };
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) * b.h >= Math.abs(dy) * b.w) return { x: dx >= 0 ? b.x + b.w : b.x, y: cy };
  return { x: cx, y: dy >= 0 ? b.y + b.h : b.y };
}

function disc(p: Pt, text: string): string {
  const star = text === '*';
  return `<g class="mx-mult"><circle cx="${n(p.x)}" cy="${n(p.y)}" r="7.5"/>${star ? `<path d="M${n(p.x)} ${n(p.y - 4)}v8M${n(p.x - 3.5)} ${n(p.y - 2)}l7 4M${n(p.x + 3.5)} ${n(p.y - 2)}l-7 4"/>` : `<text x="${n(p.x)}" y="${n(p.y + 4)}" text-anchor="middle">1</text>`}</g>`;
}

function nameBox(p: Pt, name: string, cross: boolean): string {
  const tw = measure(name, 11.5) + 8;
  return `<g class="mx-aname${cross ? ' mx-cross' : ''}"><rect x="${n(p.x - tw / 2)}" y="${n(p.y - 10)}" width="${n(tw)}" height="20"/><text x="${n(p.x)}" y="${n(p.y + 4)}" text-anchor="middle">${esc(name)}</text></g>`;
}

/** The open arrow at the end the owner points at (none when both own the association). */
function arrowAt(tip: Pt, from: Pt): string {
  const back = along(tip, from, 11);
  const dx = back.x - tip.x;
  const dy = back.y - tip.y;
  const l = Math.hypot(dx, dy) || 1;
  const px = (-dy / l) * 6;
  const py = (dx / l) * 6;
  return `<path class="mx-arrow" d="M${n(back.x + px)} ${n(back.y + py)}L${n(tip.x)} ${n(tip.y)}L${n(back.x - px)} ${n(back.y - py)}"/>`;
}

function assocSvg(a: DmAssociation, boxes: Map<string, Box>): { svg: string; box: Box } | null {
  const pb = boxes.get(a.parent);
  if (!pb) return null;
  const parentMult = a.type === 'ReferenceSet' || a.owner === 'Default' ? '*' : '1';
  const childMult = a.type === 'ReferenceSet' ? '*' : '1';
  if (a.cross) {
    // To an entity in another module: a stub out of the box with the other entity's name at its end.
    const start = endOn(pb, a.parentConn, { x: pb.x - 100, y: pb.y + pb.h / 2 });
    const left = start.x <= pb.x + pb.w / 2;
    const end = { x: start.x + (left ? -150 : 150), y: start.y };
    let s = `<path class="mx-assoc" d="M${n(start.x)} ${n(start.y)}L${n(end.x)} ${n(end.y)}"/>`;
    s += disc(along(start, end, 22), parentMult) + disc(along(end, start, 10), childMult);
    s += nameBox({ x: (start.x + end.x) / 2, y: start.y }, a.name, true);
    s += `<text class="mx-cross-to" x="${n(end.x + (left ? -4 : 4))}" y="${n(end.y + 22)}" text-anchor="${left ? 'end' : 'start'}">${esc(a.child)}</text>`;
    s += `<circle class="mx-owner" cx="${n(start.x)}" cy="${n(start.y)}" r="3.2"/>`;
    return { svg: s, box: { x: Math.min(start.x, end.x) - 10, y: start.y - 20, w: 170, h: 40 } };
  }
  const cb = boxes.get(a.child);
  if (!cb) return null;
  const cc = { x: cb.x + cb.w / 2, y: cb.y + cb.h / 2 };
  const pc = { x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 };
  const p = endOn(pb, a.parentConn, cc);
  const c = endOn(cb, a.childConn, pc);
  let s: string;
  let mid: Pt;
  let pNear: Pt;
  let cNear: Pt;
  if (a.parent === a.child || Math.hypot(p.x - c.x, p.y - c.y) < 4) {
    // An association from an entity to itself: a loop over the box.
    const top = pb.y - 46;
    const c1 = { x: p.x, y: top };
    s = `<path class="mx-assoc" d="M${n(p.x)} ${n(p.y)}C${n(p.x - 40)} ${n(p.y)} ${n(c1.x - 40)} ${n(top)} ${n(pb.x + pb.w / 2)} ${n(top)}S${n(c.x + 40)} ${n(c.y)} ${n(c.x)} ${n(c.y)}"/>`;
    mid = { x: pb.x + pb.w / 2, y: top };
    pNear = { x: p.x - 18, y: p.y - 10 };
    cNear = { x: c.x + 18, y: c.y - 10 };
  } else {
    s = `<path class="mx-assoc" d="M${n(p.x)} ${n(p.y)}L${n(c.x)} ${n(c.y)}"/>`;
    mid = { x: (p.x + c.x) / 2, y: (p.y + c.y) / 2 };
    // A line too short for its name between the two discs: the name sits beside the line instead.
    const len = Math.hypot(c.x - p.x, c.y - p.y);
    if (len < measure(a.name, 11.5) + 8 + 2 * 32) {
      const nx = -(c.y - p.y) / (len || 1);
      const ny = (c.x - p.x) / (len || 1);
      const side = ny > 0 ? -1 : 1;
      mid = { x: mid.x + nx * 17 * side, y: mid.y + ny * 17 * side };
    }
    pNear = along(p, c, 22.5);
    cNear = along(c, p, 22.5);
    if (a.owner === 'Default') s += arrowAt(c, p);
  }
  s += nameBox(mid, a.name, false);
  s += disc(pNear, parentMult) + disc(cNear, childMult);
  s += `<circle class="mx-owner" cx="${n(p.x)}" cy="${n(p.y)}" r="3.2"/>`;
  if (a.owner === 'Both') s += `<circle class="mx-owner" cx="${n(c.x)}" cy="${n(c.y)}" r="3.2"/>`;
  const x0 = Math.min(p.x, c.x, mid.x - 60);
  const y0 = Math.min(p.y, c.y, mid.y - 12);
  return { svg: s, box: { x: x0, y: y0, w: Math.max(p.x, c.x, mid.x + 60) - x0, h: Math.max(p.y, c.y, mid.y + 12) - y0 } };
}

export function drawDomain(doc: DomainDoc, diff?: DocDiff): Drawn {
  const added = new Set(diff?.added ?? []);
  const changed = new Set(diff?.changed ?? []);
  const mark = (id: string) => (added.has(id) ? ' mx-added' : changed.has(id) ? ' mx-changed' : '');
  const boxes = new Map<string, Box>();
  for (const e of doc.entities) boxes.set(e.id, { x: e.x, y: e.y, w: ENTITY_W, h: entityHeight(e) });
  const parts: string[] = [];
  const all: Box[] = [];
  for (const a of doc.annotations) {
    const t = wrap(a.text, a.w - 12, 40);
    const h = Math.max(30, t.length * 15 + 12);
    const box = { x: a.x, y: a.y, w: a.w, h };
    boxes.set(a.id, box);
    all.push(box);
    const body = `<rect class="mx-note" x="${n(a.x)}" y="${n(a.y)}" width="${n(a.w)}" height="${n(h)}"/><path class="mx-note-edge" d="M${n(a.x + 22)} ${n(a.y)}H${n(a.x)}V${n(a.y + h)}H${n(a.x + 22)}"/>${t.map((l, i) => `<text class="mx-note-t" x="${n(a.x + 8)}" y="${n(a.y + 19 + i * 15)}">${esc(l)}</text>`).join('')}`;
    parts.push(`<g class="mx-el${mark(a.id)}" data-id="${esc(a.id)}" data-box="${n(a.x)},${n(a.y)},${n(a.w)},${n(h)}">${body}</g>`);
  }
  for (const a of doc.associations) {
    const r = assocSvg(a, boxes);
    if (!r) continue;
    all.push(r.box);
    parts.push(`<g class="mx-edge${mark(a.id)}" data-id="${esc(a.id)}" data-box="${n(r.box.x)},${n(r.box.y)},${n(r.box.w)},${n(r.box.h)}">${r.svg}</g>`);
  }
  for (const e of doc.entities) {
    const b = boxes.get(e.id)!;
    const top = e.generalization || e.service ? 24 : 0;
    all.push({ x: b.x, y: b.y - top, w: b.w, h: b.h + top });
    const halo = mark(e.id) ? `<rect class="mx-halo" x="${n(b.x - 6)}" y="${n(b.y - 6)}" width="${n(b.w + 12)}" height="${n(b.h + 12)}" rx="10"/>` : '';
    parts.push(`<g class="mx-el${mark(e.id)}" data-id="${esc(e.id)}" data-box="${n(b.x)},${n(b.y - top)},${n(b.w)},${n(b.h + top)}">${halo}${entitySvg(e, b.w, b.h)}</g>`);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of all) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  if (!Number.isFinite(x0)) [x0, y0, x1, y1] = [0, 0, 400, 200];
  return { svg: parts.join(''), bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, boxes };
}
