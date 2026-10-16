// Hire from your agents, and Move when the profile is elsewhere (sequential reuse only; no "on loan").
// Each is a durable operation record in profiles.json (MoveOp), written before each step acts:
//   source-benching (bench asked on the source seat: handoff note, which stays with that project)
//   → dest-hiring (the destination seat renamed and linked tentatively, then hired: a fresh session)
//   → done (the source seat released and renamed for its next hire) | failed (destination put back, the
//   profile still on its benched source seat: Retry or Cancel) | cancelled.
// Never two live sessions: the destination is hired only once the source seat has no worker, and while a
// move is open every hire of its source or destination seat, by any path, is refused (holding()).
// A restart is reconciled from the seats alone (reconcile()).

import { freshName, isOpenMove, mintMoveId, seatKey, type AssignmentReason, type MoveOp, type NeedsMove, type SeatRef } from '../../shared/profiles.js';
import type { RoleId } from '../../shared/roster/roles.js';
import { openAssignment, seatBusy, type ProfileService } from './service.js';
import { addWorker } from './store.js';

export interface HireAsk {
  profileId: string;
  floor: string;
  role: RoleId;
  by: string;
  owner?: string;
  task?: string;
  /** The model for this one hire (the seat keeps its own): the wizard's Discovery task on its Discovery model. */
  model?: string;
  /** The person confirmed the Move (the profile is linked to a seat elsewhere). */
  move?: boolean;
}

export interface HireResult {
  error?: string;
  status?: number;
  needsMove?: NeedsMove;
  op?: MoveOp;
}

const same = (a: SeatRef | undefined, b: SeatRef) => !!a && a.floor === b.floor && a.role === b.role;

export class Moves {
  /** Moves whose destination hire is running now (holding() lets that one hire through). */
  private executing = new Map<string, MoveOp>();
  private advancing = new Set<string>();

  constructor(private s: ProfileService) {}

  private get deps() {
    return this.s.deps;
  }
  private get store() {
    return this.s.store;
  }

  /** Why a hire of this seat is refused now: an open move holds it (unless that move is the one hiring). */
  holding(floor: string, role: string): string | undefined {
    if (this.executing.has(seatKey(floor, role))) return undefined;
    for (const m of this.store.openMoves()) {
      const name = this.store.get(m.profileId)?.displayName ?? 'An agent';
      if (same(m.from, { floor, role: role as RoleId })) return `${name} is moving to ${this.s.projectName(m.to.floor)}: finish or cancel the move first (Home › Agents)`;
      if (same(m.to, { floor, role: role as RoleId })) return `This seat is kept for ${name}, who is moving here: finish or cancel the move first (Home › Agents)`;
    }
    return undefined;
  }

  /** How a hire of this seat started its assignment: by a move here, a reuse, or a plain hire. */
  reasonFor(floor: string, role: string): AssignmentReason {
    const m = this.executing.get(seatKey(floor, role));
    return !m ? 'hired' : m.from ? 'moved-in' : 'reused';
  }

  private audit(m: MoveOp, action: string, summary: string, severity?: 'notice' | 'warning') {
    const floors = [...new Set([m.to.floor, ...(m.from ? [m.from.floor] : [])])];
    for (const floor of floors) this.deps.audit({ floor, actor: { kind: 'human', name: m.by || 'The Project Manager', ...(m.owner ? { id: m.owner } : {}) }, action, target: { kind: 'profile', id: m.profileId, label: this.store.get(m.profileId)?.displayName }, summary, details: { profileId: m.profileId, move: m.id, from: m.from, to: m.to, ...(m.error ? { error: m.error } : {}) }, ...(severity ? { severity } : {}) });
  }

  private where(seat: SeatRef) {
    return `${this.s.projectName(seat.floor)} (${seat.role})`;
  }

