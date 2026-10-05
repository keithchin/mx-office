// The escalation channel to the Project Manager (the human): an agent raises one with
// `office-workers escalate` or the `escalate` MCP tool (hooks/office-escalate.ts); it's kept on the
// floor's roster, shown on the project console (🎛️ Command Center) and in the Team tab's approvals, toasted and
// sent as a desktop alert when it's urgent or critical and above the floor's threshold, and the
// Project Coordinator hears about it (batched, a minute after the last) so it can summarise it at the
// standup. The human's Reply / Approve / Reject goes back to the raising agent as a prompt and
// resolves it. The office never blocks on one, and never asks a model anything.

import { randomBytes } from 'node:crypto';
import type { WorkerInfo } from '../../shared/protocol.js';
import { URGENCY_ICON, VERDICT_WORD, isAlarming, escalationOrder, makeEscalation, type Escalation, type EscalationAsk, type EscalationVerdict } from '../../shared/roster/escalation.js';
import { ROLE_BY_ID } from '../../shared/roster/roles.js';
import { isAsleepStatus } from './bench.js';
import type { Roster } from './index.js';
import { escalationAnswerPrompt, escalationsToCoordinatorPrompt } from './prompts.js';
import type { TeamFloor } from './types.js';

/** The Project Coordinator hears about new escalations this long after the last one, all in one message. */
export const COORDINATOR_DEBOUNCE_MS = 60_000;
/** Answered escalations the console keeps showing. */
const RESOLVED_SHOWN = 10;

export class Escalations {
  private outbox = new Map<string, { list: Escalation[]; timer?: NodeJS.Timeout }>();

  constructor(private roster: Roster) {}

  /** Raises one from worker `w` on the floor; the escalation, or why not. */
  raise(floor: TeamFloor, w: WorkerInfo, ask: EscalationAsk): Escalation {
    const d = this.roster.data(floor.id);
    const role = this.roster.roleOf(floor, w.id);
    const team = role ? ROLE_BY_ID.get(role)!.team : undefined;
    const e = makeEscalation(ask, { workerId: w.id, by: w.name, ...(role ? { role } : {}), ...(team ? { team } : {}) }, d.settings.autonomy, randomBytes(5).toString('hex'), this.roster.deps.now());
    d.escalations.push(e);
    const loud = isAlarming(e);
    const tag = e.fyi ? 'FYI' : e.urgency;
    floor.activity?.(`${URGENCY_ICON[e.urgency]} ${w.name} escalated to the Project Manager (${tag}): ${e.title}`);
    if (loud) floor.toast(`${URGENCY_ICON[e.urgency]} ${e.urgency === 'critical' ? 'Critical' : 'Urgent'} escalation from ${w.name}: ${e.title} — answer it on the project console (🎛️ Command Center)`, 'warn');
    // The Coordinator relays and summarises: it isn't told about its own, or about FYIs (they're on the standup page).
    if (role !== 'pm' && !e.fyi) this.tellCoordinator(floor, e);
    this.roster.touch(floor);
    if (loud) floor.changed({ id: e.id, urgency: e.urgency as 'urgent' | 'critical', title: `${URGENCY_ICON[e.urgency]} ${w.name} needs the Project Manager`, body: e.title });
    return e;
  }

