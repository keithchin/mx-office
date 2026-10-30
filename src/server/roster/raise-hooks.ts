// Who hears that an escalation was raised (roster/escalations.ts add): the card sweep looks at the project soon
// (card-sweep/), and the merge check starts mx check at a merge ask's commit (merge-check/). A list of listeners
// rather than imports, so the roster doesn't depend on those features. A listener that throws is logged.

import type { Escalation } from '../../shared/roster/escalation.js';

type Listener = (floorId: string, e: Escalation) => void;
const listeners = new Set<Listener>();

/** Hears every escalation raised; returns what stops it. */
export function onEscalationRaised(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Tells the listeners (called by Escalations once the escalation is on the roster). */
export function escalationRaised(floorId: string, e: Escalation) {
  for (const l of listeners) {
    try {
      l(floorId, e);
    } catch (err) {
      console.error(`agent-office: an escalation listener failed: ${(err as Error).message}`);
    }
  }
}
