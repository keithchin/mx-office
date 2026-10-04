// The 2D view (/pixel): the floor you're on from above, in pixel art, without the 3D. Every worker
// sits at its desk acting out how it's doing, and the people walking about the 3D office are where
// they are. Hover over anything for what it is; click a worker for its terminal (right-click for its
// menu), a free desk to give someone new work there, or what's on the walls and about the room for
// its window: the boards, the whiteboard, the meeting room, the elevator, the TV, the bookshelf. It
// fills the window and zooms in whole steps (see pixel/camera.ts). The floors page (🏠) has every
// floor of the building. Like the 1D view, you're in the office without standing anywhere in it
// (PeerInfo.lite), and it loads no three.js.

import { store } from './state';
import { DESK_BY_ID } from '../shared/layout';
import { trackTitle } from '../shared/jukebox';
import { clip, $, h, STATUS_LABEL, toast } from './ui/dom';
import { modelBadge, providerLabel } from './ui/provider';
import { openBoard } from './ui/boards';
import { openQueue } from './ui/queue';
import { openMeeting } from './ui/meeting';
import { openPull } from './ui/pull';
import { openServices } from './ui/services';
import { openBookshelf } from './ui/bookshelf';
import { openWhiteboard, routeWhiteboardMessage } from './ui/whiteboard';
import type { BoardActions } from './ui/github/prompts';
import { summaryLine } from './ui/summary';
import { rememberView, switchView } from './graphics';
import { waitingInOrder } from './nextup';
import { flatSession } from './shared/session';
import { workerActions } from './shared/workers';
import { floorPicker, floorsHome } from './shared/floors';
import { renderTitle } from './shared/title';
import { drawOffice, frameFor, type Frame } from './pixel/office';
import { drawPeople, type People, type Spot } from './pixel/people';
import { deskSigns, drawMoving, type DeskSign } from './pixel/props';
import { hotspots, type Hotspot } from './pixel/hotspots';
import { Camera, driveCamera } from './pixel/camera';
import { closeMenu, mountChat, officeKeys, openWorkerMenu } from './pixel/hud';
import { badge, drawLabels, outline, signText } from './pixel/overlay';
import './pixel/game.css';

// Here, the office opens on the 2D view next time too (see graphics.ts).
rememberView('2d');

const session = flatSession('/pixel', (id) => workers.open(id), (msg) => routeWhiteboardMessage(msg, net));
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

// ---- What the office's things open ---------------------------------------------------------------------
function boardActions(): BoardActions {
  return {
    queue: (prompt, title, issue, provider, model, effort) => net.send({ t: 'queue.add', prompt, title, issue, provider, model, effort }),
    assign: (prompt, title, issue) => workers.send(`🤖 ${title}`, { initial: prompt }, issue),
    ask: (context, title) => workers.send(`✍️ ${title}`, { context }),
    goToDesk: (deskId) => {
      const w = store.workerAtDesk(deskId);
      if (w) workers.open(w.id);
    },
    meeting: () => showMeeting(),
  };
}
function showMeeting() {
  openMeeting(net, {
    openTerminal: workers.open,
    openPr: (id) => {
      const w = store.workers.get(id);
      const it = w?.pr && store.pulls.items.find((p) => p.number === w.pr!.number);
      if (it) openPull(it, net, boardActions());
      else if (w?.pr) window.open(w.pr.url, '_blank', 'noopener');
    },
  });
}
const githubUrl = (remote?: string) => {
  const m = remote?.match(/github\.com[:/]([^/]+\/[^/.]+)/);
  return m ? `https://github.com/${m[1]}` : undefined;
};
let pageSound = false;
const spots = (f: Frame) =>
  hotspots(f, {
    board: (kind) => openBoard(kind, net, boardActions()),
    queue: () => openQueue(net, { openTerminal: workers.open }),
    whiteboard: () => openWhiteboard(net),
    meeting: showMeeting,
    floors: () => home.show(),
    services: () => openServices(),
    docs: () => {
      if (!store.floor) return;
      openBookshelf({ floor: store.floor, project: store.project?.name, repoUrl: githubUrl(store.project?.remote), onTurn: () => {}, pageSound, onPageSound: (on) => (pageSound = on) });
    },
    station: (kind, deskId) => workers.askStation(kind, deskId),
    hired: (deskId) => !!store.workerAtDesk(deskId),
    counts: () => ({
      issues: store.issues.items.filter((i) => i.state === 'OPEN').length,
      pulls: store.pulls.items.filter((p) => p.state === 'OPEN').length,
      queue: store.queue.tasks.filter((t) => t.status !== 'done').length,
      services: store.services.items.length,
    }),
    say: {
      jukebox: () => (store.jukebox.on ? `♪ ${trackTitle(store.jukebox)} · it plays in the 3D office` : 'Off · put something on in the 3D office'),
      arcade: () => (store.cabinet.player ? `${store.cabinet.player.name} is playing` : store.cabinet.scores[0] ? `High score: ${store.cabinet.scores[0].name}` : 'Play it in the 3D office'),
      machine: () => `CPU ${Math.round(store.machine.cpu)}% of ${store.machine.cores} cores · memory ${Math.round((store.machine.memUsed / Math.max(1, store.machine.memTotal)) * 100)}%${store.machine.pressure ? ` · ${store.machine.pressure}` : ''}`,
      whiteboard: () => (store.drawing.length ? `✏️ ${store.drawing.length} drawing on it now` : 'Draw on it together, live'),
      meeting: () => {
        const m = store.meeting.current;
        return m?.status === 'running' ? `In a meeting: ${clip(m.title, 60)}` : 'Workers work through a question or a task together';
      },
    },
  });

