// The 2D view (/pixel): the floor you're on from above, in pixel art, without the 3D. Every worker
// sits at its desk acting out how it's doing, and the people walking about the 3D office are where
// they are. Hover over someone for what they're on; click a worker for its terminal (the same one
// the 1D view opens), or a free desk to give someone new work there. The floors page (🏠 Floors)
// has every floor of the building. Like the 1D view, you're in the office without standing anywhere
// in it (PeerInfo.lite), and it loads no three.js.

import { store } from './state';
import { DESK_BY_ID } from '../shared/layout';
import { clip, $, h, STATUS_LABEL, toast } from './ui/dom';
import { modelBadge, providerLabel } from './ui/provider';
import { rememberView, switchView } from './graphics';
import { flatSession } from './shared/session';
import { workerActions } from './shared/workers';
import { floorPicker, floorsHome } from './shared/floors';
import { renderTitle } from './shared/title';
import { drawOffice, frameFor, type Frame } from './pixel/office';
import { drawPeople, type People, type Spot } from './pixel/people';

// Here, the office opens on the 2D view next time too (see graphics.ts).
rememberView('2d');

const session = flatSession('/pixel', (id) => workers.open(id));
const { net } = session;
const workers = workerActions(net);

floorPicker(net);
const stage = $('stage');
const home = floorsHome(net, '2d', (shown) => {
  stage.classList.toggle('hidden', shown);
  $('px-foot').classList.toggle('hidden', shown);
  if (!shown) requestAnimationFrame(resize);
});
$('to-1d').addEventListener('click', () => switchView('1d'));

// ---- Drawing --------------------------------------------------------------------------------------
// The office is drawn small, in art pixels, then scaled up a whole number of times onto the screen
// with no smoothing, so every pixel stays a crisp square. Names go on after, at the screen's own size.
const canvas = $('office') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
const art = document.createElement('canvas');
const ag = art.getContext('2d')!;
let frame: Frame = frameFor(0);
let still = drawOffice(frame);
/** Where the art goes on the screen: its scale and its top-left corner, in screen pixels. */
let view = { scale: 1, x: 0, y: 0, dpr: 1 };
let people: People = { spots: [], labels: [] };
let hover: Spot | null = null;

function rebuild() {
  frame = frameFor(store.floorPlan.wing);
  still = drawOffice(frame);
  art.width = frame.width;
  art.height = frame.height;
  resize();
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(stage.clientWidth * dpr));
  const hgt = Math.max(1, Math.round(stage.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== hgt) {
    canvas.width = w;
    canvas.height = hgt;
  }
  // Whole steps up when there's room for at least one; a small screen gets it shrunk to fit instead.
  const fit = Math.min(w / frame.width, hgt / frame.height);
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  view = { scale, x: Math.floor((w - frame.width * scale) / 2), y: Math.floor((hgt - frame.height * scale) / 2), dpr };
  draw(performance.now());
}

function draw(now: number) {
  ag.imageSmoothingEnabled = false;
  ag.drawImage(still, 0, 0);
  const peers = [...store.peers.values()].filter((p) => p.id !== store.you && !p.lite && store.onMyFloor(p));
  people = drawPeople(ag, frame, { workers: store.workers.values(), peers, level: frame.level, hover: hover && hover.kind !== 'desk' ? hover.id : null }, now);
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#0d1828';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(art, view.x, view.y, frame.width * view.scale, frame.height * view.scale);
  if (hover?.kind === 'desk') outline(hover);
  labels();
}

