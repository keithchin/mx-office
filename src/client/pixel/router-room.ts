// Jeff's room in the 2D view: "Router · Jeff", a small glass office on the open floor east of the
// design studio, with Jeff (pixel/jeff.ts) always at his desk: he's the office's quick judge, not a
// worker, so he's in no workers list and nobody hires or benches him. On the wall behind him a
// switchboard whose lights twinkle, and blink when he judges; beside him a rack of trays, one per team
// and one for the Project Manager, that fills as he routes. When the server says he judged something
// (judge.made) he stamps it, a light flashes and his verdict floats over him ("→ PM", "→ Development").
// Hover his desk for how he's doing; click it for his card, with a link to his section on the
// Analysis tab. The room's colours come from the 1D themes' tokens, so it follows Default, Dark and
// Terminal wherever the 2D view takes them up. pixel.ts only calls in: draw, overlay, spot, onMessage.

import type { JudgeMade, JudgeSummary } from '../../shared/judge';
import type { ServerMsg } from '../../shared/protocol';
import { TEAM_IDS, TEAM_META } from '../../shared/roster/card-team';
import type { TeamZone } from '../../shared/zones';
import { h } from '../ui/dom';
import { fetchJudge, jeffName, jeffPortrait, KIND_LABEL, rateOf, statusPill, STATUS_WORDS, todayLine } from '../ui/jeff';
import { drawChair } from './desks';
import { ax, az, LIFT, type Frame } from './frame';
import type { Hotspot } from './hotspots';
import { drawJeff, jeffAct } from './jeff';
import { drawPlant } from './props';
import { zoneBanner, type Box, type View } from './overlay';
import { box, castShadow, rect } from './paint';
import { C } from './sprites';
// The themes' tokens, so the room and his card follow <html data-theme> wherever the 2D view sets it.
import '../styles/themes.css';
import './router-room.css';

/** The room on the floor plan, in meters (shared/layout.ts): open floor between the design studio and the lounge. */
export const ROUTER_ROOM = { minX: 3.8, maxX: 9.2, minZ: -4.4, maxZ: 0.4 } as const;
const WALL_H = 18;
const BUBBLE_MS = 4200;
const BLINK_MS = 2200;
/** The trays, top to bottom: the Project Manager's, then each team's. */
const TRAYS = ['pm', ...TEAM_IDS] as const;
type Tray = (typeof TRAYS)[number];

interface Tokens {
  carpet: string;
  carpetEdge: string;
  accent: string;
  key: string;
}

/** The 1D themes' tokens (styles/base.css, themes.css), read at most once a second. */
let tokens: Tokens | undefined;
let tokensAt = 0;
function themeTokens(now: number): Tokens {
  if (tokens && now - tokensAt < 1000) return tokens;
  tokensAt = now;
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  const t = { carpet: v('--paper-2', '#fff1de'), carpetEdge: v('--rule-soft', '#ead9c0'), accent: v('--accent', '#ff8a5b') };
  tokens = { ...t, key: Object.values(t).join('|') };
  return tokens;
}

// ---- What's happened: the latest judgement, the trays, his numbers ---------------------------------
let last: (JudgeMade & { seen: number }) | undefined;
const trays: Record<Tray, number> = { pm: 0, management: 0, design: 0, development: 0, testing: 0, analysis: 0 };
let summary: JudgeSummary | undefined;
let summaryFloor: string | undefined;
let fetching = false;
let floorNow: () => string | null = () => null;
let triedAt = -Infinity;

function refresh() {
  const floor = floorNow();
  if (!floor || fetching) return;
  fetching = true;
  void fetchJudge(floor)
    .then((s) => {
      summary = s;
      summaryFloor = floor;
      if (card) fillCard(card, s);
    })
    .catch(() => undefined)
    .finally(() => (fetching = false));
}

/** Which tray a verdict lands in. */
function trayOf(m: JudgeMade): Tray | undefined {
  if (m.kind === 'waiting') return m.verdict.includes('PM') ? 'pm' : undefined;
  const name = m.verdict.replace(/^→\s*/, '');
  return TEAM_IDS.find((t) => TEAM_META[t].name === name);
}

/** The server says Jeff judged something on this floor. */
export function routerJudged(m: JudgeMade, now = performance.now()) {
  last = { ...m, seen: now };
  const t = trayOf(m);
  if (t) trays[t] = Math.min(4, trays[t] + 1);
  setTimeout(refresh, 1500);
}

