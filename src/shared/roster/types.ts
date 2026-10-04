// What the Team tab is sent (GET /api/roster) and what the office keeps per floor: the settings, each
// role's member, the standups and the proposals the Leads made in them.

import type { AutonomyLevel, DecisionKind } from './autonomy.js';
import type { RoleId, TeamId } from './roles.js';
import type { StandupSchedule } from './schedule.js';

export interface RosterSettings {
  autonomy: AutonomyLevel;
  /** Minutes a Lead may sit idle before it's benched (0 = never automatically). */
  idleMinutes: number;
  schedule: StandupSchedule;
  /** A daily cost cap in dollars per autonomy level; the one for the current level applies (missing = off). */
  costCaps: Partial<Record<AutonomyLevel, number>>;
  /** Approved proposals are recorded but no GitHub issue is made: for trying the office out. */
  dryRunIssues: boolean;
}

/**
 * Where a role stands: never hired, at work, asking someone, idle (its turn is over), asleep (its
 * process stopped but its session can be woken), being benched (writing its handoff note), or
 * benched (stopped, its context cleared; a hire starts fresh from its Playbook and handoff).
 */
export type MemberStatus = 'not-hired' | 'working' | 'needs-you' | 'idle' | 'asleep' | 'benching' | 'benched';

export interface MemberView {
  role: RoleId;
  title: string;
  team: TeamId;
  icon: string;
  name: string;
  model: string;
  status: MemberStatus;
  workerId?: string;
  /** What its current session has cost, in dollars. */
  cost?: number;
  activity?: string;
  /** Idle since (ms), while it's idle: how close it is to being benched. */
  idleSince?: number;
  /** The newest entry in its team journal: the worker's own copy while hired, else the project's. */
  lastJournal?: { heading: string; excerpt: string };
  benchedAt?: number;
  handoffAt?: number;
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'change' | 'auto';

export interface Proposal {
  id: string;
  /** The standup it came from (its date). */
  standup: string;
  role: RoleId;
  team: TeamId;
  /** The Lead's name when it proposed it. */
  by: string;
  kind: DecisionKind;
  title: string;
  detail: string;
  status: ProposalStatus;
  /** Why it was rejected, or what the CTO wants changed. */
  reason?: string;
  issue?: { number?: number; url?: string; dryRun?: boolean; error?: string };
  decidedBy?: string;
  decidedAt?: number;
}

export interface StandupReportView {
  role: RoleId;
  name: string;
  /** live: it answered the standup prompt; journal: summarised from its journal without waking it. */
  source: 'live' | 'journal' | 'none';
  heading?: string;
  done: string[];
  next: string[];
  blockers: string[];
}

export interface Standup {
  /** Its date in the schedule's time zone, YYYY-MM-DD (a second one that day gets -2, -3…). */
  id: string;
  date: string;
  startedAt: number;
  /** Who ran it: a person's name, or "schedule". */
  by: string;
  status: 'collecting' | 'compiled';
  compiledAt?: number;
  /** Roles asked live, still to answer. */
  waiting: RoleId[];
  reports: StandupReportView[];
  proposalIds: string[];
  /** The compiled page, markdown: what docs/standups/<date>.md holds. */
  page?: string;
  /** Where the page went in the repo: the PM's worktree, when the PM was there to commit it. */
  savedTo?: string;
}

export interface ApprovalItem {
  id: string;
  kind: 'proposal' | 'merge' | 'cap';
  title: string;
  detail: string;
  team?: TeamId;
  proposalId?: string;
  url?: string;
}

export interface RosterView {
  floor: string;
  settings: RosterSettings;
  members: MemberView[];
  /** The latest standups, newest first, without their pages (GET /api/roster/standup has one in full). */
  standups: Omit<Standup, 'page'>[];
  proposals: Proposal[];
  approvals: ApprovalItem[];
  /** What the floor's agents spent today, in dollars, and the cap that applies at its level. */
  spentToday: number;
  cap?: number;
  /** Why hiring is paused on this floor, when the cap is reached. */
  paused?: string;
  /** When the next scheduled standup is, and whether it'll run (activity since the last one). */
  nextStandupAt?: number;
  lastStandupAt?: number;
  activitySinceStandup: boolean;
  /** May change the settings and decide on proposals. */
  admin: boolean;
}