  /** Hire a profile on a seat: at once when it's free, a confirmation (needsMove) when it's linked elsewhere, then a move. */
  async hire(ask: HireAsk): Promise<HireResult> {
    await this.store.load();
    const p = this.store.get(ask.profileId);
    if (!p) return { error: 'No such agent', status: 404 };
    const to: SeatRef = { floor: ask.floor, role: ask.role };
    const dest = this.deps.seat(to.floor, to.role);
    if (!dest || !this.deps.floors().some((f) => f.id === to.floor)) return { error: 'No such project or role', status: 404 };
    const open = this.store.openMoves();
    const mine = open.find((m) => m.profileId === p.id);
    if (mine) return { error: `${p.displayName} already has a move under way to ${this.s.projectName(mine.to.floor)}: finish or cancel it first (Home › Agents)`, status: 409 };
    const holds = this.holding(to.floor, to.role);
    if (holds) return { error: holds, status: 409 };
    const from = this.store.seatOf(p.id);
    // Already this seat's agent: a plain hire.
    if (same(from, to)) {
      const err = await this.deps.hire(to.floor, to.role, ask.by, ask.owner, ask.task, ask.model);
      return err ? { error: err, status: 409 } : {};
    }
    if (seatBusy(dest)) return { error: `This project's ${to.role} seat is taken by ${dest.name}: bench them first`, status: 409 };
    // A project that hires nobody now would leave the agent benched at its source for nothing: said before anything happens.
    const held = this.deps.hireHeld?.(to.floor);
    if (held) return { error: `${this.s.projectName(to.floor)} isn't hiring now: ${held}`, status: 409 };
    const clash = this.deps.namesOn(to.floor).some((n) => n.toLowerCase() === p.displayName.toLowerCase() && n !== dest.name);
    if (clash) return { error: `There is already a ${p.displayName} on this project's team: rename one of them first`, status: 409 };
    const src = from ? this.deps.seat(from.floor, from.role) : undefined;
    const active = seatBusy(src);
    if (from && !ask.move) {
      return { status: 409, error: active ? `${p.displayName} is working on ${this.s.projectName(from.floor)}` : `${p.displayName} is benched on ${this.s.projectName(from.floor)}`, needsMove: { profile: p.id, name: p.displayName, from: { ...from, project: this.s.projectName(from.floor), status: active ? 'active' : 'benched' }, to: { ...to, project: this.s.projectName(to.floor) } } };
    }
    const now = this.deps.now();
    const prevId = this.store.data.seats[seatKey(to.floor, to.role)] ?? null;
    const op: MoveOp = { id: mintMoveId(now), profileId: p.id, ...(from ? { from } : {}), to, state: active ? 'source-benching' : 'dest-hiring', at: now, updatedAt: now, by: ask.by, ...(ask.owner ? { owner: ask.owner } : {}), ...(ask.task ? { task: ask.task } : {}), ...(ask.model ? { model: ask.model } : {}), prevDest: { name: dest.name, profileId: prevId } };
    // The intent on disk before anything is asked of either project.
    await this.store.change((f) => void f.moves.push(op));
    if (from) this.audit(op, 'profile.move-started', `Started moving ${p.displayName} from ${this.where(from)} to ${this.where(to)}${active ? ': handoff note there first' : ''}`);
    if (active && from) {
      if (src?.phase !== 'benching') {
        const err = this.deps.bench(from.floor, from.role, ask.by);
        if (err) {
          await this.settle(op, { state: 'cancelled', error: err });
          this.audit(op, 'profile.move-cancelled', `Didn't move ${p.displayName}: ${err}`, 'notice');
          return { error: `Can't move ${p.displayName}: ${err}`, status: 409 };
        }
      }
      this.deps.toast?.(from.floor, `🧳 ${p.displayName} is writing a handoff note, then moves to ${this.s.projectName(to.floor)}`);
      this.deps.toast?.(to.floor, `🧳 ${p.displayName} will join once the handoff note on ${this.s.projectName(from.floor)} is written`);
      return { op };
    }
    return this.destHire(op);
  }

  private settle(op: MoveOp, patch: Partial<MoveOp>): Promise<void> {
    return this.store.change(() => void Object.assign(op, patch, { updatedAt: this.deps.now() }));
  }

