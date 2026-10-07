// What a reviewer does through `office-workers firm` (hooks/firm.ts hands it over once its token is
// checked): ask the project team a question, send a section of the report, fetch fresh evidence,
// say it's done; and the project side's answer coming back. Questions are rate-limited per
// reviewer, routed by interviews.ts, and every one is in the engagement's transcript.

import { ANSWER_TIMEOUT_MS, AUDIT_TEAMS, isActive, mayAsk, QUESTION_LIMITS, spentOf, type Engagement, type Question, type ReviewerRun } from '../../shared/firm/engagement.js';
import { isSectionKey, PARTNER_SECTIONS, validateSection, type ReviewerSection } from '../../shared/firm/report.js';
import { REVIEWER_BY_ID } from '../../shared/firm/roles.js';
import { LEADS, ROLE_BY_ID, type RoleId, type TeamId } from '../../shared/roster/roles.js';
import type { Firm } from './index.js';
import { routeQuestion } from './interviews.js';
import { answerPrompt, questionPrompt, unansweredPrompt } from './prompts.js';
import { missingRequired } from './report-build.js';

export const EVIDENCE_NAMES = ['github', 'ranking', 'roster', 'summary', 'judge', 'analysis', 'audit', 'liveapp', 'sections'] as const;

/** The role on a team a question goes to: its Lead, or the Project Coordinator for management. */
const roleFor = (team: TeamId): RoleId => (team === 'management' ? 'pm' : (LEADS.find((l) => l.team === team)?.id ?? 'pm'));

export class FirmDesk {
  constructor(private firm: Firm) {}

  private get deps() {
    return this.firm.deps;
  }

  /** A reviewer's question to the team it's attached to. */
  async ask(e: Engagement, r: ReviewerRun, rawTeam: unknown, rawText: unknown): Promise<{ question: Question; note: string } | string> {
    if (!isActive(e.phase) || e.phase === 'staffing') return 'The engagement isn\'t in its fieldwork';
    const role = REVIEWER_BY_ID.get(r.id)!;
    const text = typeof rawText === 'string' ? rawText.replace(/\r\n?/g, '\n').trim().slice(0, 2000) : '';
    if (!text) return 'Ask something: office-workers firm ask --team <team> "question"';
    const team = (typeof rawTeam === 'string' && rawTeam ? rawTeam : role.team) as TeamId;
    const allowed: TeamId[] = r.id === 'partner' ? ['management', ...e.config.teams] : [role.team];
    if (!allowed.includes(team)) return `You're attached to ${role.team}: ask --team ${allowed.join(' or ')}`;
    const ok = mayAsk(e, r.id, this.deps.now());
    if (ok !== true) return ok;
    const floor = this.deps.floor(e.floor);
    if (!floor) return 'The project\'s floor is closed';
    // To whoever covers the team (its own Lead, or the member covering it on a Solo or Startup team).
    const forRole = floor.coverOf?.(team) ?? roleFor(team);
    const q: Question = { id: `Q${e.id.slice(-4)}-${e.questions.length + 1}`, reviewer: r.id, team, text, at: this.deps.now(), status: 'open' };
    e.questions.push(q);
    r.asked++;
    this.firm.note(e, r.name, `❓ ${q.id} to ${team}: ${text}`);
    const route = routeQuestion(floor.lead(forRole), floor.lead(floor.coverOf?.('management') ?? 'pm'), e.config.allowRehire);
    let note: string;
    if (route.kind === 'lead' || route.kind === 'relay' || route.kind === 'wait') {
      const to = route.to;
      q.to = { role: to.role, name: to.name, workerId: to.workerId ?? '', ...(route.kind === 'relay' ? { relayed: true } : {}) };
      const err = route.kind === 'wait' ? 'busy' : floor.deliver(q.to.workerId, questionPrompt(q, e, route.kind === 'relay' ? route.forRole : undefined), to.state === 'asleep');
      if (err) q.to.pending = true;
      note = route.kind === 'relay' ? `Its Lead is benched: asked the Project Coordinator (${to.name}) to answer for them.` : err ? `${to.name} is busy with a question of its own: yours goes in as soon as it's free.` : `Asked ${to.name}, the ${ROLE_BY_ID.get(to.role)!.title}${to.state === 'asleep' ? ' (woken for it)' : ''}.`;
    } else if (route.kind === 'rehire') {
      const err = await floor.rehire(route.role, questionPrompt(q, e));
      const lead = floor.lead(route.role);
      if (err || !lead.workerId) {
        q.status = 'unanswered';
        q.why = `hiring ${lead.name} back failed: ${err ?? 'no worker'}`;
        note = `Recorded unanswered: ${q.why}.`;
      } else {
        q.to = { role: lead.role, name: lead.name, workerId: lead.workerId };
        note = `${lead.name} was benched: hired back to answer (the engagement allows it).`;
      }
    } else {
      q.status = 'unanswered';
      q.why = route.why;
      note = `Recorded unanswered: ${route.why}. Carry on from the evidence.`;
    }
    this.firm.note(e, 'The Firm', `${q.id}: ${note}`);
    this.firm.save(e, true);
    return { question: q, note };
  }

