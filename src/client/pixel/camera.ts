// The 2D view's camera (pixel.ts): how big the office is drawn and which part of it is on screen.
// It opens fitted to the window, as big as it goes with all of it showing; zooming in goes up in
// whole steps (every art pixel the same number of screen pixels), and then the office can be dragged,
// panned with the arrow keys or the wheel, and pinched on a touch screen. The zoom is remembered.
// The home page's overview has one too, with its own steps and where it keeps its zoom (CameraOptions).

const ZOOM_KEY = 'agent-office.pixel-zoom';
/** The whole steps zooming in and out goes through, in screen (CSS) pixels to an art pixel. */
const STEPS = [1, 2, 3, 4, 5, 6, 8];

export type Zoom = 'fit' | number;

/** Where a camera keeps its zoom, the steps it zooms through, and whether a phone held upright fills the height (the 2D view's does). */
export interface CameraOptions {
  key?: string;
  steps?: number[];
  fillHeight?: boolean;
}

function savedZoom(key: string, steps: number[]): Zoom {
  try {
    const z = Number(localStorage.getItem(key));
    if (steps.includes(z)) return z;
  } catch {
    // No storage: fitted, as usual.
  }
  return 'fit';
}

export class Camera {
  zoom: Zoom;
  /** CSS pixels to an art pixel, as drawn now. */
  scale = 1;
  /** Where the art's top-left corner is in the stage, in CSS pixels. */
  x = 0;
  y = 0;
  private stageW = 1;
  private stageH = 1;
  private artW = 1;
  private artH = 1;
  private readonly key: string;
  private readonly steps: number[];
  private readonly fillHeight: boolean;

  constructor(o: CameraOptions = {}) {
    this.key = o.key ?? ZOOM_KEY;
    this.steps = o.steps ?? STEPS;
    this.fillHeight = o.fillHeight ?? true;
    this.zoom = savedZoom(this.key, this.steps);
  }

  /** What fitting the whole office in the stage would scale it by. */
  get fit(): number {
    const contain = Math.min(this.stageW / this.artW, this.stageH / this.artH);
    // A phone held upright would get a postage stamp: it fills the height instead, and pans sideways.
    return contain >= 1 || !this.fillHeight ? contain : Math.max(contain, Math.min(this.stageH / this.artH, 2));
  }

  /** Whether the office is bigger than the stage, so there's something to pan to. */
  get pannable(): boolean {
    return this.artW * this.scale > this.stageW + 1 || this.artH * this.scale > this.stageH + 1;
  }

  /** The stage or the art changed size: keeps what's in the middle of the screen in the middle. */
  layout(stageW: number, stageH: number, artW: number, artH: number) {
    const cx = (this.stageW / 2 - this.x) / this.scale;
    const cy = (this.stageH / 2 - this.y) / this.scale;
    const first = this.artW === 1;
    Object.assign(this, { stageW, stageH, artW, artH });
    this.scale = this.zoom === 'fit' ? this.fit : this.zoom;
    if (first || this.zoom === 'fit') this.center();
    else this.lookAt(cx, cy);
  }

  /** Puts art point (ax, ay) in the middle of the stage, as near as the edges allow. */
  lookAt(ax: number, ay: number) {
    this.x = this.stageW / 2 - ax * this.scale;
    this.y = this.stageH / 2 - ay * this.scale;
    this.clamp();
  }

  private center() {
    this.x = (this.stageW - this.artW * this.scale) / 2;
    this.y = (this.stageH - this.artH * this.scale) / 2;
  }

  /** No panning past the office's edges; smaller than the stage, it sits in the middle. */
  clamp() {
    const w = this.artW * this.scale, h = this.artH * this.scale;
    this.x = w <= this.stageW ? (this.stageW - w) / 2 : Math.min(0, Math.max(this.stageW - w, this.x));
    this.y = h <= this.stageH ? (this.stageH - h) / 2 : Math.min(0, Math.max(this.stageH - h, this.y));
  }