// ---- Drawing --------------------------------------------------------------------------------------
// The office is drawn small, in art pixels, then blown up with no smoothing so every pixel stays a
// square. At a whole-step zoom that's straight onto the screen; fitted to the window it's a whole
// number of times first, then the last little stretch, so no pixel is ever more than one screen
// pixel off its neighbours. Names, badges and outlines go on after, sharp at the screen's own size.
const canvas = $('office') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
const art = document.createElement('canvas');
const ag = art.getContext('2d')!;
const buffer = document.createElement('canvas');
const bg = buffer.getContext('2d')!;
const cam = new Camera();
let frame: Frame = frameFor(0);
let still = drawOffice(frame);
let things: Hotspot[] = [];
let signs: DeskSign[] = [];
let people: People = { spots: [], labels: [] };
let hover: Spot | Hotspot | null = null;
let dpr = 1;

function rebuild() {
  frame = frameFor(store.floorPlan.wing);
  still = drawOffice(frame, store.theme.active);
  art.width = frame.width;
  art.height = frame.height;
  things = spots(frame);
  signs = deskSigns(frame, store.floorPlan);
  resize();
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(stage.clientWidth * dpr)), hgt = Math.max(1, Math.round(stage.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== hgt) {
    canvas.width = w;
    canvas.height = hgt;
  }
  cam.layout(stage.clientWidth, stage.clientHeight, frame.width, frame.height);
  $('px-zoom-level').textContent = cam.label();
  draw(performance.now());
}

