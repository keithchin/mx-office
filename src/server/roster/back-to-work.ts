// The back-to-work nudge: when a member's turn ends with its task still open, the office sends it one
// short prompt, "You stopped with <task> open: carry on, or escalate if you're blocked." On the live floor a
// Chief Analyst answered a catch-up standup and stopped there, her issue left open, and nobody noticed for
// 25 minutes. Event-driven: the turn's end (a worker update to idle or done) starts one debounce, after the
// review nudge's grace (nudge.ts) so that one goes first, and the rules are looked at once when it fires.
// No polling, no model calls: a fixed prompt, one turn of the member's.
//
// The rules are a pure function (backToWorkDue) so the tests can walk each: on per floor (default on),
// never at autonomy level 1 (the Project Manager drives every step there), only for a member at work with
// a task the office knows (resume.ts) that isn't finished, with no escalation of its own open, not asked
// for its standup, nobody at its terminal, no prompts held or notes owed to it (they go in first and carry
// the resume line), never while the floor is paused (⏸ Pause project, a safe restart, the budget, the spend
// cap) or Studio Pro holds its writes, once per stop, and at most BACK_PER_WINDOW times per task an hour.

import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import type { AutonomyLevel } from '../../shared/roster/autonomy.js';
import type { RoleId } from '../../shared/roster/roles.js';
import { isAsleepStatus, isBusyStatus } from './bench.js';
import type { Roster } from './index.js';
import { backToWorkPrompt } from './prompts.js';
import type { Phase } from './store.js';
import type { TeamFloor } from './types.js';
import { backToWorkNudged } from '../chatter/hooks.js';
import { audit, byWhom } from '../audit/index.js';

/** How long after a turn ends the office looks: past the review nudge's grace, and a person's own prompt. */
export const BACK_GRACE_MS = 30_000;
/** At most this many nudges about one task in BACK_WINDOW_MS. */
export const BACK_PER_WINDOW = 2;
export const BACK_WINDOW_MS = 60 * 60_000;

export interface BackLook {
  /** The floor's setting. */
  enabled: boolean;
  level: AutonomyLevel;
  phase: Phase;
  status: WorkerStatus;
  /** People with its terminal open. */
  viewers: number;
  /** What it's on (resume.ts), and why that's finished, if it is. */
  task?: string;
  finished?: string;
  /** It has an escalation open: idle because the next move may be the Project Manager's. */
  escalated: boolean;
  /** Asked for its standup and hasn't answered yet. */
  inStandup: boolean;
  /** Why the office starts no turn on the floor now (the spend cap, ⏸ Pause project, a safe restart, the budget). */
  paused?: string;
  /** Studio Pro has the project open: its mxcli writes are held. */
  studio: boolean;
  /** Prompts held for it, and notes owed to it: they go in first. */
  queued: number;
  /** When its turn ended; undefined while it's busy. */
  idleAt?: number;
  /** The stop it was last nudged for. */
  nudgedIdleAt?: number;
  /** When it was nudged about this task. */
  nudges: readonly number[];
  now: number;
}

export type BackVerdict = 'nudge' | 'off' | 'level-1' | 'not-active' | 'paused' | 'needs-you' | 'asleep' | 'busy' | 'no-task' | 'finished' | 'escalated' | 'standup' | 'studio' | 'viewer' | 'queued' | 'already-nudged' | 'grace' | 'rate-limited';

/** Whether to send the back-to-work nudge now, or why not. */
export function backToWorkDue(l: BackLook): BackVerdict {
  if (!l.enabled) return 'off';
  if (l.level <= 1) return 'level-1';
  if (l.phase !== 'active') return 'not-active';
  if (l.paused) return 'paused';
  if (l.status === 'needs_input') return 'needs-you';
  if (isAsleepStatus(l.status)) return 'asleep';
  if (isBusyStatus(l.status) || (l.status !== 'idle' && l.status !== 'done') || l.idleAt === undefined) return 'busy';
  if (!l.task) return 'no-task';
  if (l.finished) return 'finished';
  if (l.escalated) return 'escalated';
  if (l.inStandup) return 'standup';
  if (l.studio) return 'studio';
  if (l.viewers > 0) return 'viewer';
  if (l.queued > 0) return 'queued';
  if (l.nudgedIdleAt !== undefined && l.nudgedIdleAt === l.idleAt) return 'already-nudged';
  if (l.now - l.idleAt < BACK_GRACE_MS) return 'grace';
  if (l.nudges.filter((t) => l.now - t < BACK_WINDOW_MS).length >= BACK_PER_WINDOW) return 'rate-limited';
  return 'nudge';
}

interface Track {
  idleAt?: number;
  nudgedIdleAt?: number;
  /** The task the nudges below were about, and when each went. */
  task?: string;
  nudges: number[];
  timer?: NodeJS.Timeout;
}

export class BackToWork {
  private track = new Map<string, Track>();

  /** `timers` false (the tests) looks only when asked (check). */
  constructor(private roster: Roster, private timers = true) {}

  private key = (floor: TeamFloor, role: RoleId) => `${floor.id}:${role}`;

