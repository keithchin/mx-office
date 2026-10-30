// The automatic hand-off (release 82, team flow #5): on the real build the Lead Developer stopped after every batch
// of build-plan rows and waited for the Project Manager's nudge. Now, a little after a Lead's turn ends, the office
// looks: when its batch is done and the build plan has next rows for its role, it hands them over itself (typed as
// the office, between turns, as its new task with a task id), records it (an audit line `roster.handoff`, the
// activity feed, and `<data>/handoff/<floor>.json` so the same rows are never handed twice), and goes no further
// than the next checkpoint. Which rows is shared/roster/handoff.ts; when, the pure handoffDue below:
//   - on with the team's back-to-work setting (the office's own nudges), never at autonomy level 1 (the Project
//     Manager approves every task there);
//   - never while the project is paused (⏸ Pause project, a safe restart, the budget's auto-pause, the spend cap:
//     Delivery.paused), Studio Pro holds the writes, or the member asks or waits on the Project Manager;
//   - only for a member between turns, nobody at its terminal, nothing held for it, not asked for its standup,
//     no subagent or background work still running;
//   - its batch done: no open task, or every build-plan row its task names has build evidence now;
//   - at most HANDOFF_PER_HOUR hand-offs per member an hour.
// The Coordinator itself (on a team that has one) isn't handed rows: it doesn't build.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import type { AutonomyLevel } from '../../shared/roster/autonomy.js';
import { ROLE_BY_ID, type RoleId, type TeamId } from '../../shared/roster/roles.js';
import { handoffPrompt, handoffRows, nextRows, rowsWords, type NextRows } from '../../shared/roster/handoff.js';
import { rowsIn } from '../../shared/build-progress.js';
import { audit, office } from '../audit/index.js';
import { isAsleepStatus, isBusyStatus } from './bench.js';
import type { Roster } from './index.js';
import type { Phase } from './store.js';
import type { TeamFloor } from './types.js';
import { backgroundOpen } from '../workers/background-work.js';

/** How long after a turn ends the office looks (before back-to-work's 30 s: a finished batch gets rows, not "carry on"). */
export const HANDOFF_GRACE_MS = 20_000;
export const HANDOFF_PER_HOUR = 4;

export interface HandoffLook {
  enabled: boolean;
  level: AutonomyLevel;
  phase: Phase;
  status: WorkerStatus;
  viewers: number;
  paused?: string;
  studio: boolean;
  escalated: boolean;
  inStandup: boolean;
  queued: number;
  /** Its subagents or background work still running. */
  busyBehind: boolean;
  /** Its open task, and the build-plan rows that task names. */
  task?: string;
  taskRows: number[];
  done: ReadonlySet<number>;
  /** Hand-offs to it in the last hour. */
  recent: number;
}

export type HandoffVerdict = 'go' | 'off' | 'level-1' | 'not-active' | 'paused' | 'studio' | 'needs-you' | 'asleep' | 'busy' | 'viewer' | 'queued' | 'standup' | 'escalated' | 'mid-batch' | 'has-task' | 'rate-limited';

/** Whether to look for the next rows now, or why not. */
export function handoffDue(l: HandoffLook): HandoffVerdict {
  if (!l.enabled) return 'off';
  if (l.level <= 1) return 'level-1';
  if (l.phase !== 'active') return 'not-active';
  if (l.paused) return 'paused';
  if (l.studio) return 'studio';
  if (l.status === 'needs_input') return 'needs-you';
  if (isAsleepStatus(l.status)) return 'asleep';
  if (isBusyStatus(l.status) || (l.status !== 'idle' && l.status !== 'done') || l.busyBehind) return 'busy';
  if (l.viewers > 0) return 'viewer';
  if (l.queued > 0) return 'queued';
  if (l.inStandup) return 'standup';
  if (l.escalated) return 'escalated';
  if (l.task) {
    if (!l.taskRows.length) return 'has-task';
    if (!l.taskRows.every((n) => l.done.has(n))) return 'mid-batch';
  }
  if (l.recent >= HANDOFF_PER_HOUR) return 'rate-limited';
  return 'go';
}

