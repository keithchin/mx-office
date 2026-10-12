// Stuck detection wired to the office: the service (service.ts) made once per office from what the office
// already keeps (each floor's PR poll, its folder at main, Testing's records, the budget ledger, the team
// and its escalations), started with the office's clocks (office/timers.ts), read by Needs you on the
// server (notify-teams/gather.ts, so Teams cards and phone pushes follow it) and by GET /api/stuck, and
// the source of the standup page's "Blocked on you" (roster/blocked-on-you.ts).

import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import type { StuckNeed } from '../../shared/needsyou.js';
import { audit } from '../audit/index.js';
import { budgetOf } from '../budget/index.js';
import { managerRole } from '../roster/coverage.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { setBlockedOnYou } from '../roster/blocked-on-you.js';
import { testingStore } from '../testing/index.js';
import { readRepo } from './repo.js';
import { StuckService, type StuckFloor } from './service.js';
import { stuckSettings } from './settings.js';

const services = new WeakMap<object, StuckService>();
const adapters = new WeakMap<Floor, StuckFloor>();

/** A floor as stuck detection reads it. */
export function stuckFloor(floor: Floor): StuckFloor {
  let f = adapters.get(floor);
  if (!f) {
    f = {
      id: floor.id,
      name: floor.def.name,
      dir: floor.dir,
      pulls: () => floor.github.pulls.items,
      working: () => floor.workers.list().some((w) => w.kind === 'agent' && w.status === 'working'),
    };
    adapters.set(floor, f);
  }
  return f;
}

/** The office's stuck detection: made on first use, then the same one. */
export function stuckOf(ctx: Ctx): StuckService {
  let s = services.get(ctx.cfg);
  if (s) return s;
  const floorOf = (f: StuckFloor) => ctx.floors.get(f.id);
  const team = (f: StuckFloor) => {
    const floor = floorOf(f);
    if (!floor) return undefined;
    const roster = rosterOf(ctx);
    const tf = teamFloor(ctx, floor);
    return { roster, tf, d: roster.data(floor.id) };
  };
  s = new StuckService({
    dataDir: ctx.cfg.dataDir,
    floors: () => [...ctx.floors.values()].map(stuckFloor),
    now: () => Date.now(),
    settings: stuckSettings,
    readRepo,
    runs: (id) => testingStore(ctx.cfg.dataDir, id).all(),
    spendSince(f, at) {
      try {
        const days = budgetOf(ctx).file({ id: f.id, name: f.name, dir: f.dir }).ledger.days;
        const from = new Date(at).toISOString().slice(0, 10);
        const spend = Object.entries(days).reduce((n, [day, r]) => (day >= from ? n + (r.cost ?? 0) : n), 0);
        return { spend, currency: 'USD' };
      } catch {
        return undefined;
      }
    },
    lead(f) {
      const t = team(f);
      if (!t) return undefined;
      const m = t.d.members[managerRole(t.d)];
      if (!m || m.phase === 'none') return undefined;
      const w = t.roster.workerOf(t.tf, m);
      return { name: m.name, working: w?.status === 'working' };
    },
    tell(f, text, by, when, owner) {
      const t = team(f);
      return t ? t.roster.interrupts.tell(t.tf, text, by, when, {}, owner) : 'No such project';
    },
    openEscalations(f) {
      const t = team(f);
      return t ? t.roster.escalations.view(t.tf).filter((e) => e.status === 'open') : [];
    },
    record: (e) => audit.record(e),
  });
  services.set(ctx.cfg, s);
  const made = s;
  setBlockedOnYou((floorId) => {
    const floor = ctx.floors.get(floorId);
    return floor ? made.blockedLines(stuckFloor(floor)) : Promise.resolve([]);
  });
  return s;
}

/** What the server's Needs you reads (Teams cards, phone pushes): the floor's visible stuck items. */
export async function stuckNeedOf(ctx: Ctx, floor: Floor): Promise<StuckNeed | undefined> {
  try {
    const v = await stuckOf(ctx).view(stuckFloor(floor), true);
    return v.items.length ? { floor: floor.id, items: v.items } : undefined;
  } catch {
    return undefined;
  }
}

/** Starts the looks; returns what stops them. */
export function startStuckDetection(ctx: Ctx): () => void {
  const s = stuckOf(ctx);
  s.start();
  return () => s.stop();
}
