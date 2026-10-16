// The Project Manager's answer to an escalation as a durable dispatch (Slice 1B-1): the answer revision is
// appended to the answer store, each agent it goes to gets a dispatch whose intent is on disk before
// anything is typed, and only once every dispatch settled is the escalation resolved, pointing at
// {answerRev, dispatchId} (written with a critical roster flush). A card that answers several escalations
// does it as one group (groupId), every claim taken first. The raiser gets the answer typed now; while a
// dialog is up in its terminal, while it writes its handoff or once it's gone home, it is owed (typed by
// Escalations.owedTo, or carried by its next hire, with the same dispatch id). Those that +1'd it hear it too.
//
// Rollback (docs/site/running-the-office): the escalation is updated only after settle, so release 47
// sees it either still open (not dispatched: safe to answer) or resolved with delivered:true (typed), or
// owed with delivered:false only when it really wasn't typed. delivered:false is never written for an
// attempt whose outcome is unclear (that one leaves the escalation open and the dispatch outcome-unknown).

import { randomBytes } from 'node:crypto';
import type { WorkerInfo } from '../../shared/protocol.js';
import { OUTCOME_VERDICT, VERDICT_WORD, type Escalation, type EscalationOutcome, type EscalationVerdict } from '../../shared/roster/escalation.js';
import { escalationKind } from '../../shared/decisions/words.js';
import { isTypedUnconfirmed, type AnswerRevisionKind, type DispatchRecord } from '../../shared/dispatch.js';
import type { AnswerResult, AnswerSpec, Target } from '../dispatch/service.js';
import { audit, byWhom } from '../audit/index.js';
import { isAsleepStatus } from './bench.js';
import { mayType } from './deliver.js';
import { owedTarget, typeTarget } from './dispatch-send.js';
import type { Roster } from './index.js';
import { decisionCitation, escalationAnswerPrompt } from './prompts.js';
import type { TeamFloor } from './types.js';
import { NO_WORK_REQUIRED } from '../../shared/task-links.js';
import { primaryAnswer } from '../../shared/followthrough.js';
import { recordLine } from '../../shared/recorded-answer.js';

type Resolution = NonNullable<Escalation['resolution']>;

