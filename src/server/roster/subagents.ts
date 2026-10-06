// The Leads' subagents as a team the office keeps score of (see docs/teams.md): every run its hooks
// report (SubagentStart/SubagentStop, and the Agent tool's result: workers/subagents.ts), the Lead's
// review verdict on it (`office-workers subagent review`), a grade per subagent and model
// (shared/roster/subagents.ts), and where each stands with its Lead: active, on warning, benched until
// a cool-down ends. A Lead's warn / bench / swap-model / reinstate goes through the gate its skill has
// (shared/roster/skills.ts): ask raises an escalation and waits for the answer, propose files an
// approval, tell does it and tells the Project Coordinator, fyi does it and files an FYI. The Project
// Manager can do any of them straight from the Team tab. The files they change are subagent-files.ts's.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { WorkerInfo } from '../../shared/protocol.js';
import { LEADS, ROLE_BY_ID, type RoleId } from '../../shared/roster/roles.js';
import { effectiveSkill, effectiveSkills, GATE_WORDS, type SubagentOp } from '../../shared/roster/skills.js';
import { currentModel, modelWord, OP_ASK, OP_ICON, OP_VERB, RUNS_KEPT, SCORE_MIN_RUNS, scoreSubagent, type SubagentAction, type SubagentRecord, type SubagentRun, type SubagentView } from '../../shared/roster/subagents.js';
import type { SubagentEvent } from '../workers/subagents.js';
import { isAsleepStatus } from './bench.js';
import type { Roster } from './index.js';
import { NUDGE_GRACE_MS } from './nudge.js';
import { coordinatorIs, queueOnce } from './relays.js';
import { subagentDecisionPrompt, subagentNewsPrompt, underperformingPrompt } from './prompts.js';
import { cleanSubName, subagentReviews, subKey, type SubagentReview } from './subagent-store.js';
import { definitionOf } from './subagent-files.js';
import type { TeamFloor } from './types.js';
import { struggleNudged, toldCoordinator } from '../chatter/hooks.js';

/** Models a subagent can be swapped to: Claude Code's aliases, inherit, or a model id. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,63}$/;
/** A result with no SubagentStop before it (an older Claude Code) is its own run; one this soon after a stop is that run's. */
const PAIR_MS = 120_000;
/** The Coordinator hears about the team's subagent decisions this long after the last one, in one message. */
export const NEWS_DEBOUNCE_MS = 60_000;

export interface OpArgs {
  reason?: string;
  model?: string;
}

/** What a Lead's request came to: done, asked, proposed, or why not. */
export interface OpAnswer {
  ok: boolean;
  outcome?: 'done' | 'asked' | 'proposed';
  message: string;
  actionId?: string;
}

const line = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

export class Subagents {
  /** Runs under way (worker:agent_id), from SubagentStart until SubagentStop. */
  private open = new Map<string, { at: number; agent?: string }>();

  constructor(private roster: Roster) {}

  /** The subagent's record, made when it's first seen. */
  record(floor: TeamFloor, lead: RoleId, name: string): SubagentRecord {
    const d = this.roster.data(floor.id);
    const key = subKey(lead, name);
    return (d.subagents[key] ??= { name, lead, state: 'active', warnings: [], runs: [] });
  }

  private find(floor: TeamFloor, lead: RoleId, name: string): SubagentRecord | undefined {
    return this.roster.data(floor.id).subagents[subKey(lead, name)];
  }

  private leadWorker(floor: TeamFloor, lead: RoleId): WorkerInfo | undefined {
    const m = this.roster.data(floor.id).members[lead];
    return m.phase === 'active' || m.phase === 'benching' ? this.roster.workerOf(floor, m) : undefined;
  }

