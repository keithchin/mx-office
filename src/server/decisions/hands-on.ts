// A human-action proposal, once approved (roster/standup-run.ts decide): its issue, and a hands-on card in
// Needs you, open until the person presses I've done it (decision cards, D05). The card is an escalation
// the office files on the proposer's behalf (trigger needs-human, from the proposal), so it answers like
// any other: I've done it tells the proposer it's done and asks it to re-check, never "APPROVED".

import type { Escalation } from '../../shared/roster/escalation.js';
import type { Proposal } from '../../shared/roster/types.js';
import type { Roster } from '../roster/index.js';
import type { TeamFloor } from '../roster/types.js';

/** Files the hands-on card for an approved human-action proposal; the escalation, or undefined when one is already open for it. */
export function raiseHandsOn(roster: Roster, floor: TeamFloor, p: Proposal, by: string): Escalation | undefined {
  const d = roster.data(floor.id);
  if (d.escalations.some((e) => e.status === 'open' && e.from?.kind === 'proposal' && e.from.key === p.id)) return undefined;
  const m = d.members[p.role];
  const issue = p.issue?.number ? ` Its issue is #${p.issue.number}.` : p.issue?.dryRun ? ' (Dry run: no issue was made.)' : '';
  const e = roster.escalations.raiseFor(
    floor,
    { workerId: m?.workerId ?? `benched-${p.role}`, by: p.by, role: p.role },
    {
      urgency: 'important',
      trigger: 'needs-human',
      title: p.title,
      details: [`${by} approved ${p.by}'s hands-on proposal (standup ${p.standup}).${issue} Only a person can do it.`, '', p.detail, '', `Press I've done it once it's done: ${p.by} is told and re-checks. Pressing it doesn't prove it worked.`].filter((x, i, a) => x || (i > 0 && a[i - 1])).join('\n'),
      options: [],
    },
    `✋ ${by} approved a hands-on action for a person: ${p.title}`,
  );
  e.from = { kind: 'proposal', key: p.id };
  roster.touch(floor);
  return e;
}
