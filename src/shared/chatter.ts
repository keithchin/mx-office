// Team chatter (server/chatter/): the agent-to-agent exchanges on a floor as one thread, who said what
// to whom. Every message comes from something the office already did or read: an escalation and its
// answer, a relay to the Project Coordinator, a review nudge, a standup, a journal entry, a subagent
// dispatch and its review, a handoff note, a PR handed over, a Firm reviewer's question and its answer.
// Pure: the browser imports it too.

import type { RoleId, TeamId } from './roster/roles.js';

export type ChatterKind = 'relay' | 'escalation' | 'answer' | 'journal' | 'handoff' | 'dispatch' | 'review' | 'standup' | 'nudge' | 'firm' | 'message';
/** Who's talking: an agent, the human Project Manager, the office itself, Jeff (the Router), or a Firm reviewer. */
export type PartyKind = 'agent' | 'human' | 'office' | 'jeff' | 'reviewer';

export interface ChatterParty {
  name: string;
  /** Its role as words ("Lead Developer", "Project Manager", "Hedy's subagent"). */
  role?: string;
  kind: PartyKind;
  /** The roster role, when it's a team member: its outfit and team color. */
  roleId?: RoleId;
  team?: TeamId;
  /** The worker it is (its terminal), when it's a worker on the floor. */
  workerId?: string;
  /** The Firm reviewer it is (shared/firm/roles.ts), for its portrait. */
  reviewer?: string;
}

/** To a party, or to a group: the whole team, or the Project Manager (the human). */
export type ChatterTo = ChatterParty | { group: 'team' | 'pm' };

export interface ChatterRef {
  escalationId?: string;
  pr?: number;
  /** `docs/team/<team>.md#<heading>`. */
  journal?: string;
  subagent?: string;
  standup?: string;
  /** The Firm engagement an interview is part of. */
  engagement?: string;
  /** The team phone's thread it's in (shared/phone.ts): a person's message and the agents' replies to it. */
  thread?: string;
  /** The worker a team phone note is about ("replied in its terminal"), for its Open terminal. */
  worker?: string;
}

export interface ChatterMessage {
  id: string;
  at: number;
  floor: string;
  from: ChatterParty;
  to: ChatterTo;
  kind: ChatterKind;
  /** Clipped and redacted. */
  text: string;
  ref?: ChatterRef;
}

/** GET /api/chatter: newest first; `cursor` asks for the next page (older). */
export interface ChatterPage {
  floor: string;
  messages: ChatterMessage[];
  cursor?: string;
}

export const CHATTER_ICON: Record<ChatterKind, string> = {
  relay: '🔁',
  escalation: '🚩',
  answer: '✅',
  journal: '📓',
  handoff: '🤝',
  dispatch: '🧩',
  review: '🔍',
  standup: '📋',
  nudge: '👉',
  firm: '🏛️',
  message: '📱',
};

export const CHATTER_WORD: Record<ChatterKind, string> = {
  relay: 'relay',
  escalation: 'escalation',
  answer: 'answer',
  journal: 'journal',
  handoff: 'handoff',
  dispatch: 'dispatch',
  review: 'review',
  standup: 'standup',
  nudge: 'nudge',
  firm: 'interview',
  message: 'message',
};

/** Longest text a message keeps. */
export const CHATTER_TEXT_MAX = 400;
/** Longest a team phone message (a person's, or an agent's reply to one) keeps, with its lines and Markdown. */
export const CHATTER_LONG_MAX = 4000;

export const isGroup = (t: ChatterTo): t is { group: 'team' | 'pm' } => 'group' in t;

/** The thread's filters: everything, only agents among themselves, only what involves you (the human), or one person. */
export type ChatterFilter = { with: 'all' } | { with: 'agents' } | { with: 'me' } | { with: 'person'; name: string; kind?: PartyKind };

/** Whether a message involves the human Project Manager: said by them, or to them. Never by name: an agent may share it. */
export function withHuman(m: Pick<ChatterMessage, 'from' | 'to'>): boolean {
  if (m.from.kind === 'human') return true;
  return isGroup(m.to) ? m.to.group === 'pm' : m.to.kind === 'human';
}

/** Between agents: an agent (or the office, Jeff or a Firm reviewer) to another agent, a reviewer or the team. */
export function betweenAgents(m: Pick<ChatterMessage, 'from' | 'to'>): boolean {
  if (withHuman(m)) return false;
  return isGroup(m.to) ? m.to.group === 'team' : m.to.kind === 'agent' || m.to.kind === 'reviewer';
}

const samePerson = (p: ChatterParty, name: string, kind?: PartyKind) => p.name.toLowerCase() === name.toLowerCase() && (kind === undefined || p.kind === kind);

export function matchesFilter(m: Pick<ChatterMessage, 'from' | 'to'>, f: ChatterFilter): boolean {
  if (f.with === 'all') return true;
  if (f.with === 'agents') return betweenAgents(m);
  if (f.with === 'me') return withHuman(m);
  return samePerson(m.from, f.name, f.kind) || (!isGroup(m.to) && samePerson(m.to, f.name, f.kind));
}

/** Newest first; ties by id, so a cursor is stable. */
export const chatterOrder = (a: ChatterMessage, b: ChatterMessage) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** A page cursor: where the last message of a page sits in chatterOrder. */
export const cursorOf = (m: Pick<ChatterMessage, 'at' | 'id'>) => `${m.at}.${m.id}`;

export function parseCursor(c: string | null | undefined): { at: number; id: string } | undefined {
  const m = /^(\d{1,15})\.([A-Za-z0-9_-]{1,40})$/.exec(c ?? '');
  return m ? { at: Number(m[1]), id: m[2] } : undefined;
}

/** Whether `m` comes after the cursor in chatterOrder (it's older). */
export const olderThan = (m: Pick<ChatterMessage, 'at' | 'id'>, c: { at: number; id: string }) => m.at < c.at || (m.at === c.at && m.id < c.id);
