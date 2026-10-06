// The project team, as the office runs it (see docs/teams.md): per floor, each role's fixed name and
// the worker it is now; who's idle and for how long, benching Leads that sat idle too long; the
// floor's spend against its daily cap; the daily standup (standup-run.ts); the escalations raised to
// the Project Manager (escalations.ts); and the review nudge to a Lead whose subagent just came back
// (nudge.ts). Everything here is bookkeeping on worker updates plus a once-a-minute look: no model
// calls of its own, so a quiet floor costs nothing. One per office, made on first use (rosterOf), like the analyzer.

import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import { AUTONOMY, capAt, needsApproval } from '../../shared/roster/autonomy.js';
import { latestEntry } from '../../shared/roster/journal.js';
import { teamFromLabels } from '../../shared/roster/card-team.js';
import { LEADS, ROLE_BY_ID, ROLES, type RoleId } from '../../shared/roster/roles.js';
import { dayIn, nextSlot } from '../../shared/roster/schedule.js';
import type { ApprovalItem, MemberStatus, MemberView, RosterView } from '../../shared/roster/types.js';
import { awaitingAnswer, benchStep, dueForBench, isAsleepStatus, isBusyStatus } from './bench.js';
import { forgetSubagents } from '../workers/subagents.js';
import { forgetLastWords } from '../judge/turns.js';
import { Escalations } from './escalations.js';
import { excerpt, readJournal } from './journal-io.js';
import { Jeff } from './jeff.js';
import { Members } from './members.js';
import { Nudges } from './nudge.js';
import { setFloorPause } from './pause.js';
import { Relays } from './relays.js';
import { StandupRunner } from './standup-run.js';
import { Subagents } from './subagents.js';
import { effectiveSkills } from '../../shared/roster/skills.js';
import { OP_ASK, modelWord } from '../../shared/roster/subagents.js';
import { RosterFile, type MemberRecord, type RosterData } from './store.js';
import type { RosterDeps, TeamFloor } from './types.js';

interface Seen {
  status: WorkerStatus;
  /** Since when its turn has been over with nobody at its terminal. */
  idleSince?: number;
}

export class Roster {
  readonly members: Members;
  readonly standups: StandupRunner;
  readonly escalations: Escalations;
  readonly nudges: Nudges;
  readonly jeff: Jeff;
  readonly subagents: Subagents;
  readonly relays: Relays;
  /** Lead pull requests the office already labelled with their team (floor:number), so it asks GitHub once. */
  private labelled = new Set<string>();
  private files = new Map<string, RosterFile>();
  private seen = new Map<string, Seen>();
  private timer?: NodeJS.Timeout;

  constructor(readonly deps: RosterDeps, tickMs = 60_000) {
    this.members = new Members(this);
    this.standups = new StandupRunner(this);
    this.escalations = new Escalations(this);
    this.nudges = new Nudges(this, tickMs > 0);
    this.jeff = new Jeff(this);
    this.subagents = new Subagents(this);
    this.relays = new Relays(this);
    if (tickMs > 0) {
      this.timer = setInterval(() => this.tick(), tickMs);
      this.timer.unref?.();
    }
  }

  stop() {
    clearInterval(this.timer);
    for (const f of this.files.values()) f.flush();
  }

  file(floorId: string): RosterFile {
    let f = this.files.get(floorId);
    if (!f) {
      f = new RosterFile(path.join(this.deps.dataDir, 'roster'), floorId);
      this.files.set(floorId, f);
    }
    return f;
  }

  data(floorId: string): RosterData {
    return this.file(floorId).data;
  }

  /** Saves the floor's roster and, unless `quiet`, tells its browsers to fetch the Team tab again. */
  touch(floor: TeamFloor, quiet = false) {
    this.file(floor.id).save();
    if (!quiet) floor.changed();
  }

  /** The member a worker is, if it's one of the team. */
  roleOf(floor: TeamFloor, workerId: string): RoleId | undefined {
    const d = this.data(floor.id);
    return ROLES.find((r) => d.members[r.id].workerId === workerId)?.id;
  }

  workerOf(floor: TeamFloor, m: MemberRecord): WorkerInfo | undefined {
    return m.workerId ? floor.worker(m.workerId) : undefined;
  }

  idleSince(workerId: string): number | undefined {
    return this.seen.get(workerId)?.idleSince;
  }

