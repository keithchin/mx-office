// Running a standup: each Lead at work is asked for done / next / blockers / proposals (written to
// its team journal); a benched, asleep or never-hired Lead is summarised from its journal without
// being woken. Once everyone asked has answered (or 20 minutes have gone by), the office compiles the
// page, hands the draft to the Project Manager to summarise and commit, and lists each proposal for
// the CTO. The CTO's decisions go back to the PM in one message, a minute after the last one.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';
import { latestEntry, proposalIssue } from '../../shared/roster/journal.js';
import { LEADS, ROLE_BY_ID, standupPath, type RoleId } from '../../shared/roster/roles.js';
import { dayIn, isoWeek, standupDue } from '../../shared/roster/schedule.js';
import type { Proposal, Standup } from '../../shared/roster/types.js';
import { HANDOFF_START_MS, isAsleepStatus, isBusyStatus } from './bench.js';
import type { Roster } from './index.js';
import { dryRunMaker, envDryRun } from './issues.js';
import { readJournal } from './journal-io.js';
import { outcomesPrompt, standupCompiledPrompt, standupPrompt } from './prompts.js';
import { compilePage, reportFrom, standupId, toProposals } from './standup.js';
import type { TeamFloor } from './types.js';

/** How long the Leads asked live get to answer before the page is compiled without them. */
export const COLLECT_MS = 20 * 60_000;
/** The PM hears the CTO's decisions this long after the last one, all in one message. */
export const OUTCOME_DEBOUNCE_MS = 60_000;

export type Decision = 'approve' | 'reject' | 'change';

export class StandupRunner {
  /** Leads asked live, by floor and role: when, and whether they've been busy since. */
  private asks = new Map<string, { at: number; sawBusy: boolean }>();
  private outbox = new Map<string, { list: Proposal[]; timer?: NodeJS.Timeout }>();

  constructor(private roster: Roster) {}

  private collecting(floor: TeamFloor): Standup | undefined {
    return this.roster.data(floor.id).standups.find((s) => s.status === 'collecting');
  }

  /** Starts a standup now (`by` a person, or "schedule"). The standup, or why not. */
  run(floor: TeamFloor, by: string): Standup | string {
    if (this.collecting(floor)) return 'A standup is already being collected';
    const d = this.roster.data(floor.id);
    const now = this.roster.deps.now();
    const date = dayIn(now, d.settings.schedule.timeZone);
    const s: Standup = { id: standupId(date, d.standups.map((x) => x.id)), date, startedAt: now, by, status: 'collecting', waiting: [], reports: [], proposalIds: [] };
    d.standups.push(s);
    d.lastStandupAt = now;
    const stamp = this.roster.members.stamp(floor);
    for (const role of LEADS) {
      const m = d.members[role.id];
      const w = this.roster.workerOf(floor, m);
      // Only one at its desk and not asking someone is asked; the rest come from their journals.
      if (w && m.phase === 'active' && !isAsleepStatus(w.status) && w.status !== 'needs_input') {
        const err = floor.prompt(w.id, standupPrompt(role.id, date, stamp, this.extraFor(floor, role.id, now)));
        if (!err) {
          s.waiting.push(role.id);
          this.asks.set(`${floor.id}:${role.id}`, { at: now, sawBusy: false });
          continue;
        }
      }
      this.fromJournal(floor, s, role.id, w);
    }
    floor.toast(`📋 ${by === 'schedule' ? 'The daily standup' : `${by} called a standup`}: ${s.waiting.length ? `asking ${s.waiting.map((r) => d.members[r].name).join(', ')}` : 'from the journals'}`);
    if (!s.waiting.length) void this.compile(floor, s);
    this.roster.touch(floor);
    return s;
  }

