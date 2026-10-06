// What the office has still to pass on, kept in the roster file (roster/<floor>.json `outbox`) so a
// restart doesn't lose it: the escalations, proposal decisions and subagent news the Project
// Coordinator hasn't heard yet (escalations.ts, standup-run.ts, subagents.ts send them), and short
// notes owed to each Lead (the Project Manager's decision on its proposal or subagent request, told to
// the Lead itself whether or not the floor has a Coordinator). Only the debounce timers live in memory:
// after a restart, the next look sends what's waiting.
//
// The Coordinator's relays wait while it's away (asleep, benched, asking someone); a floor that has no
// Coordinator at all (never hired, or sent home without a handoff) lets them go, since what the
// Coordinator hears is the Leads' own doing or on the console and the standup page anyway.
//
// A Lead's notes go out together, between its turns, a minute after the last was queued; an asleep or
// benched Lead isn't woken for them (that costs a session): they wait for it to be back at its desk.

import { isRoleId, ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';
import { isAsleepStatus } from './bench.js';
import type { Roster } from './index.js';
import { leadNotesPrompt } from './prompts.js';
import type { TeamFloor } from './types.js';

/** A Lead hears its notes this long after the last one was queued, all in one message. */
export const LEAD_NOTES_DEBOUNCE_MS = 60_000;
/** The most of each kind an outbox keeps (the oldest go first): a floor nobody reads mustn't grow it for ever. */
export const OUTBOX_KEPT = 50;

export interface Outbox {
  /** Escalations (ids) the Project Coordinator hasn't been told about. */
  escalations: string[];
  /** Proposals (ids) whose decision the Project Coordinator hasn't heard. */
  decisions: string[];
  /** The Leads' subagent decisions for the Coordinator, and when the last was queued. */
  news: string[];
  newsAt?: number;
  /** Notes owed to each Lead, and when the last was queued. */
  leads: Partial<Record<RoleId, { lines: string[]; at: number }>>;
}

export const emptyOutbox = (): Outbox => ({ escalations: [], decisions: [], news: [], leads: {} });

const strings = (v: unknown, n: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x).map((x) => x.slice(0, n)).slice(-OUTBOX_KEPT) : []);

/** An outbox as it was saved, made whole; an older roster without one gets an empty one. */
export function reviveOutbox(raw: unknown): Outbox {
  if (!raw || typeof raw !== 'object') return emptyOutbox();
  const r = raw as Partial<Outbox>;
  const leads: Outbox['leads'] = {};
  for (const [role, box] of Object.entries(r.leads ?? {})) {
    if (!isRoleId(role) || !box || typeof box !== 'object') continue;
    const lines = strings(box.lines, 1000);
    if (lines.length) leads[role] = { lines, at: typeof box.at === 'number' ? box.at : 0 };
  }
  return {
    escalations: strings(r.escalations, 40),
    decisions: strings(r.decisions, 40),
    news: strings(r.news, 1000),
    ...(typeof r.newsAt === 'number' ? { newsAt: r.newsAt } : {}),
    leads,
  };
}

/** Adds to a list in the outbox, once, keeping the newest OUTBOX_KEPT. */
export function queueOnce(list: string[], item: string): string[] {
  return [...list.filter((x) => x !== item), item].slice(-OUTBOX_KEPT);
}

/**
 * Where the Coordinator is, for a relay to it: at work (send now), away for a while (asleep, benched,
 * writing its handoff or asking someone: the relay waits for it), or not on the team at all (never
 * hired, or sent home without a handoff: the relay is let go).
 */
export function coordinatorIs(roster: Roster, floor: TeamFloor): 'here' | 'away' | 'none' {
  const pm = roster.data(floor.id).members.pm;
  if (pm.phase === 'none') return 'none';
  const w = roster.workerOf(floor, pm);
  if (!w || pm.phase !== 'active' || isAsleepStatus(w.status) || w.status === 'needs_input') return 'away';
  return 'here';
}

export class Relays {
  constructor(private roster: Roster) {}

  /** Queues a short note for a Lead, sent with its others between its turns. Not for the Coordinator. */
  noteLead(floor: TeamFloor, role: RoleId, line: string) {
    if (role === 'pm' || !ROLE_BY_ID.has(role)) return;
    const d = this.roster.data(floor.id);
    const box = d.outbox.leads[role] ?? { lines: [], at: 0 };
    box.lines = queueOnce(box.lines, `- ${line.replace(/\s+/g, ' ').trim().slice(0, 900)}`);
    box.at = this.roster.deps.now();
    d.outbox.leads[role] = box;
    this.roster.touch(floor, true);
  }

  /** What a Lead is owed and hasn't been told yet (the tests and the Team tab's count). */
  owed(floorId: string, role: RoleId): string[] {
    return this.roster.data(floorId).outbox.leads[role]?.lines ?? [];
  }

  /**
   * Sends a Lead its notes, when it's between turns (never mid-turn or asking someone, never asleep or
   * answering a standup) and a minute has passed since the last was queued (`force`: now). True when sent.
   */
  flushLead(floor: TeamFloor, role: RoleId, now = this.roster.deps.now(), force = false): boolean {
    const d = this.roster.data(floor.id);
    const box = d.outbox.leads[role];
    if (!box?.lines.length || (!force && now - box.at < LEAD_NOTES_DEBOUNCE_MS)) return false;
    const m = d.members[role];
    const w = this.roster.workerOf(floor, m);
    if (!w || m.phase !== 'active' || w.kind !== 'agent' || (w.status !== 'idle' && w.status !== 'done') || this.roster.standups.isAsked(floor, role)) return false;
    if (floor.prompt(w.id, leadNotesPrompt(box.lines))) return false;
    delete d.outbox.leads[role];
    this.roster.touch(floor, true);
    return true;
  }

  /** The minute's look, and every Lead's worker update: notes that are due go out. */
  tick(floor: TeamFloor, now: number) {
    for (const role of Object.keys(this.roster.data(floor.id).outbox.leads)) if (isRoleId(role)) this.flushLead(floor, role, now);
  }
}
