// An escalation: something a Lead (or the Project Coordinator, or any agent on the floor) raises to
// the Project Manager — the human — when a review turned up what it shouldn't decide alone (see
// REVIEW_POLICY in autonomy.ts). The office keeps it on the floor's roster, shows it on the project
// console (the 1D view's Command Center) and in the Team tab's approvals, and sends the human's answer back to whoever raised
// it as a prompt. What arrives from an agent is read here, so the CLI, the MCP tool and the tests
// agree on what's accepted. Pure: the browser imports the types.

import { isEscalationTrigger, isFyi, isUrgency, type AutonomyLevel, type EscalationTrigger, type Urgency } from './autonomy.js';
import type { JeffRank } from './jeff-rank.js';
import type { RoleId, TeamId } from './roles.js';
import { refsFromTitle } from '../decisions/ids.js';

/** How the Project Manager answered: free text, a yes, a no (with why), or "noted" for an FYI. */
export type EscalationVerdict = 'reply' | 'approve' | 'reject' | 'dismiss';
export const ESCALATION_VERDICTS: readonly EscalationVerdict[] = ['reply', 'approve', 'reject', 'dismiss'];
/** A verdict in one word, for the agent it goes back to. */
export const VERDICT_WORD: Record<EscalationVerdict, string> = { approve: 'APPROVED', reject: 'REJECTED', reply: 'REPLIED', dismiss: 'NOTED (no action needed)' };
export const isEscalationVerdict = (v: unknown): v is EscalationVerdict => typeof v === 'string' && (ESCALATION_VERDICTS as readonly string[]).includes(v);

/**
 * What the person's answer meant, beside the verdict (decision cards, shared/decisions/): `noted` an FYI
 * acknowledged, `done` a hands-on action the person says they did, `superseded` a duplicate closed in
 * favour of another (Needs you's clean-up card: nothing is sent). The verdict next to it stays one an older
 * office knows (noted and superseded: dismiss; done: reply "Done"), so a rollback still shows it.
 */
export type EscalationOutcome = 'noted' | 'done' | 'superseded';
export const isEscalationOutcome = (v: unknown): v is EscalationOutcome => v === 'noted' || v === 'done' || v === 'superseded';
/** The legacy verdict and text written beside an outcome. */
export const OUTCOME_VERDICT: Record<EscalationOutcome, { verdict: EscalationVerdict; text: string }> = { noted: { verdict: 'dismiss', text: '' }, done: { verdict: 'reply', text: 'Done' }, superseded: { verdict: 'dismiss', text: '' } };

/** The explicit ids an escalation is about, for grouping it with the other sources of the same decision (shared/decisions/). */
export interface EscalationRefs {
  /** A BRD question's key, `<file>#<id>`. */
  questionKey?: string;
  /** A register decision or question id (OW-1, OQ-07, S4-3). */
  decisionId?: string;
  pr?: number;
  stageId?: string;
  stuckId?: string;
  /** A journey or test id (J-08). */
  journeyId?: string;
}

export interface Escalation {
  id: string;
  at: number;
  /** The worker that raised it, and its name then; its roster role and team when it's a member. */
  workerId: string;
  by: string;
  role?: RoleId;
  team?: TeamId;
  urgency: Urgency;
  trigger?: EscalationTrigger;
  /** Below the floor's threshold at its autonomy level when raised: shown, but no toast or alert. Read it through fyiNow. */
  fyi: boolean;
  /** It would have been FYI, but it asks for a decision (decisionReason), so the office filed it as one: why. */
  fyiCorrected?: string;
  /** The office itself filed it as FYI (by the level, for something it noticed; or a subagent gate that's FYI): kept FYI whatever it offers. */
  fyiKept?: true;
  /** The autonomy level it was judged against. */
  level: AutonomyLevel;
  title: string;
  details: string;
  options: string[];
  recommendation?: string;
  status: 'open' | 'resolved';
  resolution?: {
    verdict: EscalationVerdict;
    text: string;
    by: string;
    at: number;
    /** Whether the answer reached the agent that raised it (it may have gone home meanwhile). */
    delivered: boolean;
    /** What it meant (FYI noted, hands-on done), when it was one of those; `verdict` is the legacy word beside it. */
    outcome?: EscalationOutcome;
    /** The answer store's revision this answer is (server/answers/: the full text lives there). */
    answerRev?: number;
    /** The dispatch that carried it to the raiser (server/dispatch/), when one did. */
    dispatchId?: string;
    /** Closed as a duplicate of this escalation (outcome superseded). */
    supersededBy?: string;
  };
  /** Jeff's rating of how soon to resolve it, and its rank among the floor's open ones (jeff-rank.ts). */
  jeffRank?: JeffRank;
  /**
   * Other agents that raised the same while it was open (a "+1"): merged into this one instead of a
   * second escalation, and told the answer too (roster/escalations.ts).
   */
  also?: { workerId: string; by: string; role?: RoleId; at: number; /** Answered while a dialog was up in its terminal: told once that's over. */ pending?: boolean; /** The dispatch carrying the answer to it. */ dispatchId?: string }[];
  /** Filed by the office from an agent's words (server/asks/): an AWAITING-PM item (keyed by role and text), resolved by itself once the line is gone. */
  from?: { kind: 'awaiting'; key: string } | { kind: 'proposal'; key: string };
  /** The explicit ids it is about. Missing on records from before decision cards (release 45): those show ungrouped. */
  refs?: EscalationRefs;
  /** The AWAITING-PM line it was filed from is gone from the newest entry: not settled; the person says (decision cards). */
  sourceGone?: { at: number; what: string; /** When the person said it's still needed and the agent was asked. */ asked?: number };
  /** The person told the agent something without answering it (Can't now, Still needed): the last time. */
  told?: { at: number; what: string; by: string };
}

