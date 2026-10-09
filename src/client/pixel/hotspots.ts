// What you can point at in the 2D view's office that isn't a person or a desk (pixel.ts): the boards
// on the north wall, the elevator, the whiteboard, the meeting table, the TV and the services board,
// the bookshelf, the board agents' kiosks, and the things that only say what they are from here (the
// jukebox, the arcade, the coffee machine, the machine's monitor, the gong). Each is a box in art
// pixels, what its hover card says, and what clicking it does, if anything.

import { BOARDS, BOOKSHELF, CABINET, ELEVATOR, FLOOR, GONG, JUKEBOX, MACHINE_MONITOR, MEETING_TABLE, STATIONS, TV, WHITEBOARD, KIOSK, type StationKind } from '../../shared/layout';
import { FACE, LIFT, PPM, ax, az, type Frame } from './frame';
import { KITCHEN } from './props';
import { signAnchor, zoneBoxes } from './zones';
import type { TeamId } from '../../shared/roster/roles';

export interface Hotspot {
  id: string;
  title: string;
  /** A line under the title on its hover card, worked out when it's shown. */
  sub: () => string;
  /** What clicking does, in a few words; none when there's nothing to do from here. */
  action?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  run?: () => void;
  /** A count on a badge over it (open issues, PRs, tasks waiting). */
  badge?: () => number;
}

export interface HotspotActions {
  board(kind: 'issues' | 'pulls'): void;
  queue(): void;
  whiteboard(): void;
  meeting(): void;
  floors(): void;
  services(): void;
  docs(): void;
  station(kind: StationKind, deskId: string): void;
  /** Whether a board agent is hired at `deskId` (it's then a worker to click instead). */
  hired(deskId: string): boolean;
  counts(): { issues: number; pulls: number; queue: number; services: number };
  /** Each team's patch, for its signpost's hover card. */
  zones(): { team: TeamId; title: string; sub: () => string }[];
  /** What each says about itself, from the floor's state. */
  say: { jukebox(): string; machine(): string; whiteboard(): string; meeting(): string };
}

