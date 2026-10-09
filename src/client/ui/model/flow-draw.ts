// A microflow or nanoflow drawn the way Studio Pro draws it, as SVG: green start and red end
// circles, rounded light-blue activity boxes with the action's icon at the left, orange diamonds for
// decisions and merges, parameters as yellow pentagons with their name and (in blue) type underneath,
// the variable an activity gives under its box, black flow lines ending in solid arrowheads, and
// outcome labels in small boxes. Colours come from the canvas classes in model.css (light and dark).
//
// Nanoflows are drawn the same way, as Studio Pro does; the canvas gets a `mx-nano` class, which only
// tints the activity boxes' outline a little purple and marks client-side actions, so the two can be
// told apart at a glance.

import type { DocDiff, FlowDoc, FlowEdge, FlowNode, Pt } from '../../../shared/model';
import { activityIcon, commitMarker, refreshMarker } from './icons';
import { ellipsis, esc, LINE, measure, n, wrap } from './text';

export interface Drawn {
  /** The diagram's SVG (inside the canvas's moving group). */
  svg: string;
  /** Its extent in diagram units. */
  bounds: { x: number; y: number; w: number; h: number };
  /** What can be clicked: element id → its box. */
  boxes: Map<string, { x: number; y: number; w: number; h: number }>;
}

const ARROW = 10;

/** Developer-picked activity colours (Studio Pro's Background color). */
const BG: Record<string, string> = { Blue: 'mx-bg-blue', Green: 'mx-bg-green', Red: 'mx-bg-red', Yellow: 'mx-bg-yellow', Purple: 'mx-bg-purple', Gray: 'mx-bg-gray', Grey: 'mx-bg-gray', Orange: 'mx-bg-orange' };

function bez(p: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
}

/** The flow line, ending short of the target so the arrowhead's tip lands on it. */
function edgeSvg(e: FlowEdge): string {
  const [p0, c1, c2, p3] = e.path;
  // The arrow points along the curve's last stretch.
  const from = Math.hypot(p3.x - c2.x, p3.y - c2.y) > 0.5 ? c2 : Math.hypot(p3.x - c1.x, p3.y - c1.y) > 0.5 ? c1 : p0;
  const len = Math.hypot(p3.x - from.x, p3.y - from.y) || 1;
  const ux = (p3.x - from.x) / len;
  const uy = (p3.y - from.y) / len;
  const cls = e.annotation ? 'mx-aflow' : e.error ? 'mx-flow mx-err' : 'mx-flow';
  if (e.annotation) return `<path class="${cls}" d="M${n(p0.x)} ${n(p0.y)}L${n(p3.x)} ${n(p3.y)}"/>`;
  const end = { x: p3.x - ux * ARROW, y: p3.y - uy * ARROW };
  const c2s = from === c2 ? { x: c2.x - ux * Math.min(ARROW, len), y: c2.y - uy * Math.min(ARROW, len) } : c2;
  const d = `M${n(p0.x)} ${n(p0.y)}C${n(c1.x)} ${n(c1.y)} ${n(c2s.x)} ${n(c2s.y)} ${n(end.x)} ${n(end.y)}`;
  const w = ARROW / 2;
  const head = `${n(p3.x)},${n(p3.y)} ${n(end.x - uy * w)},${n(end.y + ux * w)} ${n(end.x + uy * w)},${n(end.y - ux * w)}`;
  let out = `<path class="${cls}" d="${d}"/><polygon class="mx-head${e.error ? ' mx-err' : ''}" points="${head}"/>`;
  const label = e.label ?? (e.error ? 'error' : undefined);
  if (label) {
    const m = bez(e.path, 0.5);
    const tw = Math.max(measure(label) + 10, 22);
    out += `<g class="mx-lbl${e.error ? ' mx-err' : ''}"><rect x="${n(m.x - tw / 2)}" y="${n(m.y - 10.5)}" width="${n(tw)}" height="21"/><text x="${n(m.x)}" y="${n(m.y + 4)}" text-anchor="middle">${esc(label)}</text></g>`;
  }
  return out;
}

