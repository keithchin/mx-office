// The Studio Pro hand-add gate's server side (shared/roster/handadd.ts says what it catches): an agent's
// own escalation (`office-workers escalate`, the escalate tool) that asks for a Studio Pro hand-add or
// says mxcli can't do something, with no `Tried:` section, is not raised. The agent is told, in the
// escalate tool's reply, to try the standard alternatives first and list them; it's audited
// (escalation.handadd-returned) and nothing is stored, so nothing waits on the Project Manager. Escalations
// the office files itself (raiseFor, raiseNoticed, raiseFyi) never come through here, and ones already open
// are left as they are.

import type { WorkerInfo } from '../../shared/protocol.js';
import type { EscalationAsk } from '../../shared/roster/escalation.js';
import { HANDADD_RETURN, handAddReturn } from '../../shared/roster/handadd.js';
import { agent, audit } from '../audit/index.js';
import type { TeamFloor } from './types.js';

/** The note for the agent when its ask goes back to it (audited), or undefined: raise it as usual. */
export function handAddReturned(floor: Pick<TeamFloor, 'id' | 'activity'>, w: Pick<WorkerInfo, 'id' | 'name'>, ask: EscalationAsk): string | undefined {
  const back = handAddReturn(ask);
  if (!back) return undefined;
  audit.record({
    floor: floor.id,
    actor: agent(w.name, w.id),
    action: 'escalation.handadd-returned',
    target: { kind: 'escalation', label: ask.title },
    summary: `Handed back to ${w.name}, not raised: a Studio Pro hand-add with no Tried: section: ${ask.title}`,
    details: { matched: back.matched, urgency: ask.urgency, trigger: ask.trigger, worker: w.id },
    severity: 'info',
  });
  floor.activity?.(`↩️ The office handed ${w.name}'s escalation back to try the standard alternatives first (no Tried: section): ${ask.title}`);
  return HANDADD_RETURN;
}
