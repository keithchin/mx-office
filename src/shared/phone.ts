// The team phone (ui/phone/ in the browser, server/phone/ in the office): the floor's team chatter as a
// Slack-like chat, with a composer that messages the agents, and the Needs-you items as notifications.
// What's here is pure and both sides use it: who a message goes to, the threads, the badge and read
// state, and when an alert may go off (Do not disturb, the digest).

import type { RoleId } from './roster/roles.js';
import type { ChatterMessage } from './chatter.js';

// ---- Who a message goes to -----------------------------------------------------------------------------

/** An agent on the floor a message can go to: its worker, and its role when it's on the project team. */
export interface PhoneAgent {
  workerId: string;
  name: string;
  role?: RoleId;
}

/** Where the message is written: a project channel, a DM with one agent, or a thread. */
export type PhonePlace =
  | { in: 'channel' }
  | { in: 'dm'; workerId: string }
  /** A thread: its key (threadKey), the agents in it, and the escalation when it's one. */
  | { in: 'thread'; thread: string; agents: string[]; escalationId?: string };

export type PhoneRoute =
  | {
      ok: true;
      to: PhoneAgent[];
      /** A message to every active Lead (`@team …`). */
      group?: 'team';
      /** What's sent, without the @mention. */
      body: string;
      /** The escalation this answers, through the roster's resolve. */
      resolve?: string;
      /** Something the person should know about who it went to (no Coordinator on the floor, say). */
      note?: string;
    }
  | { ok: false; why: string };

/** The longest message the phone sends. */
export const PHONE_TEXT_MAX = 4000;

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_-]/u.test(c);

/** An @mention at the start of `text`: `@team`, or an agent's name (the longest that fits, any case). */
export function parseMention(text: string, agents: readonly PhoneAgent[]): { mention?: 'team' | PhoneAgent | string; body: string } {
  const t = text.trim();
  if (!t.startsWith('@')) return { body: t };
  const rest = t.slice(1);
  const after = (n: number) => rest.slice(n).replace(/^[\s,:]+/, '').trim();
  if (/^team(?![\p{L}\p{N}_-])/iu.test(rest)) return { mention: 'team', body: after(4) };
  const byLength = [...agents].sort((a, b) => b.name.length - a.name.length);
  for (const a of byLength) {
    if (rest.slice(0, a.name.length).toLowerCase() === a.name.toLowerCase() && !isWordChar(rest[a.name.length])) return { mention: a, body: after(a.name.length) };
  }
  const word = /^[^\s,:]+/.exec(rest)?.[0] ?? '';
  return { mention: word, body: after(word.length) };
}

/** The active Leads: the team's members at work on the floor, the Project Coordinator aside. */
export const leadsOf = (agents: readonly PhoneAgent[]) => agents.filter((a) => a.role && a.role !== 'pm');

/** What `@team` costs, before it's sent: every active Lead takes a turn. */
export function teamWarning(agents: readonly PhoneAgent[]): string | undefined {
  const n = leadsOf(agents).length;
  return n ? `This wakes ${n} agent${n === 1 ? '' : 's'} (≈${n} turn${n === 1 ? '' : 's'})` : undefined;
}

/**
 * Where a plain message in a project channel goes: the Project Coordinator; with none on the floor, the
 * Chief Analyst, else any Lead, else any agent, with a note saying so.
 */
export function defaultRecipient(agents: readonly PhoneAgent[]): { to?: PhoneAgent; note?: string } {
  const pm = agents.find((a) => a.role === 'pm');
  if (pm) return { to: pm };
  const lead = agents.find((a) => a.role === 'chief-analyst') ?? leadsOf(agents)[0];
  if (lead) return { to: lead, note: `This floor has no Project Coordinator at work, so it went to ${lead.name}` };
  const any = agents[0];
  if (any) return { to: any, note: `This floor has no project team at work, so it went to ${any.name}` };
  return {};
}

