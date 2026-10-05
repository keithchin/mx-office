/**
 * The home page's 🗺️ 2D Overview tab: every floor of the building as its own pixel office, the same
 * art as the 2D view's (pixel/snapshot.ts), side by side on one canvas, each under a banner with its
 * name and numbers. It's for looking: hover a worker (or a benched Lead on a break) for who it is and what it's on, and click a
 * floor's banner (or double-click the floor) to open it in the 2D view. It opens with every floor
 * showing and zooms like the 2D view (pixel/camera.ts): the wheel, a pinch, + − 0, the buttons, and
 * a drag to pan. The floors come from GET /api/home/overview, again every 10 seconds while the tab
 * is on screen. No three.js here.
 */
import { store } from '../state';
import { overviewColumns, overviewGrid, overviewHit, overviewStats, type Overview, type OverviewCell, type OverviewWorker } from '../../shared/overview';
import { floorPalette } from '../../shared/floors';
import { h, STATUS_LABEL } from '../ui/dom';
import { currentTheme } from '../ui/colortheme';
import { Camera, driveCamera } from '../pixel/camera';
import { blitCrisp } from '../pixel/blit';
import { FloorArt } from '../pixel/snapshot';
import { BREAK_WORDS, breakAt, type BreakLead } from '../pixel/breaks';
import { officeKeys } from '../pixel/hud';
import { floorUrl, openFloor } from './projects';
import '../pixel/game.css';
import './overview.css';

const REFRESH_MS = 10_000;
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
/** The biggest in-between buffer a floor gets (pixel/blit.ts), in pixels. */
const MAX_BUFFER = 16_000_000;

export interface OverviewView {
  show(): void;
  hide(): void;
  /** The color theme changed: the tint and the banners' colors with it. */
  themed(): void;
}

