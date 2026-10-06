// What the office's outbox holds for the Project Coordinator (roster/relays.ts: new escalations, the
// Project Manager's decisions, the Leads' subagent news), folded into its ▶ Resume brief so it hears
// it all in one message rather than a second straight after. Built the way Relays.wakeCoordinator
// builds it; `mark` empties the outbox and says so in the chatter, once the brief is sent.

import type { WorkerInfo } from '../../shared/protocol.js';
import type { Escalation } from '../../shared/roster/escalation.js';
import type { Proposal } from '../../shared/roster/types.js';
import { decisionsRelayed, relayedToCoordinator } from '../chatter/hooks.js';
import type { Roster } from '../roster/index.js';
import { escalationsToCoordinatorPrompt, outcomesPrompt, subagentNewsPrompt } from '../roster/prompts.js';
import type { TeamFloor } from '../roster/types.js';

export function coordinatorRelays(roster: Roster, floor: TeamFloor): { text: string; mark: (w: WorkerInfo | undefined) => void } {
  const d = roster.data(floor.id);
  const open = d.outbox.escalations.map((id) => d.escalations.find((e) => e.id === id)).filter((e): e is Escalation => !!e && e.status === 'open');
  const decided = d.outbox.decisions.map((id) => d.proposals.find((p) => p.id === id)).filter((p): p is Proposal => !!p);
  const news = [...d.outbox.news];
  const text = [open.length ? escalationsToCoordinatorPrompt(open) : '', decided.length ? outcomesPrompt(decided) : '', news.length ? subagentNewsPrompt(news) : ''].filter(Boolean).join('\n\n---\n\n');
  return {
    text,
    mark: (w) => {
      d.outbox.escalations = [];
      d.outbox.decisions = [];
      d.outbox.news = [];
      if (w && open.length) relayedToCoordinator(floor.id, w, open);
      if (w && decided.length) decisionsRelayed(floor.id, w, decided);
    },
  };
}