/** An answer as one line of the message that carries several. */
export const answerLineOf = (e: Escalation, r: Pick<Resolution, 'outcome' | 'by' | 'verdict' | 'text' | 'answerRev'>) =>
  `- “${e.title}”: ${r.outcome === 'done' ? `DONE (${r.by} says it's done: please re-check)` : VERDICT_WORD[r.verdict]}${r.text && r.outcome !== 'done' ? ` — ${r.text}` : ''} (${r.by})${r.answerRev && r.outcome !== 'done' && r.outcome !== 'noted' && r.outcome !== 'superseded' ? `. Record it on a line of its own as \`${owedRecordLine(e.id, r.answerRev, r)}\` (commentary on the next line)` : ''}`;

/** The exact record line an owed answer asks for (shared/recorded-answer.ts), the answer's placeholder when it has no words. */
function owedRecordLine(escId: string, rev: number, r: Pick<Resolution, 'verdict' | 'text'>): string {
  const answer = primaryAnswer({ text: r.text ?? '', kind: r.verdict === 'approve' || r.verdict === 'reject' ? r.verdict : 'reply' });
  return answer ? recordLine(escId, rev, answer) : `${decisionCitation(escId, rev)}: <the answer, exactly as given>`;
}

const kindOf = (verdict: EscalationVerdict, outcome?: EscalationOutcome): AnswerRevisionKind => (outcome === 'noted' ? 'noted' : outcome === 'done' ? 'done' : verdict === 'approve' ? 'approve' : verdict === 'reject' ? 'reject' : verdict === 'dismiss' ? 'moot' : 'reply');

export interface EscalationAnswer {
  verdict: EscalationVerdict;
  raw: unknown;
  by: string;
  outcome?: EscalationOutcome;
  expectedRev?: number;
  /** A duplicate closed in favour of this escalation (outcome superseded). */
  supersededBy?: string;
  /** Slice 1B-4: the person states no implementation work is required (an answer revision of that kind). */
  noWork?: boolean;
}

/** The checks before anything else: the verdict to use and the text, or why not. */
function readAnswer(e: Escalation, a: EscalationAnswer): { verdict: EscalationVerdict; text: string } | string {
  let verdict = a.verdict;
  if (a.outcome) {
    const { kind } = escalationKind(e);
    if (a.outcome === 'noted' && kind !== 'fyi') return 'Noted is only for an FYI: this one asks something, so answer it';
    if (a.outcome === 'done' && kind !== 'hands-on') return "I've done it is only for a hands-on action";
    verdict = OUTCOME_VERDICT[a.outcome].verdict;
  }
  const own = typeof a.raw === 'string' ? a.raw.replace(/\r\n?/g, '\n').trim().slice(0, 4000) : '';
  const text = a.outcome === 'done' ? own || OUTCOME_VERDICT.done.text : a.outcome === 'noted' ? OUTCOME_VERDICT.noted.text : own;
  if (verdict === 'reply' && !text) return 'Write your reply';
  if (verdict === 'reject' && !text) return 'Say why it is rejected';
  return { verdict, text };
}

/** The spec of one escalation's answer, or why it can't be answered. */
export function escalationSpec(roster: Roster, floor: TeamFloor, id: string, a: EscalationAnswer, groupId?: string): AnswerSpec | string {
  const d = roster.data(floor.id);
  const e = d.escalations.find((x) => x.id === id);
  if (!e) return 'No such escalation';
  // Answered already: a 409 when the page said which revision it saw, as before when it didn't.
  const read = e.status === 'resolved' ? undefined : readAnswer(e, a);
  if (typeof read === 'string') return read;
  const { verdict, text } = read ?? { verdict: a.verdict, text: '' };
  const decision = `esc:${e.id}`;
  /** What each target is: the raiser, or one that +1'd it. */
  const roles: ({ raiser: true } | { also: NonNullable<Escalation['also']>[number] })[] = [];
  const later: string[] = [];
  let rehire = false;
  const res = (): Pick<Resolution, 'outcome' | 'by' | 'verdict' | 'text'> => ({ verdict, text, by: a.by, ...(a.outcome ? { outcome: a.outcome } : {}) });
  const owedRaiser = (w: WorkerInfo | undefined, why: string, rev: number) => owedTarget({ workerId: w?.id, name: e.by }, answerLineOf(e, { ...res(), answerRev: rev }), why);
  return {
    decision,
    expectedRev: a.expectedRev,
    current: () => ({ rev: e.resolution?.answerRev ?? (e.status === 'resolved' ? 1 : 0), state: e.status === 'resolved' ? `answered by ${e.resolution?.by ?? 'someone'}` : 'open', ...(e.status === 'resolved' ? { open: `Already answered by ${e.resolution?.by ?? 'someone'}` } : {}) }),
    revision: { kind: a.noWork && verdict !== 'dismiss' ? 'no-work-required' : kindOf(verdict, a.outcome), text, by: a.by },
    targets: (rev) => {
      const out: Target[] = [];
      // A dismissed FYI doesn't spend a turn of the agent's; anything else is an answer it acts on.
      if (verdict === 'dismiss') return out;
      const member = e.role ? d.members[e.role] : undefined;
      const w = floor.worker(e.workerId) ?? (member ? roster.workerOf(floor, member) : undefined);
      // One writing its handoff is about to be stopped: the answer is kept, and finishBench brings it back with it.
      const leaving = !!w && !!member && member.phase === 'benching' && member.workerId === w.id;
      if (!w && e.role) rehire = true;
      // The answer carries its citation (Slice 1B-2): Decided per ESC-<id> rev <n>, the revision just appended.
      const said = escalationAnswerPrompt(e, verdict, text, a.by, a.outcome === 'superseded' ? undefined : a.outcome, rev);
      const prompt = a.noWork ? `${said}\n\n${NO_WORK_REQUIRED} for this decision: record it, and don't start work for it.` : said;
      // A dialog may be up (a permission prompt, a question, booting): the answer stays owed and goes in once its turn is over.
      const busy = (x: WorkerInfo) => !mayType(x.status) && !isAsleepStatus(x.status);
      if (w && w.kind === 'agent' && !leaving && !busy(w)) {
        // `by`: the turn acting on a person's answer is theirs, not the office's (it flags when it's done).
        out.push(typeTarget(roster, floor, w, prompt, { origin: 'person', by: a.by, wake: true, resume: true }));
        roles.push({ raiser: true });
      } else if ((w && w.kind === 'agent') || rehire) {
        if (w && busy(w) && !leaving) later.push(e.by);
        out.push(owedRaiser(w, rehire ? 'typed when it is hired back' : leaving ? 'its next hire carries it' : 'a question is open in its terminal: typed once its turn is over', rev));
        roles.push({ raiser: true });
      }
      // Those that +1'd it hear the answer too, when they're still at their desks.
      for (const x of e.also ?? []) {
        const other = floor.worker(x.workerId);
        if (!other || other.kind !== 'agent' || other.id === w?.id) continue;
        if (busy(other)) {
          later.push(x.by);
          out.push(owedTarget({ workerId: other.id, name: x.by }, answerLineOf(e, { ...res(), answerRev: rev }), 'a question is open in its terminal: typed once its turn is over'));
        } else out.push(typeTarget(roster, floor, other, prompt, { origin: 'person', by: a.by, wake: true, resume: true }));
        roles.push({ also: x });
      }
      return out;
    },
    apply: async (rev, records) => {
      let raiser: DispatchRecord | undefined;
      for (const [i, r] of records.entries()) {
        const role = roles[i];
        if (!role) continue;
        if ('raiser' in role) {
          raiser = r;
          continue;
        }
        if (r.channel === 'hold' && r.state === 'held') Object.assign(role.also, { pending: true, dispatchId: r.id });
        else if (r.state === 'refused') floor.toast(`Couldn't send the answer to ${role.also.by}, who raised the same`, 'warn');
      }
      // Refused now (it went asleep, the cap): owed like before, as a dispatch of its own.
      if (raiser?.state === 'refused') {
        floor.toast(`Couldn't send the answer to ${e.by}: ${raiser.history[raiser.history.length - 1]?.note ?? 'refused'}. It's kept for its next session.`, 'warn');
        const again = await roster.dispatch.dispatch(floor.id, decision, rev, owedRaiser(floor.worker(e.workerId), 'refused when sent: typed once it can be', rev), groupId, a.by);
        if (typeof again !== 'string') raiser = again;
      }
      // Typed, its session not showing it yet: told (delivered: never owed again, never typed twice), and flagged
      // `typed` until the session shows it (dispatch-hooks.ts applyEscalation); the dispatch record has the truth.
      // Held (the raiser mid-turn: Delivery's held list types it once its turn ends): not delivered, and flagged
      // `held` so it isn't owed (typed twice) meanwhile; delivered once its dispatch is received.
      const typed = !!raiser && isTypedUnconfirmed(raiser);
      const held = !!raiser && raiser.channel === 'type' && raiser.state === 'held';
      const delivered = !!raiser && raiser.channel === 'type' && (raiser.state === 'submitted' || typed);
      e.status = 'resolved';
      e.resolution = { verdict, text, by: a.by, at: roster.deps.now(), delivered, ...(typed ? { typed } : {}), ...(held ? { held } : {}), ...(a.outcome ? { outcome: a.outcome } : {}), answerRev: rev, ...(raiser ? { dispatchId: raiser.id } : {}), ...(a.supersededBy ? { supersededBy: a.supersededBy } : {}) };
      afterResolve(roster, floor, e, { verdict, outcome: a.outcome, by: a.by, text, delivered, held, rehire, later, rev, dispatchId: raiser?.id, groupId, supersededBy: a.supersededBy });
      // The escalation's new state on disk before the answer counts as given (an answered card must not come back open).
      await roster
        .file(floor.id)
        .flushCritical()
        .catch((err: unknown) => console.error(`agent-office: couldn't save the roster after an answer: ${(err as Error).message}`));
      if (rehire && e.role) roster.escalations.rehireRole(floor, e.role);
    },
  };
}

/** What follows an answer, as release 47 did it: the audit, the activity, a subagent ask done, the floor told. */
function afterResolve(roster: Roster, floor: TeamFloor, e: Escalation, x: { verdict: EscalationVerdict; outcome?: EscalationOutcome; by: string; text: string; delivered: boolean; held?: boolean; rehire: boolean; later: string[]; rev: number; dispatchId?: string; groupId?: string; supersededBy?: string }) {
  const said = x.outcome === 'done' ? "said it's done for" : x.outcome === 'noted' ? 'noted' : x.outcome === 'superseded' ? `closed as a duplicate (superseded by ${x.supersededBy ?? 'another'})` : `answered (${x.verdict})`;
  audit.record({
    floor: floor.id,
    actor: byWhom(x.by),
    action: 'escalation.answer',
    target: { kind: 'escalation', id: e.id, label: e.title },
    summary: `${x.outcome === 'done' ? `Said it's done (${e.by} re-checks):` : x.outcome === 'noted' ? 'Noted the FYI:' : x.outcome === 'superseded' ? `Closed as a duplicate, superseded by ${x.supersededBy ?? 'another'} (nothing sent):` : `Answered ${e.by}'s escalation (${x.verdict}):`} ${e.title}`,
    details: { verdict: x.outcome ?? x.verdict, ...(x.outcome ? { legacyVerdict: x.verdict } : {}), ...(x.supersededBy ? { supersededBy: x.supersededBy } : {}), delivered: x.delivered, ...(x.held ? { held: true } : {}), rehire: x.rehire, ...(x.later.length ? { later: x.later } : {}), reply: x.text ? { length: x.text.length } : undefined, answerRev: x.rev, ...(x.groupId ? { groupId: x.groupId } : {}) },
    ids: { decision: `esc:${e.id}`, answerRev: x.rev, ...(x.dispatchId ? { dispatchId: x.dispatchId } : {}) },
  });
  floor.activity?.(`✅ ${x.by} ${said} ${e.by}'s escalation: ${e.title}${x.held ? ` (held for ${e.by}: not delivered yet, it goes in when their turn ends)` : ''}`);
  if (x.later.length) floor.activity?.(`⏳ ${x.later.join(', ')} ${x.later.length === 1 ? 'has' : 'have'} a question open in ${x.later.length === 1 ? 'its' : 'their'} terminal: the answer goes in once that's answered`);
  // A Lead's `ask` to warn, bench, swap or reinstate a subagent: approving it does it.
  roster.subagents.onEscalationResolved(floor, e.id, x.verdict, x.by);
  roster.touch(floor);
  roster.jeff.priority.kick(floor);
}

/** One escalation answered: the result (a 409 carries the current state). */
export async function answerEscalation(roster: Roster, floor: TeamFloor, id: string, a: EscalationAnswer): Promise<AnswerResult> {
  const spec = escalationSpec(roster, floor, id, a);
  if (typeof spec === 'string') return { ok: false, status: 400, error: spec };
  return roster.dispatch.answer(floor.id, spec);
}

/**
 * A card's answer to several escalations at once (decisions/index.ts): one group id, a dispatch per member,
 * every claim taken before anything is written. `first` is the card's own escalation: an error on it is the
 * card's error; the others that can't be answered (gone, answered meanwhile) are left out.
 */
export async function answerGroup(roster: Roster, floor: TeamFloor, first: { id: string } & EscalationAnswer, others: ({ id: string } & EscalationAnswer)[]): Promise<AnswerResult> {
  const groupId = others.length ? `grp_${randomBytes(6).toString('hex')}` : undefined;
  const lead = escalationSpec(roster, floor, first.id, first, groupId);
  if (typeof lead === 'string') return { ok: false, status: 400, error: lead };
  const rest = others.map((o) => escalationSpec(roster, floor, o.id, o, groupId)).filter((s): s is AnswerSpec => typeof s !== 'string');
  return roster.dispatch.answerMany(floor.id, [lead, ...rest], groupId);
}

/** The owed answer's marker check for reconcile: is this held dispatch still owed by its escalation? */
export function stillOwed(roster: Roster, floorId: string, r: DispatchRecord): boolean {
  if (!r.decision.startsWith('esc:')) return false;
  const e = roster.data(floorId).escalations.find((x) => `esc:${x.id}` === r.decision);
  if (!e || e.status !== 'resolved' || !e.resolution) return false;
  if (e.resolution.dispatchId === r.id && !e.resolution.delivered && !e.resolution.held) return true;
  return !!e.also?.some((x) => x.dispatchId === r.id && x.pending);
}
