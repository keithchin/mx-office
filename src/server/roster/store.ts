// What the office keeps of a floor's project team, in its own data dir (roster/<floor>.json): the
// settings, each role's member (its fixed name, its model, the worker it is now, its last handoff),
// the standups and their proposals, the escalations raised to the Project Manager, and the floor's spend today for the cost cap. Saved a moment
// after each change, so a burst of worker updates writes once.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_AUTONOMY, isAutonomyLevel, type AutonomyLevel } from '../../shared/roster/autonomy.js';
import { cleanName, isRoleId, pickNames, ROLES, type RoleId } from '../../shared/roster/roles.js';
import { cleanSchedule, DEFAULT_SCHEDULE } from '../../shared/roster/schedule.js';
import type { Escalation } from '../../shared/roster/escalation.js';
import { DEFAULT_JEFF, isJeffMode } from '../../shared/judge.js';
import type { Proposal, RosterSettings, Standup } from '../../shared/roster/types.js';
import { cleanOverrides, type SkillOverrides } from '../../shared/roster/skills.js';
import { reviveSubagents, SUBAGENT_ACTIONS_KEPT } from './subagent-store.js';
import type { SubagentAction, SubagentRecord } from '../../shared/roster/subagents.js';

/** Where a member is in its life: never hired, a worker now, writing its handoff, or benched. */
export type Phase = 'none' | 'active' | 'benching' | 'benched';

export interface MemberRecord {
  name: string;
  model: string;
  phase: Phase;
  workerId?: string;
  /** While benching: when it was asked for its handoff, and whether it has started on it since. */
  benchAskedAt?: number;
  benchSawBusy?: boolean;
  benchedAt?: number;
  /** Its latest handoff note, what a fresh hire is primed with. */
  handoff?: { at: number; text: string };
  /** What the Project Manager changed of its skills (shared/roster/skills.ts): on/off and gate per skill. */
  skills?: SkillOverrides;
}

export interface RosterData {
  settings: RosterSettings;
  members: Record<RoleId, MemberRecord>;
  standups: Standup[];
  proposals: Proposal[];
  /** What agents raised to the Project Manager (roster/escalations.ts), open and answered. */
  escalations: Escalation[];
  /** The last time anyone on the floor got to work: a standup only runs when there was some since the last. */
  lastActivityAt?: number;
  lastStandupAt?: number;
  /** Each Lead's journal entry last turned into proposals (date|heading), so a quiet Lead's old proposals aren't asked again. */
  harvested: Partial<Record<RoleId, string>>;
  /** Spend today (in the schedule's time zone), and each worker's session cost when last seen. */
  spend: { day: string; usd: number; seen: Record<string, number> };
  /** The Leads' subagents, by `<lead role>/<name>`: runs, warnings, benched (roster/subagents.ts). */
  subagents: Record<string, SubagentRecord>;
  /** Subagent actions a Lead proposed to the Project Manager, or asked them about. */
  subagentActions: SubagentAction[];
}

// Leads are benched only when the Project Manager says so; a floor can turn idle benching on in its settings.
export const DEFAULT_IDLE_MINUTES = 0;
/** A benched subagent sits out a day before the office reinstates it. */
export const DEFAULT_COOLDOWN_HOURS = 24;
const STANDUPS_KEPT = 30;
const PROPOSALS_KEPT = 300;
const ESCALATIONS_KEPT = 200;

export function defaultSettings(): RosterSettings {
  return { autonomy: DEFAULT_AUTONOMY, idleMinutes: DEFAULT_IDLE_MINUTES, schedule: { ...DEFAULT_SCHEDULE }, costCaps: {}, dryRunIssues: false, reviewNudge: true, jeff: { ...DEFAULT_JEFF }, subagentCooldownHours: DEFAULT_COOLDOWN_HOURS };
}