  /** Every worker update on the floor: activity for the standup, idleness for the bench, spend for the cap. */
  onWorker(floor: TeamFloor, w: WorkerInfo) {
    const d = this.data(floor.id);
    const now = this.deps.now();
    const prev = this.seen.get(w.id);
    if (w.status === 'working' && prev?.status !== 'working') d.lastActivityAt = now;
    const idle = (w.status === 'idle' || w.status === 'done') && w.viewers.length === 0;
    this.seen.set(w.id, { status: w.status, idleSince: idle ? (prev?.idleSince ?? now) : undefined });
    const capChanged = this.noteSpend(floor, d, w, now);
    // A turn just ended: Jeff judges whether it's waiting on the Project Manager (any agent, not just the team's).
    if (prev?.status === 'working' && (w.status === 'done' || w.status === 'idle')) void this.jeff.onTurnEnd(floor, w).catch((err: unknown) => console.error(`agent-office: Jeff on ${floor.id}: ${(err as Error)?.message ?? err}`));
    const role = this.roleOf(floor, w.id);
    if (!role) return this.touch(floor, !capChanged);
    const m = d.members[role];
    if (m.phase === 'benching') {
      if (isBusyStatus(w.status)) m.benchSawBusy = true;
      else if (benchStep(w.status, !!m.benchSawBusy, m.benchAskedAt ?? now, now) === 'finish') void this.members.finishBench(floor, role);
    }
    this.standups.onWorker(floor, role, w);
    this.nudges.onWorker(floor, role, w);
    this.escalations.onMember(floor, role, w);
    this.subagents.onMember(floor, role, now);
    if (role === 'pm') this.escalations.onCoordinator(floor, w);
    else {
      this.relays.flushLead(floor, role, now);
      this.labelLeadPr(floor, role, w);
    }
    this.touch(floor, prev?.status === w.status && !capChanged);
  }

  /** The floor's issues came back from GitHub: Jeff triages the new ones. */
  onIssues(floor: TeamFloor, issues: Parameters<Jeff['onIssues']>[1]) {
    void this.jeff.onIssues(floor, issues).catch((err: unknown) => console.error(`agent-office: Jeff's triage on ${floor.id}: ${(err as Error)?.message ?? err}`));
  }

  /** A worker left the floor: a member sent home by hand is no longer hired (its name and handoff stay). */
  onWorkerGone(floor: TeamFloor, workerId: string) {
    this.seen.delete(workerId);
    forgetSubagents(workerId);
    forgetLastWords(workerId);
    const role = this.roleOf(floor, workerId);
    if (!role) return;
    const m = this.data(floor.id).members[role];
    if (m.phase === 'benching') return void this.members.finishBench(floor, role);
    m.workerId = undefined;
    m.phase = m.handoff ? 'benched' : 'none';
    this.touch(floor);
  }

  /**
   * A Lead's pull request without a `team:` label gets its team's, so it lands on that team's board
   * (its Playbook asks for `gh pr create --label team:<team>`; this covers the ones that forgot). Only
   * on a real floor (labelPr), once per PR, and only for a PR the office can tie to the Lead: its own,
   * or the one open from its worktree's branch.
   */
  private labelLeadPr(floor: TeamFloor, role: RoleId, w: WorkerInfo) {
    if (!floor.labelPr) return;
    const team = ROLE_BY_ID.get(role)!.team;
    for (const p of floor.openPulls()) {
      if (p.number !== w.pr?.number && !(w.worktree && p.headRefName === w.worktree.branch)) continue;
      const key = `${floor.id}:${p.number}`;
      if (this.labelled.has(key) || teamFromLabels(p.labels)) continue;
      this.labelled.add(key);
      void floor.labelPr(p.number, team).then((err) => {
        if (err === 'skipped') return;
        if (err) floor.toast(`Couldn't label PR #${p.number} team:${team}: ${err}`, 'warn');
        else floor.activity?.(`🏷️ Labelled ${w.name}'s PR #${p.number} team:${team}`);
      });
    }
  }