/** Who a message written at `place` goes to. `agents`: the agents on the floor now. */
export function routeMessage(text: string, place: PhonePlace, agents: readonly PhoneAgent[]): PhoneRoute {
  const { mention, body } = parseMention(text, agents);
  if (!body) return { ok: false, why: mention ? 'Write something after the @mention' : 'Write a message' };
  if (body.length > PHONE_TEXT_MAX) return { ok: false, why: `That's longer than ${PHONE_TEXT_MAX} characters` };
  if (mention === 'team') {
    const leads = leadsOf(agents);
    return leads.length ? { ok: true, to: leads, group: 'team', body } : { ok: false, why: 'No Leads are at work on this floor' };
  }
  if (typeof mention === 'string') return { ok: false, why: `Nobody called @${mention} is on this floor` };
  if (mention) return { ok: true, to: [mention], body };
  const byId = (id: string) => agents.find((a) => a.workerId === id);
  if (place.in === 'dm') {
    const a = byId(place.workerId);
    return a ? { ok: true, to: [a], body } : { ok: false, why: "That agent isn't on this floor any more" };
  }
  if (place.in === 'thread') {
    const in_ = place.agents.map(byId).filter((a): a is PhoneAgent => !!a);
    if (place.escalationId) return { ok: true, to: in_.slice(0, 1), body, resolve: place.escalationId };
    if (in_.length) return { ok: true, to: in_, body };
  }
  const d = defaultRecipient(agents);
  if (!d.to) return { ok: false, why: 'There are no agents on this floor to message' };
  const note = place.in === 'thread' ? `Nobody from that thread is on the floor now, so it went to ${d.to.name}` : d.note;
  return { ok: true, to: [d.to], body, ...(note ? { note } : {}) };
}

// ---- Threads ---------------------------------------------------------------------------------------------

/** A DM's thread key: everything said between the person and one agent. */
export const dmThread = (workerId: string) => `dm-${workerId}`;

/** The thread a message is in: one the phone started, or an escalation and its answers. */
export function threadKey(m: Pick<ChatterMessage, 'ref'>): string | undefined {
  if (m.ref?.thread) return m.ref.thread;
  if (m.ref?.escalationId) return `esc:${m.ref.escalationId}`;
  return undefined;
}

export interface ThreadView {
  key: string;
  root: ChatterMessage;
  replies: ChatterMessage[];
  last: number;
}

/**
 * A channel's messages as a Slack channel shows them, oldest first: a message on its own, or a thread's
 * root with its replies under it (the root is the thread's first message).
 */
export function channelView(messages: readonly ChatterMessage[]): ThreadView[] {
  const byKey = new Map<string, ThreadView>();
  const out: ThreadView[] = [];
  for (const m of [...messages].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
    const k = threadKey(m);
    const t = k ? byKey.get(k) : undefined;
    if (t) {
      t.replies.push(m);
      t.last = m.at;
      continue;
    }
    const v: ThreadView = { key: k ?? `m:${m.id}`, root: m, replies: [], last: m.at };
    if (k) byKey.set(k, v);
    out.push(v);
  }
  return out;
}

/** The agents in a thread (its speakers and who they spoke to), by worker. */
export function threadAgents(t: Pick<ThreadView, 'root' | 'replies'>): string[] {
  const ids = new Set<string>();
  for (const m of [t.root, ...t.replies]) {
    for (const p of [m.from, m.to]) if (!('group' in p) && p.kind === 'agent' && p.workerId) ids.add(p.workerId);
  }
  return [...ids];
}

/** What's said between the person and one agent, oldest first. */
export function dmMessages(messages: readonly ChatterMessage[], workerId: string): ChatterMessage[] {
  const isIt = (p: ChatterMessage['from'] | ChatterMessage['to']) => !('group' in p) && p.workerId === workerId;
  const isMe = (p: ChatterMessage['from'] | ChatterMessage['to']) => ('group' in p ? p.group === 'pm' : p.kind === 'human');
  return messages.filter((m) => m.ref?.thread === dmThread(workerId) || (isIt(m.from) && isMe(m.to)) || (isMe(m.from) && isIt(m.to))).sort((a, b) => a.at - b.at);
}

// ---- The badge and what's been read --------------------------------------------------------------------

/** Read state: per channel ("floor:<id>", "dm:<floor>:<worker>"), the time of the newest message read. */
export type PhoneReads = Record<string, number>;

export const floorChannel = (floor: string) => `floor:${floor}`;
export const dmChannel = (floor: string, workerId: string) => `dm:${floor}:${workerId}`;

