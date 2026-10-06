// ▶ Resume project's dry run: every asleep or benched agent on the floor, whether it has work waiting
// and why (work.ts), what the safety checks found (safety.ts), what it'd do, and the order it'd be
// woken in (order.ts); the floor-wide checks too (the spend cap blocks, Studio mode warns). Nothing is
// woken here: preview.ts only reads.

import type { WorkerInfo } from '../../shared/protocol.js';
import { agentKey, type AgentPreview, type ResumeAction, type ResumePreview } from '../../shared/project-run.js';
import { teamFromLabels } from '../../shared/roster/card-team.js';
import { ROLE_BY_ID, ROLES, type RoleId } from '../../shared/roster/roles.js';
import { isAsleepStatus } from '../roster/bench.js';
import { assess, okProbe } from './safety.js';
import { wakeOrder } from './order.js';
import { projectPause, pacingOf } from './store.js';
import type { RunDeps, RunFloor } from './types.js';
import { issueRefs, noFacts, workWaiting, type WorkFacts } from './work.js';

/** A preview's agent, with what the run needs that the browser doesn't. */
export interface Candidate extends AgentPreview {
  facts: WorkFacts;
  behind: number;
  dirty: number;
  base?: string;
}

const prsOf = (f: RunFloor, w: WorkerInfo | undefined) => (w ? f.pulls().filter((p) => p.number === w.pr?.number || (!!w.worktree && p.headRefName === w.worktree.branch)) : []);

/** What the floor holds for one agent (a member's role, its worker if it has one). */
export function factsFor(deps: RunDeps, f: RunFloor, w: WorkerInfo | undefined, role: RoleId | undefined): WorkFacts {
  const { roster } = deps;
  const d = roster.data(f.team.id);
  const facts = noFacts();
  if (w) {
    facts.owed = roster.escalations.owedTo(f.team, w).lines;
    facts.held = roster.delivery.heldFor(w.id);
    facts.cutOff = f.cutOff(w.id);
  } else if (role) facts.owed = roster.escalations.owed(f.team, role).lines;
  if (role === 'pm') facts.outbox = [...d.outbox.escalations, ...d.outbox.decisions, ...d.outbox.news];
  else if (role) facts.outbox = d.outbox.leads[role]?.lines ?? [];
  const prs = prsOf(f, w);
  facts.failingPrs = prs.filter((p) => p.state === 'OPEN' && p.checks === 'fail').map((p) => ({ number: p.number, title: p.title }));
  const open = f.issues().filter((i) => i.state === 'OPEN');
  if (role && role !== 'pm') {
    const team = ROLE_BY_ID.get(role)!.team;
    // Its team's open issues: assigned to someone, or to nobody yet (its Lead's to pick up). Never another team's.
    facts.issues = open.filter((i) => teamFromLabels(i.labels) === team).map((i) => ({ number: i.number, title: i.title, ...(i.assignees.length || i.taken ? {} : { unassigned: true }) }));
  } else if (!role && w) {
    const refs = issueRefs(w.title, w.prompt, w.task?.summary);
    facts.issues = open.filter((i) => refs.includes(i.number)).map((i) => ({ number: i.number, title: i.title }));
  }
  if (role === 'pm') {
    const s = d.standups[d.standups.length - 1];
    if (s?.status === 'compiled' && !s.savedTo) facts.standup = s.id;
  }
  return facts;
}

/** Jeff's highest priority among the open escalations an agent raised or joined. */
function jeffOf(deps: RunDeps, f: RunFloor, w: WorkerInfo | undefined, role: RoleId | undefined): number {
  const open = deps.roster.data(f.team.id).escalations.filter((e) => e.status === 'open' && ((role && e.role === role) || (w && (e.workerId === w.id || e.also?.some((a) => a.workerId === w.id)))));
  return Math.max(0, ...open.map((e) => e.jeffRank?.score ?? 0));
}

/** The floor's dry run. */
export async function previewFloor(deps: RunDeps, f: RunFloor): Promise<{ preview: ResumePreview; candidates: Candidate[] }> {
  const { roster } = deps;
  const team = f.team;
  const d = roster.data(team.id);
  const out: (Candidate & { openPrs: number; jeff: number; key: string })[] = [];
  const awake: string[] = [];
  for (const w of team.workers()) {
    if (w.kind !== 'agent') continue;
    if (!isAsleepStatus(w.status)) {
      awake.push(w.name);
      continue;
    }
    const role = roster.roleOf(team, w.id);
    const facts = factsFor(deps, f, w, role);
    const prs = prsOf(f, w);
    const mergedPr = prs.some((p) => p.state === 'MERGED') && !prs.some((p) => p.state === 'OPEN');
    const probe = await f.probe(w, mergedPr).catch(() => okProbe());
    const { checks, options } = assess(probe, !!role);
    const reasons = workWaiting(facts);
    const doing = options.filter((o): o is ResumeAction => o !== 'send-home');
    const action: ResumeAction = reasons.length ? (doing[0] ?? 'skip') : 'skip';
    out.push({
      workerId: w.id,
      role,
      name: w.name,
      title: role ? ROLE_BY_ID.get(role)!.title : 'Worker',
      state: 'asleep',
      reasons,
      checks,
      action,
      options: [...options, 'skip'],
      order: 0,
      facts,
      behind: probe.behind,
      dirty: probe.dirty,
      base: probe.base,
      openPrs: prs.filter((p) => p.state === 'OPEN').length,
      jeff: jeffOf(deps, f, w, role),
      key: w.id,
    });
  }
  // A benched member has no worker: hiring it again starts it fresh from its handoff note.
  for (const r of ROLES) {
    const m = d.members[r.id];
    if (m.phase !== 'benched' || (m.workerId && team.worker(m.workerId))) continue;
    const facts = factsFor(deps, f, undefined, r.id);
    const reasons = workWaiting(facts);
    out.push({ role: r.id, name: m.name, title: r.title, state: 'benched', reasons, checks: [], action: reasons.length ? 'rehire' : 'skip', options: ['rehire', 'skip'], order: 0, facts, behind: 0, dirty: 0, openPrs: 0, jeff: jeffOf(deps, f, undefined, r.id), key: agentKey({ role: r.id }) });
  }
  const ordered = wakeOrder(out.map((c) => ({ ...c, owed: c.facts.owed.length })));
  const candidates: Candidate[] = ordered.map(({ openPrs: _p, jeff: _j, key: _k, owed: _o, ...c }, i) => ({ ...c, order: i }));
  const warnings: string[] = [];
  if (f.studioOpen()) warnings.push('Studio Pro has this project open (Studio mode): agents wake, but their mxcli writes stay paused until it closes.');
  const pause = projectPause(team.id);
  if (pause) warnings.push('This floor is paused: resuming lifts the pause, and the office’s own prompts (nudges, standups, relays) go to its agents again.');
  const preview: ResumePreview = {
    floor: team.id,
    floorName: team.name,
    agents: candidates.map(({ facts: _f, behind: _b, dirty: _d, base: _base, ...a }) => a),
    awake,
    blocked: roster.pauseOf(d),
    warnings,
    pause,
    pacing: pacingOf(team.id),
  };
  return { preview, candidates };
}