/** What an agent sends to raise one, before the office stamps it. */
export interface EscalationAsk {
  urgency: Urgency;
  trigger?: EscalationTrigger;
  title: string;
  details: string;
  options: string[];
  recommendation?: string;
  /** Ids the raiser named explicitly (merged over what the title names). */
  refs?: EscalationRefs;
}

const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');

/** An escalation request read from its JSON body; a string says what's wrong with it. */
export function readEscalationAsk(body: unknown): EscalationAsk | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const urgency = b.urgency ?? 'important';
  if (!isUrgency(urgency)) return 'urgency is one of info, important, urgent, critical';
  if (b.trigger !== undefined && b.trigger !== '' && !isEscalationTrigger(b.trigger)) return `trigger is one of plan, scope, design, architecture, revisions-exhausted, blocked, milestone, repeated-failure, budget-risk, security, data-loss, client-milestone, budget-overrun, blocked-no-path`;
  const title = line(b.title, 160);
  if (!title) return 'Give it a title: one line saying what needs the Project Manager';
  const raw = Array.isArray(b.options) ? b.options : typeof b.options === 'string' ? b.options.split('|') : [];
  const options = raw.map((o) => line(o, 200)).filter(Boolean).slice(0, 6);
  const recommendation = line(b.recommendation ?? b.recommend, 400) || undefined;
  return { urgency, ...(isEscalationTrigger(b.trigger) ? { trigger: b.trigger } : {}), title, details: text(b.details, 6000), options, ...(recommendation ? { recommendation } : {}) };
}

/** A customer checkpoint named in a title (CAC-3): the toolkit's checkpoints always ask the customer. */
const CHECKPOINT = /(?<![\w-])CAC-\d+[a-z]?(?![\w-])/i;
/** A gate or a stage named in a title. */
const GATE = /\b(gate|stage)\s+[P0-7]\b/i;
/** Words that make a title naming a register id, a gate or a stage a decision ("sign off OW-1", "approve Stage 2"). */
const DECIDE_WORDS = /\b(sign[- ]?off|approve|decide|choose|confirm)\b/i;
const asksQuestion = (e: Pick<Escalation, 'title' | 'details'>) => /\?/.test(`${e.title}\n${e.details}`.replace(/https?:\/\/\S+/g, ' '));

/**
 * Why an escalation is a decision whatever its FYI flag (FYI is information only): it has answer options,
 * a recommendation and a question, or its title names a customer checkpoint (CAC-3) or asks to sign off,
 * approve or decide a register id, a gate or a stage ("sign off OW-1", "approve Stage 2"). Undefined:
 * nothing in it needs an answer.
 */
export function decisionReason(e: Pick<Escalation, 'options' | 'recommendation' | 'title' | 'details'> & { refs?: EscalationRefs }): string | undefined {
  if (e.options.length) return 'it has answer options';
  if (e.recommendation && asksQuestion(e)) return 'it has a recommendation and asks a question';
  const id = CHECKPOINT.exec(e.title)?.[0];
  if (id) return `it names a sign-off (${id})`;
  if (!DECIDE_WORDS.test(e.title)) return undefined;
  const ref = e.refs?.decisionId ?? refsFromTitle(e.title).decisionId ?? GATE.exec(e.title)?.[0];
  return ref ? `it asks for a decision on ${ref}` : undefined;
}

/**
 * Whether it is FYI now: an open one stored as FYI (before the office corrected that at raise time) is
 * read as a decision when it asks for one (decisionReason), without rewriting it. A resolved one keeps its flag.
 */
export const fyiNow = (e: Pick<Escalation, 'fyi' | 'status'> & Partial<Pick<Escalation, 'options' | 'recommendation' | 'title' | 'details' | 'refs' | 'fyiKept'>>) =>
  e.fyi && (!!e.fyiKept || !(e.status === 'open' && decisionReason({ options: e.options ?? [], title: e.title ?? '', details: e.details ?? '', recommendation: e.recommendation, refs: e.refs })));

/** Whether it should get the Project Manager's attention now: open, not FYI, urgent or critical. */
export const isAlarming = (e: Pick<Escalation, 'status' | 'fyi' | 'urgency'>) => e.status === 'open' && !e.fyi && (e.urgency === 'urgent' || e.urgency === 'critical');

/** Stamps an ask as raised on a floor at `level`. */
export function makeEscalation(ask: EscalationAsk, who: { workerId: string; by: string; role?: RoleId; team?: TeamId }, level: AutonomyLevel, id: string, at: number): Escalation {
  // Every new one carries refs (maybe empty): only a record without them is a legacy one.
  const refs = { ...refsFromTitle(ask.title), ...(ask.refs ?? {}) };
  return { id, at, ...who, ...ask, refs, level, fyi: isFyi(level, ask.urgency, ask.trigger), status: 'open' };
}

/** Open ones first, the loudest and then the newest on top; then the resolved, newest first. */
export function escalationOrder(a: Escalation, b: Escalation): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
  if (a.status === 'open') {
    const loud = (e: Escalation) => (fyiNow(e) ? -1 : ['info', 'important', 'urgent', 'critical'].indexOf(e.urgency));
    if (loud(a) !== loud(b)) return loud(b) - loud(a);
    return b.at - a.at;
  }
  return (b.resolution?.at ?? b.at) - (a.resolution?.at ?? a.at);
}

export const URGENCY_ICON: Record<Urgency, string> = { info: 'ℹ️', important: '❗', urgent: '🚨', critical: '🛑' };
