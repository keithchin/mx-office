// The team phone's office side (shared/phone.ts; ui/phone/ in the browser): a person's message from the
// phone goes to the agents it's for through roster.delivery (held until their turn is over, never typed
// into a dialog, `by` the person so the turn is theirs and goes through a reached spend cap), or, in an
// escalation's thread, answers it through Escalations.resolve. The message is recorded in the floor's
// team chatter as said by the person, and once the agent has finished the turn that read it, its reply
// is taken from its transcript (reply.ts) and posted in the same thread. Nothing here is made up: a
// reply is the agent's own text, and with no transcript to read the office says it replied in its terminal.

import { randomBytes } from 'node:crypto';
import type { ChatterMessage, ChatterParty } from '../../shared/chatter.js';
import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import { channelView, dmThread, routeMessage, threadAgents, threadKey, type PhoneAgent, type PhonePlace } from '../../shared/phone.js';
import type { EscalationVerdict } from '../../shared/roster/escalation.js';
import { OFFICE, workerParty } from '../chatter/bus.js';
import type { Chatter } from '../chatter/index.js';
import { human } from '../chatter/sources.js';
import { isAsleepStatus } from '../roster/bench.js';
import { mayType } from '../roster/deliver.js';
import type { Roster } from '../roster/index.js';
import type { TeamFloor } from '../roster/types.js';
import { phonePrompt, phoneTag } from './prompt.js';
import { replyFromFile } from './reply.js';

/** A reply not seen this long after the message is given up on. */
export const PENDING_MS = 12 * 3_600_000;
/** Turns that end without the message in the transcript before the office says it replied in its terminal. */
const TRIES = 3;

export interface PhoneDeps {
  roster: Roster;
  chatter: Pick<Chatter, 'add' | 'file' | 'look'>;
  floor(id: string): TeamFloor | undefined;
  /** The worker's Claude Code transcript, when it has one. */
  transcript(floor: TeamFloor, w: WorkerInfo): string | undefined;
  now(): number;
}

export interface SendAsk {
  floor: string;
  text: string;
  place: PhonePlace;
  /** The person's name. */
  by: string;
  /** May answer escalations (the Project Manager). */
  admin: boolean;
  /** In an escalation's thread: Approve or Reject from its buttons (a typed message is a reply). */
  verdict?: EscalationVerdict;
}

export interface SentTo {
  workerId: string;
  name: string;
  /** sent: typed now; held: typed once its turn is over; woke: woken with it. */
  status: 'sent' | 'held' | 'woke';
}

export type SendResult = { ok: true; thread: string; to: SentTo[]; note?: string; resolved?: string; message?: ChatterMessage } | { ok: false; why: string; status: number };

/** A reply the phone is waiting for. */
export interface Pending {
  floor: string;
  workerId: string;
  name: string;
  thread: string;
  escalationId?: string;
  /** What the user message that carried it contains (its tag, or the escalation's title). */
  needle: string;
  by: string;
  at: number;
  /** When it was typed (or woken with); undefined while held, or for an escalation answer owed. */
  typedAt?: number;
  /** A turn has started since it was typed. */
  sawWork: boolean;
  tries: number;
}

const between = (s: WorkerStatus) => s === 'idle' || s === 'done';
const working = (s: WorkerStatus) => s === 'working' || s === 'starting' || s === 'needs_input';

export class Phone {
  readonly pending: Pending[] = [];

  constructor(readonly deps: PhoneDeps) {}

  /** The agents on the floor a message can go to, with their team role. */
  agents(floor: TeamFloor): PhoneAgent[] {
    return floor
      .workers()
      .filter((w) => w.kind === 'agent' && !w.lost)
      .map((w) => {
        const role = this.deps.roster.roleOf(floor, w.id);
        return { workerId: w.id, name: w.name, ...(role ? { role } : {}) };
      });
  }

  /** A thread's place as the office knows it: its agents and its escalation, from the floor's chatter. */
  private place(floor: TeamFloor, p: PhonePlace): PhonePlace {
    if (p.in !== 'thread') return p;
    const all = this.deps.chatter.file(floor.id).messages();
    const t = channelView(all.filter((m) => threadKey(m) === p.thread))[0];
    const esc = p.thread.startsWith('esc:') ? p.thread.slice(4) : undefined;
    return { in: 'thread', thread: p.thread, agents: t ? threadAgents(t) : [], ...(esc ? { escalationId: esc } : {}) };
  }