function lines(text: string[], x: number, y0: number, anchor: 'start' | 'middle', cls = 'mx-t'): string {
  return text.map((l, i) => `<text class="${cls}" x="${n(x)}" y="${n(y0 + i * LINE)}" text-anchor="${anchor}">${esc(l)}</text>`).join('');
}

/** Name in black and type in blue, centred under a box. */
function variable(cx: number, top: number, v: { name: string; type?: string }, maxW: number): string {
  let s = `<text class="mx-t" x="${n(cx)}" y="${n(top + 16)}" text-anchor="middle">${esc(ellipsis(v.name, maxW))}</text>`;
  if (v.type) s += `<text class="mx-type" x="${n(cx)}" y="${n(top + 33)}" text-anchor="middle">${esc(ellipsis(v.type, maxW))}</text>`;
  return s;
}

function nodeSvg(nd: FlowNode, nano: boolean): string {
  const { x, y, w, h } = nd;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (nd.kind) {
    case 'start':
    case 'end':
    case 'error':
    case 'break':
    case 'continue': {
      const r = Math.min(w, h) / 2;
      let s = `<circle class="mx-${nd.kind}" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>`;
      if (nd.kind === 'break') s += `<path class="mx-glyph" d="M${n(cx - 3)} ${n(cy - 3)}l6 6M${n(cx + 3)} ${n(cy - 3)}l-6 6"/>`;
      if (nd.kind === 'continue') s += `<path class="mx-glyph" d="M${n(cx - 3)} ${n(cy)}h5M${n(cx)} ${n(cy - 3)}l3 3-3 3"/>`;
      if (nd.kind === 'end' && nd.expr) s += `<text class="mx-type" x="${n(cx)}" y="${n(y + h + 15)}" text-anchor="middle">${esc(ellipsis(nd.expr, 160))}</text>`;
      return s;
    }
    case 'split':
    case 'inheritance':
    case 'merge': {
      const pts = `${n(cx)},${n(y)} ${n(x + w)},${n(cy)} ${n(cx)},${n(y + h)} ${n(x)},${n(cy)}`;
      let s = `<polygon class="mx-split" points="${pts}"/>`;
      if (nd.kind !== 'merge' && nd.caption) {
        const t = wrap(nd.caption, w * 0.62, Math.max(1, Math.floor((h - 10) / LINE)));
        s += lines(t, cx, cy - ((t.length - 1) * LINE) / 2 + 4, 'middle');
      }
      return s;
    }
    case 'parameter': {
      const tip = x + w * 0.62;
      let s = `<path class="mx-param" d="M${n(x)} ${n(y)}H${n(tip)}L${n(x + w)} ${n(cy)}L${n(tip)} ${n(y + h)}H${n(x)}Z"/>`;
      if (nd.output) s += variable(cx, y + h, nd.output, 220);
      return s;
    }
    case 'annotation': {
      const t = wrap(nd.caption, w - 12, Math.max(1, Math.floor((h - 6) / LINE)));
      return `<rect class="mx-note" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/><path class="mx-note-edge" d="M${n(x + Math.min(22, w / 4))} ${n(y)}H${n(x)}V${n(y + h)}H${n(x + Math.min(22, w / 4))}"/>${lines(t, x + 6, y + 14, 'start')}`;
    }
    case 'loop': {
      let s = `<rect class="mx-loop" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="8"/>`;
      // The iterator: a parameter-like pentagon at the top left, the current item and its list beside it.
      s += `<path class="mx-param" d="M${n(x + 10)} ${n(y + 8)}h12l6 7.5-6 7.5h-12z"/>`;
      const label = nd.output ? `${nd.output.name}${nd.output.type ? ` (${nd.output.type.replace(/^in /, '')})` : ''}` : nd.expr ? `While ${nd.expr}` : nd.caption;
      if (label) s += `<text class="mx-t" x="${n(x + 34)}" y="${n(y + 19)}">${esc(ellipsis(label, w - 44))}</text>`;
      return s;
    }
    default: {
      const bg = nd.color ? ` ${BG[nd.color] ?? ''}` : '';
      let s = `<rect class="mx-act${bg}${nano && nd.category === 'client' ? ' mx-client' : ''}" x="${n(x + 1)}" y="${n(y + 1)}" width="${n(w - 2)}" height="${n(h - 2)}" rx="9"/>`;
      s += activityIcon(nd.action ?? 'other', nd.category ?? 'other', x + 13.5, cy, '#3aa9f6', 'none');
      const textX = x + 31;
      const maxW = w - 31 - 8;
      const t = wrap(nd.caption || 'Activity', maxW, Math.max(1, Math.floor((h - 8) / LINE)));
      s += lines(t, textX, cy - ((t.length - 1) * LINE) / 2 + 4, 'start');
      if (nd.commit && nd.refresh) s += commitMarker(x + w - 30, y + 11) + refreshMarker(x + w - 15, y + 11);
      else if (nd.commit) s += commitMarker(x + w - 15, y + 11);
      else if (nd.refresh) s += refreshMarker(x + w - 15, y + 11);
      if (nd.output) s += variable(cx, y + h, nd.output, Math.max(w + 60, 160));
      return s;
    }
  }
}

