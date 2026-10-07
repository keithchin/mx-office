// The review nudge: when a Lead's turn ends right after one of its subagents came back (the Agent
// tool's PostToolUse hook, see workers/subagents.ts), the office sends it one short prompt to review
// that result per its Playbook's review protocol and continue or escalate, so a subagent's lane never
// sits idle because its Lead stopped to wait. No model calls of the office's own: it's a fixed
// prompt, and it costs one turn of the Lead's. The rules are a pure function (nudgeDue) so the tests
// can walk every one: on per floor (default on), once per idle period, a short grace after the turn
// ends, a few minutes between nudges, and never to a Lead that is busy, waiting on a person, asleep,
// benched or answering a standup. And it's bounded: not about a subagent that's out of revision rounds
// (review-rounds.ts: the office escalated it instead), and not more than a few times in a row while the
// Lead records no review verdict and nobody else prompts it (it isn't following the protocol: more
// nudges would only spend turns). Past the floor's spend cap it isn't sent (deliver.ts).

import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import { ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';
import { lastSubagentResult } from '../workers/subagents.js';
import { cleanSubName, subKey } from './subagent-store.js';
import { subagentFirstName } from './subagent-names.js';
import { subRef } from '../../shared/roster/subagent-names.js';
import { isAsleepStatus, isBusyStatus } from './bench.js';
import type { Roster } from './index.js';
import { reviewNudgePrompt } from './prompts.js';
import type { Phase } from './store.js';
import type { TeamFloor } from './types.js';
import { reviewNudged } from '../chatter/hooks.js';

/** How long after a turn ends the office waits, so a person's own prompt (or a queued one) goes first. */
export const NUDGE_GRACE_MS = 15_000;
/** The least time between two nudges to one Lead, whatever its subagents do. */
export const NUDGE_GAP_MS = 3 * 60_000;
/** Nudges in a row with no review verdict from the Lead (and nobody else prompting it) before the office stops. */
export const NUDGE_STREAK_MAX = 3;

export interface NudgeLook {
  /** The floor's setting. */
  enabled: boolean;
  /** The role has subagents (the Project Coordinator has none, so it's never nudged). */
  hasTeam: boolean;
  phase: Phase;
  status: WorkerStatus;
  /** When its current idle period began (its turn ended); undefined while it's busy. */
  idleAt?: number;
  /** When the turn that just ended began: only a subagent that came back during it counts. */
  turnAt?: number;
  /** When its latest subagent came back. */
  subagentAt?: number;
  /** When it was last nudged, and the idle period that nudge was for. */
  nudgedAt?: number;
  nudgedIdleAt?: number;
  /** It's been asked for its standup and hasn't answered yet. */
  inStandup: boolean;
  /** The subagent that came back is out of revision rounds: escalated, not nudged about. */
  exhausted?: boolean;
  /** Nudges in a row without a review verdict from the Lead. */
  streak?: number;
  now: number;
}

export type NudgeVerdict = 'nudge' | 'off' | 'no-team' | 'not-active' | 'needs-you' | 'busy' | 'asleep' | 'nothing-new' | 'already-nudged' | 'grace' | 'too-soon' | 'standup' | 'exhausted' | 'unheeded';

/** Whether to nudge a Lead now, or why not. */
export function nudgeDue(l: NudgeLook): NudgeVerdict {
  if (!l.enabled) return 'off';
  if (!l.hasTeam) return 'no-team';
  if (l.phase !== 'active') return 'not-active';
  if (l.status === 'needs_input') return 'needs-you';
  if (isAsleepStatus(l.status)) return 'asleep';
  if (isBusyStatus(l.status) || (l.status !== 'idle' && l.status !== 'done') || l.idleAt === undefined) return 'busy';
  if (l.inStandup) return 'standup';
  // A result that came back before its last nudge was already reviewed (or ignored) in that turn.
  if (l.subagentAt === undefined || (l.turnAt !== undefined && l.subagentAt < l.turnAt) || (l.nudgedAt !== undefined && l.subagentAt <= l.nudgedAt)) return 'nothing-new';
  if (l.exhausted) return 'exhausted';
  if ((l.streak ?? 0) >= NUDGE_STREAK_MAX) return 'unheeded';
  if (l.nudgedIdleAt !== undefined && l.nudgedIdleAt === l.idleAt) return 'already-nudged';
  if (l.now - l.idleAt < NUDGE_GRACE_MS) return 'grace';
  if (l.nudgedAt !== undefined && l.now - l.nudgedAt < NUDGE_GAP_MS) return 'too-soon';
  return 'nudge';
}

interface Track {
  idleAt?: number;
  turnAt?: number;
  nudgedAt?: number;
  nudgedIdleAt?: number;
  /** Nudges in a row without a review verdict, and whether the stop was put in the activity. */
  streak?: number;
  stopNoted?: boolean;
  timer?: NodeJS.Timeout;
}

export class Nudges {
  private track = new Map<string, Track>();

  /** `timers` false (the tests) checks only when asked: check() or the roster's tick. */
  constructor(private roster: Roster, private timers = true) {}

  private key = (floor: TeamFloor, role: RoleId) => `${floor.id}:${role}`;

  /** Every update of a member's worker: when its turn ends, look again once the grace is over. */
  onWorker(floor: TeamFloor, role: RoleId, w: WorkerInfo) {
    const t = this.track.get(this.key(floor, role)) ?? {};
    this.track.set(this.key(floor, role), t);
    // Someone else prompted it since the last nudge (a person, another agent): the streak starts again.
    if (t.nudgedAt !== undefined && w.lastInput && w.lastInput.at > t.nudgedAt && w.lastInput.by !== 'Agent Office') this.reviewed(floor, role);
    const over = w.status === 'idle' || w.status === 'done';
    if (!over) {
      // A new turn begins (or the first one the office has seen).
      if (t.idleAt !== undefined || t.turnAt === undefined) t.turnAt = this.roster.deps.now();
      t.idleAt = undefined;
      clearTimeout(t.timer);
      t.timer = undefined;
      return;
    }
    if (t.idleAt !== undefined) return;
    t.idleAt = this.roster.deps.now();
    if (!this.timers) return;
    clearTimeout(t.timer);
    t.timer = setTimeout(() => this.check(floor, role), NUDGE_GRACE_MS + 500);
    t.timer.unref?.();
  }

  /** The Lead recorded a review verdict (or someone else prompted it): nudges may go on. */
  reviewed(floor: TeamFloor, role: RoleId) {
    const t = this.track.get(this.key(floor, role));
    if (!t) return;
    t.streak = 0;
    t.stopNoted = false;
  }

  /** What the rules say for a member now. */
  look(floor: TeamFloor, role: RoleId, now = this.roster.deps.now()): NudgeVerdict {
    const d = this.roster.data(floor.id);
    const m = d.members[role];
    const w = this.roster.workerOf(floor, m);
    if (!w) return 'not-active';
    const t = this.track.get(this.key(floor, role)) ?? {};
    const result = lastSubagentResult(w.id);
    const sub = result && d.subagents[subKey(role, cleanSubName(result.agent) ?? 'general-purpose')];
    return nudgeDue({
      enabled: d.settings.reviewNudge,
      hasTeam: ROLE_BY_ID.get(role)!.subagents.length > 0,
      phase: m.phase,
      status: w.status,
      idleAt: t.idleAt,
      turnAt: t.turnAt,
      subagentAt: result?.at,
      nudgedAt: t.nudgedAt,
      nudgedIdleAt: t.nudgedIdleAt,
      inStandup: this.roster.standups.isAsked(floor, role),
      exhausted: sub?.exhaustedAt !== undefined,
      streak: t.streak,
      now,
    });
  }

  /** Nudges the member if the rules say so; true when it did. */
  check(floor: TeamFloor, role: RoleId, now = this.roster.deps.now()): boolean {
    const verdict = this.look(floor, role, now);
    const d = this.roster.data(floor.id);
    const m = d.members[role];
    if (verdict === 'unheeded') {
      const t = this.track.get(this.key(floor, role))!;
      if (!t.stopNoted) floor.activity?.(`⏸️ Stopped nudging ${m.name}: ${NUDGE_STREAK_MAX} review nudges in a row without a review verdict. It's nudged again once it records one or someone prompts it.`);
      t.stopNoted = true;
    }
    if (verdict !== 'nudge') return false;
    const w = this.roster.workerOf(floor, m)!;
    const t = this.track.get(this.key(floor, role))!;
    const result = lastSubagentResult(w.id);
    const sub = result?.agent ? cleanSubName(result.agent) : undefined;
    const first = sub && subagentFirstName(d, role, sub, () => this.roster.file(floor.id).save());
    if (this.roster.delivery.prompt(floor, w, reviewNudgePrompt(role, result, d.settings.autonomy, first || undefined))) return false;
    t.streak = (t.streak ?? 0) + 1;
    t.nudgedAt = now;
    t.nudgedIdleAt = t.idleAt;
    const who = sub && first ? subRef(first, sub) : result?.agent;
    reviewNudged(floor.id, w, result?.agent, first || undefined);
    floor.activity?.(`🔁 Nudged ${m.name} to review ${who ? `${first ? '' : 'its '}${who}'s` : "its subagent's"} result and continue or escalate`);
    return true;
  }

  /** The roster's minute look: anyone whose timer was lost (a restart of the timer-less tests, say). */
  tick(floor: TeamFloor, roles: readonly RoleId[], now: number) {
    for (const role of roles) this.check(floor, role, now);
  }
}
