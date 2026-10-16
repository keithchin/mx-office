// Agent profiles' service (Portfolios Phase 2): the roster's hooks (a profile minted at a seat's first hire,
// names unique office-wide for new hires, renames kept in step, the one profile line a hire may get, hires
// refused while a move holds the seat), the migration of existing seats, the pages' view, renames, the
// owner's notes and what a removed project leaves. Hire from your agents and Move are moves.ts.
// Behind ProfileDeps (index.ts builds it from the real roster; the tests from a Roster on fake floors).

import { cleanName, type RoleId } from '../../shared/roster/roles.js';
import type { AuditInput } from '../../shared/audit.js';
import { duplicateNames, freshName, isOpenMove, labelOf, mintProfileId, profileLine, seatKey, type Assignment, type MoveOp, type Profile, type ProfilesView, type ProfileView, type ProfileWhere, type SeatRef } from '../../shared/profiles.js';
import { addWorker, ProfileStore } from './store.js';
import { ProfileNotes } from './notes.js';
import { planMigration, type FloorFact } from './migrate.js';
import { Moves } from './moves.js';

export type SeatPhase = 'none' | 'active' | 'benching' | 'benched';
export interface SeatState {
  name: string;
  phase: SeatPhase;
  workerId?: string;
  everHired: boolean;
  hiredAt?: number;
}

export interface ProfileDeps {
  dataDir: string;
  /** The office's projects: floor id and name. */
  floors(): { id: string; name: string }[];
  seat(floor: string, role: RoleId): SeatState | undefined;
  /** Every role of a floor, with its seat (for the migration). */
  seats(floor: string): (SeatState & { role: RoleId })[];
  /** Every name on the floor's team: the members' and the subagents'. */
  namesOn(floor: string): string[];
  /** Sets a seat's name (and its live worker's), without the roster's own checks. */
  nameSeat(floor: string, role: RoleId, name: string): void;
  /** The roster's rename (per-floor checks, the worker too); it calls back renaming/renamed. */
  renameSeat(floor: string, role: RoleId, name: string, by: string): string | undefined;
  bench(floor: string, role: RoleId, by: string): string | undefined;
  /** Why the project hires nobody now (its spend cap, or it's paused), checked before a move benches anyone. */
  hireHeld?(floor: string): string | undefined;
  hire(floor: string, role: RoleId, by: string, owner?: string, task?: string): Promise<string | undefined>;
  toast?(floor: string, text: string, level?: 'info' | 'warn'): void;
  audit(e: AuditInput): void;
  now(): number;
}

/** A seat is busy when it has a worker, or is mid-hire or mid-bench. */
export const seatBusy = (s: SeatState | undefined) => !!s && (!!s.workerId || s.phase === 'active' || s.phase === 'benching');

export class ProfileService {
  readonly store: ProfileStore;
  readonly notes: ProfileNotes;
  readonly moves: Moves;
  private migrated?: Promise<number>;

  constructor(readonly deps: ProfileDeps) {
    this.store = new ProfileStore(deps.dataDir);
    this.notes = new ProfileNotes(deps.dataDir);
    this.moves = new Moves(this);
  }

  projectName(floor: string): string {
    return this.deps.floors().find((f) => f.id === floor)?.name ?? floor;
  }

  // ---- Migration and start ------------------------------------------------------------------------

  /** Once per office: every ever-hired seat without a profile gets one (migrate.ts). How many were minted. */
  migrate(): Promise<number> {
    this.migrated ??= (async () => {
      await this.store.load();
      const facts: FloorFact[] = this.deps.floors().map((f) => ({ id: f.id, name: f.name, seats: this.deps.seats(f.id).map((s) => ({ role: s.role, name: s.name, everHired: s.everHired, hiredAt: s.hiredAt, workerId: s.workerId })) }));
      const plan = planMigration(facts, this.store.data, this.deps.now());
      if (!Object.keys(plan.seats).length) return 0;
      await this.store.change((f) => {
        f.profiles.push(...plan.profiles);
        Object.assign(f.seats, plan.seats);
      });
      if (plan.profiles.length) this.deps.audit({ actor: { kind: 'office', name: 'The office' }, action: 'profile.migrate', summary: `Gave ${plan.profiles.length} existing team member${plan.profiles.length === 1 ? '' : 's'} a profile of their own`, details: { profiles: plan.profiles.length } });
      return plan.profiles.length;
    })();
    return this.migrated;
  }

