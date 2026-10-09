// The Model tab's drawing surface: one SVG with a group that moves. Wheel zooms around the pointer,
// dragging (or one finger) pans, two fingers pinch, and a click picks the element under it. With
// many elements only those in view are kept in the page (the rest get display:none), so a big
// domain model or microflow pans smoothly. Pointing at (or picking) an association lights it and its two
// entities and dims the rest, so one line can be followed through a dense domain model.

import type { Drawn } from './flow-draw';

const NS = 'http://www.w3.org/2000/svg';
const MIN = 0.1;
const MAX = 4;
/** Above this many elements, the ones out of view are taken out of the page while you pan. */
export const CULL_FROM = 150;

type Box = { x: number; y: number; w: number; h: number };

export interface CanvasEvents {
  select(id: string | null): void;
}

export class Canvas {
  readonly svg: SVGSVGElement;
  private g: SVGGElement;
  private sel: SVGGElement;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private bounds: Box = { x: 0, y: 0, w: 1, h: 1 };
  private boxes = new Map<string, Box>();
  private items: { el: SVGGElement; box: Box; shown: boolean }[] = [];
  private frame = 0;
  private selected: string | null = null;
  private byId = new Map<string, SVGGElement>();
  private hot: SVGGElement[] = [];

  constructor(private host: HTMLElement, private on: CanvasEvents) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'mx-svg');
    this.svg.setAttribute('tabindex', '0');
    this.svg.setAttribute('role', 'img');
    this.g = document.createElementNS(NS, 'g');
    this.sel = document.createElementNS(NS, 'g');
    this.sel.setAttribute('class', 'mx-selbox');
    this.svg.append(this.g);
    this.g.after(this.sel);
    host.append(this.svg);
    this.wire();
  }

  /** Puts a drawing on the surface and fits it into view. */
  show(d: Drawn, keepView = false) {
    this.g.innerHTML = d.svg;
    this.bounds = d.bounds;
    this.boxes = d.boxes;
    this.byId = new Map([...this.g.querySelectorAll<SVGGElement>('[data-id]')].map((el) => [el.dataset.id ?? '', el]));
    this.hot = [];
    this.items = [...this.g.querySelectorAll<SVGGElement>('[data-box]')].map((el) => {
      const [x, y, w, h] = (el.dataset.box ?? '0,0,0,0').split(',').map(Number);
      return { el, box: { x, y, w, h }, shown: true };
    });
    if (!keepView) this.open();
    else this.apply();
    this.select(this.selected && this.boxes.has(this.selected) ? this.selected : null, false);
  }

  clear() {
    this.g.innerHTML = '';
    this.byId = new Map();
    this.hot = [];
    this.g.classList.remove('mx-focus');
    this.sel.innerHTML = '';
    this.items = [];
    this.boxes = new Map();
  }

  /** The whole drawing in view, at most at 100% (Studio Pro opens documents at their size). */
  fit() {
    const r = this.host.getBoundingClientRect();
    const W = Math.max(r.width, 50);
    const H = Math.max(r.height, 50);
    const pad = 40;
    const s = Math.min(1, (W - pad * 2) / Math.max(this.bounds.w, 1), (H - pad * 2) / Math.max(this.bounds.h, 1));
    this.scale = Math.max(MIN, s);
    this.tx = (W - this.bounds.w * this.scale) / 2 - this.bounds.x * this.scale;
    this.ty = (H - this.bounds.h * this.scale) / 2 - this.bounds.y * this.scale;
    this.apply();
  }

  /**
   * How a document opens: all of it when it fits at a readable size; otherwise at `at` (80%) from its
   * left edge, its middle height in view, as Studio Pro opens a long flow at its start.
   */
  open(at = 0.8, readable = 0.6) {
    this.fit();
    if (this.scale >= readable) return;
    const r = this.host.getBoundingClientRect();
    this.scale = at;
    this.tx = 40 - this.bounds.x * at;
    this.ty = Math.max(r.height, 50) / 2 - (this.bounds.y + this.bounds.h / 2) * at;
    this.apply();
  }

  /** Puts the zoom at `scale` (1 = 100%), the drawing's left edge in view. */
  zoomTo(scale: number) {
    const r = this.host.getBoundingClientRect();
    this.scale = Math.min(MAX, Math.max(MIN, scale));
    this.tx = 40 - this.bounds.x * this.scale;
    this.ty = Math.max(r.height, 50) / 2 - (this.bounds.y + this.bounds.h / 2) * this.scale;
    this.apply();
  }

  /** Zooms by `f` keeping the point (px, py) of the surface where it is (the middle when left out). */
  zoom(f: number, px?: number, py?: number) {
    const r = this.host.getBoundingClientRect();
    const x = px ?? r.width / 2;
    const y = py ?? r.height / 2;
    const next = Math.min(MAX, Math.max(MIN, this.scale * f));
    const k = next / this.scale;
    this.tx = x - (x - this.tx) * k;
    this.ty = y - (y - this.ty) * k;
    this.scale = next;
    this.apply();
  }

  /** Centres an element (when it isn't in view) and marks it as Studio Pro marks a selection. */
  select(id: string | null, center = false) {
    this.selected = id;
    for (const el of this.g.querySelectorAll('.mx-sel')) el.classList.remove('mx-sel');
    this.sel.innerHTML = '';
    const el = id ? this.byId.get(id) : undefined;
    this.focus(el?.dataset.ends ? el : null);
    const b = id ? this.boxes.get(id) : undefined;
    if (!id || !b) return;
    el?.classList.add('mx-sel');
    const hs = 6;
    const pad = 5;
    const corners = [
      [b.x - pad - hs, b.y - pad - hs],
      [b.x + b.w + pad, b.y - pad - hs],
      [b.x - pad - hs, b.y + b.h + pad],
      [b.x + b.w + pad, b.y + b.h + pad],
    ];
    if (el?.classList.contains('mx-el')) this.sel.innerHTML = corners.map(([x, y]) => `<rect x="${x}" y="${y}" width="${hs}" height="${hs}"/>`).join('');
    if (center) {
      const r = this.host.getBoundingClientRect();
      const sx = b.x * this.scale + this.tx;
      const sy = b.y * this.scale + this.ty;
      if (sx < 0 || sy < 0 || sx + b.w * this.scale > r.width || sy + b.h * this.scale > r.height) {
        this.tx = r.width / 2 - (b.x + b.w / 2) * this.scale;
        this.ty = r.height / 2 - (b.y + b.h / 2) * this.scale;
        this.apply();
      }
    }
  }

  /** Lights an association and the entities it joins, dimming everything else (none: all as drawn). */
  private focus(edge: SVGGElement | null) {
    for (const el of this.hot) el.classList.remove('mx-hot');
    this.hot = [];
    if (edge) {
      this.hot.push(edge);
      for (const id of (edge.dataset.ends ?? '').split(' ')) {
        const el = this.byId.get(id);
        if (el) this.hot.push(el);
      }
      for (const el of this.hot) el.classList.add('mx-hot');
    }
    this.g.classList.toggle('mx-focus', !!edge);
  }

  /** The picked association, if one is picked: what stays lit when the pointer moves off. */
  private pinned(): SVGGElement | null {
    const el = this.selected ? this.byId.get(this.selected) : undefined;
    return el?.dataset.ends ? el : null;
  }

  get zoomLevel(): number {
    return this.scale;
  }

  private apply() {
    const t = `translate(${this.tx} ${this.ty}) scale(${this.scale})`;
    this.g.setAttribute('transform', t);
    this.sel.setAttribute('transform', t);
    this.host.dataset.zoom = String(Math.round(this.scale * 100));
    if (this.items.length > CULL_FROM && !this.frame) this.frame = requestAnimationFrame(() => this.cull());
  }

  /** Shows only what's in (or near) view. */
  private cull() {
    this.frame = 0;
    const r = this.host.getBoundingClientRect();
    const m = 200 / this.scale;
    const vx = -this.tx / this.scale - m;
    const vy = -this.ty / this.scale - m;
    const vw = r.width / this.scale + 2 * m;
    const vh = r.height / this.scale + 2 * m;
    for (const it of this.items) {
      const b = it.box;
      const inView = b.x + b.w >= vx && b.x <= vx + vw && b.y + b.h >= vy && b.y <= vy + vh;
      if (inView !== it.shown) {
        it.shown = inView;
        it.el.style.display = inView ? '' : 'none';
      }
    }
  }

  private wire() {
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch = 0;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = this.svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = local(e);
        const f = Math.exp(-Math.max(-60, Math.min(60, e.deltaY * (e.deltaMode === 1 ? 16 : 1))) / 300);
        this.zoom(f, p.x, p.y);
      },
      { passive: false },
    );
    this.svg.addEventListener('pointerdown', (e) => {
      this.svg.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      moved = 0;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    this.svg.addEventListener('pointermove', (e) => {
      const was = pts.get(e.pointerId);
      if (!was) return;
      const p = local(e);
      if (pts.size === 2) {
        pts.set(e.pointerId, p);
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.zoom(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = d;
        moved += 10;
        return;
      }
      this.tx += p.x - was.x;
      this.ty += p.y - was.y;
      moved += Math.abs(p.x - was.x) + Math.abs(p.y - was.y);
      pts.set(e.pointerId, p);
      this.svg.classList.toggle('mx-panning', moved > 3);
      this.apply();
    });
    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      this.svg.classList.remove('mx-panning');
      if (moved <= 3 && e.type === 'pointerup') {
        const hit = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-id]') as SVGGElement | null;
        const id = hit && this.g.contains(hit) ? (hit.dataset.id ?? null) : null;
        this.select(id);
        this.on.select(id);
      }
    };
    this.svg.addEventListener('pointerover', (e) => {
      if (pts.size) return;
      const edge = (e.target as Element | null)?.closest?.('[data-ends]') as SVGGElement | null;
      const next = edge && this.g.contains(edge) ? edge : this.pinned();
      if (next !== (this.hot[0] ?? null)) this.focus(next);
    });
    this.svg.addEventListener('pointerleave', () => {
      const next = this.pinned();
      if (next !== (this.hot[0] ?? null)) this.focus(next);
    });
    this.svg.addEventListener('pointerup', up);
    this.svg.addEventListener('pointercancel', up);
    this.svg.addEventListener('keydown', (e) => {
      const step = 60;
      if (e.key === '+' || e.key === '=') this.zoom(1.2);
      else if (e.key === '-') this.zoom(1 / 1.2);
      else if (e.key === '0') this.fit();
      else if (e.key === 'ArrowLeft') this.tx += step;
      else if (e.key === 'ArrowRight') this.tx -= step;
      else if (e.key === 'ArrowUp') this.ty += step;
      else if (e.key === 'ArrowDown') this.ty -= step;
      else if (e.key === 'Escape') {
        this.select(null);
        this.on.select(null);
        return;
      } else return;
      e.preventDefault();
      this.apply();
    });
  }
}