  /** The once-a-minute look: bench who's been idle too long (never one waiting on the Project Manager's answer), finish handoffs, run a due standup. */
  tick(now = this.deps.now()) {
    for (const floor of this.deps.floors()) {
      const d = this.data(floor.id);
      if (this.rollDay(floor, d, now)) this.touch(floor);
      for (const r of ROLES) {
        const m = d.members[r.id];
        const w = this.workerOf(floor, m);
        // One waiting on the Project Manager's answer to its escalation stays: its turn is over because the next move is theirs.
        if (m.phase === 'active' && w && dueForBench({ status: w.status, viewers: w.viewers.length }, this.idleSince(w.id), now, d.settings.idleMinutes) && !awaitingAnswer(d.escalations, r.id)) {
          this.members.bench(floor, r.id, 'idle');
        } else if (m.phase === 'benching' && benchStep(w?.status, !!m.benchSawBusy, m.benchAskedAt ?? now, now) === 'finish') {
          void this.members.finishBench(floor, r.id);
        }
      }
      this.standups.tick(floor, now);
      this.nudges.tick(floor, LEADS.map((r) => r.id), now);
      this.subagents.tick(floor, now);
      this.escalations.tick(floor);
      this.relays.tick(floor, now);
    }
  }

  // ---- The cost cap ---------------------------------------------------------------------------------

  /** Adds what a worker spent since last seen to the floor's day; true when that changed whether hiring is paused. */
  private noteSpend(floor: TeamFloor, d: RosterData, w: WorkerInfo, now: number): boolean {
    const before = this.pauseOf(d);
    this.rollDay(floor, d, now);
    const cost = w.usage?.cost ?? 0;
    const seen = d.spend.seen[w.id];
    // First sight of it: what it spent on an earlier day isn't today's.
    const base = seen ?? (dayIn(w.createdAt, d.settings.schedule.timeZone) === d.spend.day ? 0 : cost);
    if (cost > base) d.spend.usd = Math.round((d.spend.usd + cost - base) * 10_000) / 10_000;
    d.spend.seen[w.id] = cost;
    const after = this.pauseOf(d);
    setFloorPause(floor.id, after);
    return before !== after;
  }

  /** A new day (in the schedule's time zone): the floor's spend starts over. */
  private rollDay(floor: TeamFloor, d: RosterData, now: number): boolean {
    const day = dayIn(now, d.settings.schedule.timeZone);
    if (d.spend.day === day) return false;
    d.spend.day = day;
    d.spend.usd = 0;
    // Keep each live worker's cost as the base, so yesterday's spend isn't counted again.
    const live = new Set(floor.workers().map((w) => w.id));
    for (const id of Object.keys(d.spend.seen)) if (!live.has(id)) delete d.spend.seen[id];
    setFloorPause(floor.id, undefined);
    return true;
  }

  pauseOf(d: RosterData): string | undefined {
    const cap = capAt(d.settings.costCaps, d.settings.autonomy);
    if (cap === undefined || d.spend.usd < cap) return undefined;
    return `This floor's $${cap.toFixed(2)} daily team cap (autonomy level ${d.settings.autonomy}) is spent — no new hires here until tomorrow`;
  }

  /** Re-applies the cap after the settings changed. */
  recheckPause(floor: TeamFloor) {
    setFloorPause(floor.id, this.pauseOf(this.data(floor.id)));
  }

  // ---- What the Team tab shows ----------------------------------------------------------------------

  statusOf(m: MemberRecord, w: WorkerInfo | undefined): MemberStatus {
    if (m.phase === 'benching') return 'benching';
    if (!w) return m.phase === 'benched' || m.handoff ? 'benched' : 'not-hired';
    if (w.status === 'needs_input') return 'needs-you';
    if (isBusyStatus(w.status)) return 'working';
    if (isAsleepStatus(w.status)) return 'asleep';
    return 'idle';
  }