  /** The source seat is free: reserve the destination under the profile's name and hire it (a fresh session). */
  private async destHire(op: MoveOp): Promise<HireResult> {
    const key = seatKey(op.to.floor, op.to.role);
    if (this.executing.has(key)) return { op };
    const p = this.store.get(op.profileId);
    if (!p) return { error: 'No such agent', status: 404 };
    if (op.from && seatBusy(this.deps.seat(op.from.floor, op.from.role))) return { error: `${p.displayName} still has a session on ${this.s.projectName(op.from.floor)}`, status: 409 };
    if (seatBusy(this.deps.seat(op.to.floor, op.to.role))) {
      await this.fail(op, 'dest', `The ${op.to.role} seat on ${this.s.projectName(op.to.floor)} was taken meanwhile`);
      return { error: op.error, status: 409, op };
    }
    this.executing.set(key, op);
    try {
      await this.store.change((f) => {
        Object.assign(op, { state: 'dest-hiring', updatedAt: this.deps.now() });
        delete op.stage;
        delete op.error;
        f.seats[key] = p.id;
      });
      this.deps.nameSeat(op.to.floor, op.to.role, p.displayName);
      const err = await this.deps.hire(op.to.floor, op.to.role, op.by, op.owner, op.task, op.model);
      if (err) {
        await this.fail(op, 'dest', err);
        return { error: `${p.displayName} wasn't hired on ${this.s.projectName(op.to.floor)}: ${err}`, status: 409, op };
      }
      await this.finish(op);
      return { op };
    } finally {
      this.executing.delete(key);
    }
  }

  /** The destination is hired: release the source seat, end the assignments it replaces, and say so in both projects. */
  private async finish(op: MoveOp, workerId?: string): Promise<void> {
    const now = this.deps.now();
    const p = this.store.get(op.profileId)!;
    let opened: string | undefined;
    await this.store.change((f) => {
      if (op.from && !same(op.from, op.to)) {
        f.seats[seatKey(op.from.floor, op.from.role)] = null;
        const a = openAssignment(p, op.from.floor, op.from.role);
        if (a) Object.assign(a, { end: now, ended: 'moved' as const });
      }
      const prev = op.prevDest?.profileId && op.prevDest.profileId !== p.id ? f.profiles.find((x) => x.id === op.prevDest!.profileId) : undefined;
      const pa = prev && openAssignment(prev, op.to.floor, op.to.role);
      if (pa) Object.assign(pa, { end: now, ended: 'replaced' as const });
      // The hook (hired) opened the destination's assignment; a reconcile after a restart may have to.
      let a = openAssignment(p, op.to.floor, op.to.role);
      if (!a) {
        a = { floor: op.to.floor, project: this.s.projectName(op.to.floor), role: op.to.role, start: now, reason: op.from ? 'moved-in' : 'reused', workers: [] };
        p.assignments.push(a);
      }
      if (workerId) addWorker(a, workerId);
      // The source project's seat is open for someone new, under a name no other agent in the office has (with the same write).
      if (op.from && !same(op.from, op.to) && this.deps.floors().some((x) => x.id === op.from!.floor)) {
        opened = freshName([...f.profiles.map((x) => x.displayName), ...this.deps.namesOn(op.from.floor)]);
        this.deps.nameSeat(op.from.floor, op.from.role, opened);
      }
      Object.assign(op, { state: 'done', updatedAt: now });
    });
    if (op.from && opened) this.deps.toast?.(op.from.floor, `🧳 ${p.displayName} moved to ${this.s.projectName(op.to.floor)}; the ${op.from.role} seat here is open (its next hire is ${opened}). The handoff note stays here.`);
    if (op.from) this.audit(op, 'profile.move-done', `Moved ${p.displayName} from ${this.where(op.from)} to ${this.where(op.to)}: a fresh session there, nothing carried over`);
    else this.audit(op, 'profile.reuse', `Hired ${p.displayName} from the office's agents as ${op.to.role} on ${this.s.projectName(op.to.floor)}: a fresh session`);
  }

