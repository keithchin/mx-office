// What the ranking grades a worker on, gathered from what the office already keeps: the analyzer's run
// records (server/analysis/, which keep a worker's tasks after it has gone home), the workers at their
// desks now, each floor's roster (team roles, escalations, standups, proposals), the team journals,
// the team-labelled pull requests and the toolkit's decision register and gates. Nothing new is recorded here.

import type { RunRecord } from '../../shared/analysis.js';
import { modelLabel } from '../../shared/analysis.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { GhPull } from '../../shared/protocol/github.js';
import { teamLabel } from '../../shared/roster/card-team.js';
import type { Escalation } from '../../shared/roster/escalation.js';
import { ROLE_BY_ID, ROLES, type RoleId } from '../../shared/roster/roles.js';
import type { RankRole, TeamFacts, WorkerFacts } from '../../shared/ranking/model.js';
import type { JournalEntry } from '../../shared/roster/journal.js';
import type { RosterData } from '../roster/store.js';
import { subagentReviews } from '../roster/subagent-store.js';
import type { ProjectFacts } from '../summary/project.js';

/** A floor as the ranking needs it: open ones have everything, ones known only from old runs just a name. */
export interface FloorInput {
  id: string;
  name: string;
  workers: WorkerInfo[];
  roster?: RosterData;
  pulls: GhPull[];
  journal?: (team: RoleId, w: WorkerInfo | undefined) => JournalEntry[];
  project?: ProjectFacts;
}

const RUNNING = new Set(['starting', 'working', 'needs_input']);
/** Prompts the office itself sends (the review nudge, standups) aren't a person stepping in. */
const OFFICE = new Set(['Agent Office', 'schedule']);

/** "sonnet" → "Sonnet"; a full id → "Sonnet 5.5". */
const aliasLabel = (m: string) => {
  const l = modelLabel(m);
  return l === m && /^[a-z]+$/.test(m) ? `${m[0].toUpperCase()}${m.slice(1)}` : l;
};

/** A worker still at its desk that the analyzer has no record of yet: its tally so far, as a run that's still going. */
export function provisionalRun(floor: string, w: WorkerInfo): RunRecord {
  const model = w.usage?.model ?? w.model ?? 'unknown';
  const u = w.usage;
  return {
    id: `${floor}:${w.id}`,
    floor,
    worker: w.name,
    workerId: w.id,
    provider: w.provider ?? 'claude',
    model,
    modelLabel: modelLabel(model),
    effort: w.effort,
    title: w.title ?? '',
    prompt: '',
    startedAt: w.createdAt,
    endedAt: Date.now(),
    durationMs: Math.max(0, Date.now() - w.createdAt),
    activeMs: w.workedMs ?? 0,
    apiCalls: u?.calls ?? 0,
    toolCalls: 0,
    tokens: { input: u?.input ?? 0, output: u?.output ?? 0, cacheWrite: u?.cacheWrite ?? 0, cacheRead: u?.cacheRead ?? 0 },
    cost: u?.cost ?? 0,
    humanPrompts: 0,
    needsInput: 0,
    needsInputMs: 0,
    outcome: 'running',
    types: [],
    typesBy: 'keywords',
    excluded: 'still working',
    updatedAt: Date.now(),
  };
}

/** Which team role a worker is: the roster's member now, the role it escalated as, or a member's fixed name. */
export function roleResolver(roster: RosterData | undefined): (workerId: string, name: string) => RankRole {
  if (!roster) return () => 'worker';
  const byId = new Map<string, RoleId>();
  const byName = new Map<string, RoleId>();
  for (const r of ROLES) {
    const m = roster.members[r.id];
    if (m?.workerId) byId.set(m.workerId, r.id);
    if (m?.name) byName.set(m.name, r.id);
  }
  for (const e of roster.escalations) if (e.role && !byId.has(e.workerId)) byId.set(e.workerId, e.role);
  return (id, name) => byId.get(id) ?? byName.get(name) ?? 'worker';
}