  /** The start: the migration, then what a restart left of a move (moves.ts). */
  async start(): Promise<void> {
    await this.migrate();
    await this.moves.reconcile();
  }

  // ---- The roster's hooks -------------------------------------------------------------------------

  /** The profile a seat points at (the Team tab's 👤 Profile); undefined before the store is read. */
  profileOf(floor: string, role: string): string | undefined {
    return this.store.ready ? this.store.ofSeat(floor, role)?.id : undefined;
  }

  /**
   * Before any hire of a seat: refused while a move holds it (its source or its destination) unless the
   * move is the one hiring; a seat about to mint a new profile whose name another profile has is renamed
   * to a free one first; and the one line its first message may get (a count of other projects, S02).
   */
  async beforeHire(floor: string, role: RoleId): Promise<{ refuse?: string; line?: string }> {
    await this.store.load();
    const held = this.moves.holding(floor, role);
    if (held) return { refuse: held };
    const p = this.store.ofSeat(floor, role);
    if (!p) {
      const s = this.deps.seat(floor, role);
      // Only a seat with no session (a live worker keeps its name until the migration gives it a profile).
      if (s && !s.workerId && this.nameTaken(s.name)) {
        const name = freshName([...this.store.data.profiles.map((x) => x.displayName), ...this.deps.namesOn(floor)]);
        this.deps.nameSeat(floor, role, name);
        this.deps.toast?.(floor, `Another agent in this office is called ${s.name}, so this ${role} seat is now ${name}`);
      }
      return {};
    }
    const others = new Set(p.assignments.filter((a) => a.floor !== floor).map((a) => a.floor)).size;
    const line = profileLine(others);
    return line ? { line } : {};
  }

  /** A seat was hired: its profile (minted now if it has none) records the worker under its open assignment. */
  hired(floor: string, role: RoleId, workerId: string): void {
    const now = this.deps.now();
    const reason = this.moves.reasonFor(floor, role);
    void this.store
      .change((f) => {
        const key = seatKey(floor, role);
        let p = f.seats[key] ? f.profiles.find((x) => x.id === f.seats[key]) : undefined;
        if (!p) {
          const s = this.deps.seat(floor, role);
          p = { id: mintProfileId(now), displayName: s?.name ?? role, createdAt: now, createdBy: 'hire', assignments: [] };
          f.profiles.push(p);
          f.seats[key] = p.id;
        }
        let a = openAssignment(p, floor, role);
        if (!a) {
          a = { floor, project: this.projectName(floor), role, start: now, reason, workers: [] };
          p.assignments.push(a);
        }
        addWorker(a, workerId);
      })
      .catch((err: unknown) => console.error(`agent-office: couldn't record the profile of ${floor}/${role}: ${(err as Error)?.message ?? err}`));
  }

  /** Whether another profile (not `except`) has this display name, case-insensitive. */
  nameTaken(name: string, except?: string): Profile | undefined {
    const k = name.toLowerCase();
    return this.store.data.profiles.find((p) => p.id !== except && p.displayName.toLowerCase() === k);
  }

  /** The Team tab's rename of a seat: refused when another agent in the office has the name. */
  renaming(floor: string, role: RoleId, name: string): string | undefined {
    const mine = this.store.ofSeat(floor, role)?.id;
    const other = this.nameTaken(name, mine);
    return other ? `Another agent in this office is already called ${other.displayName}: names are kept unique across projects` : undefined;
  }

  /** A seat was renamed: its profile's display name follows. */
  renamed(floor: string, role: RoleId, name: string, by = 'The Project Manager'): void {
    const p = this.store.ofSeat(floor, role);
    if (!p || p.displayName === name) return;
    const was = p.displayName;
    // In memory at once (a second rename hears the first), on disk on the store's chain.
    p.displayName = name;
    void this.store.change(() => undefined).catch(() => undefined);
    this.deps.audit({ actor: { kind: 'human', name: by }, action: 'profile.rename', target: { kind: 'profile', id: p.id, label: name }, summary: `Renamed the agent ${was} to ${name}`, details: { profileId: p.id, before: { name: was }, after: { name } } });
  }

  /** The roster saved a floor: a move waiting on its source's bench may go on (moves.ts; nothing when none is open). */
  touched(floor: string): void {
    this.moves.touched(floor);
  }

  // ---- The pages ----------------------------------------------------------------------------------