  /** The project side answering: only the worker it went to, only while it's open. */
  answer(workerId: string, qid: unknown, rawText: unknown): { engagement: string; reviewer: string } | string {
    const text = typeof rawText === 'string' ? rawText.replace(/\r\n?/g, '\n').trim().slice(0, 8000) : '';
    if (!text) return 'Give your answer: office-workers firm answer <id> "…"';
    for (const e of this.firm.list()) {
      const q = e.questions.find((x) => x.id === qid);
      if (!q) continue;
      if (!isActive(e.phase)) return 'That audit has ended';
      if (q.status !== 'open') return `${q.id} is already ${q.status}`;
      if (q.to?.workerId !== workerId) return `${q.id} was asked of ${q.to?.name ?? 'someone else'}, not you`;
      q.status = 'answered';
      q.answer = text;
      q.answeredAt = this.deps.now();
      q.to.pending = false;
      const r = e.reviewers.find((x) => x.id === q.reviewer)!;
      this.firm.note(e, q.to.name, `💬 ${q.id}: ${text}`);
      this.firm.send(e, r, answerPrompt(q, q.to.name, ROLE_BY_ID.get(q.to.role as RoleId)?.title ?? q.to.role));
      this.firm.save(e, true);
      return { engagement: e.id, reviewer: r.name };
    }
    return `No question ${String(qid)} from the Firm`;
  }

  /** A section of the report, checked against the schema before it's kept. */
  submit(e: Engagement, r: ReviewerRun, key: unknown, raw: unknown): { note: string } | string {
    if (!isActive(e.phase)) return 'The engagement has ended';
    if (!isSectionKey(key)) return `--section is one of reviewer (a specialist) or ${PARTNER_SECTIONS.join(', ')} (the Partner)`;
    if (r.id === 'partner' && key === 'reviewer') return `As the Partner you send the report's own sections: ${PARTNER_SECTIONS.join(', ')}`;
    if (r.id !== 'partner' && key !== 'reviewer') return 'As a specialist you send one section: --section reviewer';
    const checked = validateSection(key, raw);
    if (!checked.ok) return `That section doesn't fit the schema: ${checked.error}`;
    const s = this.firm.sectionsOf(e.id);
    if (key === 'reviewer') {
      const sec = checked.value as ReviewerSection;
      for (const f of sec.findings) f.reviewer = r.id;
      s[`reviewer:${r.id}`] = sec;
      r.submitted = true;
      r.status = 'writing';
    } else {
      s[key] = checked.value;
      r.submitted = missingRequired(s).length === 0;
    }
    this.firm.saveSections(e.id);
    this.firm.note(e, r.name, `📝 Sent ${key === 'reviewer' ? 'its section' : `the ${key} section`}.`);
    this.firm.save(e, true);
    const missing = r.id === 'partner' ? missingRequired(s) : [];
    return { note: missing.length ? `Kept. Still required: ${missing.join(', ')}.` : 'Kept. When everything is sent, run office-workers firm done.' };
  }