/** Where a node's extras reach (the variable under it, an end's return value), for fitting and culling. */
function reach(nd: FlowNode): { x: number; y: number; w: number; h: number } {
  const extra = nd.output ? 38 : nd.kind === 'end' && nd.expr ? 20 : 0;
  const wide = nd.output ? Math.max(nd.w, Math.min(240, measure(nd.output.type ?? nd.output.name) + 8)) : nd.w;
  return { x: nd.x + nd.w / 2 - wide / 2, y: nd.y, w: wide, h: nd.h + extra };
}

export function drawFlow(doc: FlowDoc, diff?: DocDiff): Drawn {
  const nano = doc.kind === 'nanoflow';
  const added = new Set(diff?.added ?? []);
  const changed = new Set(diff?.changed ?? []);
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  // Loops first (they're frames behind what's in them), annotations last.
  const order = (k: string) => (k === 'loop' ? 0 : k === 'annotation' ? 2 : 1);
  const nodes = [...doc.nodes].sort((a, b) => order(a.kind) - order(b.kind));
  const parts: string[] = [];
  for (const nd of nodes) {
    const r = reach(nd);
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
    boxes.set(nd.id, { x: nd.x, y: nd.y, w: nd.w, h: nd.h });
    const mark = added.has(nd.id) ? ' mx-added' : changed.has(nd.id) ? ' mx-changed' : '';
    const halo = mark ? `<rect class="mx-halo" x="${n(nd.x - 5)}" y="${n(nd.y - 5)}" width="${n(nd.w + 10)}" height="${n(nd.h + 10)}" rx="12"/>` : '';
    parts.push(`<g class="mx-el${mark}" data-id="${esc(nd.id)}" data-box="${n(r.x)},${n(r.y)},${n(r.w)},${n(r.h)}">${halo}${nodeSvg(nd, nano)}</g>`);
  }
  const flows: string[] = [];
  for (const e of doc.edges) {
    for (const p of e.path) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const mark = added.has(e.id) ? ' mx-added' : changed.has(e.id) ? ' mx-changed' : '';
    const xs = e.path.map((p) => p.x);
    const ys = e.path.map((p) => p.y);
    const bx = Math.min(...xs) - 12;
    const by = Math.min(...ys) - 12;
    flows.push(`<g class="mx-edge${mark}" data-id="${esc(e.id)}" data-box="${n(bx)},${n(by)},${n(Math.max(...xs) - bx + 12)},${n(Math.max(...ys) - by + 12)}">${edgeSvg(e)}</g>`);
  }
  if (!Number.isFinite(x0)) {
    x0 = 0;
    y0 = 0;
    x1 = 400;
    y1 = 200;
  }
  // Flows under the elements, as in Studio Pro (arrowheads meet the boxes' edges).
  const loops = parts.filter((p, i) => nodes[i].kind === 'loop');
  const rest = parts.filter((p, i) => nodes[i].kind !== 'loop');
  return { svg: `${loops.join('')}${flows.join('')}${rest.join('')}`, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, boxes };
}
