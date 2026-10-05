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
import { ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';
import { isAsleepStatus } from './bench.js';
import type { Roster } from './index.js';
import { escalationAnswerPrompt, escalationsToCoordinatorPrompt, owedAnswersPrompt } from './prompts.js';
import type { TeamFloor } from './types.js';
import { audit, agent, byWhom, jeff, office } from '../audit/index.js';

/** The Project Coordinator hears about new escalations this long after the last one, all in one message. */
export const COORDINATOR_DEBOUNCE_MS = 60_000;
/** Answered escalations the console keeps showing. */
const RESOLVED_SHOWN = 10;

export class Escalations {
  private outbox = new Map<string, { list: Escalation[]; timer?: NodeJS.Timeout }>();

  constructor(private roster: Roster) {}

  /** Raises one from worker `w` on the floor; the escalation, or why not. */
  raise(floor: TeamFloor, w: WorkerInfo, ask: EscalationAsk): Escalation {
    return this.add(floor, { workerId: w.id, by: w.name, role: this.roster.roleOf(floor, w.id) }, ask);
  }

  /**
   * Raises one on a member's behalf, from what the office found in its handoff note (finishBench): it
   * stopped waiting on the Project Manager without having escalated. Never filed as FYI: the member is
   * benched and nothing else brings it back, so the Project Manager must see it in their approvals.
   */
  raiseFor(floor: TeamFloor, who: { workerId: string; by: string; role?: RoleId }, ask: EscalationAsk, source?: string): Escalation {
    return this.add(floor, who, ask, true, source);
  }

  /** `source`: the activity line for one the office raised, when it isn't from a handoff note (Jeff's). */
  private add(floor: TeamFloor, who: { workerId: string; by: string; role?: RoleId }, ask: EscalationAsk, byOffice = false, source?: string): Escalation {
    const d = this.roster.data(floor.id);
    const { role } = who;
    const team = role ? ROLE_BY_ID.get(role)!.team : undefined;
    const e = makeEscalation(ask, { workerId: who.workerId, by: who.by, ...(role ? { role } : {}), ...(team ? { team } : {}) }, d.settings.autonomy, randomBytes(5).toString('hex'), this.roster.deps.now());
    if (byOffice) e.fyi = false;
    d.escalations.push(e);
    audit.record({ floor: floor.id, actor: byOffice ? (source?.includes('Jeff') ? jeff() : office()) : agent(who.by, who.workerId), action: 'escalation.raise', target: { kind: 'escalation', id: e.id, label: e.title }, summary: `${byOffice ? `Escalated for ${who.by}` : 'Escalated to the Project Manager'} (${e.fyi ? 'FYI' : e.urgency}): ${e.title}`, details: { urgency: e.urgency, fyi: e.fyi, trigger: ask.trigger, role, worker: who.workerId }, severity: isAlarming(e) ? 'warning' : 'notice' });
    const loud = isAlarming(e);
    const tag = e.fyi ? 'FYI' : e.urgency;
    floor.activity?.(`${URGENCY_ICON[e.urgency]} ${byOffice ? (source ?? `The office escalated to the Project Manager for ${who.by}, from its handoff note`) : `${who.by} escalated to the Project Manager`} (${tag}): ${e.title}`);
    if (byOffice) floor.toast(`${URGENCY_ICON[e.urgency]} ${who.by} is waiting on you: ${e.title} — answer it in the approvals and the office brings ${who.by} back with your answer`, 'warn');
    if (loud) floor.toast(`${URGENCY_ICON[e.urgency]} ${e.urgency === 'critical' ? 'Critical' : 'Urgent'} escalation from ${who.by}: ${e.title} — answer it on the project console (🎛️ Command Center)`, 'warn');
    // The Coordinator relays and summarises: it isn't told about its own, or about FYIs (they're on the standup page).
    if (role !== 'pm' && !e.fyi) this.tellCoordinator(floor, e);
    this.roster.touch(floor);
    if (loud) floor.changed({ id: e.id, urgency: e.urgency as 'urgent' | 'critical', title: `${URGENCY_ICON[e.urgency]} ${who.by} needs the Project Manager`, body: e.title });
    return e;
  }

  /**
   * The Project Manager's answer: sent to the agent that raised it as its next prompt (an asleep one
   * wakes with it), and the escalation resolved. When the raiser was a team member that has gone home
   * (benched, or sent home), the role's current session gets it if it has one; otherwise the office
   * re-hires the role, and the answer is in its first message (Members.hire carries owed answers), so
   * the project picks up again without anyone hiring by hand. Not while hiring is paused by the cost
   * cap: then the answer waits for its next hire.
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
    let rehire = false;
    // A dismissed FYI doesn't spend a turn of the agent's; anything else is an answer it acts on.
    if (verdict !== 'dismiss') {
      const member = e.role ? d.members[e.role] : undefined;
      const w = floor.worker(e.workerId) ?? (member ? this.roster.workerOf(floor, member) : undefined);
      // One writing its handoff is about to be stopped: the answer is kept, and finishBench brings it back with it.
      const leaving = !!w && !!member && member.phase === 'benching' && member.workerId === w.id;
      if (!w && e.role) rehire = true;
      if (w && w.kind === 'agent' && !leaving) {
        const prompt = escalationAnswerPrompt(e, verdict, text, by);
        let err = isAsleepStatus(w.status) ? floor.wake(w.id, prompt) : floor.prompt(w.id, prompt);
        if (err === 'Worker is not running') err = floor.wake(w.id, prompt);
        delivered = !err;
        if (err) floor.toast(`Couldn't send the answer to ${e.by}: ${err}. It's kept for its next session.`, 'warn');
      }
    }
    e.status = 'resolved';
    e.resolution = { verdict, text, by, at: this.roster.deps.now(), delivered };
    audit.record({ floor: floor.id, actor: byWhom(by), action: 'escalation.answer', target: { kind: 'escalation', id: e.id, label: e.title }, summary: `Answered ${e.by}'s escalation (${verdict}): ${e.title}`, details: { verdict, delivered, rehire, reply: text ? { length: text.length } : undefined } });
    floor.activity?.(`✅ ${by} answered ${e.by}'s escalation (${verdict}): ${e.title}`);
    this.roster.touch(floor);
    if (rehire && e.role) this.rehire(floor, e.role);
    return undefined;
  }

  /** Roles the office is hiring back right now (floor:role), so answers in quick succession hire once. */
  private hiring = new Set<string>();

  /**
   * Brings a gone-home member back to act on the answers it's owed: a fresh hire primed with its
   * handoff note and those answers. Fire and forget (resolve is synchronous); a failure is toasted and
   * the answers stay owed. Answers that arrive while the hire is under way are owed too, and reach it
   * once its first turn is over (onMember).
   */
  private rehire(floor: TeamFloor, role: RoleId) {
    const key = `${floor.id}:${role}`;
    if (this.hiring.has(key)) return;
    const d = this.roster.data(floor.id);
    const m = d.members[role];
    // Still writing its handoff: finishBench calls afterBench once it's benched, which hires it back.
    if (m.phase === 'benching') return;
    const paused = this.roster.pauseOf(d);
    if (paused) {
      floor.toast(`${m.name} wasn't brought back to act on your answer: ${paused}. The answer is kept for its next hire.`, 'warn');
      return;
    }
    this.hiring.add(key);
    floor.activity?.(`🔁 The office is bringing ${m.name} back to act on the Project Manager's answer`);
    void this.roster.members
      .hire(floor, role, 'The office')
      .then((err) => {
        if (err) floor.toast(`Couldn't bring ${m.name} back with your answer: ${err}. The answer is kept for its next hire.`, 'warn');
      })
      .catch((err: unknown) => floor.toast(`Couldn't bring ${m.name} back with your answer: ${(err as Error)?.message ?? String(err)}. The answer is kept for its next hire.`, 'warn'))
      .finally(() => this.hiring.delete(key));
  }

  /** A member was just benched: answered escalations it hasn't heard yet bring it straight back. */
  afterBench(floor: TeamFloor, role: RoleId) {
    if (this.owed(floor, role).lines.length) this.rehire(floor, role);
  }

  /**
   * A member's worker changed: once its turn is over, it's told any answers it's owed that its hire
   * didn't carry (answered while the office was hiring it, or while its session was being cleared).
   */
  onMember(floor: TeamFloor, role: RoleId, w: WorkerInfo) {
    if (w.status !== 'idle' && w.status !== 'done') return;
    const m = this.roster.data(floor.id).members[role];
    if (m.phase !== 'active' || m.workerId !== w.id || w.kind !== 'agent') return;
    const owed = this.owed(floor, role);
    if (!owed.lines.length) return;
    if (!floor.prompt(w.id, owedAnswersPrompt(owed.lines))) owed.mark();
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