interface Record {
  /** Per role: each hand-off's rows and when; the checkpoint last stopped at. */
  roles: Partial<{ [r in RoleId]: { handed: { rows: number[]; at: number }[]; stoppedAt?: number } }>;
}

/** What one look did. */
export type HandoffOutcome = { did: 'handed'; rows: number[] } | { did: 'stopped'; at: number; why: string } | { did: 'nothing'; why: string };

export class AutoHandoff {
  private timers = new Map<string, NodeJS.Timeout>();
  private looking = new Set<string>();
  private seen = new Map<string, WorkerStatus>();

  constructor(private roster: Roster, private useTimers = true) {}

  private file(floorId: string) {
    return path.join(this.roster.deps.dataDir, 'handoff', `${floorId.replace(/[^\w.-]/g, '_')}.json`);
  }

  record(floorId: string): Record {
    try {
      const r = JSON.parse(readFileSync(this.file(floorId), 'utf8')) as Record;
      return r && typeof r === 'object' && r.roles ? r : { roles: {} };
    } catch {
      return { roles: {} };
    }
  }

  private save(floorId: string, r: Record) {
    const f = this.file(floorId);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(`${f}.tmp`, JSON.stringify(r, null, 1));
    renameSync(`${f}.tmp`, f);
  }

  /** The teams a member builds for: its own, and what it covers (a Solo Lead covers all). */
  teamsOf(floor: TeamFloor, role: RoleId): TeamId[] {
    const d = this.roster.data(floor.id);
    const own = ROLE_BY_ID.get(role)!.team;
    const covered = (Object.entries(d.coverage ?? {}) as [TeamId, RoleId][]).filter(([, r]) => r === role).map(([t]) => t);
    return [...new Set([own, ...covered])].filter((t) => t !== 'management');
  }

  /** Every member update: a turn that just ended starts one look after the grace. */
  onWorker(floor: TeamFloor, role: RoleId, w: WorkerInfo) {
    const key = `${floor.id}:${role}`;
    const prev = this.seen.get(key);
    this.seen.set(key, w.status);
    if (prev !== 'working' || (w.status !== 'idle' && w.status !== 'done')) return;
    if (!this.useTimers) return;
    clearTimeout(this.timers.get(key));
    const t = setTimeout(() => {
      this.timers.delete(key);
      void this.check(floor, role).catch((err: Error) => console.error(`agent-office: hand-off on ${floor.id}: ${err.message}`));
    }, HANDOFF_GRACE_MS);
    t.unref?.();
    this.timers.set(key, t);
  }

  /** The rules' look for a member, without the plan's rows. */
  look(floor: TeamFloor, role: RoleId, done: ReadonlySet<number>): HandoffLook | undefined {
    const d = this.roster.data(floor.id);
    const m = d.members[role];
    const w = this.roster.workerOf(floor, m);
    if (!w) return undefined;
    const now = this.roster.deps.now();
    const task = this.roster.tasks.current(floor, w);
    const rec = this.record(floor.id).roles[role];
    const subs = (d.subagentRuns ?? []).some((r) => r.workerId === w.id && r.status === 'working');
    return {
      enabled: d.settings.backToWork,
      level: d.settings.autonomy,
      phase: m.phase,
      status: w.status,
      viewers: w.viewers.length,
      paused: this.roster.delivery.paused(floor),
      studio: !!this.roster.deps.studioOpen?.(floor.id),
      escalated: this.roster.openAsks(floor.id, w.id).length > 0,
      inStandup: this.roster.standups.isAsked(floor, role),
      queued: this.roster.delivery.heldFor(w.id, floor.id) + this.roster.relays.owed(floor.id, role).length,
      busyBehind: subs || backgroundOpen(w.id, now),
      ...(task ? { task } : {}),
      taskRows: task ? rowsIn(task) : [],
      done,
      recent: (rec?.handed ?? []).filter((h) => now - h.at < 3_600_000).length,
    };
  }

