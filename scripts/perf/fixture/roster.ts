// A floor's roster file (roster/<floor>.json, roster/store.ts): members, standups, proposals,
// escalations (open and answered), the Leads' subagents with their runs, the live runs, the subagent
// actions, held prompts and the outbox. Built as RosterData, then put through the real reviveRoster so
// what's written is what the office would itself save (subagent names included).

import { DECISION_KINDS, ESCALATION_TRIGGERS, URGENCIES, type AutonomyLevel } from '../../../src/shared/roster/autonomy.js';
import { makeEscalation, type Escalation } from '../../../src/shared/roster/escalation.js';
import { ROLE_BY_ID, ROLES, type RoleId } from '../../../src/shared/roster/roles.js';
import type { LiveRun } from '../../../src/shared/roster/subagent-live.js';
import type { SubagentAction, SubagentRecord, SubagentRun } from '../../../src/shared/roster/subagents.js';
import type { Proposal, Standup } from '../../../src/shared/roster/types.js';
import type { HeldPrompt } from '../../../src/server/roster/held.js';
import { defaultSettings, reviveRoster, type MemberRecord, type RosterData } from '../../../src/server/roster/store.js';
import { emptyOutbox } from '../../../src/server/roster/relays.js';
import { defaultCoverage } from '../../../src/shared/roster/coverage.js';
import { DAY, Gen, HOUR, MIN, PEOPLE } from './gen.js';
import type { Cast } from './workers.js';

export interface RosterCounts {
  standups: number;
  proposals: number;
  escalations: number;
  /** Subagent types per Lead. */
  subagentTypes: number;
  /** Runs per subagent (the store keeps 50). */
  runsPer: number;
  liveRuns: number;
  actions: number;
  held: number;
  outbox: number;
}

const LEADS: RoleId[] = ['lead-designer', 'lead-developer', 'lead-tester', 'chief-analyst'];
const BASE_TYPES: Record<string, string> = { 'lead-designer': 'ui-ux-designer', 'lead-developer': 'developer', 'lead-tester': 'tester', 'chief-analyst': 'business-analyst' };

