// 🔁 Restart safely (⚙️ Settings, and POST /api/office/restart): pause every project (⏸ Pause project,
// project-run/), wait until no agent is mid-turn, optionally build the office's new commits, then exit
// with RESTART_EXIT_CODE for a looping launcher to start it again. The floors it paused are written to
// <data>/restart-pending.json first; the next office resumes exactly those (▶ Resume project with the
// preview's defaults) and deletes the file, so a floor a person had paused stays paused. A timeout
// (10 min by default) asks: keep waiting, restart anyway (interrupting only those still working), or
// cancel (resuming what it paused). Pure of the office: what it needs is RestartDeps.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_RESTART_TIMEOUT_MIN, RESTART_EXIT_CODE, type RestartPhase, type RestartView } from '../../shared/project-run.js';
import { audit, byWhom, office } from '../audit/index.js';
import { writeJsonAtomic } from '../flow/store.js';

export interface Busy {
  name: string;
  floor: string;
  /** "mid-turn", "starting". */
  doing: string;
}

export interface RestartDeps {
  dataDir: string;
  floors(): string[];
  /** A person paused it already (it isn't this restart's to resume). */
  paused(floorId: string): boolean;
  pause(floorId: string, by: string): void;
  resume(floorId: string, by: string): Promise<unknown>;
  /** Agents mid-turn (working or starting) on any floor; idle, asleep and needs_input don't hold it up. */
  busy(): Busy[];
  /** The office's checkout has commits it isn't running. */
  newCommits(): boolean;
  build(): Promise<{ ok: boolean; log: string }>;
  exit(code: number): void;
  /** A looping launcher started the office. */
  loop: boolean;
  now(): number;
  chatter?(floorId: string, text: string): void;
  /** Something to show changed. */
  changed?(): void;
}

export interface Pending {
  floors: string[];
  by: string;
  at: number;
}

export const pendingFile = (dataDir: string) => path.join(dataDir, 'restart-pending.json');

export function readPending(dataDir: string): Pending | undefined {
  const file = pendingFile(dataDir);
  if (!existsSync(file)) return undefined;
  try {
    const p = JSON.parse(readFileSync(file, 'utf8')) as Partial<Pending>;
    return { floors: Array.isArray(p.floors) ? p.floors.filter((x): x is string => typeof x === 'string') : [], by: typeof p.by === 'string' ? p.by : 'Someone', at: typeof p.at === 'number' ? p.at : 0 };
  } catch {
    return { floors: [], by: 'Someone', at: 0 };
  }
}

const dropPending = (dataDir: string) => rmSync(pendingFile(dataDir), { force: true });
const OFFICE_ACTOR = office('Safe restart');
const TARGET = { kind: 'office', id: 'restart', label: 'Safe restart' };

export class SafeRestart {
  phase: RestartPhase = 'idle';
  by?: string;
  byId?: string;
  startedAt?: number;
  waitStart?: number;
  timeoutMin = DEFAULT_RESTART_TIMEOUT_MIN;
  build = false;
  log?: string;
  error?: string;
  waitingOn: string[] = [];
  /** Floors this restart paused (the rest were paused by a person, or not at all). */
  ours: string[] = [];

  constructor(private deps: RestartDeps) {}

  view(admin: boolean): RestartView {
    return { phase: this.phase, loop: this.deps.loop, newCommits: this.deps.newCommits(), by: this.by, startedAt: this.startedAt, waitingOn: this.waitingOn, timeoutMin: this.timeoutMin, build: this.build, log: this.log, error: this.error, admin };
  }

  get active() {
    return this.phase === 'pausing' || this.phase === 'waiting' || this.phase === 'timed-out' || this.phase === 'building' || this.phase === 'exiting';
  }

  /** Starts it: every floor not already paused is paused for the restart, and written down. Why not, if not. */
  start(by: string, opts: { build?: boolean; timeoutMin?: number; byId?: string } = {}): string | undefined {
    if (this.active) return 'A safe restart is already under way';
    const now = this.deps.now();
    Object.assign(this, { phase: 'pausing', by, byId: opts.byId, startedAt: now, waitStart: now, log: undefined, error: undefined, waitingOn: [] });
    this.build = !!opts.build && this.deps.newCommits();
    this.timeoutMin = Math.max(1, Math.min(120, Math.round(opts.timeoutMin ?? DEFAULT_RESTART_TIMEOUT_MIN)));
    this.ours = this.deps.floors().filter((id) => !this.deps.paused(id));
    writeJsonAtomic(pendingFile(this.deps.dataDir), { floors: this.ours, by, at: now } satisfies Pending);
    audit.record({ actor: byWhom(by, opts.byId), action: 'restart.requested', target: TARGET, summary: `Asked for a safe restart${this.build ? ' on the latest build' : ''}: pausing ${this.ours.length} project${this.ours.length === 1 ? '' : 's'}${this.deps.loop ? '' : ' (no restart loop: the office will only exit)'}`, details: { floors: this.ours, build: this.build, loop: this.deps.loop, timeoutMin: this.timeoutMin }, severity: 'warning' });
    for (const id of this.ours) {
      this.deps.pause(id, by);
      this.deps.chatter?.(id, `🔁 ${by} asked for a safe restart: this project is pausing until the office is back.`);
    }
    this.phase = 'waiting';
    this.deps.changed?.();
    return undefined;
  }