/** Starts his numbers coming (now, every minute, after each judgement); `floor` is the floor you're on. */
export function startRouter(floor: () => string | null) {
  floorNow = floor;
  refresh();
  setInterval(refresh, 60_000);
  // For headless checks and screenshots: make him judge something without a server.
  (window as any).__router = { judged: (m: Partial<JudgeMade>) => routerJudged({ kind: 'triage', by: 'jev', verdict: '→ Development', agree: true, acted: false, at: Date.now(), ...m }), refresh };
}

/** pixel.ts's message hook: his judgements on the floor you're on. */
export function routerMessage(msg: ServerMsg) {
  if (msg.t !== 'judge.made' || msg.floor !== floorNow()) return;
  routerJudged(msg);
}

// ---- Drawing --------------------------------------------------------------------------------------

/** Where things are, in art pixels. */
function layout(f: Frame) {
  const x0 = ax(f, ROUTER_ROOM.minX), x1 = ax(f, ROUTER_ROOM.maxX), y0 = az(f, ROUTER_ROOM.minZ), y1 = az(f, ROUTER_ROOM.maxZ);
  const cx = x0 + Math.round((x1 - x0) * 0.42);
  const seatY = y0 + 34;
  return { x0, x1, y0, y1, w: x1 - x0, cx, seatY, desk: { x: cx - 24, y: seatY + 8, w: 48, d: 16, h: Math.round(0.78 * LIFT) } };
}

/** The room and Jeff in it, into the art canvas, after the people (nobody else ever sits in here). */
export function drawRouter(g: CanvasRenderingContext2D, f: Frame, now: number) {
  const L = layout(f);
  const T = themeTokens(now);
  const { x0, x1, y0, y1, w } = L;
  const since = last ? now - last.seen : undefined;
  const blinking = since !== undefined && since < BLINK_MS;

  // The floor: a carpet in the theme's paper, edged in its accent.
  rect(g, x0, y0, w, y1 - y0, T.carpet);
  rect(g, x0, y0, w, y1 - y0, 'rgba(9, 18, 34, 0.06)');
  rect(g, x0 + 3, y0 + 3, w - 6, y1 - y0 - 6, T.carpet);
  for (let y = y0 + 6; y < y1 - 4; y += 5) rect(g, x0 + 4, y, w - 8, 1, 'rgba(9, 18, 34, 0.035)');
  rect(g, x0 + 2, y1 - 3, w - 4, 1, T.accent);

  // The back wall, its face toward you, the switchboard on it.
  rect(g, x0 - 2, y0 - WALL_H, w + 4, WALL_H, C.wall);
  rect(g, x0 - 2, y0 - WALL_H, w + 4, 3, 'rgba(255,255,255,0.22)');
  rect(g, x0 - 2, y0 - 2, w + 4, 2, 'rgba(0,0,0,0.3)');
  switchboard(g, x0 + 6, y0 - WALL_H + 4, now, blinking);
  // A framed sign: a little ⚖ in the accent.
  rect(g, x1 - 24, y0 - WALL_H + 5, 16, 9, '#f4f6fa');
  rect(g, x1 - 23, y0 - WALL_H + 6, 14, 7, T.accent);
  rect(g, x1 - 17, y0 - WALL_H + 7, 2, 5, '#f4f6fa');
  rect(g, x1 - 21, y0 - WALL_H + 8, 10, 1, '#f4f6fa');

  // His chair, him, and his desk in front of him.
  const act = jeffAct(now, since);
  drawChair(g, L.cx, L.seatY, 'front', true, '#5a2a30' as typeof C.chair);
  drawJeff(g, L.cx - 12, L.seatY - 29, act, Math.floor(now / 600) % 4 === 0 && act === 'still');
  const d = L.desk;
  castShadow(g, d.x, d.y, d.w, d.d, d.h);
  box(g, d.x, d.y, d.w, d.d, d.h, '#a0714f', '#7a5238', '#c08a63');
  const top = d.y - d.h;
  // On it: papers, the ink pad and his stamp (in his hand while he stamps), his mug, his nameplate.
  rect(g, d.x + 5, top + 3, 9, 7, '#f4f6fa');
  rect(g, d.x + 6, top + 5, 6, 1, '#9aa5b4');
  rect(g, d.x + 6, top + 7, 5, 1, '#9aa5b4');
  if (act === 'stamp-down' || (since !== undefined && since < BUBBLE_MS)) rect(g, d.x + 8, top + 4, 4, 3, 'rgba(192, 57, 43, 0.85)');
  rect(g, d.x + 17, top + 6, 6, 3, '#2b2d42');
  if (act !== 'stamp-up') {
    const sx = act === 'stamp-down' ? d.x + 8 : d.x + 19, sy = act === 'stamp-down' ? top + 1 : top + 3;
    rect(g, sx, sy, 4, 2, '#c0392b');
    rect(g, sx + 1, sy - 3, 2, 3, '#8a5a35');
  }
  if (act !== 'sip') {
    rect(g, d.x + d.w - 12, top + 3, 5, 5, '#f4f6fa');
    rect(g, d.x + d.w - 12, top + 3, 5, 1, '#6b4a3a');
    rect(g, d.x + d.w - 7, top + 4, 1, 2, '#f4f6fa');
  }
  rect(g, d.x + 16, d.y + d.d - d.h + 2, 16, 5, '#2b2d42');
  rect(g, d.x + 17, d.y + d.d - d.h + 3, 14, 3, '#d4a84a');

  // The trays on their rack, one per team and one for the Project Manager, filling as he routes.
  const rx = x1 - 24, ry = y0 + 8;
  castShadow(g, rx, ry + 32, 16, 6, 8);
  rect(g, rx, ry, 16, 38, '#56637a');
  rect(g, rx, ry, 16, 1, '#7d8a9c');
  TRAYS.forEach((t, i) => {
    const y = ry + 2 + i * 6;
    const color = t === 'pm' ? C.red : `#${TEAM_META[t].labelColor}`;
    const hot = blinking && last && trayOf(last) === t;
    rect(g, rx + 1, y + 3, 14, 2, hot ? '#ffffff' : '#c5cedb');
    for (let k = 0; k < trays[t]; k++) rect(g, rx + 3, y + 2 - k, 10, 1, k % 2 ? '#e8eef5' : '#ffffff');
    rect(g, rx + 1, y + 3, 3, 2, color);
  });

  // A plant in the corner.
  drawPlant(g, x0 + 10, y1 - 8, 1, 'snake');

  // Glass on three sides: thin walls left and right, and in front, with a door gap.
  const glass = (x: number, y: number, gw: number, gh: number) => {
    rect(g, x, y, gw, gh, 'rgba(160, 222, 214, 0.22)');
    rect(g, x, y, gw, 1, C.glassEdge);
  };
  rect(g, x0 - 2, y0 - WALL_H, 2, y1 - y0 + WALL_H, C.glassEdge);
  rect(g, x1, y0 - WALL_H, 2, y1 - y0 + WALL_H, C.glassEdge);
  const doorX = x0 + Math.round(w * 0.7);
  glass(x0, y1 - 12, doorX - x0, 12);
  glass(doorX + 18, y1 - 12, x1 - doorX - 18, 12);
  rect(g, x0, y1 - 1, doorX - x0, 1, C.glassEdge);
  rect(g, doorX + 18, y1 - 1, x1 - doorX - 18, 1, C.glassEdge);
  rect(g, doorX - 1, y1 - 12, 1, 12, C.glassEdge);
  rect(g, doorX + 18, y1 - 12, 1, 12, C.glassEdge);
}