  /** What the Chief Analyst gets on top: the analyzer's numbers, and the weekly memo when it's due. */
  private extraFor(floor: TeamFloor, role: RoleId, now: number): string {
    if (role !== 'chief-analyst') return '';
    const week = isoWeek(now, this.roster.data(floor.id).settings.schedule.timeZone);
    const numbers = this.roster.deps.analysis(floor.id);
    return [numbers && `The office's analyzer data for this project:\n${numbers}`, `If \`docs/insights/${week}.md\` doesn't exist yet, write this week's insight memo there first (see your Playbook).`].filter(Boolean).join('\n');
  }

  /** A Lead's report from its latest journal entry; its proposals only the first time that entry is seen. */
  private fromJournal(floor: TeamFloor, s: Standup, role: RoleId, w: WorkerInfo | undefined, live = false) {
    const d = this.roster.data(floor.id);
    const m = d.members[role];
    const entries = readJournal(floor, w, ROLE_BY_ID.get(role)!.team);
    const today = live ? latestEntry(entries, 'standup', s.date) : undefined;
    const entry = today ?? latestEntry(entries);
    const { report, proposals } = reportFrom(role, m.name, today ? 'live' : entry ? 'journal' : 'none', entry);
    const key = entry && `${entry.date}|${entry.heading}`;
    const seen = d.proposals.some((p) => p.role === role && p.standup === s.id) || (key !== undefined && d.harvested[role] === key);
    const made = seen ? [] : toProposals(proposals, s.id, role, m.name, d.settings.autonomy);
    if (key) d.harvested[role] = key;
    s.reports = [...s.reports.filter((r) => r.role !== role), report];
    d.proposals.push(...made);
    s.proposalIds.push(...made.map((p) => p.id));
  }

  /** A Lead asked live finished its turn: read its standup entry. */
  onWorker(floor: TeamFloor, role: RoleId, w: WorkerInfo) {
    // The PM back at work with decisions it hasn't heard yet.
    if (role === 'pm' && (w.status === 'idle' || w.status === 'done') && this.outbox.get(floor.id)?.list.length && !this.outbox.get(floor.id)?.timer) this.flushPm(floor);
    const s = this.collecting(floor);
    const key = `${floor.id}:${role}`;
    const ask = this.asks.get(key);
    if (!s || !ask || !s.waiting.includes(role)) return;
    if (isBusyStatus(w.status) && w.status !== 'needs_input') ask.sawBusy = true;
    const over = isAsleepStatus(w.status) || ((w.status === 'done' || w.status === 'idle') && (ask.sawBusy || this.roster.deps.now() - ask.at >= HANDOFF_START_MS));
    if (!over) return;
    this.answered(floor, s, role, w);
  }

  private answered(floor: TeamFloor, s: Standup, role: RoleId, w: WorkerInfo | undefined) {
    this.asks.delete(`${floor.id}:${role}`);
    this.fromJournal(floor, s, role, w, true);
    s.waiting = s.waiting.filter((r) => r !== role);
    if (!s.waiting.length) void this.compile(floor, s);
    this.roster.touch(floor);
  }

  /** The minute's look: give up on slow answers, and run the scheduled standup when it's due and there was activity. */
  tick(floor: TeamFloor, now: number) {
    const s = this.collecting(floor);
    if (s && now - s.startedAt >= COLLECT_MS) {
      for (const role of [...s.waiting]) this.answered(floor, s, role, this.roster.workerOf(floor, this.roster.data(floor.id).members[role]));
    }
    const d = this.roster.data(floor.id);
    if (!s && standupDue(now, d.settings.schedule, d.lastStandupAt, d.lastActivityAt) === 'run') this.run(floor, 'schedule');
  }