/** Draws the tab into `root`. `leaving` hears the page head off to a floor. */
export function overviewView(root: HTMLElement, leaving: () => void): OverviewView {
  const canvas = h('canvas.ov-canvas', { 'aria-label': 'Every floor from above: hover a worker for what it is on, click a floor’s name to open it in the 2D view' });
  const tip = h('div.ov-tip.px-panel.hidden', { role: 'tooltip' });
  const level = h('span', {}, 'Fit');
  const zoomBtn = (id: string, label: string, title: string, child: Node | string) => h('button.px-btn', { id, type: 'button', title, 'aria-label': label }, child);
  const out = zoomBtn('ov-zoom-out', 'Zoom out', 'Zoom out (−)', '−');
  const fit = zoomBtn('ov-zoom-fit', 'Fit every floor', 'Fit every floor (0)', level);
  fit.classList.add('px-zoom-level');
  const inn = zoomBtn('ov-zoom-in', 'Zoom in', 'Zoom in (+)', '+');
  const stage = h('div.ov-stage.px-game', {}, canvas, tip, h('div.px-panel.px-zoom', { role: 'group', 'aria-label': 'Zoom' }, out, fit, inn));
  const note = h('p.ov-note', {}, 'Loading the floors…');
  root.replaceChildren(h('div.home-head', {}, h('h2', {}, '🗺️ 2D Overview'), note), stage);

  const g = canvas.getContext('2d')!;
  const cam = new Camera({ key: 'agent-office.overview-zoom', steps: [0.5, 1, 2, 3, 4, 6, 8], fillHeight: false });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let data: Overview | undefined;
  let arts: FloorArt[] = [];
  let cells: OverviewCell[] = [];
  let shown = false;
  let dpr = 1;
  let hover: { floor: number; worker: string } | null = null;
  let colors: Record<'void' | 'card' | 'ink' | 'muted' | 'line' | 'warn', string> | undefined;

  // ---- The floors, and laying them out -------------------------------------------------------------
  function layout() {
    dpr = window.devicePixelRatio || 1;
    const w = stage.clientWidth, hgt = stage.clientHeight;
    if (!w || !hgt) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    const sizes = arts.map((a) => a.frame);
    const grid = overviewGrid(sizes, overviewColumns(w, hgt, sizes));
    cells = grid.cells;
    cam.layout(w, hgt, grid.width, grid.height);
    level.textContent = cam.label();
    draw(performance.now(), true);
  }

  function take(o: Overview) {
    data = o;
    const old = new Map(arts.map((a) => [a.floor.id, a]));
    const theme = store.theme.active;
    arts = o.floors.map((f) => {
      const a = old.get(f.id);
      if (!a) return new FloorArt(f, theme);
      a.update(f, theme);
      return a;
    });
    note.textContent = o.floors.length ? `Every floor from above, live · click a floor's name (or double-click the floor) to open it in the 2D view` : 'No projects yet: ➕ Add project on the Projects tab.';
    layout();
  }

  let fetching = false;
  async function refresh() {
    if (fetching || !shown || document.hidden) return;
    fetching = true;
    try {
      const res = await fetch('/api/home/overview', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      take((await res.json()) as Overview);
    } catch (err) {
      if (!data) note.textContent = `Couldn't load the floors: ${(err as Error).message}`;
    } finally {
      fetching = false;
    }
  }

  // ---- Drawing --------------------------------------------------------------------------------------
  function readColors() {
    const cs = getComputedStyle(stage);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    colors = { void: v('--px-void', '#2b2d42'), card: v('--card', '#fffaf3'), ink: v('--ink', '#2b2d42'), muted: v('--muted', '#6b6f80'), line: v('--line', '#2b2d42'), warn: v('--warn', '#ef476f') };
    return colors;
  }

  /** `paint` draws every floor's scene again (a new frame of animation, or new data); otherwise the last frame is reused. */
  function draw(now: number, paint: boolean) {
    if (!shown || !canvas.width) return;
    const c = colors ?? readColors();
    const t = reduced.matches ? 0 : now;
    g.imageSmoothingEnabled = false;
    g.fillStyle = c.void;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const s = cam.scale * dpr;
    arts.forEach((a, i) => {
      const cell = cells[i];
      if (!cell) return;
      const x = (cam.x + cell.x * cam.scale) * dpr, top = (cam.y + cell.y * cam.scale) * dpr, y = (cam.y + cell.floorY * cam.scale) * dpr;
      // Off the screen: not drawn at all.
      if (x > canvas.width || top > canvas.height || x + cell.w * s < 0 || y + cell.h * s < 0) return;
      const hov = hover?.floor === i ? hover.worker : null;
      if (paint) a.paint(t, store.theme.active, currentTheme(), hov, reduced.matches);
      blitCrisp(g, a.art, a.buffer, x, y, s, MAX_BUFFER);
      a.overlay(g, { scale: s, x, y, dpr }, hov, t);
      banner(c, a, x, top, cell.w * s, (cell.floorY - cell.y) * s);
    });
  }

  /** A floor's banner over it: its name, big, in a card edged in its color, and its numbers. */
  function banner(c: NonNullable<typeof colors>, a: FloorArt, x: number, y: number, w: number, hgt: number) {
    const f = a.floor;
    const pad = Math.round(Math.max(4, hgt * 0.14));
    const bh = hgt - pad;
    g.fillStyle = c.line;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(bh));
    g.fillStyle = c.card;
    const edge = Math.max(1, Math.round(2 * dpr));
    g.fillRect(Math.round(x) + edge, Math.round(y) + edge, Math.round(w) - edge * 2, Math.round(bh) - edge * 2);
    g.fillStyle = floorPalette(f.palette).trim;
    const stripe = Math.max(edge * 2, Math.round(bh * 0.14));
    g.fillRect(Math.round(x) + edge, Math.round(y) + edge, stripe, Math.round(bh) - edge * 2);
    const left = x + edge + stripe + Math.round(bh * 0.22);
    const room = w - (left - x) - Math.round(bh * 0.22);
    const two = bh >= 36 * dpr;
    const big = Math.round(Math.min(32 * dpr, Math.max(10 * dpr, bh * (two ? 0.4 : 0.55))));
    const small = Math.round(Math.max(9 * dpr, big * 0.5));
    g.textBaseline = 'middle';
    g.font = `900 ${big}px ${FONT}`;
    g.fillStyle = c.ink;
    const name = fitText(f.name, room);
    g.fillText(name, left, y + (two ? bh * 0.38 : bh / 2));
    g.font = `800 ${small}px ${FONT}`;
    const stats = overviewStats(f);
    if (two) {
      g.fillStyle = f.waiting ? c.warn : c.muted;
      g.fillText(fitText(stats, room), left, y + bh * 0.74);
    } else {
      // One line: the numbers after the name, as far as they go.
      g.font = `900 ${big}px ${FONT}`;
      const after = left + g.measureText(name).width + small;
      g.font = `800 ${small}px ${FONT}`;
      if (room - (after - left) > small * 6) {
        g.fillStyle = f.waiting ? c.warn : c.muted;
        g.fillText(fitText(stats, room - (after - left)), after, y + bh / 2);
      }
    }
  }

  /** `text` cut to `max` device pixels wide in the current font, with an ellipsis. */
  function fitText(text: string, max: number): string {
    if (g.measureText(text).width <= max) return text;
    let s = text;
    while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
    return `${s}…`;
  }

  // The animation moves on a beat at a time: ten frames a second, while the tab's on screen and motion's welcome.
  let last = 0;
  let ticking = false;
  function tick(now: number) {
    ticking = shown;
    if (!shown) return;
    if (!document.hidden && !reduced.matches && now - last >= 100) {
      last = now;
      draw(now, true);
    }
    requestAnimationFrame(tick);
  }

  // ---- The camera -----------------------------------------------------------------------------------
  const camera = driveCamera(canvas, cam, () => redraw(), { wheelZooms: true });
  function redraw() {
    level.textContent = cam.label();
    draw(performance.now(), reduced.matches);
  }
  function zoom(dir: 1 | -1 | 0) {
    if (dir === 0) cam.setZoom('fit');
    else cam.step(dir);
    redraw();
  }
  out.addEventListener('click', () => zoom(-1));
  inn.addEventListener('click', () => zoom(1));
  fit.addEventListener('click', () => zoom(0));
  addEventListener('keydown', (e) => {
    if (!shown || !officeKeys(e) || e.ctrlKey) return;
    const pan = 64;
    const keys: Record<string, () => void> = {
      '+': () => zoom(1),
      '=': () => zoom(1),
      '-': () => zoom(-1),
      '0': () => zoom(0),
      ArrowLeft: () => cam.pan(pan, 0),
      ArrowRight: () => cam.pan(-pan, 0),
      ArrowUp: () => cam.pan(0, pan),
      ArrowDown: () => cam.pan(0, -pan),
    };
    const run = keys[e.key];
    if (!run) return;
    // The arrows scroll the page as usual when there's nothing to pan.
    if (e.key.startsWith('Arrow') && !cam.pannable) return;
    e.preventDefault();
    run();
    redraw();
  });
  new ResizeObserver(() => shown && layout()).observe(stage);

  // ---- Pointing at things ---------------------------------------------------------------------------
  function hitAt(clientX: number, clientY: number) {
    const r = canvas.getBoundingClientRect();
    const p = cam.toArt(clientX - r.left, clientY - r.top);
    const hit = overviewHit(cells, p.x, p.y);
    if (!hit) return null;
    const cell = cells[hit.index];
    const who = hit.part === 'floor' ? arts[hit.index]?.whoAt(p.x - cell.x, p.y - cell.floorY) : undefined;
    return { ...hit, who };
  }

  /** A benched Lead's hover card: who, and which break they're on. */
  function leadTip(l: BreakLead, i: number, a: FloorArt): Node[] {
    const b = breakAt(l.name, i, Date.now(), reduced.matches);
    return [h('b', {}, `${l.name} · ${l.title}`), h('div', {}, `🪑 Benched (${b.walking ? `on the way, ${BREAK_WORDS[b.act]}` : BREAK_WORDS[b.act]})`), h('div.ov-dim', {}, `${a.floor.name} · hire them again from its Org chart`)];
  }

  function tipFor(w: OverviewWorker, a: FloorArt): Node[] {
    const floor = a.floor.name;
    const member = a.floor.members.find((m) => m.workerId === w.id);
    return [
      h('b', {}, w.name, h('span.pill', { class: w.status }, STATUS_LABEL[w.status] ?? w.status)),
      h('div.ov-dim', {}, member ? `${member.icon} ${member.title} · ${floor}` : floor),
      w.task ? h('div.ov-task', {}, w.task) : null,
      w.now ? h('div', {}, w.status === 'needs_input' ? `🙋 ${w.now}` : w.now) : null,
      w.pr ? h('div.ov-dim', {}, `🔀 PR #${w.pr}`) : null,
    ].filter((x): x is HTMLElement => !!x);
  }

  canvas.addEventListener('pointermove', (e) => {
    const hit = hitAt(e.clientX, e.clientY);
    const who = hit?.who;
    const next = who ? { floor: hit!.index, worker: 'worker' in who ? who.worker.id : who.lead.id } : null;
    if (next?.worker !== hover?.worker) {
      hover = next;
      draw(performance.now(), true);
    }
    canvas.classList.toggle('point', hit?.part === 'banner');
    const a = hit ? arts[hit.index] : undefined;
    const f = a?.floor;
    const body = !a || !f || canvas.classList.contains('grabbing') ? null : who ? ('worker' in who ? tipFor(who.worker, a) : leadTip(who.lead, who.index, a)) : hit!.part === 'banner' ? [h('b', {}, f.name), h('div.ov-dim', {}, 'Click to open it in the 2D view')] : null;
    tip.classList.toggle('hidden', !body);
    if (!body) return;
    tip.replaceChildren(...body);
    const r = stage.getBoundingClientRect();
    const x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    tip.style.left = `${Math.max(8, Math.min(x, r.width - tip.offsetWidth - 8))}px`;
    tip.style.top = `${y + tip.offsetHeight > r.height - 8 ? e.clientY - r.top - tip.offsetHeight - 12 : y}px`;
  });
  canvas.addEventListener('pointerleave', () => {
    tip.classList.add('hidden');
    canvas.classList.remove('point');
    if (hover) {
      hover = null;
      draw(performance.now(), true);
    }
  });
  const go = (i: number) => {
    const f = arts[i]?.floor;
    if (f) openFloor(f.id, '2d', leaving);
  };
  canvas.addEventListener('click', (e) => {
    if (camera.dragged()) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit?.part === 'banner') go(hit.index);
  });
  canvas.addEventListener('dblclick', (e) => {
    const hit = hitAt(e.clientX, e.clientY);
    if (hit) go(hit.index);
  });

  setInterval(() => void refresh(), REFRESH_MS);
  document.addEventListener('visibilitychange', () => !document.hidden && void refresh());
  // A floor added or taken away: the overview catches up straight away rather than at the next refresh.
  let floorsKey = '';
  store.on('floors', () => {
    const key = store.floors.map((f) => f.id).join('|');
    if (key === floorsKey) return;
    floorsKey = key;
    void refresh();
  });

  // For headless checks and screenshots: the data, the camera, and a way to put floors in without a server.
  (window as any).__overview = { cam, take, data: () => data, cells: () => cells, spots: (i: number) => arts[i]?.people.spots, url: (i: number) => (arts[i] ? floorUrl(arts[i].floor.id, '2d') : undefined) };

  return {
    show() {
      if (shown) return;
      shown = true;
      readColors();
      layout();
      if (!ticking) requestAnimationFrame(tick);
      void refresh();
    },
    hide() {
      shown = false;
      tip.classList.add('hidden');
    },
    themed() {
      readColors();
      draw(performance.now(), true);
    },
  };
}
