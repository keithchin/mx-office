// The 2D view's desks and the people at them (pixel.ts), drawn over the still office (office.ts)
// every frame: each worker at its desk acting out how it's doing (typing while it works, nodding
// off asleep, a speech bubble when it wants you, a tick when it's done), dressed for its role on
// the team (teams.ts, chars.ts). What's
// nearer you is drawn over what's further away, so someone behind a desk is hidden by it.

import { DESKS, DESK_SIZE, KIOSK, MEETING_SEATS, MEETING_TABLE, STATIONS, BEANBAGS, WING_DESKS, beanbagsOut, deskBuilt, deskSeat, type DeskDef } from '../../shared/layout';
import { ZONE_OF_DESK } from '../../shared/zones';
import { isAsleep } from '../../shared/status';
import type { WorkerInfo } from '../../shared/protocol';
import { C, bubble, check, zed } from './sprites';
import { lookFor, seated, standing, type Outfit, type Pose } from './chars';
import { blob, oval, rect, solid } from './paint';
import { LIFT, PPM, ax, az, type Frame } from './frame';
import { beanbag } from './office';
import { DESK_H, drawChair, drawChairBack, drawDesk } from './desks';
import { dogAt, drawDog, drawSign, type DeskSign } from './props';
import { waitingOnSomeone } from '../notify';
import type { DogState } from '../../shared/dog';
import { breakAt, breakSpot, drawBreak, type BreakLead } from './breaks';
import { drawHelpers, floorWalks, type Helper } from './helpers';
import type { Walks } from './helper-life';

/** Something under the pointer: a worker, a Lead or a subagent, the dog, or a free desk to hire someone at. */
export interface Spot {
  kind: 'worker' | 'desk' | 'dog' | 'lead' | 'subagent';
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
  /** A second, smaller line: a Lead's role (in its team's colour), or what anyone else is working on. */
  tag?: { text: string; short?: string; color?: string };
  /** Shown whole up to 32 letters rather than 14 (a subagent's "Nia (Hedy's tester)"). */
  long?: boolean;
}

export interface People {
  spots: Spot[];
  labels: Label[];
}

/** What the scene is drawn from: the floor's workers, and what the pointer is on. */
export interface Cast {
  workers: Iterable<WorkerInfo>;
  level: number;
  hover: string | null;
  /** The floor's dog, and when (performance.now()) the leg it's on began. */
  dog: { state: DogState; start: number } | null;
  /** The signs on the desks (see props.ts). */
  signs: DeskSign[];
  /** What a worker wears (its role's outfit in its team's colour, or its own colour), and its name tag's second line. */
  dress: (w: WorkerInfo) => { outfit: Outfit; color: string };
  tag: (w: WorkerInfo) => Label['tag'];
  /** The team's benched Leads, on a break about the office (breaks.ts): at wall-clock `clock`, and not walking when `still`. */
  breaks?: { leads: BreakLead[]; clock: number; still: boolean };
  /** The Leads' subagents that have run: at work on stools behind their Leads' chairs, else about the office (helpers.ts). */
  helpers?: readonly Helper[];
  /** Where each was drawn last, to walk it on from there (helper-life.ts): the 2D view's own floor's unless given. */
  helperWalks?: Walks;
}

/** When each worker last changed how it's doing, for the tick that flashes as one finishes. */
const since = new Map<string, { status: string; at: number }>();
/** How long a worker that's just finished flashes its tick. */
const FLASH_MS = 4000;

