// Agent profiles' seam made from a Roster and its floors: what the service reads of each seat and asks the
// roster to do (bench, hire, name a seat), and the hooks the roster calls back (RosterDeps.profiles). The
// office's wiring (index.ts) and the tests (a Roster on fake floors) both use it, so the tests drive the real path.

import { ROLES, type RoleId } from '../../shared/roster/roles.js';
import type { AuditInput } from '../../shared/audit.js';
import type { Roster } from '../roster/index.js';
import { everHired } from '../roster/store.js';
import { hireHoldOf } from '../project-run/store.js';
import type { ProfileHooks, TeamFloor } from '../roster/types.js';
import type { ProfileDeps, ProfileService, SeatState } from './service.js';

export function rosterProfileDeps(o: { dataDir: string; roster: () => Roster; floors: () => TeamFloor[]; audit: (e: AuditInput) => void; now: () => number }): ProfileDeps {
  const floor = (id: string) => o.floors().find((f) => f.id === id);
  const seat = (id: string, role: RoleId): SeatState | undefined => {
    const f = floor(id);
    if (!f) return undefined;
    const m = o.roster().data(id).members[role];
    if (!m) return undefined;
    // A worker id the floor no longer has (it went home) doesn't count as a session.
    const workerId = m.workerId && f.worker(m.workerId) ? m.workerId : undefined;
    return { name: m.name, phase: m.phase, ...(workerId ? { workerId } : {}), everHired: everHired(m), ...(m.hiredAt !== undefined ? { hiredAt: m.hiredAt } : {}) };
  };
  return {
    dataDir: o.dataDir,
    floors: () => o.floors().map((f) => ({ id: f.id, name: f.name })),
    seat,
    seats: (id) => ROLES.map((r) => ({ role: r.id, ...seat(id, r.id)! })).filter((s) => s.name !== undefined),
    namesOn: (id) => {
      const d = o.roster().data(id);
      return [...ROLES.map((r) => d.members[r.id].name), ...Object.values(d.subagentNames)];
    },
    nameSeat: (id, role, name) => {
      const f = floor(id);
      if (f) o.roster().members.setName(f, role, name);
    },
    renameSeat: (id, role, name, by) => {
      const f = floor(id);
      return f ? o.roster().members.rename(f, role, name, by) : 'No such project';
    },
    bench: (id, role, by) => {
      const f = floor(id);
      return f ? o.roster().members.bench(f, role, by) : 'No such project';
    },
    hire: async (id, role, by, owner, task, model) => {
      const f = floor(id);
      return f ? o.roster().members.hire(f, role, by, owner, task, model) : 'No such project';
    },
    hireHeld: (id) => o.roster().pauseOf(o.roster().data(id)) ?? hireHoldOf(id),
    toast: (id, text, level) => floor(id)?.toast(text, level),
    audit: o.audit,
    now: o.now,
  };
}

/** The hooks the roster calls (RosterDeps.profiles), each going to the service only when it's asked. */
export function profileHooks(service: () => ProfileService): ProfileHooks {
  return {
    beforeHire: (f, r) => service().beforeHire(f, r),
    hired: (f, r, w) => service().hired(f, r, w),
    renaming: (f, r, n) => service().renaming(f, r, n),
    renamed: (f, r, n, by) => service().renamed(f, r, n, by),
    profileOf: (f, r) => service().profileOf(f, r),
    touched: (f) => service().touched(f),
  };
}
