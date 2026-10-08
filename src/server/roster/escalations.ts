// The escalation channel to the Project Manager (the human): an agent raises one with
// `office-workers escalate` or the `escalate` MCP tool (hooks/office-escalate.ts); it's kept on the
// floor's roster, shown on the project console (🎛️ Command Center) and in the Team tab's approvals, toasted and
// sent as a desktop alert when it's urgent or critical and above the floor's threshold, and the
// Project Coordinator hears about it (batched, a minute after the last) so it can summarise it at the
// standup. The human's Reply / Approve / Reject goes back to the raising agent as a prompt and
// resolves it. The office never blocks on one; the only model it asks is Jeff, how soon to resolve it
// (jeff-priority.ts: a sort order, re-ranked as one is raised or answered).

import { randomBytes } from 'node:crypto';
import type { WorkerInfo } from '../../shared/protocol.js';
import { URGENCY_ICON, VERDICT_WORD, isAlarming, escalationOrder, makeEscalation, type Escalation, type EscalationAsk, type EscalationVerdict } from '../../shared/roster/escalation.js';
import { ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';
import { URGENCIES, isFyi } from '../../shared/roster/autonomy.js';
import { isAsleepStatus } from './bench.js';
import { mayType } from './deliver.js';
import { sameAsk } from './jeff-ask.js';
import { coordinatorIs, queueOnce } from './relays.js';
import { managerRole } from './coverage.js';
import { SameAsk } from './jeff-same.js';
import type { Roster } from './index.js';
import { escalationAnswerPrompt, escalationsToCoordinatorPrompt } from './prompts.js';
import type { TeamFloor } from './types.js';
import { audit, agent, byWhom, jeff, office } from '../audit/index.js';
import { relayedToCoordinator } from '../chatter/hooks.js';

/** The Project Coordinator hears about new escalations this long after the last one, all in one message. */
export const COORDINATOR_DEBOUNCE_MS = 60_000;
/** Answered escalations the console keeps showing. */
const RESOLVED_SHOWN = 10;
/** An answer a worker (not a team member) couldn't be told when it came is typed to it within this long. */
const OWED_MS = 24 * 3_600_000;

/** An answer as one line of the message that carries several. */
const answerLine = (e: Escalation) => `- “${e.title}”: ${VERDICT_WORD[e.resolution!.verdict]}${e.resolution!.text ? ` — ${e.resolution!.text}` : ''} (${e.resolution!.by})`;

export class Escalations {
  /** The Coordinator's debounce per floor; what it's to hear is in the roster file's outbox. */
  private timers = new Map<string, NodeJS.Timeout>();
  /** Jeff's "the same ask in other words?" (jeff-same.ts). */
  private same: SameAsk;

  constructor(private roster: Roster) {
    this.same = new SameAsk(() => roster.deps.now());
  }

  /** Raises one from worker `w` on the floor; the escalation, or why not. */
  raise(floor: TeamFloor, w: WorkerInfo, ask: EscalationAsk): Escalation {
    return this.add(floor, { workerId: w.id, by: w.name, role: this.roster.roleOf(floor, w.id) }, ask);
  }

  /**
   * An agent's own escalation (`office-workers escalate`): when one about the same is already open on
   * the floor (sameAsk: the same title, or nearly), it joins that one as a "+1" instead of raising a
   * second (the same CI secret was once raised nine times), and gets the answer too.
   */
  raiseOrJoin(floor: TeamFloor, w: WorkerInfo, ask: EscalationAsk): { escalation: Escalation; joined: boolean } {
    const same = this.joinable(floor, ask).find((e) => sameAsk(e.title, ask.title));
    if (!same) return { escalation: this.raise(floor, w, ask), joined: false };
    return { escalation: this.join(floor, w, ask, same), joined: true };
  }

  /**
   * raiseOrJoin, and when no open one has the same title, Jeff is asked whether one is the same ask in
   * other words ("Set repo secret X", "One command to set the e2e secret", "Secret 404": one ask). He's
   * asked only while his waiting judgement isn't off, and only a confident yes joins; no answer in time,
   * or any failure, raises it as before.
   */
  async raiseOrJoinJudged(floor: TeamFloor, w: WorkerInfo, ask: EscalationAsk): Promise<{ escalation: Escalation; joined: boolean; byJeff?: boolean }> {
    const open = this.joinable(floor, ask);
    const judge = this.roster.deps.judge;
    if (judge && open.length && this.roster.data(floor.id).settings.jeff.waiting !== 'off' && !open.some((e) => sameAsk(e.title, ask.title))) {
      const same = await this.same.find(floor.id, judge, ask, open);
      // Answered while Jeff was thinking: it's a new ask again.
      if (same?.status === 'open') return { escalation: this.join(floor, w, ask, same, true), joined: true, byJeff: true };
    }
    return this.raiseOrJoin(floor, w, ask);
  }

  /** The open ones a new ask could join: a loud one doesn't hide inside an FYI, which only another FYI joins. */
  private joinable(floor: TeamFloor, ask: EscalationAsk): Escalation[] {
    const d = this.roster.data(floor.id);
    const fyi = isFyi(d.settings.autonomy, ask.urgency, ask.trigger);
    return d.escalations.filter((e) => e.status === 'open' && (!e.fyi || fyi));
  }

  /** Worker `w`'s ask added to `same` as a +1: its details, a louder urgency, and it hears the answer too. */
  private join(floor: TeamFloor, w: WorkerInfo, ask: EscalationAsk, same: Escalation, byJeff = false): Escalation {
    if (w.id !== same.workerId && !same.also?.some((a) => a.workerId === w.id)) {
      const role = this.roster.roleOf(floor, w.id);
      (same.also ??= []).push({ workerId: w.id, by: w.name, ...(role ? { role } : {}), at: this.roster.deps.now() });
    }
    const note = [`+1 from ${w.name}: ${ask.title}`, ask.details.slice(0, 1500)].filter(Boolean).join('\n');
    same.details = `${same.details}\n\n${note}`.slice(-12_000);
    if (URGENCIES.indexOf(ask.urgency) > URGENCIES.indexOf(same.urgency)) same.urgency = ask.urgency;
    audit.record({ floor: floor.id, actor: agent(w.name, w.id), action: 'escalation.raise', target: { kind: 'escalation', id: same.id, label: same.title }, summary: `+1 on ${same.by}'s open escalation (the same ask${byJeff ? ', in Jeff’s judgement' : ''}): ${ask.title}`, details: { joined: same.id, urgency: ask.urgency, worker: w.id, ...(byJeff ? { by: 'jeff' } : {}) }, severity: 'info' });
    floor.activity?.(`➕ ${w.name} raised the same as ${same.by}'s open escalation${byJeff ? ' (Jeff judged it the same ask)' : ''}: ${same.title}`);
    this.roster.touch(floor);
    return same;
  }

  /**
   * Raises one on a member's behalf, from what the office found in its handoff note (finishBench): it
   * stopped waiting on the Project Manager without having escalated. Never filed as FYI: the member is
   * benched and nothing else brings it back, so the Project Manager must see it in their approvals.
   */
  raiseFor(floor: TeamFloor, who: { workerId: string; by: string; role?: RoleId }, ask: EscalationAsk, source?: string): Escalation {
    return this.add(floor, who, ask, true, source);
  }

  /**
   * Raises one the office noticed on a member's behalf while it's still at work (a subagent's review
   * loop out of rounds, subagents.ts): FYI or not by the floor's level, as if the member had raised it.
   */
  raiseNoticed(floor: TeamFloor, who: { workerId: string; by: string; role?: RoleId }, ask: EscalationAsk, source: string): Escalation {
    return this.add(floor, who, ask, true, source, 'level');
  }

  /** Raises one from worker `w` that's FYI whatever the level: a Lead's subagent decision whose gate is fyi (roster/subagents.ts). */
  raiseFyi(floor: TeamFloor, w: WorkerInfo, ask: EscalationAsk): Escalation {
    return this.add(floor, { workerId: w.id, by: w.name, role: this.roster.roleOf(floor, w.id) }, ask, false, undefined, true);
  }

  /**
   * `source`: the activity line for one the office raised, when it isn't from a handoff note (Jeff's).
   * `fyi`: true files it as FYI whatever the level; false (the default) leaves it to the level, except
   * that one the office raised is never FYI; 'level' leaves it to the level even then.
   */
  private add(floor: TeamFloor, who: { workerId: string; by: string; role?: RoleId }, ask: EscalationAsk, byOffice = false, source?: string, fyi: boolean | 'level' = false): Escalation {
    const d = this.roster.data(floor.id);
    const { role } = who;
    const team = role ? ROLE_BY_ID.get(role)!.team : undefined;
    const e = makeEscalation(ask, { workerId: who.workerId, by: who.by, ...(role ? { role } : {}), ...(team ? { team } : {}) }, d.settings.autonomy, randomBytes(5).toString('hex'), this.roster.deps.now());
    if (byOffice && fyi === false) e.fyi = false;
    if (fyi === true) e.fyi = true;
    d.escalations.push(e);
    audit.record({ floor: floor.id, actor: byOffice ? (source?.includes('Jeff') ? jeff() : office()) : agent(who.by, who.workerId), action: 'escalation.raise', target: { kind: 'escalation', id: e.id, label: e.title }, summary: `${byOffice ? `Escalated for ${who.by}` : 'Escalated to the Project Manager'} (${e.fyi ? 'FYI' : e.urgency}): ${e.title}`, details: { urgency: e.urgency, fyi: e.fyi, trigger: ask.trigger, role, worker: who.workerId }, severity: isAlarming(e) ? 'warning' : 'notice' });
    const loud = isAlarming(e);
    const tag = e.fyi ? 'FYI' : e.urgency;
    floor.activity?.(`${URGENCY_ICON[e.urgency]} ${byOffice ? (source ?? `The office escalated to the Project Manager for ${who.by}, from its handoff note`) : `${who.by} escalated to the Project Manager`} (${tag}): ${e.title}`);
    if (byOffice && !e.fyi) floor.toast(`${URGENCY_ICON[e.urgency]} ${who.by} is waiting on you: ${e.title} — answer it in the approvals and the office brings ${who.by} back with your answer`, 'warn');
    if (loud) floor.toast(`${URGENCY_ICON[e.urgency]} ${e.urgency === 'critical' ? 'Critical' : 'Urgent'} escalation from ${who.by}: ${e.title} — answer it on the project console (🎛️ Command Center)`, 'warn');
    // The Coordinator relays and summarises: it isn't told about its own, or about FYIs (they're on the standup page).
    if (role !== managerRole(d) && !e.fyi) this.tellCoordinator(floor, e);
    this.roster.touch(floor);
    if (loud) floor.changed({ id: e.id, urgency: e.urgency as 'urgent' | 'critical', title: `${URGENCY_ICON[e.urgency]} ${who.by} needs the Project Manager`, body: e.title });
    this.roster.jeff.priority.kick(floor);
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
    /** Who'll be told once the question in their terminal is answered: never typed into a dialog, where Enter would pick an option. */
    const later: string[] = [];
    // A dismissed FYI doesn't spend a turn of the agent's; anything else is an answer it acts on.
    if (verdict !== 'dismiss') {
      const member = e.role ? d.members[e.role] : undefined;
      const w = floor.worker(e.workerId) ?? (member ? this.roster.workerOf(floor, member) : undefined);
      // One writing its handoff is about to be stopped: the answer is kept, and finishBench brings it back with it.
      const leaving = !!w && !!member && member.phase === 'benching' && member.workerId === w.id;
      if (!w && e.role) rehire = true;
      const prompt = escalationAnswerPrompt(e, verdict, text, by);
      // A dialog may be up (a permission prompt, a question, booting): the answer stays owed and goes in once its turn is over (Delivery.onWorker).
      const busy = (x: WorkerInfo) => !mayType(x.status) && !isAsleepStatus(x.status);
      if (w && w.kind === 'agent' && !leaving) {
        if (busy(w)) later.push(e.by);
        else {
          // `by`: the turn acting on a person's answer is theirs, not the office's (it flags when it's done).
          const r = this.roster.delivery.send(floor, w, prompt, { origin: 'person', by, wake: true, resume: true });
          delivered = r.status !== 'refused';
          if (r.status === 'refused') floor.toast(`Couldn't send the answer to ${e.by}: ${r.why}. It's kept for its next session.`, 'warn');
        }
      }
      // Those that +1'd it (raiseOrJoin) hear the answer too, when they're still at their desks.
      for (const a of e.also ?? []) {
        const other = floor.worker(a.workerId);
        if (!other || other.kind !== 'agent' || other.id === w?.id) continue;
        if (busy(other)) {
          a.pending = true;
          later.push(a.by);
          continue;
        }
        const r = this.roster.delivery.send(floor, other, prompt, { origin: 'person', by, wake: true, resume: true });
        if (r.status === 'refused') floor.toast(`Couldn't send the answer to ${a.by}, who raised the same`, 'warn');
      }
    }
    e.status = 'resolved';
    e.resolution = { verdict, text, by, at: this.roster.deps.now(), delivered };
    audit.record({ floor: floor.id, actor: byWhom(by), action: 'escalation.answer', target: { kind: 'escalation', id: e.id, label: e.title }, summary: `Answered ${e.by}'s escalation (${verdict}): ${e.title}`, details: { verdict, delivered, rehire, ...(later.length ? { later } : {}), reply: text ? { length: text.length } : undefined } });
    floor.activity?.(`✅ ${by} answered ${e.by}'s escalation (${verdict}): ${e.title}`);
    if (later.length) floor.activity?.(`⏳ ${later.join(', ')} ${later.length === 1 ? 'has' : 'have'} a question open in ${later.length === 1 ? 'its' : 'their'} terminal: the answer goes in once that's answered`);
    // A Lead's `ask` to warn, bench, swap or reinstate a subagent: approving it does it.
    this.roster.subagents.onEscalationResolved(floor, e.id, verdict, by);
    this.roster.touch(floor);
    this.roster.jeff.priority.kick(floor);
    if (rehire && e.role) this.rehire(floor, e.role);
    return undefined;
  }

  /** Roles the office is hiring back right now (floor:role), so answers in quick succession hire once. */
  private hiring = new Set<string>();

  /**
   * Brings a gone-home member back to act on the answers it's owed: a fresh hire primed with its
   * handoff note and those answers. Fire and forget (resolve is synchronous); a failure is toasted and
   * the answers stay owed. Answers that arrive while the hire is under way are owed too, and reach it
   * once its first turn is over (owedTo, typed by Delivery.onWorker).
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
   * Answers worker `w` is owed and hasn't been told, for Delivery.onWorker to type once its turn is
   * over: those that came while a dialog was up in its terminal, and a member's that its hire didn't
   * carry (answered while the office was hiring it, or while its session was being cleared); also the
   * ones it +1'd. `mark` once they're typed. None for a member that isn't at work (writing its handoff:
   * its next hire carries them).
   */
  owedTo(floor: TeamFloor, w: WorkerInfo): { lines: string[]; mark(): void } {
    const d = this.roster.data(floor.id);
    const role = this.roster.roleOf(floor, w.id);
    const m = role ? d.members[role] : undefined;
    if (m && (m.phase !== 'active' || m.workerId !== w.id)) return { lines: [], mark() {} };
    const since = this.roster.deps.now() - OWED_MS;
    const answered = d.escalations.filter((e) => e.status === 'resolved' && e.resolution && e.resolution.verdict !== 'dismiss');
    const own = answered.filter((e) => !e.resolution!.delivered && ((!!role && e.role === role) || (e.workerId === w.id && e.resolution!.at >= since)));
    const plus = answered.flatMap((e) => (e.also ?? []).filter((a) => a.pending && a.workerId === w.id).map((a) => ({ e, a })));
    return {
      lines: [...own, ...plus.map((p) => p.e)].map(answerLine),
      mark: () => {
        own.forEach((e) => (e.resolution!.delivered = true));
        plus.forEach((p) => delete p.a.pending);
        if (own.length || plus.length) this.roster.touch(floor, true);
      },
    };
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
      lines: list.map(answerLine),
      mark: () => list.forEach((e) => (e.resolution!.delivered = true)),
    };
  }

  // ---- Telling the Project Coordinator ---------------------------------------------------------
  // What it hasn't heard is kept in the roster file (relays.ts), so a restart doesn't lose it; only
  // the minute's debounce is in memory.

  private tellCoordinator(floor: TeamFloor, e: Escalation) {
    const d = this.roster.data(floor.id);
    d.outbox.escalations = queueOnce(d.outbox.escalations, e.id);
    clearTimeout(this.timers.get(floor.id));
    const timer = setTimeout(() => this.flushCoordinator(floor), COORDINATOR_DEBOUNCE_MS);
    timer.unref?.();
    this.timers.set(floor.id, timer);
  }

  /** The Coordinator's worker changed: back at its desk with escalations it hasn't heard yet. */
  onCoordinator(floor: TeamFloor, w: WorkerInfo) {
    if (this.roster.data(floor.id).outbox.escalations.length && !this.timers.has(floor.id) && (w.status === 'idle' || w.status === 'done')) this.flushCoordinator(floor);
  }

  /** The minute's look: what waited through a restart (no timer then) goes out once it can. */
  tick(floor: TeamFloor) {
    if (this.roster.data(floor.id).outbox.escalations.length && !this.timers.has(floor.id)) this.flushCoordinator(floor);
  }

  /**
   * Sends the Coordinator the queued escalations if it's at work; still-open ones only. An asleep,
   * benched or busy-asking one isn't woken (that costs a session): they wait in the outbox. A floor
   * with no Coordinator at all lets them go: nobody else relays, the raiser already knows, and they're
   * on the console and the next standup page anyway.
   */
  flushCoordinator(floor: TeamFloor): boolean {
    const d = this.roster.data(floor.id);
    if (!d.outbox.escalations.length) return false;
    clearTimeout(this.timers.get(floor.id));
    this.timers.delete(floor.id);
    const open = d.outbox.escalations.map((id) => d.escalations.find((e) => e.id === id)).filter((e): e is Escalation => !!e && e.status === 'open');
    const where = coordinatorIs(this.roster, floor);
    if (where === 'away') {
      d.outbox.escalations = open.map((e) => e.id);
      this.roster.touch(floor, true);
      return false;
    }
    // Asleep: woken once with everything it's owed (relays.ts wakeCoordinator), at most once a window.
    if (where === 'asleep') {
      d.outbox.escalations = open.map((e) => e.id);
      return this.roster.relays.wakeCoordinator(floor);
    }
    d.outbox.escalations = [];
    this.roster.touch(floor, true);
    if (where === 'none' || !open.length) return false;
    const w = this.roster.workerOf(floor, d.members[managerRole(d)])!;
    // Refused after all (it just went busy): they stay for its next turn.
    if (this.roster.delivery.prompt(floor, w, escalationsToCoordinatorPrompt(open))) {
      d.outbox.escalations = open.map((e) => e.id);
      return false;
    }
    relayedToCoordinator(floor.id, w, open);
    return true;
  }
}