function draw(now: number) {
  ag.imageSmoothingEnabled = false;
  ag.drawImage(still, 0, 0);
  drawMoving(ag, frame, { now, theme: store.theme.active, music: store.jukebox.on, sharing: [...store.peers.values()].some((p) => p.sharing && store.onMyFloor(p)) });
  const peers = [...store.peers.values()].filter((p) => p.id !== store.you && !p.lite && store.onMyFloor(p));
  const hoverId = hover && 'kind' in hover && hover.kind !== 'desk' ? hover.id : null;
  people = drawPeople(ag, frame, { workers: store.workers.values(), peers, level: frame.level, hover: hoverId, dog: store.dog ? { state: store.dog, start: store.dogStart } : null, signs }, now);

  g.imageSmoothingEnabled = false;
  g.fillStyle = '#0d1828';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const s = cam.scale * dpr;
  const k = Math.max(1, Math.floor(s + 1e-6));
  const dx = Math.round(cam.x * dpr), dy = Math.round(cam.y * dpr), dw = Math.round(frame.width * s), dh = Math.round(frame.height * s);
  if (Math.abs(s - k) < 1e-6) g.drawImage(art, dx, dy, dw, dh);
  else {
    if (buffer.width !== frame.width * k || buffer.height !== frame.height * k) {
      buffer.width = frame.width * k;
      buffer.height = frame.height * k;
    }
    bg.imageSmoothingEnabled = false;
    bg.drawImage(art, 0, 0, buffer.width, buffer.height);
    g.drawImage(buffer, dx, dy, dw, dh);
  }
  const view = { scale: s, x: cam.x * dpr, y: cam.y * dpr, dpr };
  for (const t of things) if (t.badge) badge(g, view, t, t.badge());
  if (s >= 2) for (const sign of signs) signText(g, view, sign);
  if (hover && (!('kind' in hover) || hover.kind === 'desk')) outline(g, view, hover, 'kind' in hover);
  drawLabels(g, view, people.labels, hoverId);
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
store.on('theme', rebuild);
store.on('workers', () => (things = spots(frame)));
const camera = driveCamera(canvas, cam, () => draw(performance.now()));

// ---- The zoom buttons --------------------------------------------------------------------------------------
function zoom(dir: 1 | -1 | 0) {
  if (dir === 0) cam.setZoom('fit');
  else cam.step(dir);
  $('px-zoom-level').textContent = cam.label();
  draw(performance.now());
}
$('px-zoom-in').addEventListener('click', () => zoom(1));
$('px-zoom-out').addEventListener('click', () => zoom(-1));
$('px-zoom-fit').addEventListener('click', () => zoom(0));

// ---- Under the office: who's doing what, and the keys ---------------------------------------------------
function renderCount() {
  const list = [...store.workers.values()];
  const count = (...statuses: string[]) => list.filter((w) => statuses.includes(w.status)).length;
  const working = count('working', 'starting'), done = count('done'), asleep = count('exited', 'offline'), waiting = count('needs_input');
  const parts = [`${list.length} worker${list.length === 1 ? '' : 's'}`, working && `${working} working`, done && `${done} done`, asleep && `${asleep} asleep`].filter(Boolean);
  $('px-count').replaceChildren(parts.join(' · '), waiting ? h('span.warn', {}, ` · 🙋 ${waiting} need${waiting === 1 ? 's' : ''} you`) : '');
  ($('px-next') as HTMLButtonElement).disabled = !waitingInOrder(list).length;
  renderTitle();
}
store.on('workers', renderCount);

/** The project in a line on the top bar (ui/summary.ts): its stage, who's working, who needs you. */
async function renderSummary() {
  $('px-summary').textContent = store.floor ? await summaryLine(store.floor) : '';
}
store.on('floor', () => void renderSummary());
setInterval(() => void renderSummary(), 60_000);

// ---- Pointing at things ----------------------------------------------------------------------------------
const tip = $('px-tip');

function hitAt(clientX: number, clientY: number): Spot | Hotspot | null {
  const r = canvas.getBoundingClientRect();
  const { x, y } = cam.toArt(clientX - r.left, clientY - r.top);
  const inside = (s: { x: number; y: number; w: number; h: number }) => x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h;
  // People are over the desks they sit at, and the nearest drawn last: the last one listed wins.
  let found: Spot | null = null;
  for (const s of people.spots) if (inside(s) && (!found || found.kind === 'desk' || s.kind !== 'desk')) found = s;
  if (found && found.kind !== 'desk') return found;
  return things.find(inside) ?? found;
}

function tipFor(s: Spot | Hotspot): HTMLElement[] | null {
  if (!('kind' in s)) return [h('b', {}, s.title), h('div.px-dim', {}, s.sub()), s.action ? h('div.px-hint', {}, `🖱️ ${s.action}`) : null].filter((x): x is HTMLElement => !!x);
  if (s.kind === 'desk') return [h('b', {}, `${DESK_BY_ID.get(s.id)?.label ?? 'Desk'} · free`), h('div.px-hint', {}, '✨ Click to give someone new work here')];
  if (s.kind === 'dog') return store.dog ? [h('b', {}, `🐕 ${store.dog.name}`), h('div.px-dim', {}, `The office dog · ${store.dog.act}`)] : null;
  if (s.kind === 'peer') {
    const p = store.peers.get(s.id);
    return p ? [h('b', {}, p.name), h('div.px-dim', {}, p.doing ?? 'Walking about the 3D office')] : null;
  }
  const w = store.workers.get(s.id);
  if (!w) return null;
  const task = w.task?.name ?? w.title ?? (w.prompt ? clip(w.prompt, 90) : undefined);
  const now = w.status === 'needs_input' ? `🙋 ${w.activity ?? 'Waiting on an answer'}` : w.status === 'done' ? w.task?.summary && `✅ ${clip(w.task.summary, 120)}` : (w.task?.summary ?? w.activity);
  const model = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort, w.usage?.model) : undefined;
  const runs = w.kind === 'agent' ? `⚙️ ${providerLabel(w.provider, store.project)}${model ? ` · ${model}` : ''}` : '🐚 shell';
  return [
    h('b', {}, w.name, h('span.pill', { class: w.status }, STATUS_LABEL[w.status] ?? w.status)),
    task ? h('div.px-task', {}, task) : null,
    now ? h('div', {}, clip(now, 140)) : null,
    h('div.px-dim', {}, [runs, DESK_BY_ID.get(w.deskId)?.label, w.pr && `🔀 PR #${w.pr.number}`].filter(Boolean).join(' · ')),
    h('div.px-hint', {}, '🖱️ Terminal · right-click for more'),
  ].filter((x): x is HTMLElement => !!x);
}