  /** The model a run went on: the Agent call's, else the swap, else its definition's, else its default. */
  private modelOf(floor: TeamFloor, lead: RoleId, rec: SubagentRecord, given?: string): string {
    if (given) return given;
    if (rec.model) return rec.model;
    const w = this.leadWorker(floor, lead);
    const def = w && definitionOf(floor.cwdOf(w), rec.name);
    if (def) {
      try {
        const m = /^model:\s*(\S+)/m.exec(readFileSync(def.file, 'utf8'));
        if (m) return m[1];
      } catch {
        // its default, then
      }
    }
    return ROLE_BY_ID.get(lead)!.subagents.find((s) => s.id === rec.name)?.model ?? 'inherit';
  }

  private addRun(rec: SubagentRecord, run: SubagentRun) {
    rec.runs.push(run);
    if (rec.runs.length > RUNS_KEPT) rec.runs.splice(0, rec.runs.length - RUNS_KEPT);
  }

  // ---- Runs, from the hooks ---------------------------------------------------------------------

  /** A Lead's subagent began, ended, or its Agent call came back. Other workers' subagents aren't the team's. */
  onEvent(floor: TeamFloor, workerId: string, ev: SubagentEvent) {
    const lead = this.roster.roleOf(floor, workerId);
    if (!lead || lead === 'pm') return;
    const name = cleanSubName(ev.agent) ?? (ev.kind === 'result' ? 'general-purpose' : undefined);
    if (ev.kind === 'start') {
      if (ev.agentId) this.open.set(`${workerId}:${ev.agentId}`, { at: ev.at, agent: name });
      const rec = name && this.find(floor, lead, name);
      if (rec && rec.state === 'benched') {
        const m = this.roster.data(floor.id).members[lead];
        floor.activity?.(`🪑 ${m.name} dispatched ${name}, which is benched: the office denied it in ${m.name}'s settings`);
      }
      return;
    }
    if (ev.kind === 'stop') {
      const key = `${workerId}:${ev.agentId ?? ''}`;
      const began = this.open.get(key);
      this.open.delete(key);
      const who = name ?? began?.agent;
      if (!who) return;
      const rec = this.record(floor, lead, who);
      const at = began?.at ?? ev.at;
      this.addRun(rec, { id: ev.agentId ?? `run-${ev.at}`, at, endedAt: ev.at, durationMs: ev.at - at, model: this.modelOf(floor, lead, rec), outcome: 'pending' });
      this.roster.touch(floor, true);
      return;
    }
    // The Agent tool's result: the task, the model it was called with, and whether the call failed.
    if (ev.background || !name) return;
    const rec = this.record(floor, lead, name);
    const run = [...rec.runs].reverse().find((r) => !r.task && r.endedAt !== undefined && ev.at - r.endedAt <= PAIR_MS);
    if (run) {
      if (ev.task) run.task = ev.task;
      if (ev.model) run.model = ev.model;
      if (ev.failed && run.outcome === 'pending') run.outcome = 'failed';
    } else {
      const ms = ev.durationMs ?? 0;
      this.addRun(rec, { id: `run-${ev.at}`, at: ev.at - ms, endedAt: ev.at, ...(ev.durationMs !== undefined ? { durationMs: ms } : {}), model: this.modelOf(floor, lead, rec, ev.model), ...(ev.task ? { task: ev.task } : {}), outcome: ev.failed ? 'failed' : 'pending' });
    }
    this.roster.touch(floor, true);
  }

  // ---- The Lead's review verdict -----------------------------------------------------------------

  /** Records a verdict on the subagent's newest unreviewed run (or a run of its own, when none is). */
  review(floor: TeamFloor, lead: RoleId, rawName: unknown, verdict: 'accept' | 'rework', note?: string): string | SubagentRun {
    const name = cleanSubName(rawName);
    if (!name) return 'Name the subagent (as in .claude/agents/<name>.md)';
    const rec = this.record(floor, lead, name);
    const now = this.roster.deps.now();
    let run = [...rec.runs].reverse().find((r) => r.outcome === 'pending' || r.outcome === 'failed');
    if (!run) {
      run = { id: `review-${now}`, at: now, endedAt: now, model: this.modelOf(floor, lead, rec), outcome: 'pending' };
      this.addRun(rec, run);
    }
    run.outcome = verdict;
    run.reviewedAt = now;
    const said = line(note, 300);
    if (said) run.note = said;
    this.checkScore(floor, rec, now);
    this.roster.touch(floor);
    return run;
  }