  private trackOf(floor: TeamFloor, role: RoleId): Track {
    let t = this.track.get(this.key(floor, role));
    if (!t) this.track.set(this.key(floor, role), (t = { nudges: [] }));
    return t;
  }

  /** Every update of a member's worker: when its turn ends, look once the grace is over. */
  onWorker(floor: TeamFloor, role: RoleId, w: WorkerInfo) {
    const t = this.trackOf(floor, role);
    if (w.status !== 'idle' && w.status !== 'done') {
      t.idleAt = undefined;
      clearTimeout(t.timer);
      t.timer = undefined;
      return;
    }
    if (t.idleAt !== undefined) return;
    t.idleAt = this.roster.deps.now();
    if (!this.timers) return;
    clearTimeout(t.timer);
    t.timer = setTimeout(() => {
      t.timer = undefined;
      this.check(floor, role);
    }, BACK_GRACE_MS + 500);
    t.timer.unref?.();
  }

  /** What the rules say for a member now. */
  look(floor: TeamFloor, role: RoleId, now = this.roster.deps.now()): BackVerdict {
    const d = this.roster.data(floor.id);
    const m = d.members[role];
    const w = this.roster.workerOf(floor, m);
    if (!w) return 'not-active';
    const t = this.trackOf(floor, role);
    const task = this.roster.tasks.current(floor, w);
    const look: BackLook = {
      enabled: d.settings.backToWork,
      level: d.settings.autonomy,
      phase: m.phase,
      status: w.status,
      viewers: w.viewers.length,
      task,
      // Any it has open (raised, joined, or its role's), an FYI too: the level filed it so, but it may still wait on it.
      escalated: this.roster.openAsks(floor.id, w.id).length > 0,
      inStandup: this.roster.standups.isAsked(floor, role),
      paused: this.roster.delivery.paused(floor),
      studio: !!this.roster.deps.studioOpen?.(floor.id),
      queued: this.roster.delivery.heldFor(w.id, floor.id) + this.roster.relays.owed(floor.id, role).length,
      idleAt: t.idleAt,
      nudgedIdleAt: t.nudgedIdleAt,
      nudges: t.task === task ? t.nudges : [],
      now,
    };
    // Finished is looked at last (it may read the agent's last words): only when everything else says go.
    const first = backToWorkDue(look);
    if (first !== 'nudge') return first;
    return backToWorkDue({ ...look, finished: this.roster.tasks.finished(floor, w) });
  }

  /** Nudges the member if the rules say so; true when it did. */
  check(floor: TeamFloor, role: RoleId, now = this.roster.deps.now()): boolean {
    if (this.look(floor, role, now) !== 'nudge') return false;
    const m = this.roster.data(floor.id).members[role];
    const w = this.roster.workerOf(floor, m)!;
    const task = this.roster.tasks.current(floor, w)!;
    // The office's words, typed now (it's between turns); the prompt names the task, so no resume line.
    const r = this.roster.delivery.send(floor, w, backToWorkPrompt(task), { origin: 'office', resume: false });
    if (r.status === 'refused') return false;
    this.noted(floor, role, task, now);
    backToWorkNudged(floor.id, w, task);
    floor.activity?.(`🔁 Nudged ${m.name} back to work: ${task}`);
    return true;
  }

  private noted(floor: TeamFloor, role: RoleId, task: string, now: number) {
    const t = this.trackOf(floor, role);
    if (t.task !== task) t.nudges = [];
    t.task = task;
    t.nudges = [...t.nudges.filter((x) => now - x < BACK_WINDOW_MS), now];
    t.nudgedIdleAt = t.idleAt;
  }

  /**
   * The Project Manager pressed Nudge (Needs you): the same prompt, theirs, now. Not into a turn under way
   * or a question in its terminal; an asleep one is woken with it. Why not, if not.
   */
  nudgeNow(floor: TeamFloor, role: RoleId, by: string): string | undefined {
    const m = this.roster.data(floor.id).members[role];
    const w = this.roster.workerOf(floor, m);
    if (!w || m.phase !== 'active') return `${m.name} isn't at work`;
    if (isBusyStatus(w.status)) return w.status === 'needs_input' ? `${m.name} is waiting on an answer in its terminal` : `${m.name} is working already`;
    const task = this.roster.tasks.current(floor, w);
    const text = task ? backToWorkPrompt(task, by) : `You're idle with no task: tell the Coordinator what you'll do next, or escalate if you're blocked. (${by} pressed Nudge in the Command Center.)`;
    const r = this.roster.delivery.send(floor, w, text, { origin: 'person', by, wake: true, resume: false });
    if (r.status === 'refused') return r.why;
    if (task) this.noted(floor, role, task, this.roster.deps.now());
    backToWorkNudged(floor.id, w, task, by);
    audit.record({ floor: floor.id, actor: byWhom(by), action: 'worker.nudge', target: { kind: 'worker', id: w.id, label: m.name }, summary: `Nudged ${m.name} back to work${task ? `: ${task}` : ''}`, details: { role, task: task ? { length: task.length } : undefined } });
    floor.activity?.(`🔁 ${by} nudged ${m.name} back to work${task ? `: ${task}` : ''}`);
    return undefined;
  }
}
