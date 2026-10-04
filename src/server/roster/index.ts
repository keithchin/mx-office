// The project team, as the office runs it (see docs/teams.md): per floor, each role's fixed name and
// the worker it is now; who's idle and for how long, benching Leads that sat idle too long; the
// floor's spend against its daily cap; and the daily standup (standup-run.ts). Everything here is
// bookkeeping on worker updates plus a once-a-minute look: no model calls of its own, so a quiet
// floor costs nothing. One per office, made on first use (rosterOf), like the analyzer.

import path from 'node:path';
import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import { AUTONOMY, capAt, needsCto } from '../../shared/roster/autonomy.js';
import { latestEntry } from '../../shared/roster/journal.js';
import { ROLE_BY_ID, ROLES, type RoleId } from '../../shared/roster/roles.js';
import { dayIn, nextSlot } from '../../shared/roster/schedule.js';
import type { ApprovalItem, MemberStatus, MemberView, RosterView } from '../../shared/roster/types.js';
import { benchStep, dueForBench, isAsleepStatus, isBusyStatus } from './bench.js';
import { excerpt, readJournal } from './journal-io.js';
import { Members } from './members.js';
import { setFloorPause } from './pause.js';
import { StandupRunner } from './standup-run.js';
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
  private files = new Map<string, RosterFile>();
  private seen = new Map<string, Seen>();
  private timer?: NodeJS.Timeout;

  constructor(readonly deps: RosterDeps, tickMs = 60_000) {
    this.members = new Members(this);
    this.standups = new StandupRunner(this);
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
    const role = this.roleOf(floor, w.id);
    if (!role) return this.touch(floor, !capChanged);
    const m = d.members[role];
    if (m.phase === 'benching') {
      if (isBusyStatus(w.status)) m.benchSawBusy = true;
      else if (benchStep(w.status, !!m.benchSawBusy, m.benchAskedAt ?? now, now) === 'finish') void this.members.finishBench(floor, role);
    }
    this.standups.onWorker(floor, role, w);
    this.touch(floor, prev?.status === w.status && !capChanged);
  }

  /** A worker left the floor: a member sent home by hand is no longer hired (its name and handoff stay). */
  onWorkerGone(floor: TeamFloor, workerId: string) {
    this.seen.delete(workerId);
    const role = this.roleOf(floor, workerId);
    if (!role) return;
    const m = this.data(floor.id).members[role];
    if (m.phase === 'benching') return void this.members.finishBench(floor, role);
    m.workerId = undefined;
    m.phase = m.handoff ? 'benched' : 'none';
    this.touch(floor);
  }

  /** The once-a-minute look: bench who's been idle too long, finish handoffs, run a due standup. */
  tick(now = this.deps.now()) {
    for (const floor of this.deps.floors()) {
      const d = this.data(floor.id);
      if (this.rollDay(floor, d, now)) this.touch(floor);
      for (const r of ROLES) {
        const m = d.members[r.id];
        const w = this.workerOf(floor, m);
        if (m.phase === 'active' && w && dueForBench({ status: w.status, viewers: w.viewers.length }, this.idleSince(w.id), now, d.settings.idleMinutes)) {
          this.members.bench(floor, r.id, 'idle');
        } else if (m.phase === 'benching' && benchStep(w?.status, !!m.benchSawBusy, m.benchAskedAt ?? now, now) === 'finish') {
          void this.members.finishBench(floor, r.id);
        }
      }
      this.standups.tick(floor, now);
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
      spentToday: d.spend.usd,
      cap,
      paused,
      nextStandupAt: nextSlot(now, d.settings.schedule),
      lastStandupAt: d.lastStandupAt,
      activitySinceStandup: d.lastActivityAt !== undefined && d.lastActivityAt > (d.lastStandupAt ?? 0),
      admin,
    };
  }

  /** What needs the CTO at the floor's level: proposals waiting, the team's PRs to merge, a cap reached. */
  approvals(floor: TeamFloor, d: RosterData, paused: string | undefined): ApprovalItem[] {
    const level = d.settings.autonomy;
    const out: ApprovalItem[] = d.proposals
      .filter((p) => p.status === 'pending')
      .map((p) => ({ id: `p-${p.id}`, kind: 'proposal', title: p.title, detail: `${p.by} (${ROLE_BY_ID.get(p.role)?.title}) · ${p.kind} · standup ${p.standup}${p.detail ? ` — ${p.detail}` : ''}`, team: p.team, proposalId: p.id }));
    if (needsCto(level, 'merge')) {
      const pulls = floor.openPulls();
      for (const r of ROLES) {
        const w = this.workerOf(floor, d.members[r.id]);
        if (!w) continue;
        for (const p of pulls.filter((x) => x.number === w.pr?.number || (w.worktree && x.headRefName === w.worktree.branch))) {
          out.push({ id: `m-${p.number}`, kind: 'merge', title: `Merge PR #${p.number}: ${p.title}`, detail: `${d.members[r.id].name} (${r.title}) · merges need the CTO at level ${level} (${AUTONOMY[level].name})`, team: r.team, url: p.url });
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