  /**
   * The Project Manager's answer: sent to the agent that raised it as its next prompt (an asleep one
   * wakes with it), and the escalation resolved. An agent that has gone home gets it in its next
   * hire's first message instead (see Members.hire).
   */
  resolve(floor: TeamFloor, id: string, verdict: EscalationVerdict, raw: unknown, by: string): string | undefined {
    const d = this.roster.data(floor.id);
    const e = d.escalations.find((x) => x.id === id);
    if (!e) return 'No such escalation';
    if (e.status === 'resolved') return `Already answered by ${e.resolution?.by ?? 'someone'}`;
    const text = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim().slice(0, 4000) : '';
    if (verdict === 'reply' && !text) return 'Write your reply';
    if (verdict === 'reject' && !text) return 'Say why it is rejected';
    let delivered = false;
    // A dismissed FYI doesn't spend a turn of the agent's; anything else is an answer it acts on.
    if (verdict !== 'dismiss') {
      const w = floor.worker(e.workerId);
      if (w && w.kind === 'agent') {
        const prompt = escalationAnswerPrompt(e, verdict, text, by);
        let err = isAsleepStatus(w.status) ? floor.wake(w.id, prompt) : floor.prompt(w.id, prompt);
        if (err === 'Worker is not running') err = floor.wake(w.id, prompt);
        delivered = !err;
        if (err) floor.toast(`Couldn't send the answer to ${e.by}: ${err}. It's kept for its next session.`, 'warn');
      }
    }
    e.status = 'resolved';
    e.resolution = { verdict, text, by, at: this.roster.deps.now(), delivered };
    floor.activity?.(`✅ ${by} answered ${e.by}'s escalation (${verdict}): ${e.title}`);
    this.roster.touch(floor);
    return undefined;
  }

  /** What the console and the approvals show: the open ones, loudest first, then the latest answered. */
  view(floor: TeamFloor): Escalation[] {
    const all = [...this.roster.data(floor.id).escalations].sort(escalationOrder);
    const open = all.filter((e) => e.status === 'open');
    return [...open, ...all.filter((e) => e.status === 'resolved').slice(0, RESOLVED_SHOWN)];
  }

  /**
   * Answers a role's next hire carries, for escalations answered while it was away: their lines, and
   * `mark` to call once the hire went through, so a failed hire doesn't lose them.
   */
  owed(floor: TeamFloor, role: string): { lines: string[]; mark(): void } {
    const list = this.roster.data(floor.id).escalations.filter((e) => e.role === role && e.status === 'resolved' && e.resolution && !e.resolution.delivered && e.resolution.verdict !== 'dismiss');
    return {
      lines: list.map((e) => `- “${e.title}”: ${VERDICT_WORD[e.resolution!.verdict]}${e.resolution!.text ? ` — ${e.resolution!.text}` : ''} (${e.resolution!.by})`),
      mark: () => list.forEach((e) => (e.resolution!.delivered = true)),
    };
  }

  // ---- Telling the Project Coordinator ---------------------------------------------------------

  private tellCoordinator(floor: TeamFloor, e: Escalation) {
    const box = this.outbox.get(floor.id) ?? { list: [] };
    box.list.push(e);
    clearTimeout(box.timer);
    box.timer = setTimeout(() => this.flushCoordinator(floor), COORDINATOR_DEBOUNCE_MS);
    box.timer.unref?.();
    this.outbox.set(floor.id, box);
  }

  /** The Coordinator's worker changed: back at its desk with escalations it hasn't heard yet. */
  onCoordinator(floor: TeamFloor, w: WorkerInfo) {
    const box = this.outbox.get(floor.id);
    if (box?.list.length && !box.timer && (w.status === 'idle' || w.status === 'done')) this.flushCoordinator(floor);
  }

  /**
   * Sends the Coordinator the queued escalations if it's at work; still-open ones only. An asleep one
   * isn't woken (that costs a session): they wait. With no Coordinator they're on the console and the
   * next standup page anyway.
   */
  flushCoordinator(floor: TeamFloor): boolean {
    const box = this.outbox.get(floor.id);
    if (!box?.list.length) return false;
    box.timer = undefined;
    const pm = this.roster.data(floor.id).members.pm;
    const w = this.roster.workerOf(floor, pm);
    if (!w || pm.phase !== 'active') {
      this.outbox.delete(floor.id);
      return false;
    }
    if (isAsleepStatus(w.status) || w.status === 'needs_input') return false;
    const open = box.list.filter((e) => e.status === 'open');
    this.outbox.delete(floor.id);
    return open.length > 0 && !floor.prompt(w.id, escalationsToCoordinatorPrompt(open));
  }
}
