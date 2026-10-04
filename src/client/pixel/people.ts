// The 2D view's desks and the people at them (pixel.ts), drawn over the still office (office.ts)
// every frame: each worker at its desk acting out how it's doing (typing while it works, nodding
// off asleep, a speech bubble when it wants you, a tick when it's done), and the people walking
// about the 3D office where they are. What's nearer you is drawn over what's further away.

import { DESKS, DESK_SIZE, KIOSK, MEETING_SEATS, MEETING_TABLE, STATIONS, BEANBAGS, WING_DESKS, beanbagsOut, deskBuilt, deskSeat, type DeskDef } from '../../shared/layout';
import { isAsleep } from '../../shared/status';
import type { PeerInfo, WorkerInfo } from '../../shared/protocol';
import { C, bubble, check, lookFor, seated, standing, zed, type Pose } from './sprites';
import { LIFT, PPM, ax, az, beanbag, box, rect, type Frame } from './office';

/** Something under the pointer: a worker, someone walking about, or a free desk to hire someone at. */
export interface Spot {
  kind: 'worker' | 'peer' | 'desk';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A name under (or over) someone, drawn sharp at the screen's own size rather than in art pixels. */
export interface Label {
  /** Whose name it is: a worker's id, or a person's. */
  id: string;
  text: string;
  /** Its middle, in art pixels. */
  x: number;
  /** Its top, in art pixels (its bottom when `above`). */
  y: number;
  above: boolean;
  human: boolean;
  status?: string;
}

export interface People {
  spots: Spot[];
  labels: Label[];
}

/** What the scene is drawn from: the floor's workers, who's walking about it, and what the pointer is on. */
export interface Cast {
  workers: Iterable<WorkerInfo>;
  peers: Iterable<PeerInfo>;
  level: number;
  hover: string | null;
}

/** When each worker last changed how it's doing, for the tick that flashes as one finishes. */
const since = new Map<string, { status: string; at: number }>();
/** How long a worker that's just finished flashes its tick. */
const FLASH_MS = 4000;

const DESK_H = Math.round(DESK_SIZE.height * LIFT);
/** Facing away from you (its back to you) at `rotY`, else toward you. Side-on seats face you. */
const poseFor = (rotY: number): Pose => (Math.cos(rotY) > 0.5 ? 'back' : 'front');

export function drawPeople(g: CanvasRenderingContext2D, f: Frame, cast: Cast, now: number): People {
  const out: People = { spots: [], labels: [] };
  const beat = Math.floor(now / 180) % 2;
  const slow = Math.floor(now / 600);
  const byDesk = new Map<string, WorkerInfo>();
  for (const w of cast.workers) {
    byDesk.set(w.deskId, w);
    const seen = since.get(w.id);
    if (!seen || seen.status !== w.status) since.set(w.id, { status: w.status, at: seen ? now : 0 });
  }
  /** Things to draw, nearest last (by where each meets the floor). */
  const queue: { y: number; draw: () => void }[] = [];

  // ---- Desks, each with its laptop and chair, and whoever sits there ----
  const desks = [...DESKS, ...WING_DESKS.filter((d) => deskBuilt(d, f.level))];
  for (const d of desks) {
    const w = byDesk.get(d.id);
    const x0 = ax(f, d.x - DESK_SIZE.width / 2), y0 = az(f, d.z - DESK_SIZE.depth / 2);
    const dw = Math.round(DESK_SIZE.width * PPM), dd = Math.round(DESK_SIZE.depth * PPM);
    const pose = poseFor(d.rotY);
    queue.push({ y: y0 + dd, draw: () => desk(g, x0, y0, dw, dd, pose, w, beat, slow) });
    seat(d, w);
    if (!w) out.spots.push({ kind: 'desk', id: d.id, x: x0, y: y0 - DESK_H, w: dw, h: dd + DESK_H });
  }
  // The bean bags that are out: every one in use, and the next free one once the desks are full.
  const out_ = beanbagsOut((id) => byDesk.has(id), f.level);
  for (const b of BEANBAGS) {
    if (!out_.has(b.id)) continue;
    const w = byDesk.get(b.id);
    const x = ax(f, b.x), y = az(f, b.z);
    queue.push({ y: y - 1, draw: () => beanbag(g, x, y, '#4a6aa0') });
    if (w) person(w, x, y + 1, poseFor(b.rotY), y + 2, false);
    else out.spots.push({ kind: 'desk', id: b.id, x: x - 8, y: y - 7, w: 16, h: 12 });
  }
  // The board agents' kiosks, the agent standing behind each one it's hired.
  for (const s of STATIONS) {
    const w = byDesk.get(s.id);
    const kw = Math.round(KIOSK.width * PPM), kd = Math.round(KIOSK.depth * PPM), kh = Math.round(KIOSK.height * LIFT);
    const x0 = ax(f, s.x) - (kw >> 1), y0 = az(f, s.z) - (kd >> 1);
    queue.push({
      y: y0 + kd,
      draw: () => {
        box(g, x0, y0, kw, kd, kh, C.desk, C.deskFront, C.deskEdge);
        rect(g, x0 + 3, y0 - kh + 2, kw - 6, 3, w ? C.teal : C.screenOff);
      },
    });
    const ay = az(f, s.z - KIOSK.stand);
    if (w) person(w, ax(f, s.x), ay, 'front', ay, true);
  }
  // The meeting room's table, and whoever a meeting has sat round it.
  const tx = ax(f, MEETING_TABLE.x - MEETING_TABLE.width / 2), ty = az(f, MEETING_TABLE.z - MEETING_TABLE.depth / 2);
  const tw = Math.round(MEETING_TABLE.width * PPM), td = Math.round(MEETING_TABLE.depth * PPM);
  queue.push({ y: ty + td, draw: () => box(g, tx, ty, tw, td, DESK_H, C.wood, C.woodDark, '#8f7a63') });
  for (const m of MEETING_SEATS) seat(m, byDesk.get(m.id));

  // ---- People walking about the 3D office, where they are ----
  for (const p of cast.peers) {
    const x = ax(f, p.x), y = az(f, p.z);
    queue.push({
      y,
      draw: () => {
        const look = lookFor(p.id, p.color);
        const pose = Math.cos(p.rotY) > 0.5 ? 'back' : 'front';
        rect(g, x - 4, y - 1, 9, 2, 'rgba(20,34,58,0.18)');
        g.drawImage(standing(look, pose, p.moving, beat), x - 5, y - 18);
        if (cast.hover === p.id) ring(x, y);
      },
    });
    out.spots.push({ kind: 'peer', id: p.id, x: x - 6, y: y - 19, w: 12, h: 20 });
    out.labels.push({ id: p.id, text: p.name, x, y: y + 2, above: false, human: true });
  }

  queue.sort((a, b) => a.y - b.y);
  for (const q of queue) q.draw();
  return out;

  /** A chair at a desk or the meeting table, and the worker in it if there is one. */
  function seat(d: DeskDef, w: WorkerInfo | undefined) {
    const at = deskSeat(d, w ? 0.85 : 0.7);
    const x = ax(f, at.x), y = az(f, at.z);
    const pose = poseFor(d.rotY);
    // The chair's back is behind someone facing you, and in front of someone with their back to you.
    queue.push({ y: pose === 'front' ? y - 6 : y, draw: () => chair(x, y, pose, pose === 'front' || !w) });
    if (w) person(w, x, y, pose, y + 1, false);
  }

  /** A worker: sitting (or standing at a kiosk), acting out how it's doing, with its name and what floats over it. */
  function person(w: WorkerInfo, x: number, y: number, pose: Pose, sortY: number, stands: boolean) {
    const asleep = isAsleep(w.status);
    const how = asleep ? 'asleep' : w.status === 'working' || w.status === 'starting' ? 'typing' : 'still';
    // Asleep, the head sinks a pixel; idle, a slow breath.
    const bob = asleep ? 1 : how === 'still' && slow % 4 === 0 ? 1 : 0;
    // Facing you, it sits up a little higher, so its shoulders and arms show over the desk.
    const top = stands ? y - 18 : y - (pose === 'front' ? 16 : 14) + bob;
    queue.push({
      y: sortY,
      draw: () => {
        const look = lookFor(w.id, w.color);
        if (stands) g.drawImage(standing(look, 'front', false, 0), x - 5, top);
        else g.drawImage(seated(look, pose, how, beat), x - 5, top);
        // Its chair's back, over someone with their back to you.
        if (!stands && pose === 'back') chairBack(x, y);
        if (cast.hover === w.id) ring(x, y);
      },
    });
    // What floats over it goes over everything, so it's never hidden behind a desk.
    queue.push({ y: 1e6, draw: () => float(w, x, top, now) });
    out.spots.push({ kind: 'worker', id: w.id, x: x - 7, y: top - 2, w: 14, h: (stands ? 20 : 16) + 2 });
    out.labels.push(pose === 'front' && !stands ? { id: w.id, text: w.name, x, y: top - 3, above: true, human: false, status: w.status } : { id: w.id, text: w.name, x, y: y + 3, above: false, human: false, status: w.status });
  }

  /** A desk, the laptop on it open toward whoever sits there (or shut, with nobody there). */
  function desk(g: CanvasRenderingContext2D, x0: number, y0: number, dw: number, dd: number, pose: Pose, w: WorkerInfo | undefined, beat: number, slow: number) {
    rect(g, x0 + 1, y0 + dd, dw - 1, 2, 'rgba(20,34,58,0.14)');
    box(g, x0, y0, dw, dd, DESK_H, C.desk, C.deskFront, C.deskEdge);
    rect(g, x0, y0 - DESK_H, dw, 1, '#ffffff');
    const lw = 12, lx = x0 + ((dw - lw) >> 1);
    // The laptop sits on the half of the desk nearest its chair.
    const near = pose === 'front' ? y0 - DESK_H + 3 : y0 - DESK_H + dd - 8;
    if (!w) {
      rect(g, lx, near + 1, lw, 5, C.laptop);
      rect(g, lx, near + 1, lw, 1, '#56637a');
      return;
    }
    if (pose === 'back') {
      // Its screen is toward you: what it's doing shows on it.
      rect(g, lx, near + 3, lw, 4, '#9aa5b4');
      rect(g, lx - 1, near - 6, lw + 2, 9, C.laptopEdge);
      screen(lx, near - 5, lw, 7, w, beat, slow);
    } else {
      // Its screen faces the worker, so you see the back of the lid, and its light.
      rect(g, lx, near, lw, 4, '#9aa5b4');
      rect(g, lx - 1, near + 1, lw + 2, 8, C.laptop);
      rect(g, lx - 1, near + 1, lw + 2, 1, '#56637a');
      rect(g, lx + (lw >> 1) - 1, near + 4, 2, 2, isAsleep(w.status) ? '#56637a' : statusColor(w.status));
      // Its hands on the keys, behind the lid, the other one each beat.
      if (w.status === 'working' || w.status === 'starting') {
        const skin = lookFor(w.id, w.color).skin;
        rect(g, lx + 1, near - 1 - (beat ? 1 : 0), 3, 2, skin);
        rect(g, lx + lw - 4, near - 1 - (beat ? 0 : 1), 3, 2, skin);
      }
    }
  }

  /** A laptop's screen, as it's doing: code scrolling while it works, a blinking cursor while it starts, dark asleep. */
  function screen(x: number, y: number, sw: number, sh: number, w: WorkerInfo, beat: number, slow: number) {
    if (isAsleep(w.status)) return rect(g, x, y, sw, sh, C.screenOff);
    const shell = w.kind === 'shell';
    const tint = w.status === 'needs_input' ? '#3a2c12' : w.status === 'done' ? '#123426' : shell ? '#0b1210' : C.screen;
    const ink = w.status === 'needs_input' ? C.amber : w.status === 'done' ? C.green : shell ? '#7ee08a' : C.tealLight;
    rect(g, x, y, sw, sh, tint);
    if (w.status === 'starting') return void (beat && rect(g, x + 2, y + 2, 2, 1, ink));
    const lines = w.status === 'working' ? 3 : 2;
    for (let i = 0; i < lines; i++) {
      const n = w.status === 'working' ? (slow + i * 3) % 5 : i;
      rect(g, x + 1 + (n % 2), y + 1 + i * 2, 3 + ((n * 5) % 7), 1, ink);
    }
    if (w.status === 'needs_input' && beat) rect(g, x + sw - 3, y + sh - 2, 2, 1, ink);
  }

  /** A chair from above: the seat, and its back when that's behind whoever sits there (or nobody does). */
  function chair(x: number, y: number, pose: Pose, withBack: boolean) {
    rect(g, x - 4, y - 1, 9, 2, 'rgba(20,34,58,0.16)');
    rect(g, x - 4, y - 5, 9, 5, C.chairTop);
    rect(g, x - 4, y - 1, 9, 1, C.chair);
    if (!withBack) return;
    if (pose === 'front') {
      rect(g, x - 5, y - 13, 11, 7, C.chair);
      rect(g, x - 5, y - 13, 11, 1, C.chairTop);
    } else chairBack(x, y);
  }

  function chairBack(x: number, y: number) {
    rect(g, x - 5, y - 4, 11, 5, C.chair);
    rect(g, x - 5, y - 4, 11, 1, C.chairTop);
  }

  /** A teal ring on the floor under what the pointer's on. */
  function ring(x: number, y: number) {
    rect(g, x - 7, y + 2, 15, 1, C.teal);
    rect(g, x - 8, y + 1, 1, 1, C.teal);
    rect(g, x + 8, y + 1, 1, 1, C.teal);
  }

  /** Over a worker's head: a bubble when it wants you, a tick as it finishes, z's while it sleeps. */
  function float(w: WorkerInfo, x: number, top: number, now: number) {
    // Beside the head, clear of the name over it.
    const hx = x + 6, hy = top - 2;
    if (w.status === 'needs_input') {
      // A permission it's asking for gets a !, a question a ?.
      const mark = /permission/i.test(w.activity ?? '') ? '!' : '?';
      g.drawImage(bubble(mark), hx, hy - (Math.floor(now / 400) % 2));
    } else if (w.status === 'done') {
      const s = since.get(w.id);
      const fresh = s && s.at && now - s.at < FLASH_MS;
      // Just finished: it flashes; after that it stays, quietly, until someone looks.
      if (!fresh || Math.floor(now / 250) % 2 === 0) g.drawImage(check(), hx, hy + 3 - (fresh ? 1 : 0));
    } else if (isAsleep(w.status)) {
      const t = (now / 1400) % 1;
      g.globalAlpha = 1 - t;
      g.drawImage(zed(), Math.round(hx + t * 3), Math.round(hy + 4 - t * 8));
      g.globalAlpha = 1;
    }
  }
}

/** The light a worker's laptop shows for how it's doing. */
function statusColor(status: string): string {
  return status === 'needs_input' ? C.amber : status === 'done' ? C.green : status === 'working' ? C.tealLight : '#8fa3bf';
}
