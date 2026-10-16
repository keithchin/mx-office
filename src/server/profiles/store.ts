// <data>/profiles.json: the office's only record of agent profiles, { version: 1, profiles, seats, moves }.
// `seats` ("floor|role" → prf id, or null for a seat released by a move) is the one link from a roster seat
// to a profile: roster files are never changed, so deleting this file (or rolling the code back) is the
// rollback. Read once (asynchronously), written with the acknowledged critical write
// (flow/critical-write.ts), changes serialised on one chain.

import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonCritical } from '../flow/critical-write.js';
import { isRoleId } from '../../shared/roster/roles.js';
import { isMoveId, isOpenMove, isProfileId, type Assignment, type MoveOp, type MoveState, type Profile, type SeatRef } from '../../shared/profiles.js';

export interface ProfilesFile {
  profiles: Profile[];
  seats: Record<string, string | null>;
  moves: MoveOp[];
}

/** Settled moves kept for the record (the audit log has every one). */
const SETTLED_KEPT = 50;
const WORKERS_KEPT = 20;
const REASONS = new Set(['migrated', 'hired', 'reused', 'moved-in']);
const ENDS = new Set(['moved', 'replaced', 'project-removed']);
const STATES = new Set<MoveState>(['source-benching', 'dest-hiring', 'done', 'failed', 'cancelled']);

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function cleanAssignment(a: unknown): Assignment | undefined {
  if (!a || typeof a !== 'object') return undefined;
  const r = a as Assignment;
  if (typeof r.floor !== 'string' || !r.floor || !isRoleId(r.role) || num(r.start) === undefined) return undefined;
  return {
    floor: r.floor,
    project: str(r.project, 120) || r.floor,
    role: r.role,
    start: r.start,
    ...(num(r.end) !== undefined ? { end: r.end } : {}),
    reason: REASONS.has(r.reason) ? r.reason : 'hired',
    ...(ENDS.has(r.ended as string) ? { ended: r.ended } : {}),
    workers: (Array.isArray(r.workers) ? r.workers : []).filter((w): w is string => typeof w === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(w)).slice(-WORKERS_KEPT),
  };
}

const cleanSeat = (s: unknown): SeatRef | undefined => (s && typeof s === 'object' && typeof (s as SeatRef).floor === 'string' && isRoleId((s as SeatRef).role) ? { floor: (s as SeatRef).floor, role: (s as SeatRef).role } : undefined);

function cleanMove(m: unknown): MoveOp | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const r = m as MoveOp;
  const to = cleanSeat(r.to);
  if (!isMoveId(r.id) || !isProfileId(r.profileId) || !to || !STATES.has(r.state)) return undefined;
  const from = cleanSeat(r.from);
  const prev = r.prevDest && typeof r.prevDest === 'object' ? { name: str(r.prevDest.name, 40), profileId: isProfileId(r.prevDest.profileId) ? r.prevDest.profileId : null } : undefined;
  return {
    id: r.id,
    profileId: r.profileId,
    ...(from ? { from } : {}),
    to,
    state: r.state,
    ...(r.stage === 'source' || r.stage === 'dest' ? { stage: r.stage } : {}),
    ...(r.error ? { error: str(r.error, 300) } : {}),
    at: num(r.at) ?? 0,
    updatedAt: num(r.updatedAt) ?? 0,
    by: str(r.by, 80),
    ...(r.owner ? { owner: str(r.owner, 80) } : {}),
    ...(r.task ? { task: String(r.task).slice(0, 4000) } : {}),
    ...(typeof r.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,63}$/.test(r.model) ? { model: r.model } : {}),
    ...(prev && prev.name ? { prevDest: prev } : {}),
  };
}