  view(floor: TeamFloor, admin: boolean): RosterView {
    const d = this.data(floor.id);
    const now = this.deps.now();
    // The first look since the office started: Jeff ranks the open escalations already there.
    this.jeff.priority.firstLook(floor);
    const members: MemberView[] = ROLES.map((r) => {
      const m = d.members[r.id];
      const w = this.workerOf(floor, m);
      // A benched Lead's handoff may only be on its branch so far: the note the office kept stands in.
      const kept = m.handoff && { heading: m.handoff.text.split('\n')[0], body: m.handoff.text.split('\n').slice(1).join('\n'), date: '' };
      const last = latestEntry(readJournal(floor, w, r.team)) ?? kept;
      const status = this.statusOf(m, w);
      return {
        role: r.id,
        title: r.title,
        team: r.team,
        icon: r.icon,
        name: m.name,
        model: m.model,
        status,
        workerId: w?.id,
        cost: w?.usage?.cost,
        // What it's on, while it's on something: an idle one's last prompt is just noise.
        activity: w && (status === 'working' || status === 'needs-you' || status === 'benching') ? (w.task?.summary ?? w.activity) : undefined,
        idleSince: status === 'idle' && w ? this.idleSince(w.id) : undefined,
        lastJournal: last && { heading: last.heading, excerpt: excerpt(last.body) },
        benchedAt: m.benchedAt,
        handoffAt: m.handoff?.at,
      };
    });
    const cap = capAt(d.settings.costCaps, d.settings.autonomy);
    const paused = this.pauseOf(d);
    return {
      floor: floor.id,
      settings: d.settings,
      members,
      standups: d.standups.slice(-14).reverse().map(({ page: _page, ...s }) => s),
      proposals: d.proposals.slice(-100),
      approvals: this.approvals(floor, d, paused),
      escalations: this.escalations.view(floor),
      skills: Object.fromEntries(ROLES.map((r) => [r.id, effectiveSkills(r.id, d.settings.autonomy, d.members[r.id].skills)])),
      subagents: this.subagents.views(floor),
      subagentActions: this.subagents.actionsView(floor),
      spentToday: d.spend.usd,
      cap,
      paused,
      nextStandupAt: nextSlot(now, d.settings.schedule),
      lastStandupAt: d.lastStandupAt,
      activitySinceStandup: d.lastActivityAt !== undefined && d.lastActivityAt > (d.lastStandupAt ?? 0),
      admin,
    };
  }

  /**
   * What needs the Project Manager at the floor's level: open escalations (loudest first), proposals
   * waiting, the team's PRs to merge, a cap reached.
   */
  approvals(floor: TeamFloor, d: RosterData, paused: string | undefined): ApprovalItem[] {
    const level = d.settings.autonomy;
    const out: ApprovalItem[] = this.escalations
      .view(floor)
      .filter((e) => e.status === 'open')
      .map((e) => ({ id: `e-${e.id}`, kind: 'escalation', title: e.title, detail: `${e.by}${e.role ? ` (${ROLE_BY_ID.get(e.role)?.title})` : ''} · ${e.fyi ? 'FYI' : e.urgency}${e.trigger ? ` · ${e.trigger}` : ''}`, team: e.team, escalationId: e.id }));
    out.push(...d.proposals
      .filter((p) => p.status === 'pending')
      .map((p) => ({ id: `p-${p.id}`, kind: 'proposal', title: p.title, detail: `${p.by} (${ROLE_BY_ID.get(p.role)?.title}) · ${p.kind} · standup ${p.standup}${p.detail ? ` — ${p.detail}` : ''}`, team: p.team, proposalId: p.id }) as ApprovalItem));
    // Subagent actions a Lead proposed (its gate was propose); an ask is an escalation above.
    for (const a of d.subagentActions.filter((x) => x.status === 'pending' && x.gate === 'propose')) {
      const m = d.members[a.lead];
      out.push({ id: `s-${a.id}`, kind: 'subagent', title: `${m.name} proposes to ${OP_ASK[a.op]} subagent ${a.name}${a.op === 'swap-model' && a.model ? ` to ${modelWord(a.model)}` : ''}`, detail: `${m.name} (${ROLE_BY_ID.get(a.lead)?.title})${a.reason ? ` — ${a.reason}` : ''}`, team: ROLE_BY_ID.get(a.lead)?.team, actionId: a.id });
    }
    if (needsApproval(level, 'merge')) {
      const pulls = floor.openPulls();
      for (const r of ROLES) {
        const w = this.workerOf(floor, d.members[r.id]);
        if (!w) continue;
        for (const p of pulls.filter((x) => x.number === w.pr?.number || (w.worktree && x.headRefName === w.worktree.branch))) {
          out.push({ id: `m-${p.number}`, kind: 'merge', title: `Merge PR #${p.number}: ${p.title}`, detail: `${d.members[r.id].name} (${r.title}) · merges need the Project Manager at level ${level} (${AUTONOMY[level].name})`, team: r.team, url: p.url });
        }
      }
    }
    if (paused) out.push({ id: 'cap', kind: 'cap', title: 'Daily cost cap reached', detail: `${paused}. Raise the cap in the team settings to hire again today.` });
    return out;
  }
}

const offices = new WeakMap<object, Roster>();

/** The office's roster, keyed like the analyzer by the office's config; `make` builds it the first time. */
export function rosterFor(key: object, make: () => Roster): Roster {
  let r = offices.get(key);
  if (!r) {
    r = make();
    offices.set(key, r);
  }
  return r;
}