  /** After a verdict: a subagent that's underperforming is flagged once, and its Lead nudged when idle. */
  private checkScore(floor: TeamFloor, rec: SubagentRecord, now: number) {
    if (rec.state === 'benched') return;
    const s = scoreSubagent(rec.runs, currentModel(rec, 'inherit'));
    if (!s.underperforming) return;
    const since = rec.flaggedAt === undefined ? Infinity : rec.runs.filter((r) => r.outcome !== 'pending' && (r.endedAt ?? r.at) > rec.flaggedAt!).length;
    if (since < SCORE_MIN_RUNS) return;
    rec.flaggedAt = now;
    const m = this.roster.data(floor.id).members[rec.lead];
    floor.activity?.(`📉 ${rec.name} (${modelWord(s.model)}) on ${m.name}'s team is underperforming: ${s.why}`);
  }

  // ---- Warn, bench, swap model, reinstate ------------------------------------------------------

  /** A Lead's request, through its skill's gate. */
  request(floor: TeamFloor, lead: RoleId, w: WorkerInfo, op: SubagentOp, rawName: unknown, args: OpArgs): OpAnswer {
    const d = this.roster.data(floor.id);
    const m = d.members[lead];
    const name = cleanSubName(rawName);
    if (!name) return { ok: false, message: 'Name the subagent (as in .claude/agents/<name>.md)' };
    const skill = effectiveSkill(lead, d.settings.autonomy, op, m.skills);
    if (!skill) return { ok: false, message: `${OP_ASK[op]} isn't one of a ${ROLE_BY_ID.get(lead)!.title}'s skills` };
    if (!skill.enabled) return { ok: false, message: `The Project Manager turned "${skill.title}" off for you: escalate instead (office-workers escalate)` };
    const bad = this.check(floor, lead, op, name, args);
    if (bad) return { ok: false, message: bad };
    const gate = skill.gate ?? 'tell';
    const what = `${OP_ASK[op]} ${name}${op === 'swap-model' ? ` to ${args.model}` : ''}`;
    if (gate === 'ask' || gate === 'propose') {
      const a: SubagentAction = { id: randomBytes(5).toString('hex'), at: this.roster.deps.now(), lead, by: m.name, op, name, gate, status: 'pending', ...(args.reason ? { reason: args.reason } : {}), ...(args.model ? { model: args.model } : {}) };
      d.subagentActions.push(a);
      if (gate === 'ask') {
        const e = this.roster.escalations.raise(floor, w, { urgency: 'important', title: `${m.name} asks to ${what}`, details: [args.reason ? `Why: ${args.reason}` : '', this.trackLine(floor, lead, name)].filter(Boolean).join('\n'), options: ['Approve: the office does it', 'Reject'], recommendation: 'Approve: the office does it' });
        a.escalationId = e.id;
        this.roster.touch(floor);
        return { ok: true, outcome: 'asked', actionId: a.id, message: `Asked the Project Manager (escalation ${e.id}): "${what}". The office does it if they approve; their answer comes back to you as a prompt. Carry on meanwhile.` };
      }
      floor.activity?.(`📝 ${m.name} (${ROLE_BY_ID.get(lead)!.title}) proposed to ${what}${args.reason ? `: ${args.reason}` : ''}`);
      this.roster.touch(floor);
      return { ok: true, outcome: 'proposed', actionId: a.id, message: `Proposed to the Project Manager: "${what}". It's in their approvals; the office does it once they approve, and tells you either way. Carry on meanwhile.` };
    }
    this.run(floor, lead, op, name, args, m.name, 'lead');
    const done = `Done: ${OP_VERB[op]} ${name}.`;
    if (gate === 'fyi') {
      this.roster.escalations.raiseFyi(floor, w, { urgency: 'info', title: `${m.name} ${OP_VERB[op]} subagent ${name}${args.reason ? `: ${args.reason}` : ''}`, details: this.trackLine(floor, lead, name), options: [] });
      return { ok: true, outcome: 'done', message: `${done} The Project Manager got an FYI.` };
    }
    this.queueNews(floor, `${m.name} ${OP_VERB[op]} subagent ${name}${op === 'swap-model' ? ` (now ${args.model})` : ''}${args.reason ? `: ${args.reason}` : ''}`);
    toldCoordinator(floor.id, w, d.members.pm, `I ${OP_VERB[op]} my subagent ${name}${op === 'swap-model' ? ` (now ${args.model})` : ''}${args.reason ? `: ${args.reason}` : ''}`, name);
    return { ok: true, outcome: 'done', message: `${done} The Project Coordinator is told.` };
  }