  /** The destination hire didn't happen: put its seat back; the profile stays on its source seat. */
  private async fail(op: MoveOp, stage: 'source' | 'dest', error: string): Promise<void> {
    const key = seatKey(op.to.floor, op.to.role);
    await this.store.change((f) => {
      if (stage === 'dest' && f.seats[key] === op.profileId) f.seats[key] = op.prevDest?.profileId ?? null;
      Object.assign(op, { state: 'failed', stage, error: error.slice(0, 300), updatedAt: this.deps.now() });
    });
    if (stage === 'dest' && op.prevDest && this.deps.floors().some((f) => f.id === op.to.floor)) {
      const s = this.deps.seat(op.to.floor, op.to.role);
      if (s && !seatBusy(s)) this.deps.nameSeat(op.to.floor, op.to.role, op.prevDest.name);
    }
    this.audit(op, 'profile.move-failed', `${this.store.get(op.profileId)?.displayName ?? 'An agent'} wasn't hired on ${this.where(op.to)}: ${error}`, 'warning');
    this.deps.toast?.(op.to.floor, `🧳 ${this.store.get(op.profileId)?.displayName ?? 'The agent'} wasn't hired here: ${error}. Retry or cancel on Home › Agents.`, 'warn');
  }

  /** The roster saved a floor: a move waiting on that floor's bench goes on once the seat has no worker. */
  touched(floor: string): void {
    if (!this.store.ready) return;
    const open = this.store.data.moves;
    if (!open.length) return;
    for (const m of open) {
      if (m.state !== 'source-benching' || m.from?.floor !== floor || this.advancing.has(m.id)) continue;
      const s = this.deps.seat(m.from.floor, m.from.role);
      if (seatBusy(s)) continue;
      this.advancing.add(m.id);
      void this.destHire(m)
        .catch((err: unknown) => this.fail(m, 'dest', (err as Error)?.message ?? String(err)))
        .finally(() => this.advancing.delete(m.id));
    }
  }

  async retry(id: string, by: string): Promise<HireResult> {
    await this.store.load();
    const op = this.store.data.moves.find((m) => m.id === id);
    if (!op || op.state !== 'failed') return { error: 'That move isn’t waiting for a retry', status: 409 };
    op.by = by || op.by;
    if (op.from && seatBusy(this.deps.seat(op.from.floor, op.from.role))) {
      const src = this.deps.seat(op.from.floor, op.from.role)!;
      if (src.phase !== 'benching') {
        const err = this.deps.bench(op.from.floor, op.from.role, by);
        if (err) return { error: `Can't bench ${this.store.get(op.profileId)?.displayName}: ${err}`, status: 409 };
      }
      await this.settle(op, { state: 'source-benching', stage: undefined, error: undefined });
      return { op };
    }
    return this.destHire(op);
  }

  async cancel(id: string, by: string): Promise<HireResult> {
    await this.store.load();
    const op = this.store.data.moves.find((m) => m.id === id);
    if (!op || !isOpenMove(op)) return { error: 'That move is already settled', status: 409 };
    if (op.state === 'dest-hiring') return { error: 'The hire is running now: wait a moment', status: 409 };
    await this.settle(op, { state: 'cancelled', error: `Cancelled by ${by}` });
    this.audit(op, 'profile.move-cancelled', `Cancelled moving ${this.store.get(op.profileId)?.displayName}: it stays on ${op.from ? this.where(op.from) : 'no project'}`, 'notice');
    return { op };
  }

  /** What a restart left: settled from the seats alone, never by hiring twice. */
  async reconcile(): Promise<void> {
    await this.store.load();
    const known = new Set(this.deps.floors().map((f) => f.id));
    for (const op of this.store.openMoves()) {
      if (!known.has(op.to.floor) || (op.from && !known.has(op.from.floor))) {
        await this.settle(op, { state: 'cancelled', error: 'The project is gone' });
        continue;
      }
      if (op.state === 'source-benching') {
        const src = op.from && this.deps.seat(op.from.floor, op.from.role);
        if (!src || !seatBusy(src)) await this.destHire(op).catch(() => undefined);
        else if (src.phase !== 'benching') await this.fail(op, 'source', `The bench on ${this.s.projectName(op.from!.floor)} didn't finish (the office restarted?)`);
      } else if (op.state === 'dest-hiring' && !this.executing.has(seatKey(op.to.floor, op.to.role))) {
        const dest = this.deps.seat(op.to.floor, op.to.role);
        const p = this.store.get(op.profileId);
        if (dest && dest.workerId && dest.phase === 'active' && p && dest.name === p.displayName) await this.finish(op, dest.workerId);
        else await this.fail(op, 'dest', 'The office stopped during the hire, and it didn’t happen');
      }
    }
  }
}