/** The names, sharp at the screen's size, in a pill: navy for workers (with a dot for how it's doing), white for people. */
function labels() {
  const { scale, dpr } = view;
  // Too small to read beside each other: only the one under the pointer.
  const all = scale >= 1.5;
  const size = Math.round((scale >= 3 ? 12 : 11) * dpr);
  g.font = `700 ${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  g.textBaseline = 'middle';
  /** The pills drawn so far: one that would overlap another steps a row further from its owner. */
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  for (const l of people.labels) {
    if (!all && hover?.id !== l.id) continue;
    const text = l.text.length > 14 ? `${l.text.slice(0, 13)}…` : l.text;
    const pad = Math.round(5 * dpr), dot = l.status ? Math.round(8 * dpr) : 0;
    const w = Math.ceil(g.measureText(text).width) + pad * 2 + dot, hgt = Math.round(size * 1.45);
    const cx = view.x + l.x * scale;
    let y = Math.round(view.y + l.y * scale - (l.above ? hgt : 0));
    const x = Math.round(cx - w / 2);
    for (let tries = 0; tries < 3 && placed.some((p) => x < p.x + p.w && p.x < x + w && y < p.y + p.h && p.y < y + hgt); tries++) y += (l.above ? -1 : 1) * (hgt + Math.round(2 * dpr));
    placed.push({ x, y, w, h: hgt });
    g.fillStyle = l.human ? 'rgba(255,255,255,0.94)' : 'rgba(13,24,40,0.86)';
    g.beginPath();
    g.roundRect(x, y, w, hgt, Math.round(4 * dpr));
    g.fill();
    if (l.status) {
      g.fillStyle = STATUS_DOT[l.status] ?? '#8fa3bf';
      g.fillRect(x + pad, Math.round(y + hgt / 2 - 2.5 * dpr), Math.round(5 * dpr), Math.round(5 * dpr));
    }
    g.fillStyle = l.human ? '#13213a' : '#ffffff';
    g.fillText(text, x + pad + dot, y + hgt / 2 + dpr * 0.5);
  }
}

const STATUS_DOT: Record<string, string> = { working: '#5fd9cb', starting: '#5fd9cb', idle: '#c9d4e3', needs_input: '#f2b33d', done: '#2fbf8a', exited: '#8fa3bf', offline: '#8fa3bf' };

/** A free desk under the pointer: a dashed teal outline round it. */
function outline(s: Spot) {
  const { scale } = view;
  g.save();
  g.strokeStyle = '#17b3a3';
  g.lineWidth = Math.max(2, Math.round(scale));
  g.setLineDash([Math.round(4 * scale), Math.round(3 * scale)]);
  g.strokeRect(view.x + (s.x - 2) * scale, view.y + (s.y - 2) * scale, (s.w + 4) * scale, (s.h + 4) * scale);
  g.restore();
}

// The animation moves on a beat at a time, so drawing ten times a second is plenty; nothing while hidden.
let last = 0;
function tick(now: number) {
  if (now - last >= 100 && !document.hidden && !home.shown) {
    last = now;
    draw(now);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
new ResizeObserver(() => resize()).observe(stage);
store.on('floorPlan', rebuild);

/** Under the office: how many are working, waiting on someone, done and asleep. */
function renderCount() {
  const list = [...store.workers.values()];
  const count = (...statuses: string[]) => list.filter((w) => statuses.includes(w.status)).length;
  const working = count('working', 'starting'), done = count('done'), asleep = count('exited', 'offline'), waiting = count('needs_input');
  const parts = [`${list.length} worker${list.length === 1 ? '' : 's'}`, working && `${working} working`, done && `${done} done`, asleep && `${asleep} asleep`].filter(Boolean);
  $('px-count').replaceChildren(parts.join(' · '), waiting ? h('span.warn', {}, ` · 🙋 ${waiting} need${waiting === 1 ? 's' : ''} you`) : '');
  renderTitle();
}
store.on('workers', renderCount);

// ---- Pointing at someone ----------------------------------------------------------------------------
const tip = $('px-tip');

function spotAt(e: PointerEvent): Spot | null {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) * view.dpr - view.x) / view.scale;
  const y = ((e.clientY - r.top) * view.dpr - view.y) / view.scale;
  // People are over the desks they sit at, and the nearest drawn last: so the last one listed wins.
  let found: Spot | null = null;
  for (const s of people.spots) {
    if (x < s.x || y < s.y || x >= s.x + s.w || y >= s.y + s.h) continue;
    if (!found || found.kind === 'desk' || s.kind !== 'desk') found = s;
  }
  return found;
}

function tipFor(s: Spot): HTMLElement[] | null {
  if (s.kind === 'desk') {
    const d = DESK_BY_ID.get(s.id);
    return [h('b', {}, `${d?.label ?? 'Desk'} · free`), h('div.px-hint', {}, '✨ Click to give someone new work here')];
  }
  if (s.kind === 'peer') {
    const p = store.peers.get(s.id);
    if (!p) return null;
    return [h('b', {}, p.name), h('div.px-dim', {}, p.doing ?? 'Walking about the 3D office')];
  }
  const w = store.workers.get(s.id);
  if (!w) return null;
  const task = w.task?.name ?? w.title ?? (w.prompt ? clip(w.prompt, 90) : undefined);
  const now = w.status === 'needs_input' ? `🙋 ${w.activity ?? 'Waiting on an answer'}` : w.status === 'done' ? w.task?.summary && `✅ ${clip(w.task.summary, 120)}` : (w.task?.summary ?? w.activity);
  const badge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort, w.usage?.model) : undefined;
  const runs = w.kind === 'agent' ? `⚙️ ${providerLabel(w.provider, store.project)}${badge ? ` · ${badge}` : ''}` : '🐚 shell';
  return [
    h('b', {}, w.name, h('span.pill', { class: w.status }, STATUS_LABEL[w.status] ?? w.status)),
    task ? h('div.px-task', {}, task) : null,
    now ? h('div', {}, clip(now, 140)) : null,
    h('div.px-dim', {}, [runs, DESK_BY_ID.get(w.deskId)?.label, w.pr && `🔀 PR #${w.pr.number}`].filter(Boolean).join(' · ')),
    h('div.px-hint', {}, '⌨️ Click for its terminal'),
  ].filter((x): x is HTMLElement => !!x);
}

canvas.addEventListener('pointermove', (e) => {
  const s = spotAt(e);
  if (s?.id !== hover?.id || s?.kind !== hover?.kind) {
    hover = s;
    canvas.classList.toggle('point', !!s && s.kind !== 'peer');
    draw(performance.now());
  }
  const body = s && tipFor(s);
  tip.classList.toggle('hidden', !body);
  if (!body) return;
  tip.replaceChildren(...body);
  // Beside the pointer, kept inside the office.
  const r = stage.getBoundingClientRect();
  const x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
  tip.style.left = `${Math.min(x, r.width - tip.offsetWidth - 8)}px`;
  tip.style.top = `${y + tip.offsetHeight > r.height - 8 ? e.clientY - r.top - tip.offsetHeight - 10 : y}px`;
});
canvas.addEventListener('pointerleave', () => {
  hover = null;
  tip.classList.add('hidden');
  canvas.classList.remove('point');
});
canvas.addEventListener('click', (e) => {
  const s = spotAt(e as PointerEvent);
  if (!s) return;
  tip.classList.add('hidden');
  if (s.kind === 'worker') workers.open(s.id);
  else if (s.kind === 'desk') workers.send('✨ New task', {}, undefined, s.id);
  else toast(`🚶 ${store.peers.get(s.id)?.name ?? 'They'} ${store.peers.has(s.id) ? 'is' : 'are'} walking about the 3D office`);
});

// ---- In ----------------------------------------------------------------------------------------
session.bellBefore($('to-home'));
session.start();
rebuild();
renderCount();

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__pixel = { store, net, home, draw: () => draw(performance.now()), spots: () => people.spots, view: () => view };
