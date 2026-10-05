// Interviews: a reviewer's question goes to the project team it's attached to. To its Lead (the
// Project Coordinator for the Partner and the Cost reviewer), woken if asleep; when that Lead is
// benched, to the Project Coordinator to answer for it, or back to the PM's rule: hired back just
// for the audit only when the engagement allows it; with nobody to ask, it's recorded unanswered.
// The answer comes back to the reviewer as its next prompt. All of it goes in the transcript.

import type { RoleId } from '../../shared/roster/roles.js';
import type { LeadState } from './types.js';

export type Route =
  | { kind: 'lead'; to: LeadState }
  /** Its Lead is mid-question in its own terminal: typing now would answer that, so it waits. */
  | { kind: 'wait'; to: LeadState }
  | { kind: 'relay'; to: LeadState; forRole: RoleId }
  | { kind: 'rehire'; role: RoleId }
  | { kind: 'none'; why: string };

const reachable = (l: LeadState) => l.state === 'active' || l.state === 'asleep';

/** Where a question for `role` goes, given that role and the Project Coordinator as they stand. */
export function routeQuestion(lead: LeadState, coordinator: LeadState, allowRehire: boolean): Route {
  if (reachable(lead)) return { kind: 'lead', to: lead };
  if (lead.state === 'asking') return { kind: 'wait', to: lead };
  // Being benched or benched: it's writing its handoff, or gone.
  if (allowRehire && lead.state === 'benched' && lead.role !== 'pm') return { kind: 'rehire', role: lead.role };
  if (lead.role !== 'pm' && reachable(coordinator)) return { kind: 'relay', to: coordinator, forRole: lead.role };
  return { kind: 'none', why: lead.role === 'pm' ? 'the Project Coordinator is benched' : `${lead.name} is benched and the Project Coordinator isn't on the floor either` };
}