const kindOf = (s: Spot | Hotspot | null) => (s && 'kind' in s ? s.kind : 'thing');
canvas.addEventListener('pointermove', (e) => {
  const s = hitAt(e.clientX, e.clientY);
  if (s?.id !== hover?.id || kindOf(s) !== kindOf(hover)) {
    hover = s;
    canvas.classList.toggle('point', !!s && (!('kind' in s) ? !!s.run : s.kind === 'worker' || s.kind === 'desk'));
    draw(performance.now());
  }
  const body = s && tipFor(s);
  tip.classList.toggle('hidden', !body || canvas.classList.contains('grabbing'));
  if (!body) return;
  tip.replaceChildren(...body);
  // Beside the pointer, kept inside the office.
  const r = stage.getBoundingClientRect();
  const x = e.clientX - r.left + 16, y = e.clientY - r.top + 16;
  tip.style.left = `${Math.max(8, Math.min(x, r.width - tip.offsetWidth - 8))}px`;
  tip.style.top = `${y + tip.offsetHeight > r.height - 8 ? e.clientY - r.top - tip.offsetHeight - 12 : y}px`;
});
canvas.addEventListener('pointerleave', () => {
  hover = null;
  tip.classList.add('hidden');
  canvas.classList.remove('point');
});

function use(s: Spot | Hotspot) {
  tip.classList.add('hidden');
  if (!('kind' in s)) return s.run ? s.run() : toast(`${s.title}: ${s.sub()}`);
  if (s.kind === 'worker') workers.open(s.id);
  else if (s.kind === 'desk') workers.send('✨ New task', {}, undefined, s.id);
  else if (s.kind === 'peer') toast(`🚶 ${store.peers.get(s.id)?.name ?? 'They'} is walking about the 3D office`);
}
canvas.addEventListener('click', (e) => {
  if (camera.dragged()) return;
  const s = hitAt(e.clientX, e.clientY);
  if (s) use(s);
});
// Right-click (or a long press on a touch screen) a worker for its menu.
function menuAt(clientX: number, clientY: number): boolean {
  const s = hitAt(clientX, clientY);
  if (!s || !('kind' in s) || s.kind !== 'worker') return false;
  const r = stage.getBoundingClientRect();
  tip.classList.add('hidden');
  openWorkerMenu(stage, s.id, clientX - r.left, clientY - r.top, workers);
  return true;
}
canvas.addEventListener('contextmenu', (e) => {
  if (menuAt(e.clientX, e.clientY)) e.preventDefault();
});
let press: number | undefined;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') press = window.setTimeout(() => camera.dragged() || menuAt(e.clientX, e.clientY), 550);
});
canvas.addEventListener('pointerup', () => clearTimeout(press));
canvas.addEventListener('pointercancel', () => clearTimeout(press));

// ---- Keys (as the 3D office's, where they mean the same) ----------------------------------------------------
const chat = mountChat(stage, net);
/** N: to whoever's waited longest on you, their terminal open and the office turned to them. */
function nextWaiting() {
  const w = waitingInOrder(store.workers.values())[0];
  if (!w) return toast('Nobody is waiting on you ✨');
  const spot = people.spots.find((s) => s.kind === 'worker' && s.id === w.id);
  if (spot && cam.pannable) cam.lookAt(spot.x + spot.w / 2, spot.y + spot.h / 2);
  workers.open(w.id);
}
$('px-next').addEventListener('click', nextWaiting);
addEventListener('keydown', (e) => {
  if (home.shown || !officeKeys(e) || e.ctrlKey) return;
  const pan = 64;
  const keys: Record<string, () => void> = {
    n: nextWaiting,
    t: () => chat.open(),
    '+': () => zoom(1),
    '=': () => zoom(1),
    '-': () => zoom(-1),
    '0': () => zoom(0),
    ArrowLeft: () => cam.pan(pan, 0),
    ArrowRight: () => cam.pan(-pan, 0),
    ArrowUp: () => cam.pan(0, pan),
    ArrowDown: () => cam.pan(0, -pan),
    Escape: closeMenu,
  };
  const run = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!run) return;
  e.preventDefault();
  run();
  draw(performance.now());
});

// ---- In ----------------------------------------------------------------------------------------
session.bellBefore($('to-home'));
session.start();
rebuild();
renderCount();

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__pixel = { store, net, home, cam, draw: () => draw(performance.now()), spots: () => people.spots, things: () => things, view: () => ({ scale: cam.scale * dpr, x: cam.x * dpr, y: cam.y * dpr, dpr }) };