/** The routing panel: rows of lights, patch cords between them; a twinkle, or all blinking when he judges. */
function switchboard(g: CanvasRenderingContext2D, x: number, y: number, now: number, blinking: boolean) {
  rect(g, x, y, 40, 12, '#141a26');
  rect(g, x, y, 40, 1, '#3a4659');
  const colors = [C.green, C.amber, C.tealLight, C.red];
  const tick = Math.floor(now / (blinking ? 120 : 700));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      const n = (r * 8 + c) * 7 + tick * 13;
      const on = blinking ? (n + r) % 2 === 0 : n % 5 === 0;
      rect(g, x + 3 + c * 5, y + 2 + r * 3, 2, 2, on ? colors[(r + c) % colors.length] : '#2b3445');
    }
  }
  // Two patch cords hanging down.
  rect(g, x + 8, y + 12, 1, 3, '#d4a84a');
  rect(g, x + 9, y + 15, 10, 1, '#d4a84a');
  rect(g, x + 19, y + 12, 1, 3, '#d4a84a');
  rect(g, x + 28, y + 12, 1, 4, C.red);
  rect(g, x + 29, y + 16, 6, 1, C.red);
  rect(g, x + 35, y + 12, 1, 4, C.red);
}

/** His room's signpost and, after a judgement, his verdict over him: sharp, at the screen's own size. */
export function routerOverlay(g: CanvasRenderingContext2D, v: View, f: Frame, before: Box[] = [], now = performance.now()) {
  // His numbers for the floor you're on, once it's known (and again after a floor change).
  if (floorNow() && summaryFloor !== floorNow() && now - triedAt > 5000) {
    triedAt = now;
    refresh();
  }
  const L = layout(f);
  const T = themeTokens(now);
  const zone = { team: 'management', name: 'Router · Jeff', icon: '⚖️', color: T.accent, desks: [], area: ROUTER_ROOM } as unknown as TeamZone;
  const lead = summary && summaryFloor === floorNow() ? `${jeffName(summary.status)} · ${todayLine(summary)}` : 'Jeff (Jev)';
  before.push(zoneBanner(g, v, { zone, x0: L.x0, y0: L.y0 - WALL_H - 6, x1: L.x1, y1: L.y1 }, lead, before));
  const since = last ? now - last.seen : undefined;
  if (since === undefined || since > BUBBLE_MS) return;
  bubble(g, v, L.cx + 10, L.seatY - 34, last!.verdict, Math.min(1, (BUBBLE_MS - since) / 500));
}

