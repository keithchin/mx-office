// Which decision cards (shared/decisions/, collectDecisions in shared/needsyou.ts) are the business owner's
// (C4 of the App Workspace proposal, section 7: "business-kind items only"). The App Workspace shows only
// those; the Engineering view keeps every card, these included. The rule is explicit and closed: a card
// is the business owner's only for a reason listed here, anything else is the team's, and anything this
// table doesn't know is `unknown` and stays out of the App view (it is never lost: the Engineering view
// shows it). Pure.
//
//   kind hands-on / fyi / status                      engineering (sign-ins, merges, FYIs, what the office noticed)
//   a client question (Questions page, BRD)            business
//   a stage's sign-off (✋ gate)                        business: agreeing the scope or a result
//   a design system to adopt for the app                business: how the app looks
//   an escalation with a business trigger               business: plan, scope, design, milestone,
//                                                       client-milestone, question
//   an escalation with an engineering trigger           engineering: architecture, review rounds, blocked,
//                                                       repeated failures, budget, security, data loss,
//                                                       blocked with no path, a hands-on step
//   a permission card (a command the team was denied)   engineering
//   an escalation with no trigger                       unknown
//   a stuck decision that is a client question          business; any other stuck item unknown
//   proposals, merges, approvals, PR checks, brains     engineering
//   surfaced asks (assumptions) and anything else       unknown

import type { DecisionCard } from '../decisions/types.js';
import type { EscalationTrigger } from '../roster/autonomy.js';

export type Audience = 'business' | 'engineering' | 'unknown';

export const BUSINESS_TRIGGERS: readonly EscalationTrigger[] = ['plan', 'scope', 'design', 'milestone', 'client-milestone', 'question'];
export const ENGINEERING_TRIGGERS: readonly EscalationTrigger[] = ['architecture', 'revisions-exhausted', 'blocked', 'repeated-failure', 'budget-risk', 'security', 'data-loss', 'budget-overrun', 'blocked-no-path', 'needs-human'];

type CardFacts = Pick<DecisionCard, 'kind' | 'sources' | 'trigger' | 'permission' | 'questionKey' | 'duplicates'>;

/** Whose decision a card is, and why (the table at the top). */
export function audienceOf(c: CardFacts): { audience: Audience; why: string } {
  if (c.kind !== 'decision') return { audience: 'engineering', why: `a ${c.kind} card` };
  if (c.permission) return { audience: 'engineering', why: 'a command the team was denied' };
  if (c.duplicates) return { audience: 'engineering', why: 'tidying likely duplicates' };
  const src = c.sources[0];
  switch (src?.type) {
    case 'question':
      return { audience: 'business', why: 'a question for the client' };
    case 'signoff':
      return { audience: 'business', why: 'a stage’s sign-off' };
    case 'escalation':
      if (!c.trigger) return { audience: 'unknown', why: 'an escalation without a trigger' };
      if (BUSINESS_TRIGGERS.includes(c.trigger)) return { audience: 'business', why: `trigger ${c.trigger}` };
      if (ENGINEERING_TRIGGERS.includes(c.trigger)) return { audience: 'engineering', why: `trigger ${c.trigger}` };
      return { audience: 'unknown', why: `trigger ${c.trigger}` };
    case 'stuck':
      return c.questionKey ? { audience: 'business', why: 'a client question that is stuck' } : { audience: 'unknown', why: 'a stuck item' };
    case 'approval':
    case 'pr-check':
    case 'brain':
      return { audience: 'engineering', why: src.type };
    case 'other':
      if (src.id.startsWith('design:')) return { audience: 'business', why: 'a design system for the app' };
      return { audience: 'unknown', why: src.id };
    default:
      return { audience: 'unknown', why: src?.type ?? 'no source' };
  }
}

/** Whether the App Workspace shows the card: the business owner's only. */
export const isBusinessDecision = (c: CardFacts) => audienceOf(c).audience === 'business';
