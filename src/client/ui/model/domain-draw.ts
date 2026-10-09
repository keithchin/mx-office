// A module's domain model drawn the way Studio Pro draws it, as SVG: entity boxes coloured by type
// (persistable blue, non-persistable yellow, view green, external purple) with a header (icon and
// name) over the attributes, "Name (Type)" each with its validation and calculated markers; the
// generalization in a blue label on top; associations as grey lines between the connection points the
// developer chose, with "1" and "*" discs near each end, a dot on the owner's end, an arrow at the
// other unless both own it, and the name in a box half way. Annotations sit where they were put.
// Associations nobody arranged (still at Studio Pro's default points) get ends and a route around the
// boxes from domain-layout.ts, so their lines don't run across other entities.

import type { DmAssociation, DmEntity, DocDiff, DomainDoc, Pt } from '../../../shared/model';
import { ENTITY_W, entityHeight, routeAssociations, type Box, type Route } from './domain-layout';
import type { Drawn } from './flow-draw';
import { ellipsis, esc, measure, n, wrap } from './text';

const HEAD = 30;
const ROW = 16.5;

export { ENTITY_W, entityHeight };

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

const pathD = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('');
/** A wide invisible line under the drawn one, so a thin line is easy to point at. */
const hitLine = (d: string) => `<path class="mx-hit" d="${d}"/>`;

function assocSvg(a: DmAssociation, r: Route, pb: Box): { svg: string; box: Box } {
  const parentMult = a.type === 'ReferenceSet' || a.owner === 'Default' ? '*' : '1';
  const childMult = a.type === 'ReferenceSet' ? '*' : '1';
  const p = r.pts[0];
  const c = r.pts[r.pts.length - 1];
  let s: string;
  if (r.kind === 'cross') {
    // To an entity in another module: a stub out of the box with the other entity's name at its end.
    const d = pathD(r.pts);
    s = `${hitLine(d)}<path class="mx-assoc" d="${d}"/>`;
    s += disc(r.pDisc, parentMult) + disc(r.cDisc, childMult);
    s += nameBox(r.name, a.name, true);
    const t = r.crossText!;
    s += `<text class="mx-cross-to" x="${n(t.x)}" y="${n(t.y)}" text-anchor="${t.anchor}">${esc(a.child)}</text>`;
    s += `<circle class="mx-owner" cx="${n(p.x)}" cy="${n(p.y)}" r="3.2"/>`;
    const x0 = Math.min(p.x, c.x, r.name.x - 60, t.x - (t.anchor === 'start' ? 0 : 120));
    const y0 = Math.min(p.y, c.y, r.name.y - 12, t.y - 14);
    const x1 = Math.max(p.x, c.x, r.name.x + 60, t.x + (t.anchor === 'end' ? 0 : 120));
    const y1 = Math.max(p.y, c.y, r.name.y + 12, t.y + 4);
    return { svg: s, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  }
  const extra: Pt[] = [];
  if (r.kind === 'loop') {
    // An association from an entity to itself at its stored points: Studio Pro's loop over the box.
    const top = r.name.y;
    const d = `M${n(p.x)} ${n(p.y)}C${n(p.x - 40)} ${n(p.y)} ${n(p.x - 40)} ${n(top)} ${n(pb.x + pb.w / 2)} ${n(top)}S${n(c.x + 40)} ${n(c.y)} ${n(c.x)} ${n(c.y)}`;
    s = `${hitLine(d)}<path class="mx-assoc" d="${d}"/>`;
    extra.push({ x: p.x - 40, y: top }, { x: c.x + 40, y: c.y });
  } else {
    const d = pathD(r.pts);
    s = `${hitLine(d)}<path class="mx-assoc" d="${d}"/>`;
    if (a.owner === 'Default') s += arrowAt(c, r.pts[r.pts.length - 2]);
  }
  s += nameBox(r.name, a.name, false);
  s += disc(r.pDisc, parentMult) + disc(r.cDisc, childMult);
  s += `<circle class="mx-owner" cx="${n(p.x)}" cy="${n(p.y)}" r="3.2"/>`;
  if (a.owner === 'Both') s += `<circle class="mx-owner" cx="${n(c.x)}" cy="${n(c.y)}" r="3.2"/>`;
  let x0 = r.name.x - 60;
  let y0 = r.name.y - 12;
  let x1 = r.name.x + 60;
  let y1 = r.name.y + 12;
  for (const q of [...r.pts, ...extra]) {
    x0 = Math.min(x0, q.x - 8);
    y0 = Math.min(y0, q.y - 8);
    x1 = Math.max(x1, q.x + 8);
    y1 = Math.max(y1, q.y + 8);
  }
  return { svg: s, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
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
  // What lines go round: the entities (with the label over them) and the annotations.
  const obstacles = doc.entities.map((e) => {
    const b = boxes.get(e.id)!;
    const top = e.generalization || e.service ? 22 : 0;
    return { x: b.x, y: b.y - top, w: b.w, h: b.h + top };
  });
  const routes = routeAssociations(doc.associations, boxes, [...obstacles, ...all]);
  for (const a of doc.associations) {
    const route = routes.get(a.id);
    if (!route) continue;
    const r = assocSvg(a, route, boxes.get(a.parent)!);
    all.push(r.box);
    const ends = a.cross ? a.parent : `${a.parent} ${a.child}`;
    parts.push(`<g class="mx-edge${mark(a.id)}" data-id="${esc(a.id)}" data-ends="${esc(ends)}" data-box="${n(r.box.x)},${n(r.box.y)},${n(r.box.w)},${n(r.box.h)}">${r.svg}</g>`);
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