/** Facing away from you (its back to you) at `rotY`, else toward you. Side-on seats face you. */
const poseFor = (rotY: number): Pose => (Math.cos(rotY) > 0.5 ? 'back' : 'front');
/** How far above its seat a sitting character's picture starts, facing you or not; standing, above its feet. */
const SIT_FRONT = 29, SIT_BACK = 31, STAND = 33;

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

  // ---- Desks, each with what its team works with and its chair, and whoever sits there ----
  const desks = [...DESKS, ...WING_DESKS.filter((d) => deskBuilt(d, f.level))];
  for (const d of desks) {
    const w = byDesk.get(d.id);
    const x0 = ax(f, d.x - DESK_SIZE.width / 2), y0 = az(f, d.z - DESK_SIZE.depth / 2);
    const dw = Math.round(DESK_SIZE.width * PPM), dd = Math.round(DESK_SIZE.depth * PPM);
    const pose = poseFor(d.rotY);
    const team = ZONE_OF_DESK.get(d.id)?.team ?? null;
    queue.push({ y: y0 + dd, draw: () => drawDesk(g, { x0, y0, dw, dd, pose, team, duck: d.id === 'desk-2', w, beat, slow }) });
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
    if (w) person(w, x, y + 6, poseFor(b.rotY), y + 2, false, false);
    else out.spots.push({ kind: 'desk', id: b.id, x: x - 11, y: y - 9, w: 22, h: 16 });
  }
  // The board agents' kiosks, the agent standing behind each one it's hired.
  for (const s of STATIONS) {
    const w = byDesk.get(s.id);
    const kw = Math.round(KIOSK.width * PPM), kd = Math.round(KIOSK.depth * PPM), kh = Math.round(KIOSK.height * LIFT);
    const x0 = ax(f, s.x) - (kw >> 1), y0 = az(f, s.z) - (kd >> 1);
    queue.push({
      y: y0 + kd,
      draw: () => {
        solid(g, x0, y0, kw, kd, kh, C.desk, C.deskFront, C.deskEdge);
        rect(g, x0 + 3, y0 - kh + 2, kw - 6, 4, w ? C.teal : C.screenOff);
        rect(g, x0 + 3, y0 - kh + 2, kw - 6, 1, 'rgba(255,255,255,0.3)');
      },
    });
    const ay = az(f, s.z - KIOSK.stand);
    if (w) person(w, ax(f, s.x), ay, 'front', ay, true);
  }
  // The meeting room's table, and whoever a meeting has sat round it.
  const tx = ax(f, MEETING_TABLE.x - MEETING_TABLE.width / 2), ty = az(f, MEETING_TABLE.z - MEETING_TABLE.depth / 2);
  const tw = Math.round(MEETING_TABLE.width * PPM), td = Math.round(MEETING_TABLE.depth * PPM);
  queue.push({
    y: ty + td,
    draw: () => {
      solid(g, tx, ty, tw, td, DESK_H, C.wood, C.woodDark, '#8f7a63');
      rect(g, tx, ty - DESK_H, tw, 1, '#e2d2bd');
    },
  });
  for (const m of MEETING_SEATS) seat(m, byDesk.get(m.id));

  // Benched Leads, on a break: the TV, a smoke on the balcony, a coffee (breaks.ts).
  cast.breaks?.leads.forEach((l, i) => {
    const s = breakAt(l.name, i, cast.breaks!.clock, cast.breaks!.still);
    const { x, y, top } = breakSpot(f, s);
    queue.push({ y: y + 1, draw: () => drawBreak(g, f, l, s, now, cast.hover === l.id) });
    out.spots.push({ kind: 'lead', id: l.id, x: x - 11, y: top - 2, w: 22, h: y - top + 4 });
    // The name over their head, clear of the counter, the ashtray or the couch in front of them.
    out.labels.push({ id: l.id, text: l.name, x, y: top - 3, above: true, human: false, tag: { text: '🪑 benched', color: '#9aa7bd' } });
  });

  // The Leads' subagents: at work on a stool behind their Lead's chair, else about the office (helpers.ts).
  if (cast.helpers?.length) {
    const world = { leads: cast.breaks?.leads ?? [], clock: cast.breaks?.clock ?? Date.now(), still: cast.breaks?.still ?? false, walks: cast.helperWalks ?? floorWalks };
    drawHelpers(g, f, cast.helpers, byDesk.values(), now, cast.hover, world, {
      queue: (y, draw) => queue.push({ y, draw }),
      spot: (s) => out.spots.push({ kind: 'subagent', ...s }),
      label: (l) => out.labels.push({ ...l, above: true, human: false, long: true }),
    });
  }

  // The signs stand on their desks' far edges, drawn with the desk they're on.
  for (const s of cast.signs) queue.push({ y: s.y + DESK_H + Math.round((DESK_SIZE.depth * PPM) / 2) + 1, draw: () => drawSign(g, s) });
  // The dog, trotting about between the desks, napping under one, barking at whoever needs you.
  if (cast.dog) {
    const d = cast.dog.state, at = dogAt(d, now - cast.dog.start);
    const x = ax(f, at.x), y = az(f, at.z);
    queue.push({ y, draw: () => drawDog(g, x, y, d, at, now) });
    out.spots.push({ kind: 'dog', id: 'dog', x: x - 8, y: y - 11, w: 16, h: 13 });
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
    queue.push({ y: pose === 'front' ? y - 8 : y, draw: () => drawChair(g, x, y, pose, pose === 'front' || !w) });
    if (w) person(w, x, y, pose, y + 1, false);
  }

  /** A worker: sitting (or standing at a kiosk), acting out how it's doing, with its name and what floats over it. */
  function person(w: WorkerInfo, x: number, y: number, pose: Pose, sortY: number, stands: boolean, chair = true) {
    const asleep = isAsleep(w.status);
    const how = asleep ? 'asleep' : w.status === 'working' || w.status === 'starting' ? 'typing' : 'still';
    // Asleep, the head sinks; idle, a slow breath now and then.
    const bob = asleep ? 1 : how === 'still' && slow % 4 === 0 ? 1 : 0;
    const top = stands ? y - STAND : y - (pose === 'front' ? SIT_FRONT : SIT_BACK) + bob;
    const dress = cast.dress(w);
    queue.push({
      y: sortY,
      draw: () => {
        const look = lookFor(w.id, dress.color, dress.outfit);
        if (waitingOnSomeone(w)) pulse(x, y, w.status === 'needs_input' ? C.amber : C.green);
        if (stands) {
          blob(g, x, y, 8, 2);
          g.drawImage(standing(look, 'front', false, 0), x - 12, top);
        } else g.drawImage(seated(look, pose, how, beat), x - 12, top);
        // Its chair's back, over someone with their back to you.
        if (!stands && chair && pose === 'back') drawChairBack(g, x, y);
        if (cast.hover === w.id) ring(x, y);
      },
    });
    // What floats over it goes over everything, so it's never hidden behind a desk.
    queue.push({ y: 1e6, draw: () => float(w, x, top, now) });
    out.spots.push({ kind: 'worker', id: w.id, x: x - 11, y: top - 2, w: 22, h: (stands ? STAND : pose === 'front' ? 26 : 30) + 2 });
    const tag = cast.tag(w);
    out.labels.push(pose === 'front' && !stands ? { id: w.id, text: w.name, x, y: top - 3, above: true, human: false, status: w.status, tag } : { id: w.id, text: w.name, x, y: y + 4, above: false, human: false, status: w.status, tag });
  }

  /** A ring on the floor that swells and fades, under someone waiting on you. */
  function pulse(x: number, y: number, color: string) {
    const t = (now % 1200) / 1200;
    g.globalAlpha = 0.55 * (1 - t);
    oval(g, x, y + 2, Math.round(9 + t * 9), Math.round(3 + t * 3), color);
    g.globalAlpha = 1;
  }

  /** A teal ring on the floor under what the pointer's on. */
  function ring(x: number, y: number) {
    rect(g, x - 10, y + 3, 21, 1, C.teal);
    rect(g, x - 11, y + 2, 1, 1, C.teal);
    rect(g, x + 11, y + 2, 1, 1, C.teal);
    rect(g, x - 8, y + 4, 17, 1, 'rgba(23,179,163,0.4)');
  }

  /** Over a worker's head: a bubble when it wants you, a tick as it finishes, z's while it sleeps. */
  function float(w: WorkerInfo, x: number, top: number, now: number) {
    // Beside the head, clear of the name over it.
    const hx = x + 8, hy = top - 6;
    if (w.status === 'needs_input') {
      // A permission it's asking for gets a !, a question a ?.
      const mark = /permission/i.test(w.activity ?? '') ? '!' : '?';
      g.drawImage(bubble(mark), hx, hy - (Math.floor(now / 400) % 2));
    } else if (w.status === 'done') {
      const s = since.get(w.id);
      const fresh = s && s.at && now - s.at < FLASH_MS;
      // Just finished: it flashes; after that it stays, quietly, until someone looks.
      if (!fresh || Math.floor(now / 250) % 2 === 0) g.drawImage(check(), hx + 2, hy + 4 - (fresh ? 1 : 0));
    } else if (isAsleep(w.status)) {
      for (let i = 0; i < 2; i++) {
        const t = (now / 1600 + i / 2) % 1;
        g.globalAlpha = 1 - t;
        g.drawImage(zed(), Math.round(hx + 2 + t * 5), Math.round(hy + 8 - t * 12));
      }
      g.globalAlpha = 1;
    }
  }
}
