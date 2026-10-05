// An escalation: something a Lead (or the Project Coordinator, or any agent on the floor) raises to
// the Project Manager — the human — when a review turned up what it shouldn't decide alone (see
// REVIEW_POLICY in autonomy.ts). The office keeps it on the floor's roster, shows it on the project
// console (the 1D view's Command Center) and in the Team tab's approvals, and sends the human's answer back to whoever raised
// it as a prompt. What arrives from an agent is read here, so the CLI, the MCP tool and the tests
// agree on what's accepted. Pure: the browser imports the types.

import { isEscalationTrigger, isFyi, isUrgency, type AutonomyLevel, type EscalationTrigger, type Urgency } from './autonomy.js';
import type { JeffRank } from './jeff-rank.js';
import type { RoleId, TeamId } from './roles.js';

/** How the Project Manager answered: free text, a yes, a no (with why), or "noted" for an FYI. */
export type EscalationVerdict = 'reply' | 'approve' | 'reject' | 'dismiss';
export const ESCALATION_VERDICTS: readonly EscalationVerdict[] = ['reply', 'approve', 'reject', 'dismiss'];
/** A verdict in one word, for the agent it goes back to. */
export const VERDICT_WORD: Record<EscalationVerdict, string> = { approve: 'APPROVED', reject: 'REJECTED', reply: 'REPLIED', dismiss: 'NOTED (no action needed)' };
export const isEscalationVerdict = (v: unknown): v is EscalationVerdict => typeof v === 'string' && (ESCALATION_VERDICTS as readonly string[]).includes(v);

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
  /** Below the floor's threshold at its autonomy level when raised: shown, but no toast or alert. */
  fyi: boolean;
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
  };
  /** Jeff's rating of how soon to resolve it, and its rank among the floor's open ones (jeff-rank.ts). */
  jeffRank?: JeffRank;
}

/** What an agent sends to raise one, before the office stamps it. */
export interface EscalationAsk {
  urgency: Urgency;
  trigger?: EscalationTrigger;
  title: string;
  details: string;
  options: string[];
  recommendation?: string;
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

/** Whether it should get the Project Manager's attention now: open, not FYI, urgent or critical. */
export const isAlarming = (e: Pick<Escalation, 'status' | 'fyi' | 'urgency'>) => e.status === 'open' && !e.fyi && (e.urgency === 'urgent' || e.urgency === 'critical');

/** Stamps an ask as raised on a floor at `level`. */
export function makeEscalation(ask: EscalationAsk, who: { workerId: string; by: string; role?: RoleId; team?: TeamId }, level: AutonomyLevel, id: string, at: number): Escalation {
  return { id, at, ...who, ...ask, level, fyi: isFyi(level, ask.urgency, ask.trigger), status: 'open' };
}

/** Open ones first, the loudest and then the newest on top; then the resolved, newest first. */
export function escalationOrder(a: Escalation, b: Escalation): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
  if (a.status === 'open') {
    const loud = (e: Escalation) => (e.fyi ? -1 : ['info', 'important', 'urgent', 'critical'].indexOf(e.urgency));
    if (loud(a) !== loud(b)) return loud(b) - loud(a);
    return b.at - a.at;
  }
  return (b.resolution?.at ?? b.at) - (a.resolution?.at ?? a.at);
}

export const URGENCY_ICON: Record<Urgency, string> = { info: 'ℹ️', important: '❗', urgent: '🚨', critical: '🛑' };