function journalFacts(entries: JournalEntry[]): TeamFacts['journal'] {
  if (!entries.length) return undefined;
  return {
    entries: entries.length,
    days: new Set(entries.map((e) => e.date)).size,
    lessons: entries.filter((e) => /\blesson|learn(ed|t)\b/i.test(e.body) || /lesson/i.test(e.heading)).length,
    handoffs: entries.filter((e) => /handoff/i.test(e.heading)).length,
  };
}

function teamPrs(pulls: GhPull[], role: RoleId): TeamFacts['teamPrs'] {
  const team = ROLE_BY_ID.get(role)?.team;
  if (!team) return undefined;
  const mine = pulls.filter((p) => p.labels.some((l) => l.name === teamLabel(team)));
  if (!mine.length) return undefined;
  const st = (s: string) => mine.filter((p) => p.state.toUpperCase() === s).length;
  return { merged: st('MERGED'), closed: st('CLOSED'), open: st('OPEN'), checksPass: mine.filter((p) => p.checks === 'pass').length, checksFail: mine.filter((p) => p.checks === 'fail').length };
}

function registerFacts(project: ProjectFacts | undefined): Pick<TeamFacts, 'decisions' | 'gates'> {
  const phase = project?.phase;
  if (!phase) return {};
  const ds = phase.decisions ?? [];
  const decisions = ds.length ? { confirmed: ds.filter((d) => /CONFIRMED/i.test(d.status)).length, assumed: ds.filter((d) => /ASSUMED/i.test(d.status)).length, other: ds.filter((d) => !/CONFIRMED|ASSUMED/i.test(d.status)).length } : undefined;
  const counted = phase.stages.filter((s) => s.status !== 'WAIVED');
  return { decisions, gates: counted.length ? { pass: counted.filter((s) => s.status === 'PASS').length, total: counted.length } : undefined };
}