  async view(admin: boolean): Promise<ProfilesView> {
    await this.store.load();
    const notes = admin ? await this.notes.load() : {};
    const d = this.store.data;
    const dupes = duplicateNames(d.profiles);
    const seatOf = new Map<string, SeatRef>();
    for (const [k, v] of Object.entries(d.seats)) {
      if (!v) continue;
      const i = k.lastIndexOf('|');
      seatOf.set(v, { floor: k.slice(0, i), role: k.slice(i + 1) as RoleId });
    }
    const moveOf = new Map<string, MoveOp>();
    for (const m of d.moves) if (isOpenMove(m)) moveOf.set(m.profileId, m);
    const names = new Map(this.deps.floors().map((f) => [f.id, f.name]));
    const profiles = d.profiles.map((p): ProfileView => {
      const move = moveOf.get(p.id);
      const seat = seatOf.get(p.id);
      let where: ProfileWhere = { kind: 'free' };
      if (move && move.state !== 'failed') where = { kind: 'moving', floor: move.to.floor, project: names.get(move.to.floor) ?? move.to.floor, role: move.to.role };
      else if (seat) where = { kind: seatBusy(this.deps.seat(seat.floor, seat.role)) ? 'working' : 'benched', floor: seat.floor, project: names.get(seat.floor) ?? seat.floor, role: seat.role };
      const n = notes[p.id];
      return { ...p, label: labelOf(p, dupes), roles: [...new Set(p.assignments.map((a) => a.role))], where, projects: new Set(p.assignments.map((a) => a.floor)).size, ...(n ? { notes: n } : {}), ...(move ? { move } : {}) };
    });
    return { profiles, admin };
  }

  /** A new display name from the Agents page: the seat and its worker follow when it's linked to one. */
  async rename(id: string, raw: unknown, by: string): Promise<string | undefined> {
    await this.store.load();
    const p = this.store.get(id);
    if (!p) return 'No such agent';
    const name = cleanName(raw);
    if (!name) return 'Give it a name (up to 24 characters)';
    if (name === p.displayName) return undefined;
    const other = this.nameTaken(name, id);
    if (other) return `Another agent in this office is already called ${other.displayName}`;
    const seat = this.store.seatOf(id);
    if (seat && this.deps.floors().some((f) => f.id === seat.floor)) {
      const err = this.deps.renameSeat(seat.floor, seat.role, name, by);
      if (err) return err;
      // The roster's rename calls renamed() for a linked seat; make sure of it.
      if (p.displayName !== name) this.renamed(seat.floor, seat.role, name, by);
      return undefined;
    }
    const was = p.displayName;
    await this.store.change(() => void (p.displayName = name));
    this.deps.audit({ actor: { kind: 'human', name: by }, action: 'profile.rename', target: { kind: 'profile', id, label: name }, summary: `Renamed the agent ${was} to ${name}`, details: { profileId: id, before: { name: was }, after: { name } } });
    return undefined;
  }

  /** The owner's notes on a profile (never given to an agent); the text isn't logged, only its length. */
  async setNotes(id: string, text: string, by: string): Promise<string | undefined> {
    await this.store.load();
    const p = this.store.get(id);
    if (!p) return 'No such agent';
    await this.notes.set(id, text, by, this.deps.now());
    this.deps.audit({ actor: { kind: 'human', name: by }, action: 'profile.notes', target: { kind: 'profile', id, label: p.displayName }, summary: `${text.trim() ? 'Updated' : 'Cleared'} the notes on the agent ${p.displayName}`, details: { profileId: id, length: text.trim().length } });
    return undefined;
  }

  /** A project was removed: its seats let go, open assignments end (project, role and dates kept), moves touching it cancelled. */
  forgetFloor(floor: string): Promise<void> {
    const now = this.deps.now();
    return this.store
      .change((f) => {
        for (const k of Object.keys(f.seats)) if (k.slice(0, k.lastIndexOf('|')) === floor) delete f.seats[k];
        for (const p of f.profiles) for (const a of p.assignments) if (a.floor === floor && a.end === undefined) Object.assign(a, { end: now, ended: 'project-removed' as const });
        for (const m of f.moves) if (isOpenMove(m) && (m.to.floor === floor || m.from?.floor === floor)) Object.assign(m, { state: 'cancelled' as const, error: 'The project was removed', updatedAt: now });
      })
      .catch(() => undefined);
  }
}

/** The profile's assignment on this seat that hasn't ended, if any. */
export function openAssignment(p: Profile, floor: string, role: string): Assignment | undefined {
  for (let i = p.assignments.length - 1; i >= 0; i--) {
    const a = p.assignments[i];
    if (a.floor === floor && a.role === role && a.end === undefined) return a;
  }
  return undefined;
}