/** Settings from what was saved or sent, anything malformed left as it was in `base`. */
export function cleanSettings(v: unknown, base: RosterSettings = defaultSettings()): RosterSettings {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<RosterSettings>;
  const caps: Partial<Record<AutonomyLevel, number>> = {};
  const rawCaps = s.costCaps && typeof s.costCaps === 'object' ? s.costCaps : base.costCaps;
  for (const [k, n] of Object.entries(rawCaps ?? {})) {
    const level = Number(k);
    if (isAutonomyLevel(level) && typeof n === 'number' && Number.isFinite(n) && n > 0) caps[level] = Math.min(Math.round(n * 100) / 100, 100_000);
  }
  const idle = typeof s.idleMinutes === 'number' && Number.isFinite(s.idleMinutes) ? Math.max(0, Math.min(Math.round(s.idleMinutes), 24 * 60)) : base.idleMinutes;
  return {
    autonomy: isAutonomyLevel(s.autonomy) ? s.autonomy : base.autonomy,
    idleMinutes: idle,
    schedule: s.schedule === undefined ? base.schedule : cleanSchedule(s.schedule),
    costCaps: caps,
    dryRunIssues: typeof s.dryRunIssues === 'boolean' ? s.dryRunIssues : base.dryRunIssues,
    // A roster saved before the review nudge existed has it on, like a fresh one.
    reviewNudge: typeof s.reviewNudge === 'boolean' ? s.reviewNudge : (base.reviewNudge ?? true),
    // A roster saved before Jeff has him in shadow mode on both.
    jeff: {
      waiting: isJeffMode(s.jeff?.waiting) ? s.jeff.waiting : (base.jeff?.waiting ?? DEFAULT_JEFF.waiting),
      triage: isJeffMode(s.jeff?.triage) ? s.jeff.triage : (base.jeff?.triage ?? DEFAULT_JEFF.triage),
    },
    subagentCooldownHours: typeof s.subagentCooldownHours === 'number' && Number.isFinite(s.subagentCooldownHours) ? Math.max(0, Math.min(Math.round(s.subagentCooldownHours * 10) / 10, 24 * 30)) : (base.subagentCooldownHours ?? DEFAULT_COOLDOWN_HOURS),
  };
}

/** A fresh roster: every role named from the pool, nobody hired. */
export function freshRoster(rng: () => number = Math.random): RosterData {
  const names = pickNames(rng);
  const members = {} as Record<RoleId, MemberRecord>;
  for (const r of ROLES) members[r.id] = { name: names[r.id], model: r.model, phase: 'none' };
  return { settings: defaultSettings(), members, standups: [], proposals: [], escalations: [], harvested: {}, spend: { day: '', usd: 0, seen: {} }, subagents: {}, subagentActions: [] };
}

/** A saved roster, made whole: a role added since it was saved gets a name, a bad field its default. */
export function reviveRoster(raw: unknown, rng: () => number = Math.random): RosterData {
  const fresh = freshRoster(rng);
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as Partial<RosterData>;
  const members = { ...fresh.members };
  for (const [id, m] of Object.entries(r.members ?? {})) {
    if (!isRoleId(id) || !m || typeof m !== 'object') continue;
    const phase: Phase = ['none', 'active', 'benching', 'benched'].includes(m.phase) ? m.phase : 'none';
    const skills = cleanOverrides(id, m.skills);
    members[id] = { ...m, name: cleanName(m.name) ?? fresh.members[id].name, model: typeof m.model === 'string' && m.model ? m.model : fresh.members[id].model, phase, skills };
  }
  return {
    settings: cleanSettings(r.settings),
    members,
    standups: Array.isArray(r.standups) ? r.standups.slice(-STANDUPS_KEPT) : [],
    proposals: Array.isArray(r.proposals) ? r.proposals.slice(-PROPOSALS_KEPT) : [],
    escalations: Array.isArray(r.escalations) ? r.escalations.filter((e) => e && typeof e === 'object' && typeof e.id === 'string').slice(-ESCALATIONS_KEPT) : [],
    lastActivityAt: typeof r.lastActivityAt === 'number' ? r.lastActivityAt : undefined,
    lastStandupAt: typeof r.lastStandupAt === 'number' ? r.lastStandupAt : undefined,
    harvested: r.harvested && typeof r.harvested === 'object' ? { ...r.harvested } : {},
    spend: r.spend && typeof r.spend === 'object' && typeof r.spend.usd === 'number' ? { day: String(r.spend.day ?? ''), usd: r.spend.usd, seen: { ...(r.spend.seen ?? {}) } } : fresh.spend,
    subagents: reviveSubagents(r.subagents),
    subagentActions: Array.isArray(r.subagentActions) ? r.subagentActions.filter((a) => a && typeof a === 'object' && typeof a.id === 'string').slice(-SUBAGENT_ACTIONS_KEPT) : [],
  };
}

export class RosterFile {
  readonly data: RosterData;
  private file: string;
  private timer?: NodeJS.Timeout;

  constructor(dir: string, floorId: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, `${floorId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    let raw: unknown;
    try {
      raw = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : undefined;
    } catch (err) {
      console.error(`agent-office: couldn't read ${this.file}, starting the team over`, err);
    }
    this.data = reviveRoster(raw);
    if (raw === undefined) this.save();
  }

  /** Saves shortly, once for a burst of changes. */
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const d = this.data;
    d.standups = d.standups.slice(-STANDUPS_KEPT);
    d.proposals = d.proposals.slice(-PROPOSALS_KEPT);
    d.escalations = d.escalations.slice(-ESCALATIONS_KEPT);
    d.subagentActions = d.subagentActions.slice(-SUBAGENT_ACTIONS_KEPT);
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}`, err);
    }
  }
}
