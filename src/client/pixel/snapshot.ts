// One floor drawn from what's known of it, rather than from the floor you're on: its plan, its workers
// and its team (shared/overview.ts). The home page's overview keeps one of these per floor and puts
// them side by side; each paints its scene into an art canvas of its own (scene.ts), the same art as
// the 2D view's, and its signposts, Jeff's sign and the names go on after at the screen's size.

import type { Theme, WorkerInfo } from '../../shared/protocol';
import type { OverviewFloor, OverviewMember, OverviewWorker } from '../../shared/overview';
import type { ColorTheme } from '../ui/colortheme';
import { drawOffice } from './office';
import { frameFor, type Frame } from './frame';
import { deskSigns, type DeskSign } from './props';
import { paintScene } from './scene';
import { benchedLeads, signLine, teamLookup, type TeamLookup } from './teams';
import type { BreakLead } from './breaks';
import type { Helper } from './helpers';
import { Walks } from './helper-life';
import { asHelpers } from './subagents';
import type { People } from './people';
import { drawLabels, zoneBanner, type Box, type View } from './overlay';
import { zoneBoxes } from './zones';
import { routerOverlay } from './router-room';

/** An overview worker as the drawing takes one (it reads only how it's doing, its desk and its name). */
export function asWorker(w: OverviewWorker): WorkerInfo {
  return { id: w.id, kind: w.kind, name: w.name, color: w.color, status: w.status, deskId: w.deskId, acked: w.acked, title: w.task, activity: w.now, createdBy: '', createdAt: 0, cols: 0, rows: 0, viewers: [], viewerIds: [] };
}

const MEMBER_STATUS: Record<OverviewMember['status'], string> = { 'not-hired': 'not hired', working: 'working', 'needs-you': 'needs you', idle: 'idle', asleep: 'asleep', benching: 'writing handoff', benched: 'benched' };

export class FloorArt {
  readonly art = document.createElement('canvas');
  readonly buffer = document.createElement('canvas');
  private readonly ag = this.art.getContext('2d')!;
  frame: Frame = frameFor(0);
  private still: HTMLCanvasElement | null = null;
  private stillFor = '';
  private signs: DeskSign[] = [];
  private workers: WorkerInfo[] = [];
  team: TeamLookup<OverviewMember> = teamLookup([]);
  /** Its benched Leads, on a break about the office (breaks.ts). */
  leads: BreakLead[] = [];
  /** Its Leads' subagents that have run: at work beside their desks, else about the office (helpers.ts). */
  helpers: Helper[] = [];
  private readonly walks = new Walks();
  people: People = { spots: [], labels: [] };

  constructor(public floor: OverviewFloor, theme: Theme | null = null) {
    this.update(floor, theme);
  }

  /** New data for the floor: the still office is drawn again only when its plan (or the holiday) changed. */
  update(floor: OverviewFloor, theme: Theme | null = null) {
    this.floor = floor;
    const key = `${floor.plan.wing}|${theme}`;
    if (key !== this.stillFor) {
      this.stillFor = key;
      this.frame = frameFor(floor.plan.wing);
      this.still = drawOffice(this.frame, theme);
      this.art.width = this.frame.width;
      this.art.height = this.frame.height;
    }
    this.signs = deskSigns(this.frame, floor.plan);
    this.workers = floor.workers.map(asWorker);
    this.team = teamLookup(floor.members);
    this.leads = benchedLeads(floor.members, floor.id);
    this.helpers = asHelpers(floor.helpers ?? [], floor.id);
  }

  /** A frame of the scene, into the art canvas; `hover` is who the pointer's on; `still` keeps the benched Leads from walking. */
  paint(now: number, theme: Theme | null, colorTheme: ColorTheme, hover: string | null, still: boolean) {
    const t = this.team;
    this.people = paintScene(
      this.ag,
      this.frame,
      this.still!,
      { theme, music: false, sharing: false, colorTheme },
      { workers: this.workers, peers: [], level: this.frame.level, hover, dog: null, signs: this.signs, dress: (w) => t.dressFor(w), tag: (w) => t.tagFor(w), breaks: { leads: this.leads, clock: Date.now(), still }, helpers: this.helpers, helperWalks: this.walks },
      now,
    );
  }

  /** The signposts, Jeff's sign and the names over the floor, sharp at the screen's size; how much depends on how big it's drawn. */
  overlay(g: CanvasRenderingContext2D, v: View, hover: string | null, now: number) {
    const zoom = v.scale / v.dpr;
    const banners: Box[] = [];
    if (zoom >= 0.75) {
      for (const b of zoneBoxes(this.frame)) {
        const m = this.team.leadOf(b.zone.team);
        banners.push(zoneBanner(g, v, b, m && signLine(m, b.zone.team, MEMBER_STATUS[m.status]), banners));
      }
      routerOverlay(g, v, this.frame, banners, now);
    }
    drawLabels(g, v, this.people.labels, hover, banners);
  }

  /** The worker or benched Lead at art point (x, y) of this floor, if any (the nearest, drawn last). */
  whoAt(x: number, y: number): { worker: OverviewWorker } | { lead: BreakLead; index: number } | undefined {
    let hit: { kind: string; id: string } | undefined;
    for (const s of this.people.spots) if ((s.kind === 'worker' || s.kind === 'lead') && x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h) hit = s;
    if (!hit) return undefined;
    if (hit.kind === 'lead') {
      const index = this.leads.findIndex((l) => l.id === hit.id);
      return index < 0 ? undefined : { lead: this.leads[index], index };
    }
    const worker = this.floor.workers.find((w) => w.id === hit.id);
    return worker && { worker };
  }
}