  send(ask: SendAsk): SendResult {
    const floor = this.deps.floor(ask.floor);
    if (!floor) return { ok: false, why: 'No such floor', status: 404 };
    const place = this.place(floor, ask.place);
    const agents = this.agents(floor);
    // Approve and Reject from an escalation's buttons: an answer with no words needed for Approve.
    if (ask.verdict && ask.verdict !== 'reply' && place.in === 'thread' && place.escalationId) return this.resolve(floor, place.escalationId, ask.verdict, ask.text.trim(), ask);
    const route = routeMessage(ask.text, place, agents);
    if (!route.ok) return { ok: false, why: route.why, status: 400 };
    if (route.resolve) return this.resolve(floor, route.resolve, 'reply', route.body, ask);
    const now = this.deps.now();
    const id = randomBytes(5).toString('hex');
    const thread = place.in === 'thread' ? place.thread : place.in === 'dm' && route.to.length === 1 && route.to[0].workerId === place.workerId ? dmThread(place.workerId) : `th-${id}`;
    const text = phonePrompt(ask.by, route.body, id, route.group === 'team');
    const to: SentTo[] = [];
    const refused: string[] = [];
    for (const a of route.to) {
      const w = floor.worker(a.workerId);
      if (!w) continue;
      const p: Pending = { floor: floor.id, workerId: w.id, name: w.name, thread, needle: phoneTag(id), by: ask.by, at: now, sawWork: false, tries: 0 };
      // Held until the turn under way is over (between), never into a dialog; an asleep one is woken with it.
      const r = this.deps.roster.delivery.send(floor, w, text, { origin: 'person', by: ask.by, wake: true, hold: true, between: true, id: `phone:${id}:${w.id}`, onSent: () => void (p.typedAt = this.deps.now()) });
      if (r.status === 'refused') {
        refused.push(`${w.name}: ${r.why}`);
        continue;
      }
      this.pending.push(p);
      to.push({ workerId: w.id, name: w.name, status: r.status });
    }
    if (!to.length) return { ok: false, why: refused.join('; ') || 'Nobody to send it to', status: 409 };
    const party = (a: PhoneAgent): ChatterParty => ({ ...workerParty({ id: a.workerId, name: a.name }), ...(a.role ? { roleId: a.role } : {}) });
    const message = this.deps.chatter.add(floor.id, { kind: 'message', from: human(ask.by), to: route.group === 'team' ? { group: 'team' } : party(route.to[0]), text: route.body, ref: { thread }, long: true });
    const note = [route.note, refused.length ? `Not sent to ${refused.join('; ')}` : ''].filter(Boolean).join('. ') || undefined;
    return { ok: true, thread, to, ...(note ? { note } : {}), ...(message ? { message } : {}) };
  }

  /** An answer to an escalation through the roster's own resolve: the raiser is told, Needs you and the approvals follow. */
  private resolve(floor: TeamFloor, id: string, verdict: EscalationVerdict, text: string, ask: SendAsk): SendResult {
    if (!ask.admin) return { ok: false, why: 'Only the Project Manager (an admin) can answer escalations', status: 403 };
    const e = this.deps.roster.data(floor.id).escalations.find((x) => x.id === id);
    const err = this.deps.roster.escalations.resolve(floor, id, verdict, text, ask.by);
    if (err || !e) return { ok: false, why: err ?? 'No such escalation', status: 400 };
    // The answer is in the chatter at once (the roster source's answer message), not at its next look.
    this.deps.chatter.look(floor, false);
    const w = floor.worker(e.workerId);
    const to: SentTo[] = [];
    if (w && w.kind === 'agent' && verdict !== 'dismiss') {
      const now = this.deps.now();
      // Typed now when no dialog was up; otherwise it's owed and typed once the turn is over (found by its title).
      const typed = mayType(w.status) && !isAsleepStatus(w.status);
      this.pending.push({ floor: floor.id, workerId: w.id, name: w.name, thread: `esc:${id}`, escalationId: id, needle: e.title, by: ask.by, at: now, ...(typed ? { typedAt: now } : {}), sawWork: false, tries: 0 });
      to.push({ workerId: w.id, name: w.name, status: typed ? 'sent' : 'held' });
    }
    return { ok: true, thread: `esc:${id}`, to, resolved: id };
  }

  /** The replies the floor is waiting for (the phone's "working on it…"). */
  pendingOn(floor: string): { workerId: string; thread: string; since: number }[] {
    return this.pending.filter((p) => p.floor === floor).map((p) => ({ workerId: p.workerId, thread: p.thread, since: p.at }));
  }

  /** Every worker update: a turn that read a phone message is over, so its reply goes in the thread. */
  onWorker(floor: TeamFloor, w: WorkerInfo) {
    const now = this.deps.now();
    for (const p of [...this.pending]) {
      if (now - p.at > PENDING_MS) {
        this.drop(p);
        continue;
      }
      if (p.workerId !== w.id || p.floor !== floor.id) continue;
      if (p.typedAt === undefined && !p.escalationId) continue;
      if (working(w.status)) {
        p.sawWork = true;
        continue;
      }
      if (p.sawWork && (between(w.status) || isAsleepStatus(w.status))) this.capture(floor, w, p);
    }
  }

  private drop(p: Pending) {
    const i = this.pending.indexOf(p);
    if (i >= 0) this.pending.splice(i, 1);
  }

  private capture(floor: TeamFloor, w: WorkerInfo, p: Pending) {
    const file = this.deps.transcript(floor, w);
    const ref = { thread: p.thread, ...(p.escalationId ? { escalationId: p.escalationId } : {}) };
    const note = (text: string) => this.deps.chatter.add(floor.id, { kind: 'message', from: OFFICE, to: human(p.by), text, ref: { ...ref, worker: w.id } });
    const said = file ? replyFromFile(file, p.needle) : undefined;
    if (said === undefined) {
      p.sawWork = false;
      p.tries++;
      // Not in the transcript yet (held, or owed behind a dialog): the next turn, unless it never will be.
      if (file && p.tries < TRIES) return;
      if (p.typedAt === undefined) return;
      note(`${w.name} replied in its terminal → Open it to read the answer.`);
    } else if (!said) note(`${w.name} finished the turn without writing a reply → Open its terminal to see what it did.`);
    else this.deps.chatter.add(floor.id, { kind: 'message', from: workerParty(w), to: human(p.by), text: said, ref, long: true });
    this.drop(p);
  }
}
