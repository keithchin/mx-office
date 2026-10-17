// The surfaced asks wired to the office: the service (service.ts) made once per office from what the
// office already keeps (each floor's workers and their worktrees, the team and its escalations, main as
// stuck detection reads it), started with the office's clocks (office/timers.ts), looked at soon after a
// bench, a pause or a turn's end (roster/asks-hook.ts), read by GET /api/asks, and a second source of the
// standup page's "Blocked on you" (roster/blocked-on-you.ts): the lead's standup still on its branch.

import path from 'node:path';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { audit } from '../audit/index.js';
import { managerRole } from '../roster/coverage.js';
import { rosterOf, teamFloor } from '../roster/adapter.js';
import { everHired } from '../roster/store.js';
import { addBlockedOnYou } from '../roster/blocked-on-you.js';
import { setAsksSoon } from '../roster/asks-hook.js';
import { foldOfficeAsk } from '../roster/escalation-fold.js';
import { ROLES, type RoleId, type TeamId } from '../../shared/roster/roles.js';
import { AsksService, type AsksFloor } from './service.js';
import { detectInputOf } from './main.js';
import { decisionsOf } from '../decisions/index.js';
import { escalationsApart } from '../../shared/decisions/duplicates.js';
import type { AskPerson } from './sources.js';

const services = new WeakMap<object, AsksService>();
const adapters = new WeakMap<Floor, AsksFloor>();

/** A floor as the asks service reads it. */
export function asksFloor(ctx: Ctx, floor: Floor): AsksFloor {
  let f = adapters.get(floor);
  if (!f) {
    f = {
      id: floor.id,
      name: floor.def.name,
      dir: floor.dir,
      people() {
        let members: { name: string; role: RoleId; workerId?: string }[] = [];
        try {
          const d = rosterOf(ctx).data(floor.id);
          members = ROLES.map((r) => ({ name: d.members[r.id].name, role: r.id, workerId: d.members[r.id].workerId }));
        } catch {
          // no team: the workers alone
        }
        const out: AskPerson[] = [];
        for (const w of floor.workers.list()) {
          const m = members.find((x) => x.workerId === w.id);
          out.push({ name: m?.name ?? w.name, ...(m ? { role: m.role } : {}), ...(w.worktree && !w.lost ? { dir: path.resolve(floor.dir, w.worktree.path), branch: w.worktree.branch } : {}) });
        }
        return out;
      },
    };
    adapters.set(floor, f);
  }
  return f;
}

/** The office's surfaced asks: made on first use, then the same one. */
export function asksOf(ctx: Ctx): AsksService {
  let s = services.get(ctx.cfg);
  if (s) return s;
  const team = (f: AsksFloor) => {
    const floor = ctx.floors.get(f.id);
    if (!floor) return undefined;
    const roster = rosterOf(ctx);
    return { roster, tf: teamFloor(ctx, floor), d: roster.data(floor.id) };
  };
  s = new AsksService({
    dataDir: ctx.cfg.dataDir,
    floors: () => [...ctx.floors.values()].map((f) => asksFloor(ctx, f)),
    now: () => Date.now(),
    writerOf(f, teamId: TeamId) {
      const t = team(f);
      if (!t) return undefined;
      // Whoever writes that journal: a hired member of that team (its Lead, the Solo Lead), else whoever covers it.
      const role = ROLES.find((r) => r.team === teamId && everHired(t.d.members[r.id]))?.id ?? t.d.coverage[teamId];
      return role ? { role, name: t.d.members[role].name } : undefined;
    },
    escalations(f) {
      const t = team(f);
      return t ? t.d.escalations : [];
    },
    raise(f, role, ask, key) {
      const t = team(f);
      if (!t) return;
      const m = t.d.members[role];
      // An item naming an open or answered escalation (ESC-<id>, its decision id, the same denied command) isn't filed again.
      if (foldOfficeAsk(t.roster, t.tf, { workerId: m.workerId ?? `benched-${role}`, by: m.name, role }, ask, key)) return;
      const e = t.roster.escalations.raiseFor(t.tf, { workerId: m.workerId ?? `benched-${role}`, by: m.name, role }, ask, `📌 ${m.name} is waiting on you (its journal's AWAITING-PM line): ${ask.title}`);
      e.from = { kind: 'awaiting', key };
      t.roster.touch(t.tf);
    },
    continueAsk(f, id, ask, key) {
      const t = team(f);
      if (t) t.roster.escalations.continueAwaiting(t.tf, id, ask, key);
    },
    apart: (f) => decisionsOf(ctx).splits.get(f.id).then(escalationsApart),
    markGone(f, id, what) {
      const t = team(f);
      if (t) t.roster.escalations.markGone(t.tf, id, what);
    },
    detectInput: (f, reads) => detectInputOf(ctx, f, reads),
    lead(f) {
      const t = team(f);
      if (!t) return undefined;
      const m = t.d.members[managerRole(t.d)];
      return m && m.phase !== 'none' ? { name: m.name } : undefined;
    },
    tell(f, text, by, owner) {
      const t = team(f);
      return t ? t.roster.interrupts.tell(t.tf, text, by, 'after', {}, owner, undefined, 'decision') : 'No such project';
    },
    record: (e) => audit.record(e),
  });
  services.set(ctx.cfg, s);
  const made = s;
  setAsksSoon((floorId, why) => made.soon(floorId, why));
  addBlockedOnYou((floorId) => {
    const floor = ctx.floors.get(floorId);
    return floor ? made.blockedLines(asksFloor(ctx, floor)) : Promise.resolve([]);
  });
  return s;
}

/** Starts the looks; returns what stops them. */
export function startAsks(ctx: Ctx): () => void {
  const s = asksOf(ctx);
  s.start();
  return () => {
    s.stop();
    setAsksSoon(undefined);
  };
}
