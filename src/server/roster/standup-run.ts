// Running a standup: each Lead at work is asked for done / next / blockers / proposals (written to
// its team journal); a benched, asleep or never-hired Lead is summarised from its journal without
// being woken. Once everyone asked has answered (or 20 minutes have gone by), the office compiles the
// page, hands the draft to the Project Coordinator to summarise and commit (with the open escalations),
// and lists each proposal for the Project Manager (the human). Their decisions go back to the
// Coordinator in one message, a minute after the last one, and each to the Lead that proposed it as a
// short note (relays.ts). What's still to send is kept in the roster file's outbox.
//
// A standup never takes over a turn under way unless the Project Manager says so: a scheduled one asks
// only the Leads between turns and reads the busy ones' journals; one the Project Manager runs asks the
// busy ones as they chose in the check (shared/roster/interrupt.ts): now, after their current turn (held,
// and asked once it's typed), or from their journal. Each ask ends with the resume line (resume.ts), so
// answering it isn't the end of the turn. And a team hired after today's slot gets no catch-up standup
// on its first day (newTeam in standup.ts): its first standup is the next scheduled one.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';
import { latestEntry, proposalIssue } from '../../shared/roster/journal.js';
import { ROLE_BY_ID, standupPath, type RoleId } from '../../shared/roster/roles.js';
import { coveredBy, standupRoles } from '../../shared/roster/coverage.js';
import { managerRole } from './coverage.js';
import { dayIn, isoWeek, standupDue } from '../../shared/roster/schedule.js';
import type { Proposal, Standup } from '../../shared/roster/types.js';
import { HANDOFF_START_MS, isAsleepStatus, isBusyStatus } from './bench.js';
import type { InterruptChoice } from '../../shared/roster/interrupt.js';

import type { Roster } from './index.js';
import { dryRunMaker, envDryRun } from './issues.js';
import { readJournal } from './journal-io.js';
import { outcomesPrompt, standupCompiledPrompt, standupPrompt } from './prompts.js';
import { coordinatorIs, queueOnce } from './relays.js';
import { compilePage, newTeam, reportFrom, standupId, toProposals } from './standup.js';
import type { TeamFloor } from './types.js';
import { audit, byWhom } from '../audit/index.js';
import { decisionsRelayed } from '../chatter/hooks.js';

/** How long the Leads asked live get to answer before the page is compiled without them. */
export const COLLECT_MS = 20 * 60_000;
/** The Project Coordinator hears the Project Manager's decisions this long after the last one, all in one message. */
export const OUTCOME_DEBOUNCE_MS = 60_000;

export type Decision = 'approve' | 'reject' | 'change';