  /** The reviewer says it's finished: released once this turn ends. */
  done(e: Engagement, r: ReviewerRun, rawNote: unknown): string | undefined {
    if (!isActive(e.phase)) return 'The engagement has ended';
    const wrap = !!e.wrapUpAt;
    if (r.id === 'partner') {
      if (e.phase === 'fieldwork' && !wrap) return 'Not yet: the specialists are still at work. Their sections come to you as a prompt; stop your turn until then.';
      const missing = missingRequired(this.firm.sectionsOf(e.id));
      if (missing.length && !wrap) return `Send ${missing.join(', ')} first`;
    } else if (!r.submitted && !wrap) return 'Send your section first: office-workers firm report --section reviewer --file out/section.json';
    r.status = 'done';
    r.endedAt = this.deps.now();
    const note = typeof rawNote === 'string' ? rawNote.trim().slice(0, 300) : '';
    this.firm.note(e, r.name, `✅ Done${note ? `: ${note}` : ''}.`);
    this.firm.advance(e);
    this.firm.save(e, true);
    return undefined;
  }

  /** Fresh evidence from the office, by name; the specialists' sections only for the Partner. */
  async evidence(e: Engagement, r: ReviewerRun, name: unknown): Promise<unknown> {
    if (!EVIDENCE_NAMES.includes(name as (typeof EVIDENCE_NAMES)[number])) return `One of ${EVIDENCE_NAMES.join(', ')}`;
    if (name === 'sections') {
      const s = this.firm.sectionsOf(e.id);
      return r.id === 'partner' ? s : { [`reviewer:${r.id}`]: s[`reviewer:${r.id}`] };
    }
    const floor = this.deps.floor(e.floor);
    if (!floor) return 'The project\'s floor is closed';
    return (await floor.evidence())[name as string] ?? null;
  }

  status(e: Engagement, r: ReviewerRun) {
    const lim = QUESTION_LIMITS[e.config.depth];
    return {
      engagement: e.id,
      phase: e.phase,
      you: { id: r.id, status: r.status, submitted: r.submitted, cost: Math.round(r.cost * 100) / 100 },
      budget: { spent: Math.round(spentOf(e) * 100) / 100, cap: e.config.budget, wrapUp: !!e.wrapUpAt },
      questions: { asked: r.asked, left: Math.max(0, lim.total - e.questions.filter((q) => q.reviewer === r.id).length), open: e.questions.filter((q) => q.reviewer === r.id && q.status === 'open').map((q) => q.id) },
      reviewers: e.reviewers.map((x) => ({ id: x.id, name: x.name, status: x.status, submitted: x.submitted })),
      teams: [...AUDIT_TEAMS],
    };
  }

  /** Every tick: questions waiting for a busy Lead go in, and the ones nobody answered time out. */
  tick(e: Engagement, now: number) {
    const floor = this.deps.floor(e.floor);
    for (const q of e.questions) {
      if (q.status !== 'open') continue;
      const r = e.reviewers.find((x) => x.id === q.reviewer)!;
      if (now - q.at > ANSWER_TIMEOUT_MS) {
        q.status = 'unanswered';
        q.why = `no answer within ${Math.round(ANSWER_TIMEOUT_MS / 60_000)} minutes`;
        this.firm.note(e, 'The Firm', `${q.id}: ${q.why}.`);
        this.firm.send(e, r, unansweredPrompt(q));
        this.firm.save(e, true);
        continue;
      }
      if (q.to?.pending && floor) {
        const lead = floor.lead(q.to.role as RoleId);
        if (lead.workerId !== q.to.workerId || (lead.state !== 'active' && lead.state !== 'asleep')) continue;
        if (!floor.deliver(q.to.workerId, questionPrompt(q, e), lead.state === 'asleep')) {
          q.to.pending = false;
          this.firm.save(e, true);
        }
      }
    }
  }
}