  /** Why `op` can't be done to `name` now, if it can't. */
  private check(floor: TeamFloor, lead: RoleId, op: SubagentOp, name: string, args: OpArgs): string | undefined {
    const rec = this.find(floor, lead, name);
    const defined = ROLE_BY_ID.get(lead)!.subagents.some((s) => s.id === name);
    const w = this.leadWorker(floor, lead);
    if (!rec && !defined && !(w && definitionOf(floor.cwdOf(w), name))) return `No subagent called ${name} on the ${ROLE_BY_ID.get(lead)!.title}'s team`;
    if ((op === 'warn' || op === 'bench') && !args.reason) return `Say why: --reason "…" (it goes into ${name}'s definition and the activity)`;
    if (op === 'swap-model' && (!args.model || !MODEL.test(args.model))) return 'Which model? --model haiku|sonnet|opus (or a model id, or inherit)';
    if (op === 'bench' && rec?.state === 'benched') return `${name} is already benched`;
    if (op === 'reinstate' && (!rec || rec.state === 'active')) return `${name} isn't benched or on warning`;
    return undefined;
  }

  /**
   * Does it: the record, then the files in the Lead's folder (its Playbook and subagent definitions are
   * written again from the records), an activity line, and a word to the Lead when it wasn't its own doing.
   * `as`: who did it, the Lead, the Project Manager from the Team tab, or the office (the cool-down).
   */
  run(floor: TeamFloor, lead: RoleId, op: SubagentOp, name: string, args: OpArgs, by: string, as: 'lead' | 'pm' | 'office'): string | undefined {
    const bad = this.check(floor, lead, op, name, args);
    if (bad) return bad;
    const d = this.roster.data(floor.id);
    const rec = this.record(floor, lead, name);
    const now = this.roster.deps.now();
    const reason = args.reason ? line(args.reason, 300) : undefined;
    const before = modelWord(currentModel(rec, this.modelOf(floor, lead, rec)));
    if (op === 'warn') {
      rec.warnings.push({ at: now, reason: reason!, by });
      if (rec.state === 'active') rec.state = 'warning';
    } else if (op === 'bench') {
      const hours = d.settings.subagentCooldownHours;
      Object.assign(rec, { state: 'benched', benchedAt: now, benchedUntil: hours > 0 ? now + hours * 3_600_000 : undefined, benchReason: reason });
    } else if (op === 'swap-model') {
      rec.model = args.model;
    } else {
      rec.state = 'active';
      rec.benchedAt = rec.benchedUntil = rec.benchReason = undefined;
      rec.flaggedAt = rec.nudgedAt = undefined;
    }
    const m = d.members[lead];
    const who = as === 'lead' ? `${by} (${ROLE_BY_ID.get(lead)!.title})` : as === 'pm' ? `${by} (Project Manager)` : 'The office';
    const whose = as === 'lead' ? 'subagent' : `${m.name}'s subagent`;
    const why = op === 'swap-model' ? ` to ${modelWord(args.model!)}` : reason ? `: ${reason}` : as === 'office' ? ': its cool-down is over' : '';
    floor.activity?.(`${OP_ICON[op]} ${who} ${OP_VERB[op]} ${whose} ${name} (${before})${why}`);
    const w = this.leadWorker(floor, lead);
    const wrote = this.roster.members.rewrite(floor, lead);
    // The Lead hears what it didn't do itself, between turns (never interrupting one, or a question to a person).
    if (as !== 'lead' && w && wrote && (w.status === 'idle' || w.status === 'done')) {
      floor.prompt(w.id, `${as === 'pm' ? `The Project Manager (${by})` : 'The office'} ${OP_VERB[op]} your subagent ${name}${why}. Your Playbook and its definition have been rewritten${op === 'bench' ? `: don't dispatch ${name}; do the work yourself or use another subagent` : ''}. Note it in your team journal and carry on. Reply \`ok\`.`);
    }
    this.roster.touch(floor);
    return undefined;
  }

  // ---- The Project Manager's decisions -----------------------------------------------------------

  /** Approve or reject a proposed action (the approvals' card). */
  decide(floor: TeamFloor, id: string, approve: boolean, by: string, reason?: string): string | undefined {
    const d = this.roster.data(floor.id);
    const a = d.subagentActions.find((x) => x.id === id);
    if (!a) return 'No such request';
    if (a.status !== 'pending') return `Already ${a.status}${a.decidedBy ? ` by ${a.decidedBy}` : ''}`;
    if (approve) {
      const err = this.run(floor, a.lead, a.op, a.name, { reason: a.reason, model: a.model }, a.by, 'lead');
      if (err) return err;
    }
    Object.assign(a, { status: approve ? 'approved' : 'rejected', decidedBy: by, decidedAt: this.roster.deps.now(), ...(reason ? { decision: line(reason, 300) } : {}) });
    floor.activity?.(`${approve ? '✅' : '❌'} ${by} ${approve ? 'approved' : 'rejected'} ${a.by}'s request to ${OP_ASK[a.op]} ${a.name}`);
    // An ask's escalation is answered by this too; a proposal's Lead is told here, or as soon as it's
    // back between turns when it's asleep or asking someone now (relays.ts keeps the note).
    if (a.escalationId) this.roster.escalations.resolve(floor, a.escalationId, approve ? 'approve' : 'reject', reason || (approve ? 'Approved: the office has done it.' : 'Rejected.'), by);
    else {
      const w = this.leadWorker(floor, a.lead);
      const told = !!w && !isAsleepStatus(w.status) && w.status !== 'needs_input' && !floor.prompt(w.id, subagentDecisionPrompt(`${OP_ASK[a.op]} ${a.name}`, approve, by, reason));
      if (!told) this.roster.relays.noteLead(floor, a.lead, `The Project Manager (${by}) ${approve ? 'approved' : 'rejected'} your request to ${OP_ASK[a.op]} ${a.name}.${approve ? ' The office has done it.' : ''}${reason ? ` ${line(reason, 300)}` : ''}`);
    }
    this.roster.touch(floor);
    return undefined;
  }

  /** An escalation was answered: when it was a Lead's `ask`, approving it does the action. */
  onEscalationResolved(floor: TeamFloor, escalationId: string, verdict: string, by: string) {
    const a = this.roster.data(floor.id).subagentActions.find((x) => x.escalationId === escalationId && x.status === 'pending');
    if (!a) return;
    const err = verdict === 'approve' ? this.run(floor, a.lead, a.op, a.name, { reason: a.reason, model: a.model }, a.by, 'lead') : 'not approved';
    Object.assign(a, { status: err ? 'rejected' : 'approved', decidedBy: by, decidedAt: this.roster.deps.now(), ...(err && verdict === 'approve' ? { decision: `Approved, but the office couldn't: ${err}` } : {}) });
  }

  // ---- The minute look ---------------------------------------------------------------------------

  /** Reinstates subagents whose cool-down is over, tells the Coordinator the news, nudges about underperformers. */
  tick(floor: TeamFloor, now: number) {
    const d = this.roster.data(floor.id);
    for (const rec of Object.values(d.subagents)) {
      if (rec.state === 'benched' && rec.benchedUntil !== undefined && rec.benchedUntil <= now) this.run(floor, rec.lead, 'reinstate', rec.name, {}, 'The office', 'office');
    }
    this.flushNews(floor, now);
    for (const r of LEADS) this.nudgeLead(floor, r.id, now);
  }

  /** A member's worker changed: the Coordinator back between turns hears the news; a Lead may be nudged. */
  onMember(floor: TeamFloor, role: RoleId, now = this.roster.deps.now()) {
    if (role === 'pm') this.flushNews(floor, now);
    else this.nudgeLead(floor, role, now);
  }

  /** Nudges an idle Lead about a flagged subagent of its, once per finding. */
  private nudgeLead(floor: TeamFloor, lead: RoleId, now: number): boolean {
    const d = this.roster.data(floor.id);
    const flagged = Object.values(d.subagents).find((r) => r.lead === lead && r.state !== 'benched' && r.flaggedAt !== undefined && (r.nudgedAt === undefined || r.nudgedAt < r.flaggedAt));
    if (!flagged) return false;
    const m = d.members[lead];
    const w = this.roster.workerOf(floor, m);
    if (!w || m.phase !== 'active' || (w.status !== 'idle' && w.status !== 'done') || this.roster.standups.isAsked(floor, lead)) return false;
    const idle = this.roster.idleSince(w.id);
    if (idle === undefined || now - idle < NUDGE_GRACE_MS) return false;
    const s = scoreSubagent(flagged.runs, currentModel(flagged, 'inherit'));
    const skills = effectiveSkills(lead, d.settings.autonomy, m.skills).filter((k) => k.enabled && (k.key === 'warn' || k.key === 'bench' || k.key === 'swap-model')).map((k) => `${k.title} — ${GATE_WORDS[k.gate!]} (\`${k.how}\`)`);
    if (floor.prompt(w.id, underperformingPrompt(flagged.name, modelWord(s.model), s.why ?? 'poor reviews', skills))) return false;
    flagged.nudgedAt = now;
    struggleNudged(floor.id, w, flagged.name, s.why ?? 'poor reviews');
    floor.activity?.(`🔁 Nudged ${m.name} about ${flagged.name}'s track record (${s.why})`);
    this.roster.touch(floor, true);
    return true;
  }

  /** Queues news for the Coordinator, in the roster file's outbox (relays.ts) so a restart keeps it. */
  private queueNews(floor: TeamFloor, text: string) {
    const o = this.roster.data(floor.id).outbox;
    o.news = queueOnce(o.news, `- ${text}`);
    o.newsAt = this.roster.deps.now();
  }

  /**
   * Tells the Coordinator the team's subagent decisions, once a minute has passed since the last and
   * it's between turns. An asleep or benched one isn't woken: they wait. A floor with no Coordinator
   * drops them: each was a Lead's own doing, so there's nobody else to tell.
   */
  flushNews(floor: TeamFloor, now: number, force = false): boolean {
    const o = this.roster.data(floor.id).outbox;
    if (!o.news.length || (!force && now - (o.newsAt ?? 0) < NEWS_DEBOUNCE_MS)) return false;
    const where = coordinatorIs(this.roster, floor);
    if (where === 'none') {
      o.news = [];
      this.roster.touch(floor, true);
      return false;
    }
    const w = this.roster.workerOf(floor, this.roster.data(floor.id).members.pm);
    if (where === 'away' || !w || (w.status !== 'idle' && w.status !== 'done')) return false;
    if (floor.prompt(w.id, subagentNewsPrompt(o.news))) return false;
    o.news = [];
    this.roster.touch(floor, true);
    return true;
  }

  // ---- What the Team tab and `subagent list` show ----------------------------------------------

  private trackLine(floor: TeamFloor, lead: RoleId, name: string): string {
    const v = this.views(floor).find((x) => x.lead === lead && x.name === name);
    if (!v) return '';
    const s = v.score;
    return `Track record on ${v.model}: ${s.runs} runs, ${s.reviewed} reviewed in the last ${Math.max(s.reviewed, 1)}, ${s.accepted} accepted, ${s.reworks} reworks${s.grade ? `, grade ${s.grade}` : ''}.`;
  }

  views(floor: TeamFloor): SubagentView[] {
    const d = this.roster.data(floor.id);
    const out: SubagentView[] = [];
    for (const lead of LEADS) {
      const recs = Object.values(d.subagents).filter((r) => r.lead === lead.id);
      const names = [...lead.subagents.map((s) => s.id), ...recs.map((r) => r.name).filter((n) => !lead.subagents.some((s) => s.id === n))];
      for (const name of names) {
        const rec = recs.find((r) => r.name === name);
        const def = lead.subagents.find((s) => s.id === name);
        const model = rec ? currentModel(rec, def?.model ?? 'inherit') : (def?.model ?? 'inherit');
        out.push({
          lead: lead.id,
          name,
          defined: !!def,
          model,
          state: rec?.state ?? 'active',
          ...(rec?.benchedUntil ? { benchedUntil: rec.benchedUntil } : {}),
          ...(rec?.benchReason ? { benchReason: rec.benchReason } : {}),
          warnings: rec?.warnings.length ?? 0,
          ...(rec?.warnings.length ? { lastWarning: rec.warnings.at(-1)!.reason } : {}),
          score: scoreSubagent(rec?.runs ?? [], model),
          ...(rec?.runs.length ? { lastRunAt: rec.runs.at(-1)!.at } : {}),
        });
      }
    }
    return out;
  }

  /** `office-workers subagent list` for a Lead: its subagents with their standing and record. */
  list(floor: TeamFloor, lead: RoleId): string {
    const rows = this.views(floor).filter((v) => v.lead === lead);
    if (!rows.length) return 'No subagents on your team yet.';
    const d = this.roster.data(floor.id);
    const skills = effectiveSkills(lead, d.settings.autonomy, d.members[lead].skills).filter((k) => ['warn', 'bench', 'swap-model', 'reinstate'].includes(k.key));
    return [
      ...rows.map((v) => {
        const s = v.score;
        const state = v.state === 'benched' ? `🪑 benched${v.benchedUntil ? ` until ${new Date(v.benchedUntil).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}` : v.state === 'warning' ? '⚠️ on warning' : 'active';
        return `${v.name} (${v.model}) · ${state} · ${s.grade ? `grade ${s.grade} (${s.score}%)` : `ungraded (${s.reviewed}/${SCORE_MIN_RUNS} reviewed runs)`} · ${s.runs} runs, ${s.accepted} accepted, ${s.reworks} reworks in the last ${s.reviewed}${s.underperforming ? ` · underperforming: ${s.why}` : ''}${v.lastWarning ? ` · last warning: ${v.lastWarning}` : ''}`;
      }),
      '',
      `Your gates: ${skills.map((k) => `${k.key} ${k.enabled ? k.gate : 'off'}`).join(', ')}.`,
    ].join('\n');
  }

  /** A floor's reviewed subagent runs (one Lead's with `role`): the rankings' review facts (subagent-store.ts subagentReviews). */
  reviews(floorId: string, role?: RoleId): SubagentReview[] {
    return subagentReviews(this.roster.data(floorId), floorId, role);
  }

  /** The actions to show: pending ones, then the latest decided. */
  actionsView(floor: TeamFloor): SubagentAction[] {
    const all = this.roster.data(floor.id).subagentActions;
    return [...all.filter((a) => a.status === 'pending'), ...all.filter((a) => a.status !== 'pending').slice(-10).reverse()];
  }
}