/** The file as read, made whole: bad entries dropped, a profile id once, a seat pointing at a profile that exists. */
export function cleanFile(raw: unknown): ProfilesFile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProfilesFile>;
  const profiles: Profile[] = [];
  const ids = new Set<string>();
  for (const p of Array.isArray(r.profiles) ? r.profiles : []) {
    if (!p || typeof p !== 'object' || !isProfileId(p.id) || ids.has(p.id)) continue;
    ids.add(p.id);
    profiles.push({
      id: p.id,
      displayName: str(p.displayName, 24) || `Agent ${p.id.slice(-4)}`,
      createdAt: num(p.createdAt) ?? 0,
      createdBy: p.createdBy === 'migration' ? 'migration' : 'hire',
      assignments: (Array.isArray(p.assignments) ? p.assignments : []).map(cleanAssignment).filter((a): a is Assignment => !!a),
    });
  }
  const seats: Record<string, string | null> = {};
  // One seat per profile, even in a hand-edited file: the first keeps it.
  const linked = new Set<string>();
  for (const [k, v] of Object.entries(r.seats && typeof r.seats === 'object' ? r.seats : {})) {
    if (!/^[^|]+\|[a-z-]+$/.test(k)) continue;
    if (v === null) seats[k] = null;
    else if (typeof v === 'string' && ids.has(v) && !linked.has(v)) {
      seats[k] = v;
      linked.add(v);
    }
  }
  const moves = (Array.isArray(r.moves) ? r.moves : []).map(cleanMove).filter((m): m is MoveOp => !!m && ids.has(m.profileId));
  return { profiles, seats, moves };
}

export class ProfileStore {
  readonly file: string;
  private loaded?: Promise<ProfilesFile>;
  private state: ProfilesFile = { profiles: [], seats: {}, moves: [] };
  private byId = new Map<string, Profile>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'profiles.json');
  }

  /** The file (empty, and nothing written, when profiles.json doesn't exist). */
  load(): Promise<ProfilesFile> {
    this.loaded ??= readFile(this.file, 'utf8').then(
      async (t) => {
        try {
          return this.set(cleanFile(JSON.parse(t)));
        } catch {
          // Unreadable: kept beside it (the next write would replace it), and the office carries on as if it were new.
          await copyFile(this.file, `${this.file}.unreadable-${Date.now()}`).catch(() => undefined);
          console.error(`agent-office: couldn't read ${this.file}; kept a copy beside it and started agent profiles over`);
          return this.set(cleanFile(undefined));
        }
      },
      () => this.set(cleanFile(undefined)),
    );
    return this.loaded;
  }

  private set(f: ProfilesFile): ProfilesFile {
    this.state = f;
    this.isReady = true;
    this.byId = new Map(f.profiles.map((p) => [p.id, p]));
    return f;
  }

  /** Whether load() has finished (the roster's hooks answer "no profile" before then). */
  get ready(): boolean {
    return this.isReady;
  }
  private isReady = false;

  /** As last loaded (empty before the first load). */
  get data(): Readonly<ProfilesFile> {
    return this.state;
  }

  get(id: string): Profile | undefined {
    return this.byId.get(id);
  }

  /** The profile a seat points at, if any. */
  ofSeat(floor: string, role: string): Profile | undefined {
    const id = this.state.seats[`${floor}|${role}`];
    return id ? this.byId.get(id) : undefined;
  }

  /** The seat a profile is linked to, if any. */
  seatOf(id: string): SeatRef | undefined {
    for (const [k, v] of Object.entries(this.state.seats)) {
      if (v !== id) continue;
      const i = k.lastIndexOf('|');
      return { floor: k.slice(0, i), role: k.slice(i + 1) as SeatRef['role'] };
    }
    return undefined;
  }

  openMoves(): MoveOp[] {
    return this.state.moves.filter(isOpenMove);
  }

  /** Runs `fn` on the loaded state (which it may change in place), then saves it; one change at a time. */
  change<T>(fn: (f: ProfilesFile) => T): Promise<T> {
    const run = this.chain.then(async () => {
      await this.load();
      const out = fn(this.state);
      this.byId = new Map(this.state.profiles.map((p) => [p.id, p]));
      const open = this.state.moves.filter(isOpenMove);
      const settled = this.state.moves.filter((m) => !isOpenMove(m)).slice(-SETTLED_KEPT);
      this.state.moves = [...settled, ...open].sort((a, b) => a.at - b.at);
      await writeJsonCritical(this.file, { version: 1, ...this.state });
      return out;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

/** Adds a worker to an assignment's list, newest last, capped. */
export function addWorker(a: Assignment, workerId: string) {
  if (a.workers.at(-1) === workerId) return;
  a.workers = [...a.workers.filter((w) => w !== workerId), workerId].slice(-WORKERS_KEPT);
}