export function hotspots(f: Frame, a: HotspotActions): Hotspot[] {
  const north = az(f, FLOOR.minZ);
  const east = ax(f, FLOOR.maxX);
  const out: Hotspot[] = [];
  const board = (id: 'issues' | 'queue' | 'pulls', title: string, sub: string, run: () => void, badge: () => number) => {
    const b = BOARDS[id];
    const w = Math.round(b.width * PPM) - 10;
    out.push({ id, title, sub: () => sub, action: 'Open it', x: ax(f, b.x) - (w >> 1), y: north - FACE + 6, w, h: FACE - 12, run, badge });
  };
  board('issues', '📌 Issues', "The project's GitHub issues", () => a.board('issues'), () => a.counts().issues);
  board('queue', '📋 Task queue', 'Issues and tasks waiting for the next free agent', a.queue, () => a.counts().queue);
  board('pulls', '🔀 Pull requests', "The project's open PRs", () => a.board('pulls'), () => a.counts().pulls);

  const ew = Math.round(ELEVATOR.doorWidth * PPM) + 8;
  out.push({ id: 'elevator', title: '🛗 Elevator', sub: () => 'Every floor of the building', action: 'Pick a floor, or add a project', x: ax(f, ELEVATOR.x) - (ew >> 1), y: north - FACE + 5, w: ew, h: FACE - 5, run: a.floors });

  const ww = Math.round(WHITEBOARD.width * PPM), wh = Math.round((WHITEBOARD.height + WHITEBOARD.bottom) * LIFT);
  out.push({ id: 'whiteboard', title: '📝 Whiteboard', sub: a.say.whiteboard, action: 'Draw on it together', x: ax(f, WHITEBOARD.x) - (ww >> 1), y: az(f, WHITEBOARD.z) - wh, w: ww, h: wh + 1, run: a.whiteboard });

  const tw = Math.round(MEETING_TABLE.width * PPM), td = Math.round(MEETING_TABLE.depth * PPM), th = Math.round(MEETING_TABLE.height * LIFT);
  out.push({ id: 'meeting', title: '🤝 Meeting room', sub: a.say.meeting, action: 'Call a meeting, or see how it’s going', x: ax(f, MEETING_TABLE.x) - (tw >> 1), y: az(f, MEETING_TABLE.z) - (td >> 1) - th, w: tw, h: td + th, run: a.meeting });

  // The TV and the services board, flat on the east wall: a wider box than they're drawn, to hit.
  const slab = (z: number, width: number) => ({ x: east - 12, y: az(f, z) - Math.round((width * PPM) / 2), w: 18, h: Math.round(width * PPM) });
  out.push({ id: 'tv', title: '📺 TV', sub: () => `Shows whoever is sharing their screen · ${a.counts().services} web server${a.counts().services === 1 ? '' : 's'} running`, action: 'The agents’ web servers', ...slab(TV.z, TV.width), run: a.services });
  out.push({ id: 'services', title: '🌐 Services', sub: () => 'Web servers the agents are running', action: 'Open the list', ...slab(BOARDS.services.z, BOARDS.services.width), run: a.services, badge: () => a.counts().services });

  const bw = Math.round(BOOKSHELF.width * PPM);
  out.push({ id: 'bookshelf', title: '📚 Bookshelf', sub: () => "Every Markdown file in the project", action: 'Read the docs', x: ax(f, BOOKSHELF.x) - (bw >> 1), y: az(f, BOOKSHELF.z) - 14, w: bw, h: 18, run: a.docs });

  for (const s of STATIONS) {
    if (!s.station || a.hired(s.id)) continue;
    const kind = s.station;
    const kw = Math.round(KIOSK.width * PPM) + 6;
    out.push({ id: s.id, title: `🙋 ${s.label} agent`, sub: () => 'Nobody hired yet', action: 'Ask it something (that hires it)', x: ax(f, s.x) - (kw >> 1), y: az(f, s.z) - 16, w: kw, h: 20, run: () => a.station(kind, s.id) });
  }

  // Each team's signpost: who leads it, and how they are.
  const zones = a.zones();
  for (const b of zoneBoxes(f)) {
    const z = zones.find((x) => x.team === b.zone.team);
    if (!z) continue;
    const s = signAnchor(b);
    out.push({ id: `zone-${b.zone.team}`, title: z.title, sub: z.sub, x: s.x - 30, y: s.y - s.post - 16, w: 60, h: s.post + 18 });
  }

  // Only what they are, from here.
  const jw = Math.round(JUKEBOX.width * PPM), jd = Math.round(JUKEBOX.depth * PPM);
  out.push({ id: 'jukebox', title: '🎵 Jukebox', sub: a.say.jukebox, x: east - jd - 1, y: az(f, JUKEBOX.z) - (jw >> 1) - 18, w: jd + 1, h: jw + 18 });
  const cw = Math.round(CABINET.width * PPM), cd = Math.round(CABINET.depth * PPM);
  out.push({ id: 'arcade', title: '🕹️ Arcade', sub: () => 'The lounge’s arcade cabinet', x: east - cd - 1, y: az(f, CABINET.z) - (cw >> 1) - 20, w: cd + 1, h: cw + 20 });
  out.push({ id: 'coffee', title: '☕ Coffee machine', sub: () => 'Fresh coffee for the team', x: ax(f, KITCHEN.coffee) - 8, y: az(f, FLOOR.maxZ) - Math.round(KITCHEN.depth * PPM) - 18, w: 16, h: 20 });
  const mh = Math.round(MACHINE_MONITOR.width * PPM);
  out.push({ id: 'machine', title: '🖥️ The office’s machine', sub: a.say.machine, x: ax(f, FLOOR.minX) - 2, y: az(f, MACHINE_MONITOR.z) - (mh >> 1), w: 12, h: mh });
  out.push({ id: 'gong', title: '🔔 Gong', sub: () => 'Rings when a pull request merges', x: ax(f, GONG.x) - 12, y: north - FACE + 6, w: 24, h: 28 });
  return out;
}