/** Messages in a channel nobody has read: newer than what was read, and not the person's own. */
export function unreadIn(messages: readonly Pick<ChatterMessage, 'at' | 'from'>[], readAt: number | undefined): number {
  const since = readAt ?? 0;
  return messages.filter((m) => m.at > since && m.from.kind !== 'human').length;
}

/** Merges two read states: the later read wins for each channel. */
export function mergeReads(a: PhoneReads, b: PhoneReads): PhoneReads {
  const out: PhoneReads = { ...a };
  for (const [k, v] of Object.entries(b)) if (typeof v === 'number' && Number.isFinite(v) && v > (out[k] ?? 0)) out[k] = v;
  return out;
}

/** Only well-formed channels and times, at most `max` of them (the newest). */
export function cleanReads(v: unknown, max = 500): PhoneReads {
  if (!v || typeof v !== 'object') return {};
  const ok = Object.entries(v as Record<string, unknown>).filter((e): e is [string, number] => /^(floor|dm):[\w.:-]{1,160}$/.test(e[0]) && typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0);
  return Object.fromEntries(ok.sort((a, b) => b[1] - a[1]).slice(0, max));
}

export type Badge = { kind: 'count'; n: number } | { kind: 'dot' } | { kind: 'none' };

/** The launcher's (and a channel's) badge: a red count of what needs the person, else a grey dot for unread messages. */
export function badgeOf(needs: number, unread: number): Badge {
  if (needs > 0) return { kind: 'count', n: needs };
  return unread > 0 ? { kind: 'dot' } : { kind: 'none' };
}

// ---- Do not disturb and the digest -----------------------------------------------------------------------

export type DndChoice = 'off' | 'on' | '1h' | 'tomorrow';

export interface AlertSettings {
  /** Do not disturb until then (ms); Infinity until turned off; 0 off. */
  dndUntil: number;
  /** Bundle alerts that aren't urgent into one every this many minutes (0: send each as it comes). */
  digestMinutes: number;
  /** A short sound with an alert. */
  sound: boolean;
}

export const DEFAULT_ALERTS: AlertSettings = { dndUntil: 0, digestMinutes: 0, sound: true };
export const DIGEST_CHOICES = [0, 15, 30, 60] as const;

/** When Do not disturb ends for a choice made at `now`: tomorrow is 9:00 on the next day (local time). */
export function dndUntil(choice: DndChoice, now: number): number {
  if (choice === 'off') return 0;
  if (choice === 'on') return Infinity;
  if (choice === '1h') return now + 3_600_000;
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

export const isQuiet = (s: Pick<AlertSettings, 'dndUntil'>, now: number) => s.dndUntil === Infinity || s.dndUntil > now;

/** What happens to a new alert: shown now, kept for the digest, or dropped (Do not disturb). */
export function alertPlan(urgent: boolean, s: AlertSettings, now: number): 'now' | 'digest' | 'drop' {
  if (isQuiet(s, now)) return 'drop';
  return !urgent && s.digestMinutes > 0 ? 'digest' : 'now';
}

/** Whether the digest is due: something is waiting and the last one went out at least N minutes ago. */
export function digestDue(s: Pick<AlertSettings, 'digestMinutes'>, waiting: number, lastAt: number, now: number): boolean {
  return waiting > 0 && s.digestMinutes > 0 && now - lastAt >= s.digestMinutes * 60_000;
}

/** Settings from storage, anything malformed back to its default. */
export function cleanAlerts(v: unknown): AlertSettings {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof AlertSettings, unknown>>;
  const dnd = s.dndUntil === null || s.dndUntil === 'on' ? Infinity : typeof s.dndUntil === 'number' && s.dndUntil >= 0 ? s.dndUntil : 0;
  const digest = typeof s.digestMinutes === 'number' && (DIGEST_CHOICES as readonly number[]).includes(s.digestMinutes) ? s.digestMinutes : 0;
  return { dndUntil: dnd, digestMinutes: digest, sound: s.sound !== false };
}

/** Settings as they're stored (JSON has no Infinity). */
export const storedAlerts = (s: AlertSettings) => ({ ...s, dndUntil: s.dndUntil === Infinity ? 'on' : s.dndUntil });