export function rosterData(g: Gen, cast: Cast, c: RosterCounts): RosterData {
  const settings = defaultSettings();
  // Jeff off: he'd ask a model (the real claude CLI) about every turn.
  settings.jeff = { waiting: 'off', triage: 'off', priority: 'off', waitingPolicy: 'agree' };
  settings.autonomy = 3;
  const level: AutonomyLevel = settings.autonomy;

  const members = {} as Record<RoleId, MemberRecord>;
  for (const r of ROLES) {
    const m = cast.members[r.id];
    const w = cast.workers.find((x) => x.id === m.workerId);
    members[r.id] = w
      ? { name: m.name, model: w.model, phase: 'active', workerId: w.id, hiredAt: w.createdAt, handoff: { at: w.createdAt - DAY, text: `## ${Gen.day(w.createdAt - DAY)} — Handoff\n${g.paragraph(3)}` } }
      : { name: m.name, model: r.model, phase: 'none' };
  }
  const who = (role: RoleId) => ({ workerId: cast.members[role].workerId ?? g.workerId(), by: cast.members[role].name, role, team: ROLE_BY_ID.get(role)!.team });

  // Standups, oldest first, one a day.
  const standups: Standup[] = [];
  const proposals: Proposal[] = [];
  for (let i = c.standups - 1; i >= 0; i--) {
    const startedAt = g.base - i * DAY - 3 * HOUR;
    const date = Gen.day(startedAt);
    const s: Standup = {
      id: date,
      date,
      startedAt,
      by: g.chance(0.7) ? 'schedule' : g.pick(PEOPLE),
      status: 'compiled',
      compiledAt: startedAt + 10 * MIN,
      waiting: [],
      reports: LEADS.map((role) => ({ role, name: cast.members[role].name, source: g.pick(['live', 'journal'] as const), heading: g.title(), done: [g.sentence(8), g.sentence(6)], next: [g.sentence(7)], blockers: g.chance(0.2) ? [g.sentence(6)] : [] })),
      proposalIds: [],
      page: `# Standup ${date}\n\n${g.paragraph(4)}`,
      savedTo: `docs/standups/${date}.md`,
    };
    standups.push(s);
  }
  for (let i = 0; i < c.proposals; i++) {
    const s = standups[i % standups.length];
    const role = g.pick(LEADS);
    const status = g.pick(['pending', 'approved', 'approved', 'rejected', 'change', 'auto'] as const);
    const p: Proposal = { id: g.hex(10), standup: s.id, role, team: ROLE_BY_ID.get(role)!.team, by: cast.members[role].name, kind: g.pick(DECISION_KINDS), title: g.title(), detail: g.paragraph(2), status };
    if (status !== 'pending') Object.assign(p, { decidedBy: status === 'auto' ? 'the office' : g.pick(PEOPLE), decidedAt: s.compiledAt! + g.int(1, 120) * MIN });
    if (status === 'approved') p.issue = { number: 400 + i, url: `https://github.invalid/example/${cast.floor}/issues/${400 + i}` };
    if (status === 'rejected' || status === 'change') p.reason = g.sentence(8);
    s.proposalIds.push(p.id);
    proposals.push(p);
  }

  // Escalations: mostly answered, the newest still open.
  const escalations: Escalation[] = [];
  for (let i = 0; i < c.escalations; i++) {
    const role = g.pick([...LEADS, 'pm'] as RoleId[]);
    const at = g.base - (c.escalations - i) * (20 * DAY / Math.max(1, c.escalations)) - g.int(0, 30) * MIN;
    const e = makeEscalation(
      { urgency: g.pick(URGENCIES), trigger: g.pick(ESCALATION_TRIGGERS), title: g.title(), details: g.paragraph(3, 14), options: [g.sentence(5), g.sentence(5), g.sentence(4)], recommendation: g.sentence(7) },
      who(role),
      level,
      `esc-${g.hex(10)}`,
      at,
    );
    const open = i >= c.escalations - Math.max(3, Math.floor(c.escalations / 8));
    if (!open) e.status = 'resolved';
    if (!open) e.resolution = { verdict: g.pick(['reply', 'approve', 'reject', 'dismiss'] as const), text: g.sentence(9), by: g.pick(PEOPLE), at: at + g.int(5, 300) * MIN, delivered: g.chance(0.9) };
    if (g.chance(0.1)) e.also = [{ workerId: g.workerId(), by: cast.members[g.pick(LEADS)].name, at: at + 10 * MIN }];
    escalations.push(e);
  }

  // The Leads' subagents: several types each, each with its runs.
  const subagents: Record<string, SubagentRecord> = {};
  for (const lead of LEADS) {
    for (let t = 0; t < c.subagentTypes; t++) {
      const name = t === 0 ? BASE_TYPES[lead] : `${BASE_TYPES[lead]}-${t + 1}`;
      const runs: SubagentRun[] = [];
      for (let k = 0; k < c.runsPer; k++) {
        const at = g.base - (c.runsPer - k) * 3 * HOUR - g.int(0, 60) * MIN;
        const durationMs = g.int(1, 40) * MIN;
        const outcome = g.pick(['accept', 'accept', 'accept', 'rework', 'failed', 'pending'] as const);
        runs.push({ id: `agent-${g.hex(12)}`, at, endedAt: at + durationMs, durationMs, model: g.pick(['sonnet', 'haiku', 'opus']), task: g.title(), outcome, ...(outcome !== 'pending' ? { reviewedAt: at + durationMs + g.int(1, 90) * MIN, note: g.sentence(8) } : {}), ...(g.chance(0.3) ? { ci: g.pick(['pass', 'fail'] as const) } : {}) });
      }
      const state = g.pick(['active', 'active', 'active', 'warning', 'benched'] as const);
      subagents[`${lead}/${name}`] = {
        name,
        lead,
        state,
        warnings: state === 'active' ? [] : [{ at: g.ago(5), reason: g.sentence(8), by: cast.members[lead].name }],
        ...(state === 'benched' ? { benchedAt: g.ago(1), benchedUntil: g.base + DAY, benchReason: g.sentence(6) } : {}),
        runs,
      };
    }
  }
  const keys = Object.keys(subagents);
  const subagentRuns: LiveRun[] = [];
  for (let i = 0; i < c.liveRuns; i++) {
    const [lead, name] = g.pick(keys).split('/') as [RoleId, string];
    const working = i >= c.liveRuns - 4;
    const startedAt = working ? g.base - g.int(1, 20) * MIN : g.ago(3, HOUR);
    const durationMs = g.int(1, 30) * MIN;
    subagentRuns.push({ id: `toolu_${g.hex(20)}`, lead, workerId: cast.members[lead].workerId ?? g.workerId(), name, task: g.title(), model: 'sonnet', status: working ? 'working' : g.pick(['done', 'done', 'failed', 'lost'] as const), startedAt, ...(working ? {} : { endedAt: startedAt + durationMs, durationMs }), seenAt: working ? g.base : startedAt + durationMs, source: g.pick(['hooks', 'transcript'] as const) });
  }
  const subagentActions: SubagentAction[] = [];
  for (let i = 0; i < c.actions; i++) {
    const [lead, name] = g.pick(keys).split('/') as [RoleId, string];
    const status = g.pick(['pending', 'approved', 'rejected', 'done'] as const);
    subagentActions.push({ id: `sa-${g.hex(8)}`, at: g.ago(10), lead, by: cast.members[lead].name, op: g.pick(['warn', 'bench', 'swap-model', 'reinstate'] as const), name, reason: g.sentence(8), gate: g.pick(['propose', 'tell', 'ask'] as const), status, ...(status !== 'pending' ? { decidedBy: g.pick(PEOPLE), decidedAt: g.ago(5), decision: g.sentence(5) } : {}) });
  }
  subagentActions.sort((a, b) => a.at - b.at);

  const held: HeldPrompt[] = [];
  const targets = cast.workers.filter((w) => w.live);
  for (let i = 0; i < c.held; i++) {
    const w = targets[i % Math.max(1, targets.length)] ?? cast.workers[0];
    const createdAt = g.base - g.int(1, 600) * MIN;
    held.push({ id: `h-${g.hex(16)}`, workerId: w.id, origin: g.pick(['person', 'office', 'agent'] as const), by: g.pick(PEOPLE), text: g.paragraph(1, 16), createdAt, expiresAt: createdAt + DAY });
  }
  const outbox = emptyOutbox();
  outbox.escalations = escalations.filter((e) => e.status === 'open').slice(-c.outbox).map((e) => e.id);
  outbox.decisions = proposals.filter((p) => p.status !== 'pending').slice(-c.outbox).map((p) => p.id);
  outbox.news = Array.from({ length: Math.min(c.outbox, 20) }, () => g.sentence(10));
  outbox.newsAt = g.base - 5 * MIN;
  for (const lead of LEADS) outbox.leads[lead] = { lines: Array.from({ length: Math.min(c.outbox, 10) }, () => g.sentence(9)), at: g.base - 2 * MIN };

  const raw: RosterData = {
    settings,
    shape: 'enterprise',
    coverage: defaultCoverage('enterprise'),
    members,
    standups,
    proposals,
    escalations,
    lastActivityAt: g.base - MIN,
    lastStandupAt: standups.at(-1)?.startedAt,
    harvested: {},
    spend: { day: '', usd: 0, seen: {} },
    subagents,
    subagentNames: {},
    subagentActions,
    subagentRuns,
    outbox,
    held,
  };
  // What the office itself would save: names given, caps applied.
  return reviveRoster(JSON.parse(JSON.stringify(raw)), g.rand);
}