function bubble(g: CanvasRenderingContext2D, v: View, ax0: number, ay0: number, text: string, alpha: number) {
  const size = Math.round(Math.max(11, Math.min(15, 4.5 * (v.scale / v.dpr))) * v.dpr);
  g.save();
  g.globalAlpha = alpha;
  g.font = `900 ${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  g.textBaseline = 'middle';
  const pad = Math.round(size * 0.6), w = Math.ceil(g.measureText(text).width) + pad * 2, hgt = Math.round(size * 1.8);
  const x = Math.round(v.x + ax0 * v.scale), y = Math.round(v.y + ay0 * v.scale) - hgt;
  const p = Math.max(1, Math.round(v.dpr * 2));
  g.fillStyle = '#0d1828';
  g.fillRect(x - p, y - p, w + p * 2, hgt + p * 2);
  g.fillRect(x + p * 3, y + hgt, p * 4, p * 3);
  g.fillStyle = '#ffffff';
  g.fillRect(x, y, w, hgt);
  g.fillRect(x + p * 4, y + hgt, p * 2, p * 2);
  g.fillStyle = '#0d1828';
  g.fillText(text, x + pad, y + hgt / 2 + v.dpr);
  g.restore();
}

// ---- Hover and click ------------------------------------------------------------------------------

let card: HTMLElement | undefined;

/** His desk as a hotspot: the hover card says how he's doing; a click opens his card. */
export function routerSpot(f: Frame, stage: HTMLElement): Hotspot {
  const L = layout(f);
  return {
    id: 'router-jeff',
    title: '🧑‍⚖️ Jeff · Router',
    sub: () => (summary && summaryFloor === floorNow() ? `${jeffName(summary.status)} · ${STATUS_WORDS[summary.status.state]} · ${todayLine(summary)}` : 'The office’s quick judge: what goes to you, and which team an issue is for'),
    action: 'His card',
    x: L.cx - 26,
    y: L.seatY - 32,
    w: 52,
    h: 50,
    run: () => openCard(stage),
  };
}

function openCard(stage: HTMLElement) {
  card?.remove();
  const close = h('button.jr-x', { type: 'button', 'aria-label': 'Close', onclick: () => closeCard() }, '✕');
  card = h('div.jr-card', { role: 'dialog', 'aria-label': 'Jeff, the Router' }, close, h('p.jr-dim', {}, 'Asking Jeff…'));
  stage.append(card);
  if (summary && summaryFloor === floorNow()) fillCard(card, summary);
  refresh();
  setTimeout(() => addEventListener('pointerdown', outside), 0);
}

function outside(e: Event) {
  if (card && !card.contains(e.target as Node)) closeCard();
}

function closeCard() {
  card?.remove();
  card = undefined;
  removeEventListener('pointerdown', outside);
}

function fillCard(el: HTMLElement, s: JudgeSummary) {
  const floor = floorNow();
  const link = `/lite?${new URLSearchParams({ tab: 'analysis', ...(floor ? { floor } : {}) })}#jeff`;
  el.replaceChildren(
    h('button.jr-x', { type: 'button', 'aria-label': 'Close', onclick: () => closeCard() }, '✕'),
    h('div.jr-head', {}, jeffPortrait(40), h('div', {}, h('b', {}, 'Jeff · Router'), h('span.jr-dim', {}, `${jeffName(s.status)} · staff, not an agent`)), statusPill(s.status)),
    h('p.jr-today', {}, todayLine(s)),
    h(
      'ul.jr-kinds',
      {},
      ...s.kinds.map((k) => {
        const r = rateOf(k);
        return h('li', {}, h('span', {}, KIND_LABEL[k.kind]), h('span.jr-mode', {}, k.mode), h('b', {}, r === undefined ? '–' : `${Math.round(r * 100)}% agree`), h('span.jr-dim', {}, ` · ${k.total} judged`));
      }),
    ),
    h('a.jr-link', { href: link }, '📊 His judgements on the Analysis tab'),
  );
}