/** Everyone to rank: a worker per worker id, but a team role is one entry however many times it was hired. */
export function gatherFacts(floors: FloorInput[], runs: RunRecord[]): WorkerFacts[] {
  const out = new Map<string, WorkerFacts>();
  const byFloor = new Map<string, RunRecord[]>();
  for (const r of runs) byFloor.set(r.floor, [...(byFloor.get(r.floor) ?? []), r]);
  const known = new Map(floors.map((f) => [f.id, f]));
  for (const id of byFloor.keys()) if (!known.has(id)) known.set(id, { id, name: id, workers: [], pulls: [] });
  for (const floor of known.values()) {
    const roleOf = roleResolver(floor.roster);
    const floorRuns = byFloor.get(floor.id) ?? [];
    const live = new Map(floor.workers.filter((w) => w.kind === 'agent').map((w) => [w.id, w]));
    const entry = (workerId: string, name: string, at: number): WorkerFacts => {
      const role = roleOf(workerId, name);
      const key = role === 'worker' ? `${floor.id}:${workerId}` : `${floor.id}:role:${role}`;
      let f = out.get(key);
      if (!f) {
        f = { key, floor: floor.id, floorName: floor.name, workerIds: [], name: role === 'worker' ? name : (floor.roster?.members[role]?.name ?? name), role, model: 'unknown', modelLabel: 'unknown', gone: true, lastSeen: 0, runs: [], liveInputs: 0, escalations: [], proposals: [], autonomy: floor.roster?.settings.autonomy };
        out.set(key, f);
      }
      if (!f.workerIds.includes(workerId)) f.workerIds.push(workerId);
      f.lastSeen = Math.max(f.lastSeen, at);
      return f;
    };
    for (const r of [...floorRuns].sort((a, b) => a.startedAt - b.startedAt)) {
      const f = entry(r.workerId, r.worker, r.endedAt);
      f.runs.push(r);
      // A run recorded before its session named its model only has the alias it was hired with: a full id wins.
      if (modelLabel(r.model) !== r.model || f.model === 'unknown') {
        f.model = r.model;
        f.modelLabel = modelLabel(r.model) !== r.model ? r.modelLabel : aliasLabel(r.model);
      }
    }
    for (const w of live.values()) {
      const f = entry(w.id, w.name, Date.now());
      f.gone = false;
      f.status = w.status;
      f.color = w.color;
      // The latest of a role's hires is the one at its desk now.
      f.workerIds = [...f.workerIds.filter((id) => id !== w.id), w.id];
      if (!f.runs.some((r) => r.workerId === w.id)) {
        const p = provisionalRun(floor.id, w);
        f.runs.push(p);
        if (w.lastInput && !OFFICE.has(w.lastInput.by) && w.lastInput.at >= w.createdAt) f.liveInputs++;
      }
      // What its session says it runs on wins; the alias it was hired with ("sonnet") only when nothing better is known.
      if (w.usage?.model && RUNNING.has(w.status)) {
        f.model = w.usage.model;
        f.modelLabel = modelLabel(w.usage.model);
      } else if (f.model === 'unknown' && (w.usage?.model ?? w.model)) {
        f.model = (w.usage?.model ?? w.model)!;
        f.modelLabel = aliasLabel(f.model);
      }
    }
    const roster = floor.roster;
    for (const f of out.values()) {
      if (f.floor !== floor.id) continue;
      if (roster) {
        const ids = new Set(f.workerIds);
        f.escalations = roster.escalations.filter((e) => ids.has(e.workerId) || (f.role !== 'worker' && e.role === f.role));
        f.proposals = f.role === 'worker' ? [] : roster.proposals.filter((p) => p.role === f.role);
      }
      if (f.role === 'worker') continue;
      const role = f.role;
      const leadEscalations: Escalation[] = roster ? roster.escalations.filter((e) => e.role && e.role !== 'pm') : [];
      f.team = {
        standups: roster?.standups.map((s) => ({ startedAt: s.startedAt, compiledAt: s.compiledAt, status: s.status })) ?? [],
        leadEscalations,
        journal: floor.journal ? journalFacts(floor.journal(role, live.get(f.workerIds[f.workerIds.length - 1]))) : undefined,
        teamPrs: teamPrs(floor.pulls, role),
        floorRuns,
        ...(roster?.subagents ? { reviews: reviewFacts(roster, floor.id, role) } : {}),
        ...registerFacts(floor.project),
      };
    }
    // A role on the roster that has never worked yet isn't ranked: there's nothing to grade.
  }
  // A worker known only by the alias it was hired with ("Opus") joins its family's latest version ("Opus 5.5"), so the groups don't split.
  const labels = [...runs].sort((a, b) => b.startedAt - a.startedAt).map((r) => r.modelLabel);
  for (const f of out.values()) {
    if (f.modelLabel.includes(' ')) continue;
    const full = labels.find((l) => l.startsWith(`${f.modelLabel} `));
    if (full) f.modelLabel = full;
  }
  return [...out.values()];
}

/** Its Lead's reviews of its subagents' runs, as the ranking reads them (TeamFacts.reviews). */
function reviewFacts(roster: RosterData, floor: string, role: RoleId): NonNullable<TeamFacts['reviews']> {
  const rows = subagentReviews(roster, floor, role);
  return {
    turnaroundMin: rows.filter((r) => r.turnaroundMs !== undefined).map((r) => r.turnaroundMs! / 60_000),
    accepted: rows.filter((r) => r.verdict === 'accept').length,
    reworked: rows.filter((r) => r.verdict === 'rework').length,
    failed: rows.filter((r) => r.verdict === 'failed').length,
    // Finished runs still waiting for a verdict (the reader leaves them out).
    unreviewed: Object.values(roster.subagents).filter((rec) => rec.lead === role).reduce((n, rec) => n + rec.runs.filter((r) => r.outcome === 'pending' && r.endedAt !== undefined).length, 0),
  };
}