  pan(dx: number, dy: number) {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  /** A step in (+1) or out (-1), keeping stage point (sx, sy) (the middle, unless given) where it is. */
  step(dir: 1 | -1, sx = this.stageW / 2, sy = this.stageH / 2) {
    if (dir > 0) {
      const next = this.steps.find((s) => s > this.scale + 0.01);
      if (next !== undefined) this.setZoom(next, sx, sy);
      return;
    }
    // Out no further than all of it showing: smaller than that is only more empty screen.
    const next = [...this.steps].reverse().find((s) => s < this.scale - 0.01);
    this.setZoom(next === undefined || next < this.fit ? 'fit' : next, sx, sy);
  }

  /** Pinching: scale by `factor` about stage point (sx, sy), snapping to the nearest whole step when it's let go (see settle). */
  pinch(factor: number, sx: number, sy: number) {
    const ax = (sx - this.x) / this.scale, ay = (sy - this.y) / this.scale;
    this.scale = Math.max(Math.min(this.fit, 1), Math.min(this.steps[this.steps.length - 1], this.scale * factor));
    this.x = sx - ax * this.scale;
    this.y = sy - ay * this.scale;
    this.clamp();
  }

  /** The pinch is over: to the nearest whole step (or fitted, if that's nearer). */
  settle(sx: number, sy: number) {
    const fit = this.fit;
    const nearest = this.steps.reduce((a, b) => (Math.abs(b - this.scale) < Math.abs(a - this.scale) ? b : a));
    this.setZoom(Math.abs(fit - this.scale) < Math.abs(nearest - this.scale) ? 'fit' : nearest, sx, sy);
  }

  setZoom(to: Zoom, sx = this.stageW / 2, sy = this.stageH / 2) {
    const ax = (sx - this.x) / this.scale, ay = (sy - this.y) / this.scale;
    this.zoom = to;
    this.scale = to === 'fit' ? this.fit : to;
    if (to === 'fit') this.center();
    else {
      this.x = sx - ax * this.scale;
      this.y = sy - ay * this.scale;
      this.clamp();
    }
    try {
      localStorage.setItem(this.key, String(to));
    } catch {
      // Just for this visit, then.
    }
  }

  /** A point on the stage (CSS pixels) as an art pixel. */
  toArt(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.x) / this.scale, y: (sy - this.y) / this.scale };
  }

  /** The zoom as a person reads it. */
  label(): string {
    return this.zoom === 'fit' ? 'Fit' : this.zoom < 1 ? `${Math.round(this.zoom * 100)}%` : `${this.zoom}×`;
  }
}

/**
 * The stage's pointer and keys driving `cam`: dragging pans (a drag isn't a click), Ctrl+wheel and
 * pinching zoom, the plain wheel pans once zoomed in, and the arrows, + − and 0 when nothing else has
 * the keyboard. `changed` redraws; `dragging` says whether a press turned into a drag.
 */
export function driveCamera(el: HTMLElement, cam: Camera, changed: () => void, o: { wheelZooms?: boolean } = {}): { dragged(): boolean } {
  const down = new Map<number, { x: number; y: number }>();
  let moved = 0;
  // With `wheelZooms` (the home page's overview), the plain wheel zooms too, a step per notch's worth.
  let wheelSum = 0;
  let wheelAt = 0;
  let pinchFrom = 0;
  const local = (e: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down.set(e.pointerId, local(e));
    moved = 0;
    if (down.size === 2) {
      const [a, b] = [...down.values()];
      pinchFrom = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  el.addEventListener('pointermove', (e) => {
    const was = down.get(e.pointerId);
    if (!was) return;
    const p = local(e);
    if (down.size === 2) {
      down.set(e.pointerId, p);
      const [a, b] = [...down.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchFrom > 0) cam.pinch(d / pinchFrom, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchFrom = d;
      moved += 10;
      return changed();
    }
    moved += Math.abs(p.x - was.x) + Math.abs(p.y - was.y);
    down.set(e.pointerId, p);
    if (moved > 4 && cam.pannable) {
      if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
      el.classList.add('grabbing');
      cam.pan(p.x - was.x, p.y - was.y);
      changed();
    }
  });
  const up = (e: PointerEvent) => {
    if (down.size === 2) {
      const [a, b] = [...down.values()];
      cam.settle((a.x + b.x) / 2, (a.y + b.y) / 2);
      changed();
    }
    down.delete(e.pointerId);
    el.classList.remove('grabbing');
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener(
    'wheel',
    (e) => {
      const p = local(e);
      if (o.wheelZooms && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Out past all of it showing: the page scrolls on instead.
        if (e.deltaY > 0 && cam.zoom === 'fit') return;
        e.preventDefault();
        const now = performance.now();
        if (now - wheelAt > 300) wheelSum = 0;
        wheelAt = now;
        wheelSum += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
        if (Math.abs(wheelSum) < 50) return;
        cam.step(wheelSum < 0 ? 1 : -1, p.x, p.y);
        wheelSum = 0;
        return changed();
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        cam.step(e.deltaY < 0 ? 1 : -1, p.x, p.y);
        return changed();
      }
      if (!cam.pannable) return;
      e.preventDefault();
      cam.pan(e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY);
      changed();
    },
    { passive: false },
  );
  return { dragged: () => moved > 4 };
}