  /** Everyone's in: the page, the auto-approved proposals' issues, and the PM's draft. */
  async compile(floor: TeamFloor, s: Standup) {
    const d = this.roster.data(floor.id);
    s.status = 'compiled';
    s.compiledAt = this.roster.deps.now();
    for (const p of d.proposals.filter((x) => s.proposalIds.includes(x.id) && x.status === 'auto')) p.issue = await this.makeIssue(floor, p, 'the team');
    s.page = compilePage(s, d.proposals, d.settings.autonomy, floor.name);
    const pm = d.members.pm;
    const w = this.roster.workerOf(floor, pm);
    const pending = d.proposals.filter((p) => s.proposalIds.includes(p.id) && p.status === 'pending').length;
    if (w && pm.phase === 'active' && !isAsleepStatus(w.status) && w.status !== 'needs_input') {
      try {
        const file = path.join(floor.cwdOf(w), standupPath(s.id));
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, s.page);
        s.savedTo = standupPath(s.id);
        floor.prompt(w.id, standupCompiledPrompt(s.id, pending));
      } catch (err) {
        floor.toast(`Couldn't hand the standup page to ${pm.name}: ${(err as Error).message}`, 'warn');
      }
    }
    floor.toast(`📋 Standup ${s.id} is ready${pending ? `: ${pending} proposal${pending === 1 ? '' : 's'} await you` : ''}`);
    this.roster.touch(floor);
  }

  private makeIssue(floor: TeamFloor, p: Proposal, by: string, note?: string, env?: Record<string, string>) {
    const d = this.roster.data(floor.id);
    const make = d.settings.dryRunIssues || envDryRun() ? dryRunMaker : this.roster.deps.makeIssue;
    return make(floor.dir, proposalIssue(p, by, d.settings.autonomy, note), env);
  }

  /**
   * The CTO's decision on a proposal: approve (it becomes an issue labelled with its team), reject
   * (with the reason) or change (what to change; the Lead can propose it again). The PM is told.
   */
  async decide(floor: TeamFloor, id: string, decision: Decision, by: string, reason?: string, env?: Record<string, string>): Promise<string | undefined> {
    const d = this.roster.data(floor.id);
    const p = d.proposals.find((x) => x.id === id);
    if (!p) return 'No such proposal';
    if (p.status !== 'pending' && p.status !== 'change') return `Already ${p.status === 'auto' ? 'decided by the team' : p.status}`;
    const why = reason?.trim().slice(0, 1000) || undefined;
    if (decision !== 'approve' && !why) return decision === 'reject' ? 'Say why it is rejected' : 'Say what should change';
    if (decision === 'approve') {
      const issue = await this.makeIssue(floor, p, by, why, env);
      if (issue.error) return `Couldn't make the issue: ${issue.error}`;
      p.issue = issue;
      p.status = 'approved';
    } else p.status = decision === 'reject' ? 'rejected' : 'change';
    p.reason = decision === 'approve' ? (why ?? p.reason) : why;
    p.decidedBy = by;
    p.decidedAt = this.roster.deps.now();
    const s = d.standups.find((x) => x.id === p.standup);
    if (s?.page) s.page = compilePage(s, d.proposals, d.settings.autonomy, floor.name);
    this.tellPm(floor, p);
    this.roster.touch(floor);
    return undefined;
  }

  /** Queues a decision for the PM, sent with the others a minute after the last. */
  private tellPm(floor: TeamFloor, p: Proposal) {
    const box = this.outbox.get(floor.id) ?? { list: [] };
    box.list = [...box.list.filter((x) => x.id !== p.id), p];
    clearTimeout(box.timer);
    box.timer = setTimeout(() => this.flushPm(floor), OUTCOME_DEBOUNCE_MS);
    box.timer.unref?.();
    this.outbox.set(floor.id, box);
  }

  /**
   * Sends the PM the queued decisions if it's at work. An asleep PM isn't woken for them (that costs a
   * session): they wait until it's back at its desk. A benched or unhired PM finds them on the standup pages.
   */
  flushPm(floor: TeamFloor): boolean {
    const box = this.outbox.get(floor.id);
    if (!box?.list.length) return false;
    box.timer = undefined;
    const pm = this.roster.data(floor.id).members.pm;
    const w = this.roster.workerOf(floor, pm);
    if (!w || pm.phase !== 'active') {
      this.outbox.delete(floor.id);
      return false;
    }
    if (isAsleepStatus(w.status) || w.status === 'needs_input') return false;
    this.outbox.delete(floor.id);
    return !floor.prompt(w.id, outcomesPrompt(box.list));
  }
}