  /** Looks once: hands the next rows when the rules say so. Never throws. */
  async check(floor: TeamFloor, role: RoleId): Promise<HandoffOutcome> {
    const key = `${floor.id}:${role}`;
    if (this.looking.has(key)) return { did: 'nothing', why: 'looking already' };
    this.looking.add(key);
    try {
      const d = this.roster.data(floor.id);
      if (role === 'pm' && d.members.pm.phase !== 'none') return { did: 'nothing', why: 'the Coordinator builds nothing' };
      const pre = this.look(floor, role, new Set());
      if (!pre) return { did: 'nothing', why: 'not at work' };
      // The cheap rules first (no git): a member that's busy, paused or waiting isn't read for.
      const first = handoffDue({ ...pre, task: undefined, taskRows: [] });
      if (first !== 'go') return { did: 'nothing', why: first };
      const m = d.members[role];
      const w = this.roster.workerOf(floor, m)!;
      const plan = await this.roster.deps.buildPlan?.(floor, w.worktree?.branch);
      if (!plan) return { did: 'nothing', why: 'no build plan' };
      const done = new Set(plan.done);
      const l = this.look(floor, role, done);
      const verdict = l ? handoffDue(l) : 'not-active';
      if (verdict !== 'go') return { did: 'nothing', why: verdict };
      const next: NextRows = nextRows(handoffRows(plan.plan), done, this.teamsOf(floor, role));
      const rec = this.record(floor.id);
      const mine = (rec.roles[role] ??= { handed: [] });
      if (!next.rows.length) {
        if (next.stoppedAt && mine.stoppedAt !== next.stoppedAt.n) {
          mine.stoppedAt = next.stoppedAt.n;
          this.save(floor.id, rec);
          const why = next.stoppedAt.why === 'checkpoint' ? `row ${next.stoppedAt.n} is a checkpoint (${next.stoppedAt.step}): the Project Manager decides what comes next` : `row ${next.stoppedAt.n} depends on rows not done yet`;
          floor.activity?.(`⏸️ No rows handed to ${m.name}: ${why}`);
          audit.record({ floor: floor.id, actor: office(), action: 'roster.handoff', target: { kind: 'role', id: role, label: m.name }, summary: `Stopped handing rows to ${m.name}: ${why}`, details: { stoppedAt: next.stoppedAt.n, why: next.stoppedAt.why }, severity: 'info' });
          return { did: 'stopped', at: next.stoppedAt.n, why: next.stoppedAt.why };
        }
        return { did: 'nothing', why: 'no next rows' };
      }
      const ns = next.rows.map((r) => r.n);
      // The same rows twice: the last hand-off didn't land them, so the person decides (Needs you shows it idle).
      if (mine.handed.some((h) => h.rows[0] === ns[0])) return { did: 'nothing', why: 'handed already' };
      const text = handoffPrompt(next.rows, d.settings.autonomy);
      const prep = await this.roster.tasks.prepare(floor, w.id, text, 'tell');
      if (prep.error !== undefined) return { did: 'nothing', why: prep.error };
      const now = floor.worker(w.id) ?? w;
      const sent = this.roster.delivery.send(floor, now, prep.text, { origin: 'office', resume: false, between: true, hold: true });
      if (sent.status === 'refused') return { did: 'nothing', why: sent.why };
      this.roster.tasks.assign(floor, w.id, prep.text, 'The office', 'tell', prep.task?.executionId);
      mine.handed = [...mine.handed.slice(-19), { rows: ns, at: this.roster.deps.now() }];
      delete mine.stoppedAt;
      this.save(floor.id, rec);
      floor.activity?.(`➡️ Handed ${m.name} the build plan's next ${rowsWords(ns)}${sent.status === 'held' ? ' (after its turn)' : ''}`);
      audit.record({ floor: floor.id, actor: office(), action: 'roster.handoff', target: { kind: 'role', id: role, label: m.name }, summary: `Handed ${m.name} the build plan's next ${rowsWords(ns)}`, details: { rows: ns, level: d.settings.autonomy, sent: sent.status }, severity: 'notice' });
      this.roster.touch(floor);
      return { did: 'handed', rows: ns };
    } catch (err) {
      return { did: 'nothing', why: (err as Error).message };
    } finally {
      this.looking.delete(key);
    }
  }
}