  /** Every second while it's under way: who it's waiting on, and on once nobody is mid-turn. */
  async tick(): Promise<void> {
    if (this.phase !== 'waiting') return;
    const busy = this.deps.busy();
    const was = this.waitingOn.join('|');
    this.waitingOn = busy.map((b) => `${b.name} ${b.doing}`);
    if (this.waitingOn.join('|') !== was) {
      if (busy.length) audit.record({ actor: OFFICE_ACTOR, action: 'restart.waiting', target: TARGET, summary: `Waiting on ${busy.length}: ${this.waitingOn.join(', ')}`, details: { busy } });
      this.deps.changed?.();
    }
    if (!busy.length) return this.proceed([]);
    if (this.deps.now() - (this.waitStart ?? 0) >= this.timeoutMin * 60_000) {
      this.phase = 'timed-out';
      this.deps.changed?.();
    }
  }

  /** The timeout's choice. Why not, if it can't. */
  async choose(c: 'wait' | 'anyway' | 'cancel'): Promise<string | undefined> {
    if (c === 'cancel') return this.cancel();
    if (this.phase !== 'timed-out' && !(c === 'anyway' && this.phase === 'waiting')) return 'Nothing to choose now';
    if (c === 'wait') {
      this.phase = 'waiting';
      this.waitStart = this.deps.now();
      this.deps.changed?.();
      return undefined;
    }
    await this.proceed(this.deps.busy());
    return undefined;
  }

  /** Stops it, resuming the floors it paused. */
  async cancel(): Promise<string | undefined> {
    if (!this.active && this.phase !== 'failed') return 'No safe restart to cancel';
    if (this.phase === 'exiting') return 'Too late: the office is exiting';
    this.phase = 'cancelled';
    dropPending(this.deps.dataDir);
    audit.record({ actor: byWhom(this.by ?? 'Someone', this.byId), action: 'restart.cancelled', target: TARGET, summary: `Cancelled the safe restart: resuming ${this.ours.length} project${this.ours.length === 1 ? '' : 's'}`, details: { floors: this.ours } });
    for (const id of this.ours) await this.deps.resume(id, this.by ?? 'The office').catch(() => undefined);
    this.deps.changed?.();
    return undefined;
  }

  /** Nobody's mid-turn (or restart anyway): build if asked, then exit for the launcher. */
  private async proceed(interrupting: Busy[]) {
    if (this.build) {
      this.phase = 'building';
      this.deps.changed?.();
      const r = await this.deps.build().catch((err: Error) => ({ ok: false, log: err.message }));
      if (!r.ok) {
        this.phase = 'failed';
        this.log = r.log;
        this.error = 'The build failed: the office keeps running the version it has. Cancel resumes the projects it paused.';
        audit.record({ actor: OFFICE_ACTOR, action: 'restart.failed', target: TARGET, summary: 'The safe restart stopped: npm run build failed', details: { log: r.log.slice(-1500) }, severity: 'warning' });
        this.deps.changed?.();
        return;
      }
    }
    this.phase = 'exiting';
    audit.record({ actor: OFFICE_ACTOR, action: 'restart.exiting', target: TARGET, summary: this.deps.loop ? `Restarting the office${interrupting.length ? `, interrupting ${interrupting.map((b) => b.name).join(', ')}` : ''}` : 'Exiting the office: start it again to finish the restart', details: { interrupting, loop: this.deps.loop, build: this.build }, severity: interrupting.length ? 'warning' : 'notice' });
    for (const id of this.ours) this.deps.chatter?.(id, '🔁 The office is restarting now; this project resumes when it’s back.');
    this.deps.changed?.();
    this.deps.exit(this.deps.loop ? RESTART_EXIT_CODE : 0);
  }
}

/**
 * The office just started: when the last one left restart-pending.json, the floors it paused are
 * resumed (▶ Resume project, the preview's defaults: those with work), and the file is deleted. A
 * floor a person paused since, or one that's gone, is left alone. The floors resumed.
 */
export async function resumeAfterRestart(deps: Pick<RestartDeps, 'dataDir' | 'floors' | 'resume' | 'chatter'> & { pausedForRestart(floorId: string): boolean }): Promise<string[]> {
  const p = readPending(deps.dataDir);
  if (!p) return [];
  dropPending(deps.dataDir);
  const here = new Set(deps.floors());
  const floors = p.floors.filter((id) => here.has(id) && deps.pausedForRestart(id));
  for (const id of floors) {
    await deps.resume(id, p.by).catch((err: Error) => console.error(`agent-office: couldn't resume ${id} after the restart: ${err.message}`));
    deps.chatter?.(id, '🔁 The office is back from its safe restart: resuming this project.');
  }
  audit.record({ actor: OFFICE_ACTOR, action: 'restart.resumed', target: TARGET, summary: `Back from the safe restart: resumed ${floors.length} project${floors.length === 1 ? '' : 's'}`, details: { floors, skipped: p.floors.filter((id) => !floors.includes(id)) } });
  return floors;
}