export class StandupRunner {
  /** Leads asked live, by floor and role: when, and whether they've been busy since. */
  private asks = new Map<string, { at: number; sawBusy: boolean }>();
  /** The Coordinator's debounce per floor; the decisions it's to hear are in the roster file's outbox. */
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private roster: Roster) {}

  /** Whether a Lead has been asked for its standup and hasn't answered yet (the review nudge leaves it be). */
  isAsked(floor: TeamFloor, role: RoleId): boolean {
    return this.asks.has(`${floor.id}:${role}`);
  }

  private collecting(floor: TeamFloor): Standup | undefined {
    return this.roster.data(floor.id).standups.find((s) => s.status === 'collecting');
  }

  /**
   * Starts a standup now (`by` a person, or "schedule"). `choices`: what the Project Manager picked for
   * each busy Lead (after their turn when unsaid). The standup, or why not.
   */
  run(floor: TeamFloor, by: string, choices: Partial<Record<RoleId, InterruptChoice>> = {}): Standup | string {
    if (this.collecting(floor)) return 'A standup is already being collected';
    const d = this.roster.data(floor.id);
    const now = this.roster.deps.now();
    const date = dayIn(now, d.settings.schedule.timeZone);
    const s: Standup = { id: standupId(date, d.standups.map((x) => x.id)), date, startedAt: now, by, status: 'collecting', waiting: [], reports: [], proposalIds: [] };
    d.standups.push(s);
    d.lastStandupAt = now;
    const stamp = this.roster.members.stamp(floor);
    const scheduled = by === 'schedule';
    /** Asked after their current turn: held, and asked once it's typed. */
    const later: RoleId[] = [];
    // The Leads that cover a team (the four on an Enterprise team, the Solo Lead alone on a Solo one); nobody absent is asked.
    for (const role of standupRoles(d.coverage).map((r) => ROLE_BY_ID.get(r)!)) {
      const m = d.members[role.id];
      const w = this.roster.workerOf(floor, m);
      // Only one at its desk and not asking someone is asked; the rest come from their journals.
      // A scheduled one is the office's: past the spend cap, everyone's comes from their journal, and so
      // does a busy one's (the office never takes over a turn under way).
      if (w && m.phase === 'active' && !isAsleepStatus(w.status) && w.status !== 'needs_input') {
        const busy = isBusyStatus(w.status);
        const choice: InterruptChoice = !busy ? 'interrupt' : scheduled ? 'journal' : (choices[role.id] ?? 'after');
        if (choice !== 'journal') {
          const key = `${floor.id}:${role.id}`;
          const r = this.roster.delivery.send(floor, w, standupPrompt(role.id, date, stamp, this.extraFor(floor, role.id, now)), {
            origin: scheduled ? 'office' : 'person',
            ...(scheduled ? {} : { by }),
            resume: true,
            id: `standup:${s.id}:${role.id}`,
            ...(choice === 'after' ? { hold: true, between: true, ttlMs: COLLECT_MS } : {}),
            // Asked once it's typed: a held one isn't waited on until then (its turn under way isn't the answer).
            onSent: () => this.asks.set(key, { at: this.roster.deps.now(), sawBusy: false }),
          });
          if (r.status !== 'refused') {
            s.waiting.push(role.id);
            if (r.status === 'held') later.push(role.id);
            continue;
          }
        }
      }
      this.fromJournal(floor, s, role.id, w);
    }
    const now2 = s.waiting.filter((r) => !later.includes(r));
    audit.record({ floor: floor.id, actor: byWhom(by), action: 'standup.run', target: { kind: 'standup', id: s.id, label: `Standup ${s.date}` }, summary: scheduled ? 'The daily standup started' : 'Called a standup', details: { asked: now2, ...(later.length ? { afterTurn: later } : {}) } });
    const names = (rs: RoleId[]) => rs.map((r) => d.members[r].name).join(', ');
    const parts = [now2.length ? `asking ${names(now2)}` : '', later.length ? `after their turn: ${names(later)}` : ''].filter(Boolean);
    floor.toast(`📋 ${scheduled ? 'The daily standup' : `${by} called a standup`}: ${parts.length ? `${parts.join('; ')}; the rest from their journals` : 'from the journals'}`);
    if (!s.waiting.length) void this.compile(floor, s);
    this.roster.touch(floor);
    return s;
  }

  /** What the Chief Analyst gets on top: the analyzer's numbers, and the weekly memo when it's due. */
  private extraFor(floor: TeamFloor, role: RoleId, now: number): string {
    if (!coveredBy(this.roster.data(floor.id).coverage, role).includes('analysis')) return '';
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
    // The Project Coordinator back at work with decisions it hasn't heard yet.
    if (role === managerRole(this.roster.data(floor.id)) && (w.status === 'idle' || w.status === 'done') && this.roster.data(floor.id).outbox.decisions.length && !this.timers.has(floor.id)) this.flushPm(floor);
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
    // Decisions that waited through a restart (no timer then) go out once the Coordinator can hear them.
    if (d.outbox.decisions.length && !this.timers.has(floor.id)) this.flushPm(floor);
    // A team hired after today's slot has its first standup at the next one, not a catch-up now.
    if (!s && standupDue(now, d.settings.schedule, d.lastStandupAt, d.lastActivityAt) === 'run' && !newTeam(now, d.settings.schedule, Object.values(d.members).map((m) => m.hiredAt))) this.run(floor, 'schedule');
  }

  /** Everyone's in: the page, the auto-approved proposals' issues, and the Project Coordinator's draft. */
  async compile(floor: TeamFloor, s: Standup) {
    const d = this.roster.data(floor.id);
    s.status = 'compiled';
    s.compiledAt = this.roster.deps.now();
    for (const p of d.proposals.filter((x) => s.proposalIds.includes(x.id) && x.status === 'auto')) p.issue = await this.makeIssue(floor, p, 'the team');
    s.page = compilePage(s, d.proposals, d.settings.autonomy, floor.name);
    // To whoever covers Management: the Coordinator, or on a Solo team the Solo Lead (its daily note in docs/standups).
    const pm = d.members[managerRole(d)];
    const w = this.roster.workerOf(floor, pm);
    const pending = d.proposals.filter((p) => s.proposalIds.includes(p.id) && p.status === 'pending').length;
    if (w && pm.phase === 'active' && !isAsleepStatus(w.status) && w.status !== 'needs_input') {
      try {
        const file = path.join(floor.cwdOf(w), standupPath(s.id));
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, s.page);
        s.savedTo = standupPath(s.id);
        this.roster.delivery.send(floor, w, standupCompiledPrompt(s.id, pending, d.escalations.filter((e) => e.status === 'open' || e.at >= (d.standups[d.standups.length - 2]?.startedAt ?? 0))), { origin: s.by === 'schedule' ? 'office' : 'person', resume: true });
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
   * The Project Manager's decision on a proposal: approve (it becomes an issue labelled with its team),
   * reject (with the reason) or change (what to change; the Lead can propose it again). The Project
   * Coordinator is told.
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
    // The member who covers Management hears it with the others, unless it proposed it: then its own note says it.
    if (p.role !== managerRole(d)) this.tellPm(floor, p);
    // What it proposed and waited on: it hears soon, woken for it if it's asleep (relays.ts).
    this.roster.relays.noteLead(floor, p.role, decisionNote(p, by), true);
    audit.record({ floor: floor.id, actor: byWhom(by), action: 'proposal.decide', target: { kind: 'proposal', id: p.id, label: p.title }, summary: `${decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'Asked for changes to'} the proposal “${p.title}”${p.issue?.number ? ` (issue #${p.issue.number})` : ''}`, details: { decision, reason: why ? { length: why.length } : undefined, issue: p.issue?.number }, severity: 'notice' });
    this.roster.touch(floor);
    return undefined;
  }

  /** Queues a decision for the Project Coordinator, sent with the others a minute after the last. */
  private tellPm(floor: TeamFloor, p: Proposal) {
    const d = this.roster.data(floor.id);
    d.outbox.decisions = queueOnce(d.outbox.decisions, p.id);
    clearTimeout(this.timers.get(floor.id));
    const timer = setTimeout(() => this.flushPm(floor), OUTCOME_DEBOUNCE_MS);
    timer.unref?.();
    this.timers.set(floor.id, timer);
  }

  /**
   * Sends the Project Coordinator the queued decisions if it's at work. An asleep, benched or
   * busy-asking one isn't woken for them (that costs a session): they wait in the outbox until it's back
   * at its desk. A floor with no Coordinator drops them: each Lead has its own as a note already.
   */
  flushPm(floor: TeamFloor): boolean {
    const d = this.roster.data(floor.id);
    if (!d.outbox.decisions.length) return false;
    clearTimeout(this.timers.get(floor.id));
    this.timers.delete(floor.id);
    // Busy asking someone, booting, or the spend cap reached: they wait in the outbox.
    const where = coordinatorIs(this.roster, floor);
    if (where === 'away') return false;
    // Asleep: woken once with everything it's owed (relays.ts wakeCoordinator), at most once a window.
    if (where === 'asleep') return this.roster.relays.wakeCoordinator(floor);
    const list = d.outbox.decisions.map((id) => d.proposals.find((p) => p.id === id)).filter((p): p is Proposal => !!p);
    if (where === 'none' || !list.length) {
      d.outbox.decisions = [];
      this.roster.touch(floor, true);
      return false;
    }
    const w = this.roster.workerOf(floor, d.members[managerRole(d)])!;
    if (this.roster.delivery.prompt(floor, w, outcomesPrompt(list))) return false;
    d.outbox.decisions = [];
    this.roster.touch(floor, true);
    decisionsRelayed(floor.id, w, list);
    return true;
  }
}

/** The Lead's note about the Project Manager's decision on its proposal. */
export function decisionNote(p: Proposal, by: string): string {
  const what = p.status === 'approved' ? `APPROVED${p.issue?.number ? ` → issue #${p.issue.number}` : p.issue?.dryRun ? ' (dry run: no issue made)' : ''}` : p.status === 'rejected' ? `REJECTED: ${p.reason ?? 'no reason given'}` : `CHANGE REQUESTED: ${p.reason ?? ''} (propose it again once changed)`;
  return `Your proposal “${p.title}” (standup ${p.standup}): ${what} (${by}).`;
}
